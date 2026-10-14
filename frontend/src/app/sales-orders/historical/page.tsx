"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { selectClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { RequirePermission } from "@/components/require-permission";
import { useAdminUser } from "@/app/admin/layout";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { TransactionInfoFields, emptyTransactionInfo, transactionInfoErrors, transactionInfoPayload, type TransactionInfo } from "@/components/payments/transaction-info";
import { PAYMENT_DOCUMENT_ACCEPT } from "../../receipts/[id]/_sections/DocumentsSection";
import { formatMoney } from "@/lib/format";
import { parseNumberInput } from "@/lib/number-input";
import { CustomerInfo } from "../_form/CustomerInfo";
import { paymentMethodLabels } from "../../receipts/shared";
import { QUICK_SALE_PAYMENT_METHODS, type QuickSalePaymentMethod } from "../quick-sale/shared";
import type { SalesFormOptions } from "../shared";
import { historicalPaymentModeLabels, type HistoricalPaymentMode, type HistoricalSaleResult } from "./shared";

type ItemRow = { key: string; itemId: string; quantity: string; unitPrice: string; discountPercent: string; discountAmount: string; taxRate: string };
type Sale = {
  key: string;
  saleDate: string;
  customerId: string;
  categoryId: string;
  paymentMode: HistoricalPaymentMode;
  paymentMethod: QuickSalePaymentMethod;
  paymentAmount: string;
  // Empty = same as the sale date.
  paymentDate: string;
  referenceNumber: string;
  txInfo: TransactionInfo;
  files: { key: string; file: File; note: string }[];
  items: ItemRow[];
  errors: string[];
};

const emptyItem = (): ItemRow => ({ key: crypto.randomUUID(), itemId: "", quantity: "1", unitPrice: "", discountPercent: "", discountAmount: "", taxRate: "" });
const emptySale = (base?: Sale): Sale => ({
  key: crypto.randomUUID(),
  saleDate: base?.saleDate ?? "",
  customerId: "",
  categoryId: base?.categoryId ?? "",
  paymentMode: base?.paymentMode ?? "FULL",
  paymentMethod: base?.paymentMethod ?? "CASH",
  paymentAmount: "",
  paymentDate: "",
  referenceNumber: "",
  txInfo: emptyTransactionInfo,
  files: [],
  items: [emptyItem()],
  errors: [],
});

const isBlankItem = (item: ItemRow) => !item.itemId && !item.unitPrice;

// Same formula as the backend (sales-totals.ts): gross − discount (percent OR amount) + tax on the rest.
function lineTotal(item: ItemRow): number {
  const gross = Math.round((parseNumberInput(item.quantity) || 0) * (parseNumberInput(item.unitPrice) || 0));
  const percent = item.discountPercent.trim() === "" ? null : parseNumberInput(item.discountPercent);
  const discount = percent !== null ? Math.round((gross * percent) / 100) : parseNumberInput(item.discountAmount) || 0;
  return gross - discount + Math.round(((gross - discount) * (parseNumberInput(item.taxRate) || 0)) / 100);
}

