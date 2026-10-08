"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { RequirePermission } from "@/components/require-permission";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney, todayIso } from "@/lib/format";
import { normalizeDigits, parseNumberInput } from "@/lib/number-input";
import { FormSection } from "../../sales-orders/_form/FormSection";
import type { SalesInvoiceDetail, SalesInvoiceFormOptions } from "../shared";

type Line = { key: number; itemName: string; quantity: string; unitPrice: string; taxRate: string };

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, itemName: "", quantity: "1", unitPrice: "", taxRate: "" });

// Display-only line total (the backend computes the stored amounts the same
// way — sales-totals.ts — rounding half-up to a whole Rial).
function lineTotal(line: Line): number {
  const quantity = parseNumberInput(normalizeDigits(line.quantity));
  const price = parseNumberInput(normalizeDigits(line.unitPrice));
  const rate = line.taxRate.trim() === "" ? 0 : parseNumberInput(normalizeDigits(line.taxRate));
  if (![quantity, price, rate].every(Number.isFinite)) return 0;
  const gross = Math.round(quantity * price);
  return gross + Math.round((gross * rate) / 100);
}

// «فاکتور مانده افتتاحیه» — DRAFT opening-balance invoice
// (POST /sales-invoices/opening-balance, sales.invoice): a customer's
// historical receivable, with no order or delivery, so it can be collected
// against once Receivables exists. Excluded from sales statistics. Saved as
// a draft; numbered and given a due date by «ثبت فاکتور» on the detail page.
function OpeningBalanceForm() {
  const router = useRouter();
  const { toasts, pushError, pushErrors, dismiss } = useToasts();
  const [options, setOptions] = useState<SalesInvoiceFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesInvoiceFormOptions>("/sales-invoices/form-options")
      .then((data) => {
        if (!ignore) {
          setOptions(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت فهرست مشتریان ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    if (!customerId) problems.push("مشتری را انتخاب کنید.");
    if (!invoiceDate) problems.push("تاریخ فاکتور را وارد کنید.");
    const items = lines.map((line, index) => {
      const label = `ردیف ${(index + 1).toLocaleString("fa-IR")}`;
      const quantity = parseNumberInput(normalizeDigits(line.quantity));
      const unitPrice = parseNumberInput(normalizeDigits(line.unitPrice));
      const taxRate = line.taxRate.trim() === "" ? undefined : parseNumberInput(normalizeDigits(line.taxRate));
      if (!Number.isFinite(quantity) || quantity <= 0) problems.push(`${label}: مقدار باید بزرگ‌تر از صفر باشد.`);
      if (!Number.isInteger(unitPrice) || unitPrice < 0) problems.push(`${label}: مبلغ واحد باید عدد صحیح (ریال) باشد.`);
      if (taxRate !== undefined && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) problems.push(`${label}: نرخ مالیات باید بین ۰ تا ۱۰۰ باشد.`);
      return { itemName: line.itemName.trim(), quantity, unitPrice, ...(taxRate !== undefined ? { taxRate } : {}) };
    });
    if (problems.length === 0 && lines.reduce((sum, line) => sum + lineTotal(line), 0) <= 0) problems.push("جمع مبلغ فاکتور باید بیشتر از صفر باشد.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<SalesInvoiceDetail>("/sales-invoices/opening-balance", {
        method: "POST",
        body: JSON.stringify({ customerId: Number(customerId), invoiceDate, note: note.trim(), items }),
      });
      router.push(`/sales-invoices/${saved.id}`);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ذخیره فاکتور ناموفق بود.");
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p role="alert">{loadError}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش دوباره</Button>
            <Button size="sm" variant="ghost" onClick={() => router.push("/sales-invoices")}>بازگشت به فاکتورها</Button>
          </div>
        </div>
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

  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">فاکتور مانده افتتاحیه</h1>
          <p className="text-sm text-muted-foreground">ثبت بدهی تاریخی مشتری (بدون سفارش و حواله) — در آمار فروش حساب نمی‌شود. به‌صورت پیش‌نویس ذخیره می‌شود.</p>
        </div>

        <form id="opening-balance-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات فاکتور">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-customer">مشتری<RequiredMark /></Label>
                <select id="ob-customer" className={selectClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">انتخاب کنید</option>
                  {options.customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.customerNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-date-year">تاریخ فاکتور<RequiredMark /></Label>
                <JalaliDateInput idPrefix="ob-date" value={invoiceDate} onChange={setInvoiceDate} required />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="ردیف‌ها"
            description="شرح خالی = «مانده افتتاحیه». مبالغ به ریال."
            action={
              <Button type="button" size="sm" variant="ghost" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, newLine()])}>
                <Plus className="size-3.5" aria-hidden="true" />
                افزودن ردیف
              </Button>
            }
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[44rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">شرح</th>
                    <th className="w-24 px-2 py-2 font-medium">مقدار</th>
                    <th className="w-36 px-2 py-2 font-medium">مبلغ واحد</th>
                    <th className="w-24 px-2 py-2 font-medium">نرخ مالیات ٪</th>
                    <th className="w-32 px-2 py-2 font-medium">جمع ردیف</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, index) => (
                    <tr key={line.key}>
                      <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{(index + 1).toLocaleString("fa-IR")}</td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`شرح ردیف ${index + 1}`} className="h-8" maxLength={200} placeholder="مانده افتتاحیه" value={line.itemName} onChange={(event) => updateLine(line.key, { itemName: event.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`مقدار ردیف ${index + 1}`} className="h-8 tabular-nums" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`مبلغ واحد ردیف ${index + 1}`} className="h-8 tabular-nums" inputMode="numeric" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`نرخ مالیات ردیف ${index + 1}`} className="h-8 tabular-nums" inputMode="decimal" placeholder="۰" value={line.taxRate} onChange={(event) => updateLine(line.key, { taxRate: event.target.value })} />
                      </td>
                      <td className="px-2 py-2 tabular-nums">{formatMoney(lineTotal(line))}</td>
                      <td className="px-2 py-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`حذف ردیف ${index + 1}`}
                          disabled={lines.length === 1}
                          onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="یادداشت">
            <textarea aria-label="یادداشت فاکتور" className={textareaClass} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="مثلاً مرجع سند قدیمی (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="opening-balance-form" disabled={saving}>
            {saving ? "در حال ذخیره..." : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/sales-invoices")}>
            انصراف
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            جمع فاکتور: <span className="font-medium text-foreground tabular-nums">{formatMoney(total)}</span> ریال
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OpeningBalanceInvoicePage() {
  return (
    <RequirePermission permission="sales.invoice" message="اجازه صدور فاکتور فروش را ندارید.">
      <OpeningBalanceForm />
    </RequirePermission>
  );
}
