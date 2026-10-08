"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatMoney } from "@/lib/format";
import { JALALI_MAX_YEAR } from "@/lib/jalali";
import { parseNumberInput } from "@/lib/number-input";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  PAYMENT_METHODS,
  paymentMethodLabels,
  type AllocationSuggestion,
  type CustomerPaymentDetail,
  type CustomerPaymentFormOptions,
  type OpenInvoiceRow,
  type PaymentMethod,
} from "./shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

type ReceiptForm = {
  customerId: string;
  paymentDate: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string;
  chequeDueDate: string;
  bankName: string;
  note: string;
};

const emptyForm: ReceiptForm = { customerId: "", paymentDate: "", amount: "", method: "CASH", referenceNumber: "", chequeDueDate: "", bankName: "", note: "" };

type AllocationLine = { invoiceId: number; invoiceNumber: string | null; dueDate: string | null; openAmount: string; amount: string };

// «ثبت دریافت» — one dialog that both records a RECEIPT (POST
// /receivables/payments) and, in the same action, allocates as much of it
// as the user wants to the customer's open invoices (POST
// /receivables/allocations) — build plan §7. Cheque fields (due date, bank
// name) only appear when method=CHECK (B9). The allocation grid is
// prefilled oldest-first («پیشنهاد تخصیص» — GET /receivables/allocations/suggest)
// but every row stays editable, and any amount left over simply isn't sent
// (it stays on the receipt as unapplied credit — build plan §3).
//
// Plain native <select>s only (no Base-UI combobox) — same convention as
// every other customer/item picker in this project.
export function RecordReceiptDialog({ open, onOpenChange, onCreated, toasts }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (paymentId: number) => void; toasts: SectionToasts }) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [form, setForm] = useState<ReceiptForm>(emptyForm);
  const [customers, setCustomers] = useState<CustomerPaymentFormOptions["customers"]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationLine[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset the form the moment the dialog transitions closed → open (the
  // "adjust state during render" pattern — see lib/jalali-date-input.tsx's
  // own syncedValue — not a useEffect, so there's no cascading-render lint
  // warning for a synchronous setState).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(emptyForm);
      setOpenInvoices([]);
      setAllocations([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    apiFetch<CustomerPaymentFormOptions>("/receivables/payments/form-options")
      .then((data) => setCustomers(data.customers))
      .catch((reason) => pushError((reason as ApiError).message ?? "دریافت فهرست مشتریان ناموفق بود."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function update<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadSuggestion(customerId: string, amount: number) {
    if (!customerId || !(amount > 0)) {
      setOpenInvoices([]);
      setAllocations([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      const [open, suggestion] = await Promise.all([
        apiFetch<OpenInvoiceRow[]>(`/receivables/customers/${customerId}/open-invoices`),
        apiFetch<AllocationSuggestion>(`/receivables/allocations/suggest?customerId=${customerId}&amount=${amount}`),
      ]);
      setOpenInvoices(open);
      const suggested = new Map(suggestion.items.map((item) => [item.invoiceId, item.amount]));
      setAllocations(open.map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate, openAmount: invoice.openAmount, amount: suggested.get(invoice.id) ?? "0" })));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت فاکتورهای باز مشتری ناموفق بود.");
    } finally {
      setLoadingInvoices(false);
    }
  }

  function changeCustomer(customerId: string) {
    update("customerId", customerId);
    void loadSuggestion(customerId, parseNumberInput(form.amount) || 0);
  }

  function refreshSuggestion() {
    void loadSuggestion(form.customerId, parseNumberInput(form.amount) || 0);
  }

  function setAllocationAmount(invoiceId: number, value: string) {
    setAllocations((current) => current.map((line) => (line.invoiceId === invoiceId ? { ...line, amount: value } : line)));
  }

  const allocatedTotal = allocations.reduce((sum, line) => sum + (parseNumberInput(line.amount) || 0), 0);
  const amountValue = parseNumberInput(form.amount) || 0;
  const unallocated = amountValue - allocatedTotal;

  function closeDialog() {
    if (saving) return;
    onOpenChange(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    if (!form.customerId) problems.push("مشتری را انتخاب کنید.");
    if (!form.paymentDate) problems.push("تاریخ دریافت را وارد کنید.");
    if (!(amountValue > 0)) problems.push("مبلغ باید بزرگ‌تر از صفر باشد.");
    if (form.method === "CHECK" && !form.chequeDueDate) problems.push("برای روش پرداخت «چک» تاریخ سررسید الزامی است.");
    if (allocatedTotal > amountValue) problems.push("جمع تخصیص‌ها نمی‌تواند از مبلغ دریافت بیشتر باشد.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      const payment = await apiFetch<CustomerPaymentDetail>("/receivables/payments", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(form.customerId),
          paymentDate: form.paymentDate,
          amount: amountValue,
          method: form.method,
          referenceNumber: form.referenceNumber.trim(),
          chequeDueDate: form.method === "CHECK" ? form.chequeDueDate : undefined,
          bankName: form.method === "CHECK" ? form.bankName.trim() : undefined,
          note: form.note.trim(),
        }),
      });
      const items = allocations.filter((line) => (parseNumberInput(line.amount) || 0) > 0).map((line) => ({ invoiceId: line.invoiceId, amount: parseNumberInput(line.amount) }));
      if (items.length > 0) {
        try {
          await apiFetch("/receivables/allocations", { method: "POST", body: JSON.stringify({ sourcePaymentId: payment.id, items }) });
          pushSuccess(`دریافت ${payment.paymentNumber} ثبت و به ${items.length.toLocaleString("fa-IR")} فاکتور تخصیص یافت.`);
        } catch (allocationReason) {
          const error = allocationReason as ApiError;
          pushError(`دریافت ${payment.paymentNumber} ثبت شد، اما تخصیص آن ناموفق بود: ${error.message ?? "خطای نامشخص"}`);
        }
      } else {
        pushSuccess(`دریافت ${payment.paymentNumber} ثبت شد.`);
      }
      onCreated(payment.id);
      onOpenChange(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت دریافت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ثبت دریافت</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="record-receipt-form" className="grid gap-4" onSubmit={submit} noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-customer">مشتری<RequiredMark /></Label>
                <select id="receipt-customer" className={selectClass} value={form.customerId} onChange={(event) => changeCustomer(event.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name} ({customer.customerNumber})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-date">تاریخ دریافت<RequiredMark /></Label>
                <JalaliDateInput idPrefix="receipt-date" value={form.paymentDate} onChange={(value) => update("paymentDate", value)} maxYear={JALALI_MAX_YEAR} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-amount">مبلغ (ریال)<RequiredMark /></Label>
                <Input id="receipt-amount" inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} onBlur={refreshSuggestion} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-method">روش پرداخت</Label>
                <select id="receipt-method" className={selectClass} value={form.method} onChange={(event) => update("method", event.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                  ))}
                </select>
              </div>
              {form.method === "CHECK" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="receipt-cheque-due">سررسید چک<RequiredMark /></Label>
                    <JalaliDateInput idPrefix="receipt-cheque-due" value={form.chequeDueDate} onChange={(value) => update("chequeDueDate", value)} maxYear={JALALI_MAX_YEAR} required />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="receipt-bank">نام بانک</Label>
                    <Input id="receipt-bank" value={form.bankName} onChange={(event) => update("bankName", event.target.value)} />
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-reference">شماره مرجع</Label>
                <Input id="receipt-reference" value={form.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="receipt-note">یادداشت</Label>
              <textarea id="receipt-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
            </div>

            {form.customerId ? (
              <div className="rounded-md border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
                  <span className="text-sm font-medium">تخصیص به فاکتور (اختیاری)</span>
                  <Button type="button" size="sm" variant="ghost" disabled={loadingInvoices} onClick={refreshSuggestion}>
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    پیشنهاد تخصیص
                  </Button>
                </div>
                {loadingInvoices ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">در حال دریافت فاکتورهای باز...</p>
                ) : openInvoices.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">این مشتری فاکتور بازی ندارد.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-muted/20 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">شماره فاکتور</th>
                          <th className="px-3 py-2 font-medium">سررسید</th>
                          <th className="px-3 py-2 font-medium">مانده فاکتور</th>
                          <th className="px-3 py-2 font-medium">مبلغ تخصیص</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {allocations.map((line) => (
                          <tr key={line.invoiceId}>
                            <td className="px-3 py-2 font-mono text-xs">{line.invoiceNumber ?? `#${line.invoiceId}`}</td>
                            <td className="px-3 py-2 text-muted-foreground">{line.dueDate ? line.dueDate.slice(0, 10) : "-"}</td>
                            <td className="px-3 py-2 tabular-nums">{formatMoney(line.openAmount)}</td>
                            <td className="px-3 py-2">
                              <Input className="h-7 w-28" inputMode="decimal" value={line.amount} onChange={(event) => setAllocationAmount(line.invoiceId, event.target.value)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs">
                  <span className="text-muted-foreground">تخصیص‌یافته: {formatMoney(allocatedTotal)} ریال</span>
                  <span className={unallocated < 0 ? "font-medium text-destructive" : "text-muted-foreground"}>باقی‌ماندهٔ دریافت: {formatMoney(unallocated)} ریال</span>
                </div>
              </div>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="record-receipt-form" disabled={saving}>
            {saving ? "در حال ثبت..." : "ثبت دریافت"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
