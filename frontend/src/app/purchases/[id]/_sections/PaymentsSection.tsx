"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { JALALI_MAX_YEAR, formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import {
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  RequiredMark,
  StatusBadge,
  formatMoney,
  paymentMethodLabels,
  paymentRecordStatusLabels,
  paymentRecordStatusTone,
  selectClass,
  textareaClass,
  type PaymentMethod,
  type PaymentRecordStatus,
  type PurchaseDetail,
  type PurchasePaymentRow,
  type PurchaseStatus,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

export type PaymentFormState = {
  paymentDate: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string;
  status: PaymentRecordStatus;
  note: string;
};

// COMPLETED by default (business decision 2026-10-05) — only COMPLETED
// payments count toward the paid amount; PENDING is still selectable (e.g.
// a post-dated cheque not yet cleared).
export const emptyPaymentForm: PaymentFormState = {
  paymentDate: "",
  amount: "",
  method: "CASH",
  referenceNumber: "",
  status: "COMPLETED",
  note: "",
};

// Which purchase statuses allow recording a payment — mirrors the backend
// (purchase-rules.ts PAYABLE_PURCHASE_STATUSES); the backend stays
// authoritative, this just hides actions that would be refused.
const PAYABLE_STATUSES: PurchaseStatus[] = ["CONFIRMED", "RECEIVED", "CLOSED"];