// «ثبت فروش‌های تاریخی» — fast entry of past sales on one page. Every sale
// block becomes a normal order → delivery → invoice → receipt on its own
// date (POST /historical-sales, the same chain as the quick sale). Sales are
// independent: the ones that save are removed from the page and listed with
// their document numbers; a failed one stays, with its errors, to fix and
// resubmit. «کپی فروش» repeats a sale's date / payment settings for the next.
function HistoricalSalesScreen() {
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  // Discounts are a sales.approve privilege on every order (B3) — the inputs only show for those users.
  const canDiscount = useAdminUser()?.permissions.includes("sales.approve") ?? false;
  const [options, setOptions] = useState<SalesFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([emptySale()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Extract<HistoricalSaleResult, { ok: true }>[]>([]);

  useEffect(() => {
    apiFetch<SalesFormOptions>("/sales-orders/form-options")
      .then(setOptions)
      .catch((reason: unknown) => setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود."));
  }, []);

  const itemById = new Map((options?.items ?? []).map((item) => [String(item.id), item]));

  function patchSale(key: string, patch: Partial<Sale>) {
    setSales((current) => current.map((sale) => (sale.key === key ? { ...sale, ...patch } : sale)));
  }
  function patchItem(saleKey: string, itemKey: string, patch: Partial<ItemRow>) {
    setSales((current) => current.map((sale) => (sale.key === saleKey ? { ...sale, items: sale.items.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)) } : sale)));
  }
  function pickItem(saleKey: string, itemKey: string, itemId: string) {
    const option = itemById.get(itemId);
    patchItem(saleKey, itemKey, { itemId, unitPrice: option?.sellingPrice != null ? String(Number(option.sellingPrice)) : "" });
  }

  const saleTotal = (sale: Sale) => sale.items.reduce((sum, item) => sum + lineTotal(item), 0);

  async function submit() {
    const problems: string[] = [];
    const payload = sales.map((sale, index) => {
      const label = `فروش ${(index + 1).toLocaleString("fa-IR")}`;
      const items = sale.items.filter((item) => !isBlankItem(item));
      if (!sale.saleDate) problems.push(`${label}: تاریخ را وارد کنید.`);
      if (!sale.customerId) problems.push(`${label}: مشتری را انتخاب کنید.`);
      if (items.length === 0) problems.push(`${label}: حداقل یک کالا وارد کنید.`);
      for (const item of items) {
        if (item.discountPercent.trim() !== "" && item.discountAmount.trim() !== "") problems.push(`${label}: برای تخفیف هر ردیف فقط یکی از «درصد» یا «مبلغ» را وارد کنید.`);
        if (!item.itemId || !((parseNumberInput(item.quantity) || 0) > 0) || !(parseNumberInput(item.unitPrice) >= 0)) problems.push(`${label}: کالا، مقدار و قیمت هر ردیف را کامل کنید.`);
      }
      if (sale.paymentMode !== "NONE") problems.push(...transactionInfoErrors(sale.txInfo).map((message) => `${label}: ${message}`));
      if (sale.paymentMode !== "NONE" && sale.paymentDate && sale.saleDate && sale.paymentDate < sale.saleDate) problems.push(`${label}: تاریخ پرداخت نمی‌تواند پیش از تاریخ فروش باشد.`);
      if (sale.paymentMode === "NONE" && sale.files.length > 0) problems.push(`${label}: برای فروش پرداخت‌نشده مدرک پرداخت پیوست نمی‌شود.`);
      if (sale.paymentMode === "PARTIAL" && !((parseNumberInput(sale.paymentAmount) || 0) > 0)) problems.push(`${label}: مبلغ دریافتی را وارد کنید.`);
      if (sale.paymentMode === "PARTIAL" && (parseNumberInput(sale.paymentAmount) || 0) > saleTotal(sale)) problems.push(`${label}: مبلغ دریافتی از جمع فروش بیشتر است.`);
      return {
        customerId: Number(sale.customerId),
        saleDate: sale.saleDate,
        items: items.map((item) => ({
          itemId: Number(item.itemId),
          quantity: parseNumberInput(item.quantity),
          unitPrice: parseNumberInput(item.unitPrice),
          discountPercent: canDiscount && item.discountPercent.trim() !== "" ? parseNumberInput(item.discountPercent) : undefined,
          discountAmount: canDiscount && item.discountAmount.trim() !== "" ? parseNumberInput(item.discountAmount) : undefined,
          taxRate: item.taxRate.trim() === "" ? undefined : parseNumberInput(item.taxRate),
        })),
        paymentMode: sale.paymentMode,
        paymentMethod: sale.paymentMode === "NONE" ? undefined : sale.paymentMethod,
        paymentAmount: sale.paymentMode === "PARTIAL" ? parseNumberInput(sale.paymentAmount) : undefined,
        paymentDate: sale.paymentMode !== "NONE" && sale.paymentDate ? sale.paymentDate : undefined,
        referenceNumber: sale.referenceNumber.trim(),
        ...(sale.paymentMode === "NONE" ? {} : transactionInfoPayload(sale.txInfo)),
      };
    });
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const { results } = await apiFetch<{ results: HistoricalSaleResult[] }>("/historical-sales", { method: "POST", body: JSON.stringify({ rows: payload }) });
      const done = results.filter((result): result is Extract<HistoricalSaleResult, { ok: true }> => result.ok);
      const failed = new Map(results.filter((result) => !result.ok).map((result) => [result.index, (result as { errors: string[] }).errors]));
      // Payment files go up one by one once their sale exists; a failed upload
      // doesn't undo the sale (the file can be added on the receipt page).
      const uploadFailures: string[] = [];
      for (const result of done) {
        if (!result.payment) continue;
        for (const { file, note } of sales[result.index].files) {
          try {
            await apiUpload(`/receivables/payments/${result.payment.id}/documents`, file, "file", note.trim() ? { note: note.trim() } : {});
          } catch (uploadReason) {
            uploadFailures.push(`${result.payment.paymentNumber} — «${file.name}»: ${(uploadReason as ApiError).message ?? "بارگذاری ناموفق بود."}`);
          }
        }
      }
      if (uploadFailures.length > 0) pushErrors(["فروش ثبت شد، اما بارگذاری این مدارک ناموفق بود (از صفحهٔ دریافت دوباره بارگذاری کنید):", ...uploadFailures]);
      setSaved((current) => [...current, ...done]);
      const remaining = sales.filter((_, index) => failed.has(index)).map((sale) => ({ ...sale, errors: failed.get(sales.indexOf(sale)) ?? [] }));
      setSales(remaining.length > 0 ? remaining : [emptySale(sales[sales.length - 1])]);
      if (done.length > 0) pushSuccess(`${done.length.toLocaleString("fa-IR")} فروش ثبت شد.`);
      if (failed.size > 0) pushError(`${failed.size.toLocaleString("fa-IR")} فروش ثبت نشد؛ خطای هر مورد در همان فروش نمایش داده شده است.`);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت فروش‌های تاریخی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!options) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  const grandTotal = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">ثبت فروش‌های تاریخی</h1>
          <p className="text-sm text-muted-foreground">
            هر فروش به‌صورت سفارش + حواله + فاکتور (+ دریافت) با تاریخ همان فروش ثبت می‌شود. فروش‌هایی که ثبت شوند از این صفحه حذف می‌شوند و شمارهٔ اسنادشان بالا نمایش داده می‌شود؛
            فروشی که خطا بدهد می‌ماند تا اصلاح و دوباره ارسال شود. پرداخت‌های بعدی را از صفحهٔ سفارش ثبت کنید.
          </p>
        </div>

        {saved.length > 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
            <p className="mb-2 font-medium text-success">ثبت‌شده در این نشست ({saved.length.toLocaleString("fa-IR")}):</p>
            <ul className="grid gap-1 md:grid-cols-2">
              {saved.map((result) => (
                <li key={result.order.id} className="flex flex-wrap gap-x-3 text-xs">
                  <Link href={`/sales-orders/${result.order.id}`} className="font-mono text-primary hover:underline">{result.order.orderNumber}</Link>
                  <Link href={`/sales-invoices/${result.invoice.id}`} className="font-mono text-primary hover:underline">{result.invoice.invoiceNumber}</Link>
                  {result.payment ? <Link href={`/receipts/${result.payment.id}`} className="font-mono text-primary hover:underline">{result.payment.paymentNumber}</Link> : <span className="text-muted-foreground">بدون دریافت</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sales.map((sale, index) => {
          const total = saleTotal(sale);
          const categoryItems = sale.categoryId ? options.items.filter((item) => String(item.categoryId) === sale.categoryId) : options.items;
          return (
            <section key={sale.key} className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-1.5">
                <h2 className="text-sm font-semibold">فروش {(index + 1).toLocaleString("fa-IR")}</h2>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSales((current) => [...current, emptySale(sale)])}>
                    <Copy className="size-3.5" aria-hidden="true" />
                    کپی فروش
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={sales.length === 1} onClick={() => setSales((current) => current.filter((entry) => entry.key !== sale.key))}>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    حذف
                  </Button>
                </div>
              </div>
              <div className="space-y-3 px-4 py-3">
                {sale.errors.length > 0 ? (
                  <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-6 py-2 text-xs text-destructive">
                    {sale.errors.map((message, i) => (
                      <li key={i}>{message}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`hs-${sale.key}-date-year`}>تاریخ فروش</Label>
                    <JalaliDateInput idPrefix={`hs-${sale.key}-date`} value={sale.saleDate} onChange={(value) => patchSale(sale.key, { saleDate: value, ...(value && sale.paymentDate && sale.paymentDate < value ? { paymentDate: "" } : {}) })} required />
                  </div>
                  <div className="flex flex-col gap-1.5 lg:col-span-2">
                    <Label htmlFor={`hs-${sale.key}-customer`}>مشتری</Label>
                    <select id={`hs-${sale.key}-customer`} className={selectClass} value={sale.customerId} onChange={(event) => patchSale(sale.key, { customerId: event.target.value })}>
                      <option value="">— انتخاب کنید —</option>
                      {options.customers.map((customer) => (
                        <option key={customer.id} value={customer.id} disabled={customer.creditHold}>
                          {customer.name} ({customer.customerNumber}){customer.creditHold ? " — توقف اعتباری" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`hs-${sale.key}-mode`}>پرداخت</Label>
                    <select id={`hs-${sale.key}-mode`} className={selectClass} value={sale.paymentMode} onChange={(event) => patchSale(sale.key, { paymentMode: event.target.value as HistoricalPaymentMode })}>
                      {(["FULL", "PARTIAL", "NONE"] as const).map((mode) => (
                        <option key={mode} value={mode}>{historicalPaymentModeLabels[mode]}</option>
                      ))}
                    </select>
                  </div>
                  {sale.paymentMode !== "NONE" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hs-${sale.key}-method`}>روش پرداخت</Label>
                      <select id={`hs-${sale.key}-method`} className={selectClass} value={sale.paymentMethod} onChange={(event) => patchSale(sale.key, { paymentMethod: event.target.value as QuickSalePaymentMethod })}>
                        {QUICK_SALE_PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {sale.paymentMode === "PARTIAL" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hs-${sale.key}-amount`}>مبلغ دریافتی (ریال)</Label>
                      <MoneyInput id={`hs-${sale.key}-amount`} value={sale.paymentAmount} onChange={(value) => patchSale(sale.key, { paymentAmount: value })} />
                    </div>
                  ) : null}
                  {sale.paymentMode !== "NONE" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hs-${sale.key}-ref`}>شماره مرجع</Label>
                      <Input id={`hs-${sale.key}-ref`} value={sale.referenceNumber} onChange={(event) => patchSale(sale.key, { referenceNumber: event.target.value })} />
                    </div>
                  ) : null}
                </div>

                {sale.customerId ? (
                  <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                    <CustomerInfo customerId={Number(sale.customerId)} />
                  </div>
                ) : null}

                {sale.paymentMode !== "NONE" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <TransactionInfoFields
                      idPrefix={`hs-${sale.key}`}
                      value={sale.txInfo}
                      onChange={(next) => patchSale(sale.key, { txInfo: next })}
                      defaultOpen
                      leading={
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`hs-${sale.key}-paydate-year`}>تاریخ پرداخت</Label>
                          <JalaliDateInput idPrefix={`hs-${sale.key}-paydate`} value={sale.paymentDate} minDate={sale.saleDate || undefined} onChange={(value) => patchSale(sale.key, { paymentDate: value })} />
                          <p className="text-xs text-muted-foreground">خالی = همان تاریخ فروش</p>
                        </div>
                      }
                    />
                    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`hs-${sale.key}-files`}>مدارک پرداخت (فیش، تصویر چک، …)</Label>
                        <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById(`hs-${sale.key}-files`)?.click()}>
                          <Plus className="size-3.5" aria-hidden="true" />
                          افزودن مدرک
                        </Button>
                      </div>
                      {/* Each pick APPENDS to the list (the browser's own picker would replace the previous selection). */}
                      <input
                        id={`hs-${sale.key}-files`}
                        type="file"
                        multiple
                        accept={PAYMENT_DOCUMENT_ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          const picked = Array.from(event.target.files ?? []).map((file) => ({ key: crypto.randomUUID(), file, note: "" }));
                          event.target.value = "";
                          if (picked.length > 0) patchSale(sale.key, { files: [...sale.files, ...picked] });
                        }}
                      />
                      {sale.files.length === 0 ? (
                        <p className="text-xs text-muted-foreground">PDF یا تصویر (jpg، png)، حداکثر ۱۰ مگابایت برای هر فایل؛ هر چند مدرک که لازم است اضافه کنید.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {sale.files.map((entry) => (
                            <li key={entry.key} className="flex items-center gap-2 text-xs">
                              <span className="min-w-0 max-w-[40%] truncate" title={entry.file.name}>{entry.file.name}</span>
                              <Input
                                aria-label={`توضیح مدرک ${entry.file.name}`}
                                className="h-8 flex-1 text-xs"
                                placeholder="توضیح (اختیاری)"
                                maxLength={500}
                                value={entry.note}
                                onChange={(event) => patchSale(sale.key, { files: sale.files.map((current) => (current.key === entry.key ? { ...current, note: event.target.value } : current)) })}
                              />
                              <Button type="button" size="icon" variant="ghost" aria-label="حذف مدرک" onClick={() => patchSale(sale.key, { files: sale.files.filter((current) => current.key !== entry.key) })}>
                                <Trash2 className="size-4" aria-hidden="true" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[48rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">
                          <span className="me-2">کالا</span>
                          <select aria-label="دسته‌بندی کالا" className={`${selectClass} h-7 w-44 text-xs font-normal`} value={sale.categoryId} onChange={(event) => patchSale(sale.key, { categoryId: event.target.value })}>
                            <option value="">همه دسته‌ها</option>
                            {options.categories.map((category) => (
                              <option key={category.id} value={category.id}>{category.nameFa}</option>
                            ))}
                          </select>
                        </th>
                        <th className="w-24 px-2 py-1.5 font-medium">مقدار</th>
                        <th className="w-36 px-2 py-1.5 font-medium">قیمت واحد (ریال)</th>
                        {canDiscount ? (
                          <>
                            <th className="w-20 px-2 py-1.5 font-medium">تخفیف ٪</th>
                            <th className="w-28 px-2 py-1.5 font-medium">مبلغ تخفیف</th>
                          </>
                        ) : null}
                        <th className="w-20 px-2 py-1.5 font-medium">مالیات ٪</th>
                        <th className="w-32 px-2 py-1.5 font-medium">جمع ردیف</th>
                        <th className="w-10 px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sale.items.map((item) => (
                        <tr key={item.key}>
                          <td className="px-2 py-1.5">
                            <select aria-label="کالا" className={`${selectClass} w-full`} value={item.itemId} onChange={(event) => pickItem(sale.key, item.key, event.target.value)}>
                              <option value="">— انتخاب کالا —</option>
                              {categoryItems.concat(item.itemId && !categoryItems.some((option) => String(option.id) === item.itemId) && itemById.get(item.itemId) ? [itemById.get(item.itemId)!] : []).map((option) => (
                                <option key={option.id} value={option.id}>{option.name} ({option.code})</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Input aria-label="مقدار" dir="ltr" inputMode="decimal" className="h-9 tabular-nums" value={item.quantity} onChange={(event) => patchItem(sale.key, item.key, { quantity: event.target.value })} />
                          </td>
                          <td className="px-2 py-1.5">
                            <MoneyInput aria-label="قیمت واحد" className="h-9 tabular-nums" value={item.unitPrice} onChange={(value) => patchItem(sale.key, item.key, { unitPrice: value })} />
                          </td>
                          {canDiscount ? (
                            <>
                              <td className="px-2 py-1.5">
                                <Input aria-label="درصد تخفیف" dir="ltr" inputMode="decimal" className="h-9 tabular-nums" value={item.discountPercent} disabled={item.discountAmount.trim() !== ""} onChange={(event) => patchItem(sale.key, item.key, { discountPercent: event.target.value })} />
                              </td>
                              <td className="px-2 py-1.5">
                                <MoneyInput aria-label="مبلغ تخفیف" className="h-9 tabular-nums" value={item.discountAmount} disabled={item.discountPercent.trim() !== ""} onChange={(value) => patchItem(sale.key, item.key, { discountAmount: value })} />
                              </td>
                            </>
                          ) : null}
                          <td className="px-2 py-1.5">
                            <Input aria-label="مالیات ٪" dir="ltr" inputMode="decimal" className="h-9 tabular-nums" value={item.taxRate} onChange={(event) => patchItem(sale.key, item.key, { taxRate: event.target.value })} />
                          </td>
                          <td className="px-2 py-2 tabular-nums">{formatMoney(lineTotal(item))}</td>
                          <td className="px-2 py-1.5">
                            <Button type="button" size="icon" variant="ghost" aria-label="حذف ردیف" disabled={sale.items.length === 1} onClick={() => patchSale(sale.key, { items: sale.items.filter((entry) => entry.key !== item.key) })}>
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => patchSale(sale.key, { items: [...sale.items, emptyItem()] })}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    ردیف کالا
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    جمع فروش (برآورد): <span className="font-semibold text-foreground tabular-nums">{formatMoney(total)} ریال</span>
                  </span>
                </div>
              </div>
            </section>
          );
        })}

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "در حال ثبت..." : `ثبت ${sales.length.toLocaleString("fa-IR")} فروش`}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setSales((current) => [...current, emptySale(current[current.length - 1])])}>
            <Plus className="size-4" aria-hidden="true" />
            فروش جدید
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            جمع همهٔ فروش‌ها (برآورد): <span className="font-semibold text-foreground tabular-nums">{formatMoney(grandTotal)} ریال</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// /sales-orders/historical — gated on every permission the chain needs.
export default function HistoricalSalesPage() {
  return (
    <RequirePermission permission="sales.manage" message="اجازه ثبت فروش را ندارید.">
      <RequirePermission permission="sales.deliver" message="برای ثبت فروش تاریخی، مجوز «ثبت حواله» هم لازم است.">
        <RequirePermission permission="sales.invoice" message="برای ثبت فروش تاریخی، مجوز «صدور فاکتور» هم لازم است.">
          <RequirePermission permission="receivables.manage" message="برای ثبت فروش تاریخی، مجوز «ثبت دریافت» هم لازم است.">
            <HistoricalSalesScreen />
          </RequirePermission>
        </RequirePermission>
      </RequirePermission>
    </RequirePermission>
  );
}
