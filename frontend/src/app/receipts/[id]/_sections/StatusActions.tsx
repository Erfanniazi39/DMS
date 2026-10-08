"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { apiFetch, type ApiError } from "@/lib/api";
import { customerPaymentTitle, type CustomerPaymentDetail } from "../../shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

type ActionKind = "cancel" | "clear" | "bounce";

const dialogTitles: Record<ActionKind, string> = {
  cancel: "لغو دریافت/پرداخت",
  clear: "تأیید وصول چک",
  bounce: "برگشت چک",
};

const actionPaths: Record<ActionKind, string> = { cancel: "cancel", clear: "clear-cheque", bounce: "bounce-cheque" };

// The payment's status-transition buttons (page header) — build plan §5:
//   COMPLETED → «لغو» (POST :id/cancel, reason required, reverses active allocations).
//   PENDING (cheque) → «تأیید وصول چک» (POST :id/clear-cheque — no reason: a
//                      routine confirmation, it only starts counting toward
//                      the invoice from this moment, B9) or «برگشت چک»
//                      (POST :id/bounce-cheque, reason required, reverses
//                      active allocations).
// Every call sends the page's updatedAt; RECORD_MODIFIED disables further
// actions until the page is reloaded.
export function StatusActions({
  payment,
  onUpdated,
  canManage,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  payment: CustomerPaymentDetail;
  onUpdated: (payment: CustomerPaymentDetail) => void;
  canManage: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const showCancel = canManage && payment.status === "COMPLETED";
  const showChequeActions = canManage && payment.status === "PENDING";
  const disabled = staleRecord || saving;

  function open(kind: ActionKind) {
    setAction(kind);
    setReason("");
  }
  function closeDialog() {
    if (saving) return;
    setAction(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    if (action !== "clear" && !reason.trim()) {
      pushError(action === "cancel" ? "علت لغو الزامی است." : "علت برگشت چک الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<CustomerPaymentDetail>(`/receivables/payments/${payment.id}/${actionPaths[action]}`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: payment.updatedAt, ...(action === "clear" ? {} : { reason: reason.trim() }) }),
      });
      onUpdated(updated);
      pushSuccess(action === "cancel" ? "دریافت لغو شد." : action === "clear" ? "وصول چک تأیید شد." : "برگشت چک ثبت شد.");
      setAction(null);
    } catch (reasonError) {
      const error = reasonError as ApiError;
      if (error.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setAction(null);
      }
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? `${dialogTitles[action]} ناموفق بود.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showChequeActions ? (
          <>
            <Button variant="success" disabled={disabled} onClick={() => open("clear")}>تأیید وصول چک</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => open("bounce")}>برگشت چک</Button>
          </>
        ) : null}
        {showCancel ? <Button variant="destructive" disabled={disabled} onClick={() => open("cancel")}>لغو</Button> : null}
      </div>

      <Dialog open={action !== null} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{action ? dialogTitles[action] : ""}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="payment-action-form" className="grid gap-3 text-sm" onSubmit={submit} noValidate>
              <p className="text-muted-foreground">
                {action === "cancel"
                  ? `دریافت «${customerPaymentTitle(payment)}» لغو می‌شود و تخصیص‌های فعال آن (در صورت وجود) برگشت می‌خورد. این عمل قابل بازگشت نیست.`
                  : action === "clear"
                    ? "با تأیید وصول، این چک تکمیل‌شده علامت می‌خورد و از این لحظه، تخصیص‌های ثبت‌شدهٔ آن در تسویهٔ فاکتورهای مربوط اثر می‌کند."
                    : "با ثبت برگشت چک، این دریافت لغو می‌شود و تخصیص‌های ثبت‌شدهٔ آن (در صورت وجود) برگشت می‌خورد."}
              </p>
              {action !== "clear" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="payment-action-reason">
                    {action === "cancel" ? "علت لغو" : "علت برگشت چک"}
                    <RequiredMark />
                  </Label>
                  <textarea id="payment-action-reason" className={textareaClass} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
                </div>
              ) : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="payment-action-form" variant={action === "cancel" || action === "bounce" ? "destructive" : "default"} disabled={saving}>
              {saving ? "در حال انجام..." : dialogTitles[action ?? "cancel"]}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