// «پرداخت‌ها» section plus its add/edit dialog. All form/dialog state lives
// in page.tsx and is passed in; `onChanged` reloads the purchase (its
// paid/remaining amounts and payment status are recomputed server-side).
export function PaymentsSection({
  purchaseId,
  purchase,
  canManagePayments,
  dialogOpen,
  setDialogOpen,
  form,
  setForm,
  editingPaymentId,
  setEditingPaymentId,
  saving,
  setSaving,
  onChanged,
  toasts,
}: {
  purchaseId: number;
  purchase: PurchaseDetail;
  canManagePayments: boolean;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  form: PaymentFormState;
  setForm: Dispatch<SetStateAction<PaymentFormState>>;
  // null = adding a new payment; otherwise the payment being edited in place
  // (PATCH /purchases/:id/payments/:paymentId).
  editingPaymentId: number | null;
  setEditingPaymentId: (id: number | null) => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;

  function openPaymentDialog() {
    setEditingPaymentId(null);
    setForm(emptyPaymentForm);
    setDialogOpen(true);
  }

  function openEditPaymentDialog(payment: PurchasePaymentRow) {
    setEditingPaymentId(payment.id);
    setForm({
      paymentDate: payment.paymentDate.slice(0, 10),
      amount: String(Number(payment.amount)),
      method: payment.method,
      referenceNumber: payment.referenceNumber ?? "",
      status: payment.status,
      note: payment.note ?? "",
    });
    setDialogOpen(true);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.paymentDate || !form.amount) {
      pushError("تاریخ و مبلغ پرداخت الزامی است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editingPaymentId === null ? `/purchases/${purchaseId}/payments` : `/purchases/${purchaseId}/payments/${editingPaymentId}`, {
        method: editingPaymentId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          paymentDate: form.paymentDate,
          amount: parseNumberInput(form.amount),
          method: form.method,
          referenceNumber: form.referenceNumber.trim(),
          status: form.status,
          note: form.note.trim(),
        }),
      });
      pushSuccess(editingPaymentId === null ? "پرداخت با موفقیت ثبت شد." : "پرداخت با موفقیت ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت پرداخت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function removePayment(paymentId: number) {
    if (!window.confirm("آیا از حذف این پرداخت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/payments/${paymentId}`, { method: "DELETE" });
      pushSuccess("پرداخت حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف پرداخت ناموفق بود.");
    }
  }

  const remainingAmount = Number(purchase.totalAmount) - Number(purchase.paidAmount);
  // 0 → fully settled (success/green). Negative → paid more than the total,
  // i.e. overpaid (warning/yellow). Positive → still owed (destructive/red,
  // unchanged from before).
  const remainingAmountClass =
    remainingAmount === 0 ? "text-success" : remainingAmount < 0 ? "text-warning" : "text-destructive";
  // Overpayment is allowed (business decision 2026-10-05) but must be
  // impossible to miss — see the warning banner below.
  const overpaidAmount = remainingAmount < 0 ? -remainingAmount : 0;
  const canAddPayment = canManagePayments && PAYABLE_STATUSES.includes(purchase.status);

  return (
    <>
      {/* 3. پرداخت‌ها */}
      <DetailSection
        title="پرداخت‌ها"
        action={
          canAddPayment ? (
            <Button size="sm" onClick={openPaymentDialog}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن پرداخت
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {canManagePayments && !PAYABLE_STATUSES.includes(purchase.status) ? (
            <p className="text-xs text-muted-foreground">
              ثبت پرداخت فقط برای خرید «تأییدشده»، «دریافت‌شده» یا «بسته‌شده» امکان‌پذیر است.
            </p>
          ) : null}
          {overpaidAmount > 0 ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                پرداخت بیش از مبلغ خرید: مجموع پرداخت‌های تکمیل‌شده {formatMoney(overpaidAmount)} ریال بیشتر از مبلغ کل خرید است.
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">مبلغ کل</p>
              <p className="mt-1 font-medium tabular-nums">{formatMoney(purchase.totalAmount)} ریال</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">مبلغ پرداخت‌شده</p>
              <p className="mt-1 font-medium text-success tabular-nums">{formatMoney(purchase.paidAmount)} ریال</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">مبلغ باقی‌مانده</p>
              <p className={`mt-1 font-medium tabular-nums ${remainingAmountClass}`}>
                {overpaidAmount > 0 ? `${formatMoney(overpaidAmount)} ریال اضافه پرداخت` : `${formatMoney(remainingAmount)} ریال`}
              </p>
            </div>
          </div>

          {purchase.payments.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              هنوز پرداختی ثبت نشده است.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[40rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">تاریخ</th>
                    <th className="px-3 py-2 font-medium">مبلغ</th>
                    <th className="px-3 py-2 font-medium">روش پرداخت</th>
                    <th className="px-3 py-2 font-medium">شماره مرجع</th>
                    <th className="px-3 py-2 font-medium">وضعیت</th>
                    <th className="px-3 py-2 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {purchase.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-3 py-2 text-muted-foreground">{formatJalali(payment.paymentDate)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(payment.amount)} ریال</td>
                      <td className="px-3 py-2 text-muted-foreground">{paymentMethodLabels[payment.method]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{payment.referenceNumber || "-"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge label={paymentRecordStatusLabels[payment.status]} tone={paymentRecordStatusTone[payment.status]} />
                      </td>
                      <td className="px-3 py-2">
                        {canManagePayments ? (
                          <div className="flex gap-1">
                            {PAYABLE_STATUSES.includes(purchase.status) ? (
                              <Button size="sm" variant="ghost" onClick={() => openEditPaymentDialog(payment)}>
                                <Pencil className="size-4" aria-hidden="true" />
                                ویرایش
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removePayment(payment.id)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              حذف
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DetailSection>

      {/* Portal-based: renders outside the page flow regardless of where it sits in the tree. */}
      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPaymentId === null ? "افزودن پرداخت" : "ویرایش پرداخت"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="payment-form" className="grid gap-4" onSubmit={submitPayment} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-date-year">تاریخ<RequiredMark /></Label>
                {/* Future dates allowed (post-dated cheques) up to the end of
                    the business date range — never capped at this year. */}
                <JalaliDateInput
                  idPrefix="payment-date"
                  value={form.paymentDate}
                  onChange={(value) => setForm((current) => ({ ...current, paymentDate: value }))}
                  maxYear={JALALI_MAX_YEAR}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-amount">مبلغ (ریال)<RequiredMark /></Label>
                <Input
                  id="payment-amount"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-method">روش پرداخت</Label>
                <select
                  id="payment-method"
                  className={selectClass}
                  value={form.method}
                  onChange={(event) => setForm((current) => ({ ...current, method: event.target.value as PaymentMethod }))}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-reference">شماره مرجع</Label>
                <Input
                  id="payment-reference"
                  value={form.referenceNumber}
                  onChange={(event) => setForm((current) => ({ ...current, referenceNumber: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-status">وضعیت</Label>
                <select
                  id="payment-status"
                  className={selectClass}
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PaymentRecordStatus }))}
                >
                  {PAYMENT_RECORD_STATUSES.map((status) => (
                    <option key={status} value={status}>{paymentRecordStatusLabels[status]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-note">یادداشت</Label>
                <textarea
                  id="payment-note"
                  className={textareaClass}
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="payment-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingPaymentId === null ? "ثبت پرداخت" : "ذخیره تغییرات"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
