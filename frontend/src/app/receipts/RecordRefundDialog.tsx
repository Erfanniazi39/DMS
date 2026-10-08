"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { JALALI_MAX_YEAR } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { PAYMENT_METHODS, paymentMethodLabels, type CustomerPaymentDetail, type CustomerPaymentFormOptions, type PaymentMethod } from "./shared";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

type RefundForm = {
  customerId: string;
  paymentDate: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string;
  chequeDueDate: string;
  bankName: string;
  note: string;
};

const emptyForm: RefundForm = { customerId: "", paymentDate: "", amount: "", method: "CASH", referenceNumber: "", chequeDueDate: "", bankName: "", note: "" };

// «ثبت بازپرداخت» — POST /receivables/refunds (receivables.manage): a
// REFUND CustomerPayment, raising the customer's AR balance back up (build
// plan §3). No allocation grid here — a refund isn't allocated to an
// invoice the way a receipt is; it's simply recorded. Cheque fields appear
// for method=CHECK exactly like the receipt dialog (B9 applies to either
// direction — an issued cheque is PENDING until cleared, same backend rule).
export function RecordRefundDialog({ open, onOpenChange, onCreated, toasts }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (paymentId: number) => void; toasts: SectionToasts }) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [form, setForm] = useState<RefundForm>(emptyForm);
  const [customers, setCustomers] = useState<CustomerPaymentFormOptions["customers"]>([]);
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setForm(emptyForm);
  }

  useEffect(() => {
    if (!open) return;
    apiFetch<CustomerPaymentFormOptions>("/receivables/payments/form-options")
      .then((data) => setCustomers(data.customers))
      .catch((reason) => pushError((reason as ApiError).message ?? "دریافت فهرست مشتریان ناموفق بود."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function update<K extends keyof RefundForm>(key: K, value: RefundForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeDialog() {
    if (saving) return;
    onOpenChange(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountValue = Number(form.amount);
    const problems: string[] = [];
    if (!form.customerId) problems.push("مشتری را انتخاب کنید.");
    if (!form.paymentDate) problems.push("تاریخ بازپرداخت را وارد کنید.");
    if (!(amountValue > 0)) problems.push("مبلغ باید بزرگ‌تر از صفر باشد.");
    if (form.method === "CHECK" && !form.chequeDueDate) problems.push("برای روش پرداخت «چک» تاریخ سررسید الزامی است.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      const payment = await apiFetch<CustomerPaymentDetail>("/receivables/refunds", {
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
      pushSuccess(`بازپرداخت ${payment.paymentNumber} ثبت شد.`);
      onCreated(payment.id);
      onOpenChange(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت بازپرداخت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>ثبت بازپرداخت</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="record-refund-form" className="grid gap-4" onSubmit={submit} noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="refund-customer">مشتری<RequiredMark /></Label>
                <select id="refund-customer" className={selectClass} value={form.customerId} onChange={(event) => update("customerId", event.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name} ({customer.customerNumber})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="refund-date">تاریخ بازپرداخت<RequiredMark /></Label>
                <JalaliDateInput idPrefix="refund-date" value={form.paymentDate} onChange={(value) => update("paymentDate", value)} maxYear={JALALI_MAX_YEAR} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="refund-amount">مبلغ (ریال)<RequiredMark /></Label>
                <Input id="refund-amount" inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="refund-method">روش پرداخت</Label>
                <select id="refund-method" className={selectClass} value={form.method} onChange={(event) => update("method", event.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                  ))}
                </select>
              </div>
              {form.method === "CHECK" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="refund-cheque-due">سررسید چک<RequiredMark /></Label>
                    <JalaliDateInput idPrefix="refund-cheque-due" value={form.chequeDueDate} onChange={(value) => update("chequeDueDate", value)} maxYear={JALALI_MAX_YEAR} required />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="refund-bank">نام بانک</Label>
                    <Input id="refund-bank" value={form.bankName} onChange={(event) => update("bankName", event.target.value)} />
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="refund-reference">شماره مرجع</Label>
                <Input id="refund-reference" value={form.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="refund-note">یادداشت</Label>
              <textarea id="refund-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="record-refund-form" variant="destructive" disabled={saving}>
            {saving ? "در حال ثبت..." : "ثبت بازپرداخت"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
