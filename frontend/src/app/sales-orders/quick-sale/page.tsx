"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney, todayIso } from "@/lib/format";
import { parseNumberInput } from "@/lib/number-input";
import { RequirePermission } from "@/components/require-permission";
import { FormSection } from "../_form/FormSection";
import type { SalesFormOptions } from "../shared";
import { quickSalePaymentMethodLabels, QUICK_SALE_PAYMENT_METHODS, type QuickSalePaymentMethod, type QuickSaleResult } from "./shared";

type LineRow = { key: string; itemId: string; quantity: string; unitPrice: string };

function emptyLine(): LineRow {
  return { key: crypto.randomUUID(), itemId: "", quantity: "1", unitPrice: "" };
}

function QuickSaleScreen() {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [options, setOptions] = useState<SalesFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [saleDate, setSaleDate] = useState(todayIso());
  const [method, setMethod] = useState<QuickSalePaymentMethod>("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<QuickSaleResult | null>(null);

  useEffect(() => {
    apiFetch<SalesFormOptions>("/sales-orders/form-options")
      .then((data) => setOptions(data))
      .catch((reason: unknown) => setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود."));
  }, []);

  const itemById = new Map((options?.items ?? []).map((item) => [String(item.id), item]));

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  function setItem(key: string, itemId: string) {
    const option = itemById.get(itemId);
    updateLine(key, { itemId, unitPrice: option?.sellingPrice ?? "" });
  }
  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }
  function removeLine(key: string) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  const total = lines.reduce((sum, line) => {
    const quantity = parseNumberInput(line.quantity) || 0;
    const unitPrice = parseNumberInput(line.unitPrice) || 0;
    return sum + Math.round(quantity * unitPrice);
  }, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    if (!customerId) problems.push("مشتری را انتخاب کنید.");
    if (!saleDate) problems.push("تاریخ فروش را وارد کنید.");
    const items: { itemId: number; quantity: number; unitPrice: number }[] = [];
    for (const line of lines) {
      if (!line.itemId && !line.quantity && !line.unitPrice) continue;
      const quantity = parseNumberInput(line.quantity);
      const unitPrice = parseNumberInput(line.unitPrice);
      if (!line.itemId) problems.push("برای هر ردیف کالا را انتخاب کنید.");
      else if (!Number.isFinite(quantity) || quantity <= 0) problems.push(`کالای «${itemById.get(line.itemId)?.name ?? ""}»: مقدار نامعتبر است.`);
      else if (!Number.isFinite(unitPrice) || unitPrice <= 0) problems.push(`کالای «${itemById.get(line.itemId)?.name ?? ""}»: قیمت واحد نامعتبر است.`);
      else items.push({ itemId: Number(line.itemId), quantity, unitPrice });
    }
    if (items.length === 0) problems.push("حداقل یک ردیف کالا وارد کنید.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }

    setSaving(true);
    setResult(null);
    try {
      const data = await apiFetch<QuickSaleResult>("/quick-sale", {
        method: "POST",
        body: JSON.stringify({ customerId: Number(customerId), saleDate, paymentMethod: method, referenceNumber: referenceNumber.trim(), items }),
      });
      setResult(data);
      pushSuccess("فروش نقدی با موفقیت ثبت شد.");
      setLines([emptyLine()]);
      setCustomerId("");
      setReferenceNumber("");
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت فروش نقدی ناموفق بود.");
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

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">فروش نقدی سریع</h1>
          <p className="text-sm text-muted-foreground">
            یک اقدام، سفارش + حواله تحویل + فاکتور + دریافت را پشت‌هم ثبت می‌کند؛ اسناد زیرین همچنان مستقل باقی می‌مانند (B6).
            همان بررسی‌های اعتبار و موجودی یک سفارش معمولی روی فروش نقدی هم اعمال می‌شود.
          </p>
        </div>

        {result ? (
          <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
            <p className="mb-2 font-medium text-success">فروش با موفقیت ثبت شد:</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">سفارش</dt>
                <dd><Link href={`/sales-orders/${result.order.id}`} className="font-mono text-primary hover:underline">{result.order.orderNumber}</Link></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">حواله</dt>
                <dd><Link href={`/deliveries/${result.delivery.id}`} className="font-mono text-primary hover:underline">{result.delivery.deliveryNumber}</Link></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">فاکتور</dt>
                <dd><Link href={`/sales-invoices/${result.invoice.id}`} className="font-mono text-primary hover:underline">{result.invoice.invoiceNumber}</Link></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">دریافت</dt>
                <dd><Link href={`/receipts/${result.payment.id}`} className="font-mono text-primary hover:underline">{result.payment.paymentNumber}</Link></dd>
              </div>
            </dl>
          </div>
        ) : null}

        <form id="quick-sale-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات فروش">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quick-sale-customer">مشتری<RequiredMark /></Label>
                <select id="quick-sale-customer" className={selectClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {options.customers.map((customer) => (
                    <option key={customer.id} value={customer.id} disabled={customer.creditHold}>
                      {customer.name} ({customer.customerNumber}){customer.creditHold ? " — توقف اعتباری" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quick-sale-date-year">تاریخ<RequiredMark /></Label>
                <JalaliDateInput idPrefix="quick-sale-date" value={saleDate} onChange={setSaleDate} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quick-sale-method">روش پرداخت</Label>
                <select id="quick-sale-method" className={selectClass} value={method} onChange={(event) => setMethod(event.target.value as QuickSalePaymentMethod)}>
                  {QUICK_SALE_PAYMENT_METHODS.map((value) => (
                    <option key={value} value={value}>{quickSalePaymentMethodLabels[value]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quick-sale-reference">شماره مرجع</Label>
                <Input id="quick-sale-reference" value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="اقلام"
            action={
              <Button type="button" size="sm" variant="ghost" onClick={addLine}>
                <Plus className="size-3.5" aria-hidden="true" />
                ردیف جدید
              </Button>
            }
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[40rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="w-28 px-2 py-2 font-medium">مقدار</th>
                    <th className="w-36 px-2 py-2 font-medium">قیمت واحد</th>
                    <th className="w-32 px-2 py-2 font-medium">جمع</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line) => {
                    const quantity = parseNumberInput(line.quantity) || 0;
                    const unitPrice = parseNumberInput(line.unitPrice) || 0;
                    return (
                      <tr key={line.key}>
                        <td className="px-2 py-1.5">
                          <select className={selectClass} value={line.itemId} onChange={(event) => setItem(line.key, event.target.value)}>
                            <option value="">— انتخاب کالا —</option>
                            {options.items.map((item) => (
                              <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input aria-label="مقدار" inputMode="decimal" className="h-9 tabular-nums" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input aria-label="قیمت واحد" inputMode="decimal" className="h-9 tabular-nums" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} />
                        </td>
                        <td className="px-2 py-2 tabular-nums">{formatMoney(Math.round(quantity * unitPrice))}</td>
                        <td className="px-2 py-1.5">
                          <Button type="button" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => removeLine(line.key)}>
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-border bg-muted/20 text-sm">
                  <tr>
                    <td className="px-2 py-2" colSpan={3}>جمع کل</td>
                    <td className="px-2 py-2 font-semibold tabular-nums">{formatMoney(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="quick-sale-form" disabled={saving}>
            {saving ? "در حال ثبت..." : "ثبت فروش نقدی"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/sales-orders")}>
            بازگشت به سفارش‌های فروش
          </Button>
        </div>
      </div>
    </div>
  );
}

// /sales-orders/quick-sale — B6: counter/cash sales. Gated on sales.manage.
export default function QuickSalePage() {
  return (
    <RequirePermission permission="sales.manage" message="اجازه ثبت فروش نقدی را ندارید.">
      <QuickSaleScreen />
    </RequirePermission>
  );
}
