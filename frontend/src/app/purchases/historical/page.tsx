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
import { TransactionInfoFields, emptyTransactionInfo, transactionInfoErrors, transactionInfoPayload, type TransactionInfo } from "@/components/payments/transaction-info";
import { useAdminUser } from "@/app/admin/layout";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { parseNumberInput } from "@/lib/number-input";
import type { PurchaseTypeOption, SupplierOption, UnitOption } from "@/lib/reference-options";
import { PAYMENT_METHODS, paymentMethodLabels, type PaymentMethod } from "../shared";
import { SupplierPanel } from "../_form/SupplierPanel";
import { HistoricalDocuments, type HistoricalDocument } from "./HistoricalDocuments";

type PaymentMode = "FULL" | "PARTIAL" | "NONE";
const paymentModeLabels: Record<PaymentMode, string> = { FULL: "پرداخت کامل", PARTIAL: "پرداخت جزئی", NONE: "پرداخت‌نشده" };

type ItemRow = { key: string; name: string; quantity: string; unitId: string; unitPrice: string; totalPrice: string; totalTouched: boolean };
type Purchase = {
  key: string;
  purchaseDate: string;
  supplierId: string;
  purchaseTypeId: string;
  note: string;
  paymentMode: PaymentMode;
  paymentMethod: PaymentMethod;
  paymentAmount: string;
  // Empty = same as the purchase date.
  paymentDate: string;
  referenceNumber: string;
  txInfo: TransactionInfo;
  documents: HistoricalDocument[];
  items: ItemRow[];
  errors: string[];
};

type PurchaseResult =
  | { index: number; ok: true; purchase: { id: number; purchaseNumber: string }; paymentRecorded: boolean; paymentErrors?: string[] }
  | { index: number; ok: false; errors: string[] };

const emptyItem = (unitId = ""): ItemRow => ({ key: crypto.randomUUID(), name: "", quantity: "1", unitId, unitPrice: "", totalPrice: "", totalTouched: false });
const emptyPurchase = (unitId: string, base?: Purchase): Purchase => ({
  key: crypto.randomUUID(),
  purchaseDate: base?.purchaseDate ?? "",
  supplierId: "",
  purchaseTypeId: base?.purchaseTypeId ?? "",
  note: "",
  paymentMode: base?.paymentMode ?? "FULL",
  paymentMethod: base?.paymentMethod ?? "BANK_TRANSFER",
  paymentAmount: "",
  paymentDate: "",
  referenceNumber: "",
  txInfo: emptyTransactionInfo,
  documents: [],
  items: [emptyItem(unitId)],
  errors: [],
});

const isBlankItem = (item: ItemRow) => !item.name.trim() && !item.unitPrice && !item.totalPrice;
const itemTotal = (item: ItemRow) => parseNumberInput(item.totalPrice) || 0;

// «ثبت خریدهای تاریخی» — fast entry of past purchases on one page (the
// purchases twin of /sales-orders/historical). Each block becomes a normal
// purchase (HISTORICAL_IMPORT, confirmed — no requester department / buyer
// needed) plus at most one completed payment on its own date
// (POST /historical-purchases). Purchases that save leave the page and are
// listed with their numbers; a failed one stays with its errors. Documents
// go up right after their purchase is saved, through the same two-step
// endpoints the purchase page uses. An item's total is auto-filled from
// quantity × unit price until it is edited (the total is what's billed).
function HistoricalPurchasesScreen() {
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const canUploadDocuments = useAdminUser()?.permissions.includes("documents.upload") ?? false;
  const [types, setTypes] = useState<PurchaseTypeOption[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([emptyPurchase("")]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: number; purchaseNumber: string; paid: boolean }[]>([]);

  useEffect(() => {
    Promise.all([apiFetch<PurchaseTypeOption[]>("/purchase-types"), apiFetch<SupplierOption[]>("/suppliers"), apiFetch<UnitOption[]>("/units")])
      .then(([typeRows, supplierRows, unitRows]) => {
        setTypes(typeRows);
        setSuppliers(supplierRows.filter((supplier) => supplier.status === "active"));
        setUnits(unitRows);
        const firstUnit = unitRows[0] ? String(unitRows[0].id) : "";
        setPurchases((current) => current.map((purchase) => ({ ...purchase, items: purchase.items.map((item) => (item.unitId ? item : { ...item, unitId: firstUnit })) })));
      })
      .catch((reason: unknown) => setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود."));
  }, []);

  const defaultUnit = units[0] ? String(units[0].id) : "";

  function patch(key: string, change: Partial<Purchase>) {
    setPurchases((current) => current.map((purchase) => (purchase.key === key ? { ...purchase, ...change } : purchase)));
  }
  function patchItem(purchaseKey: string, itemKey: string, change: Partial<ItemRow>) {
    setPurchases((current) => current.map((purchase) => (purchase.key === purchaseKey ? { ...purchase, items: purchase.items.map((item) => (item.key === itemKey ? { ...item, ...change } : item)) } : purchase)));
  }
  // quantity / unit price edits refresh the total until the user types the total itself.
  function editQuantityOrPrice(purchaseKey: string, item: ItemRow, change: Partial<Pick<ItemRow, "quantity" | "unitPrice">>) {
    const next = { ...item, ...change };
    const auto = !item.totalTouched ? { totalPrice: next.unitPrice.trim() === "" ? "" : String(Math.round((parseNumberInput(next.quantity) || 0) * (parseNumberInput(next.unitPrice) || 0))) } : {};
    patchItem(purchaseKey, item.key, { ...change, ...auto });
  }
  // The supplier's only active purchase type fills the type (same convenience as the purchase form).
  function pickSupplier(purchase: Purchase, supplierId: string) {
    const supplier = suppliers.find((entry) => String(entry.id) === supplierId);
    const activeTypes = (supplier?.purchaseTypes ?? []).filter((type) => type.isActive);
    patch(purchase.key, { supplierId, ...(activeTypes.length === 1 && !purchase.purchaseTypeId ? { purchaseTypeId: String(activeTypes[0].id) } : {}) });
  }
  const purchaseTotal = (purchase: Purchase) => purchase.items.reduce((sum, item) => sum + itemTotal(item), 0);

  // Same two calls as the purchase page: create the document record (dated
  // with the purchase), then attach the file. Returns the failure messages.
  async function uploadDocuments(purchaseId: number, number: string, purchaseDate: string, documents: HistoricalDocument[]): Promise<string[]> {
    const failures: string[] = [];
    for (const doc of documents) {
      let createdId: number | null = null;
      try {
        const created = await apiFetch<{ id: number }>(`/purchases/${purchaseId}/documents`, {
          method: "POST",
          body: JSON.stringify({ documentType: doc.documentType, documentNumber: doc.documentNumber.trim(), date: purchaseDate, note: doc.note.trim() }),
        });
        createdId = created.id;
        await apiUpload(`/purchases/${purchaseId}/documents/${created.id}/file`, doc.file);
      } catch (reason) {
        failures.push(`${number} — «${doc.file.name}»: ${(reason as ApiError).message ?? "بارگذاری ناموفق بود."}`);
        // Don't leave a file-less document record behind.
        if (createdId !== null) await apiFetch(`/purchases/${purchaseId}/documents/${createdId}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
    return failures;
  }

  async function submit() {
    const problems: string[] = [];
    const payload = purchases.map((purchase, index) => {
      const label = `خرید ${(index + 1).toLocaleString("fa-IR")}`;
      const items = purchase.items.filter((item) => !isBlankItem(item));
      if (!purchase.purchaseDate) problems.push(`${label}: تاریخ را وارد کنید.`);
      if (!purchase.supplierId) problems.push(`${label}: تأمین‌کننده را انتخاب کنید.`);
      if (!purchase.purchaseTypeId) problems.push(`${label}: نوع خرید را انتخاب کنید.`);
      if (items.length === 0) problems.push(`${label}: حداقل یک قلم وارد کنید.`);
      for (const item of items) {
        if (!item.name.trim() || !item.unitId || !((parseNumberInput(item.quantity) || 0) > 0) || !(itemTotal(item) >= 0) || item.totalPrice.trim() === "") problems.push(`${label}: نام، مقدار، واحد و قیمت کل هر قلم را کامل کنید.`);
      }
      if (purchase.paymentMode !== "NONE") problems.push(...transactionInfoErrors(purchase.txInfo).map((message) => `${label}: ${message}`));
      if (purchase.paymentMode !== "NONE" && purchase.paymentDate && purchase.purchaseDate && purchase.paymentDate < purchase.purchaseDate) problems.push(`${label}: تاریخ پرداخت نمی‌تواند پیش از تاریخ خرید باشد.`);
      if (purchase.paymentMode === "PARTIAL" && !((parseNumberInput(purchase.paymentAmount) || 0) > 0)) problems.push(`${label}: مبلغ پرداخت را وارد کنید.`);
      if (purchase.paymentMode === "PARTIAL" && (parseNumberInput(purchase.paymentAmount) || 0) > purchaseTotal(purchase)) problems.push(`${label}: مبلغ پرداخت از جمع خرید بیشتر است.`);
      if (purchase.paymentMode === "NONE" && purchase.documents.some((doc) => doc.documentType === "RECEIPT")) problems.push(`${label}: برای خرید پرداخت‌نشده سند «رسید» پیوست نکنید.`);
      return {
        purchaseDate: purchase.purchaseDate,
        supplierId: Number(purchase.supplierId),
        purchaseTypeId: Number(purchase.purchaseTypeId),
        note: purchase.note.trim(),
        items: items.map((item) => ({
          name: item.name.trim(),
          quantity: parseNumberInput(item.quantity),
          unitId: Number(item.unitId),
          unitPrice: item.unitPrice.trim() === "" ? undefined : parseNumberInput(item.unitPrice),
          totalPrice: parseNumberInput(item.totalPrice),
        })),
        paymentMode: purchase.paymentMode,
        paymentMethod: purchase.paymentMode === "NONE" ? undefined : purchase.paymentMethod,
        paymentAmount: purchase.paymentMode === "PARTIAL" ? parseNumberInput(purchase.paymentAmount) : undefined,
        paymentDate: purchase.paymentMode !== "NONE" && purchase.paymentDate ? purchase.paymentDate : undefined,
        referenceNumber: purchase.referenceNumber.trim(),
        ...(purchase.paymentMode === "NONE" ? {} : transactionInfoPayload(purchase.txInfo)),
      };
    });
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const { results } = await apiFetch<{ results: PurchaseResult[] }>("/historical-purchases", { method: "POST", body: JSON.stringify({ rows: payload }) });
      const done = results.filter((result): result is Extract<PurchaseResult, { ok: true }> => result.ok);
      const failed = new Map(results.filter((result) => !result.ok).map((result) => [result.index, (result as { errors: string[] }).errors]));

      const notices: string[] = [];
      for (const result of done) {
        const source = purchases[result.index];
        if (result.paymentErrors?.length) notices.push(`${result.purchase.purchaseNumber}: خرید ثبت شد اما پرداخت ثبت نشد — ${result.paymentErrors.join("، ")}`);
        if (source.documents.length > 0) notices.push(...(await uploadDocuments(result.purchase.id, result.purchase.purchaseNumber, source.purchaseDate, source.documents)));
      }
      if (notices.length > 0) pushErrors(["بخشی از موارد ثبت نشد (از صفحهٔ همان خرید ثبت کنید):", ...notices]);

      setSaved((current) => [...current, ...done.map((result) => ({ id: result.purchase.id, purchaseNumber: result.purchase.purchaseNumber, paid: result.paymentRecorded }))]);
      const remaining = purchases.filter((_, index) => failed.has(index)).map((purchase) => ({ ...purchase, errors: failed.get(purchases.indexOf(purchase)) ?? [] }));
      setPurchases(remaining.length > 0 ? remaining : [emptyPurchase(defaultUnit, purchases[purchases.length - 1])]);
      if (done.length > 0) pushSuccess(`${done.length.toLocaleString("fa-IR")} خرید ثبت شد.`);
      if (failed.size > 0) pushError(`${failed.size.toLocaleString("fa-IR")} خرید ثبت نشد؛ خطای هر مورد در همان خرید نمایش داده شده است.`);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت خریدهای تاریخی ناموفق بود.");
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
  if (!types) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  const grandTotal = purchases.reduce((sum, purchase) => sum + purchaseTotal(purchase), 0);

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">ثبت خریدهای تاریخی</h1>
          <p className="text-sm text-muted-foreground">
            هر خرید به‌صورت «ثبت تاریخی» و تأییدشده (بدون نیاز به دپارتمان و خریدار) با تاریخ همان خرید ثبت می‌شود و در صورت پرداخت، یک پرداخت تکمیل‌شده هم با تاریخ پرداخت ثبت می‌شود.
            خریدهایی که ثبت شوند از این صفحه حذف می‌شوند و شماره‌شان بالا نمایش داده می‌شود؛ خریدی که خطا بدهد می‌ماند تا اصلاح و دوباره ارسال شود. این ثبت‌ها روی موجودی انبار اثری ندارند.
          </p>
        </div>

        {saved.length > 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
            <p className="mb-2 font-medium text-success">ثبت‌شده در این نشست ({saved.length.toLocaleString("fa-IR")}):</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {saved.map((entry) => (
                <li key={entry.id} className="text-xs">
                  <Link href={`/purchases/${entry.id}`} className="font-mono text-primary hover:underline">{entry.purchaseNumber}</Link>
                  {entry.paid ? null : <span className="ms-1 text-muted-foreground">(بدون پرداخت)</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {purchases.map((purchase, index) => {
          const total = purchaseTotal(purchase);
          return (
            <section key={purchase.key} className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-1.5">
                <h2 className="text-sm font-semibold">خرید {(index + 1).toLocaleString("fa-IR")}</h2>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPurchases((current) => [...current, emptyPurchase(defaultUnit, purchase)])}>
                    <Copy className="size-3.5" aria-hidden="true" />
                    کپی خرید
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={purchases.length === 1} onClick={() => setPurchases((current) => current.filter((entry) => entry.key !== purchase.key))}>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    حذف
                  </Button>
                </div>
              </div>
              <div className="space-y-3 px-4 py-3">
                {purchase.errors.length > 0 ? (
                  <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-6 py-2 text-xs text-destructive">
                    {purchase.errors.map((message, i) => (
                      <li key={i}>{message}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`hp-${purchase.key}-date-year`}>تاریخ خرید</Label>
                    <JalaliDateInput
                      idPrefix={`hp-${purchase.key}-date`}
                      value={purchase.purchaseDate}
                      onChange={(value) => patch(purchase.key, { purchaseDate: value, ...(value && purchase.paymentDate && purchase.paymentDate < value ? { paymentDate: "" } : {}) })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 lg:col-span-2">
                    <Label htmlFor={`hp-${purchase.key}-supplier`}>تأمین‌کننده</Label>
                    <select id={`hp-${purchase.key}-supplier`} className={selectClass} value={purchase.supplierId} onChange={(event) => pickSupplier(purchase, event.target.value)}>
                      <option value="">— انتخاب کنید —</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`hp-${purchase.key}-type`}>نوع خرید</Label>
                    <select id={`hp-${purchase.key}-type`} className={selectClass} value={purchase.purchaseTypeId} onChange={(event) => patch(purchase.key, { purchaseTypeId: event.target.value })}>
                      <option value="">— انتخاب کنید —</option>
                      {types.map((type) => (
                        <option key={type.id} value={type.id}>{type.nameFa}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`hp-${purchase.key}-mode`}>پرداخت</Label>
                    <select id={`hp-${purchase.key}-mode`} className={selectClass} value={purchase.paymentMode} onChange={(event) => patch(purchase.key, { paymentMode: event.target.value as PaymentMode })}>
                      {(["FULL", "PARTIAL", "NONE"] as const).map((mode) => (
                        <option key={mode} value={mode}>{paymentModeLabels[mode]}</option>
                      ))}
                    </select>
                  </div>
                  {purchase.paymentMode !== "NONE" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hp-${purchase.key}-method`}>روش پرداخت</Label>
                      <select id={`hp-${purchase.key}-method`} className={selectClass} value={purchase.paymentMethod} onChange={(event) => patch(purchase.key, { paymentMethod: event.target.value as PaymentMethod })}>
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {purchase.paymentMode === "PARTIAL" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hp-${purchase.key}-amount`}>مبلغ پرداخت (ریال)</Label>
                      <MoneyInput id={`hp-${purchase.key}-amount`} value={purchase.paymentAmount} onChange={(value) => patch(purchase.key, { paymentAmount: value })} />
                    </div>
                  ) : null}
                  {purchase.paymentMode !== "NONE" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`hp-${purchase.key}-ref`}>شماره مرجع</Label>
                      <Input id={`hp-${purchase.key}-ref`} value={purchase.referenceNumber} onChange={(event) => patch(purchase.key, { referenceNumber: event.target.value })} />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
                    <Label htmlFor={`hp-${purchase.key}-note`}>یادداشت</Label>
                    <Input id={`hp-${purchase.key}-note`} value={purchase.note} maxLength={1000} onChange={(event) => patch(purchase.key, { note: event.target.value })} />
                  </div>
                </div>

                {purchase.supplierId ? (
                  <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                    <SupplierPanel supplierId={Number(purchase.supplierId)} />
                  </div>
                ) : null}

                <div className={`grid gap-3 ${purchase.paymentMode !== "NONE" && canUploadDocuments ? "md:grid-cols-2" : ""}`}>
                  {purchase.paymentMode !== "NONE" ? (
                    <TransactionInfoFields
                      idPrefix={`hp-${purchase.key}`}
                      value={purchase.txInfo}
                      onChange={(next) => patch(purchase.key, { txInfo: next })}
                      defaultOpen
                      leading={
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`hp-${purchase.key}-paydate-year`}>تاریخ پرداخت</Label>
                          <JalaliDateInput idPrefix={`hp-${purchase.key}-paydate`} value={purchase.paymentDate} minDate={purchase.purchaseDate || undefined} onChange={(value) => patch(purchase.key, { paymentDate: value })} />
                          <p className="text-xs text-muted-foreground">خالی = همان تاریخ خرید</p>
                        </div>
                      }
                    />
                  ) : null}
                  {canUploadDocuments ? <HistoricalDocuments idPrefix={`hp-${purchase.key}`} documents={purchase.documents} onChange={(next) => patch(purchase.key, { documents: next })} pushErrors={pushErrors} /> : null}
                </div>

                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[48rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">نام / شرح قلم</th>
                        <th className="w-24 px-2 py-1.5 font-medium">مقدار</th>
                        <th className="w-32 px-2 py-1.5 font-medium">واحد</th>
                        <th className="w-36 px-2 py-1.5 font-medium">قیمت واحد (ریال)</th>
                        <th className="w-40 px-2 py-1.5 font-medium">قیمت کل (ریال)</th>
                        <th className="w-10 px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {purchase.items.map((item) => (
                        <tr key={item.key}>
                          <td className="px-2 py-1.5">
                            <Input aria-label="نام قلم" className="h-9" maxLength={150} value={item.name} onChange={(event) => patchItem(purchase.key, item.key, { name: event.target.value })} />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input aria-label="مقدار" dir="ltr" inputMode="decimal" className="h-9 tabular-nums" value={item.quantity} onChange={(event) => editQuantityOrPrice(purchase.key, item, { quantity: event.target.value })} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select aria-label="واحد" className={`${selectClass} w-full`} value={item.unitId} onChange={(event) => patchItem(purchase.key, item.key, { unitId: event.target.value })}>
                              {units.map((unit) => (
                                <option key={unit.id} value={unit.id}>{unit.nameFa}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <MoneyInput aria-label="قیمت واحد" className="h-9 tabular-nums" value={item.unitPrice} onChange={(value) => editQuantityOrPrice(purchase.key, item, { unitPrice: value })} />
                          </td>
                          <td className="px-2 py-1.5">
                            <MoneyInput aria-label="قیمت کل" className="h-9 tabular-nums" value={item.totalPrice} onChange={(value) => patchItem(purchase.key, item.key, { totalPrice: value, totalTouched: true })} />
                          </td>
                          <td className="px-2 py-1.5">
                            <Button type="button" size="icon" variant="ghost" aria-label="حذف ردیف" disabled={purchase.items.length === 1} onClick={() => patch(purchase.key, { items: purchase.items.filter((entry) => entry.key !== item.key) })}>
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => patch(purchase.key, { items: [...purchase.items, emptyItem(defaultUnit)] })}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    قلم جدید
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    جمع خرید: <span className="font-semibold text-foreground tabular-nums">{formatMoney(total)} ریال</span>
                  </span>
                </div>

              </div>
            </section>
          );
        })}

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "در حال ثبت..." : `ثبت ${purchases.length.toLocaleString("fa-IR")} خرید`}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setPurchases((current) => [...current, emptyPurchase(defaultUnit, current[current.length - 1])])}>
            <Plus className="size-4" aria-hidden="true" />
            خرید جدید
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            جمع همهٔ خریدها: <span className="font-semibold text-foreground tabular-nums">{formatMoney(grandTotal)} ریال</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// /purchases/historical — creating the purchase and its payment are both purchases.manage.
export default function HistoricalPurchasesPage() {
  return (
    <RequirePermission permission="purchases.manage" message="اجازه ثبت خرید را ندارید.">
      <HistoricalPurchasesScreen />
    </RequirePermission>
  );
}
