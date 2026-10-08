"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { apiFetch, type ApiError } from "@/lib/api";
import { salesReturnTitle, type SalesReturnDetail } from "../../shared";
import { ReceiveDialog } from "./ReceiveDialog";
import { InspectDialog } from "./InspectDialog";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

type ReasonAction = "reject" | "cancel" | "completeWithoutCredit";

const reasonDialogTitles: Record<ReasonAction, string> = {
  reject: "رد درخواست مرجوعی",
  cancel: "لغو مرجوعی",
  completeWithoutCredit: "تکمیل بدون صدور یادداشت اعتباری",
};
const reasonActionPaths: Record<ReasonAction, string> = { reject: "reject", cancel: "cancel", completeWithoutCredit: "complete-without-credit" };
const reasonLabels: Record<ReasonAction, string> = { reject: "علت رد", cancel: "علت لغو", completeWithoutCredit: "علت تکمیل بدون یادداشت اعتباری" };

// The return's action buttons (page header) — build plan §5:
//   REQUESTED  → «تأیید» (POST :id/approve, sales.approve — assigns the RMA
//                number) / «رد» (sales.approve, reason) / «لغو»
//                (sales.manage, reason).
//   APPROVED   → «دریافت کالا» (ReceiveDialog, sales.deliver) / «لغو»
//                (sales.manage, reason).
//   RECEIVED   → «بازرسی و تعیین تکلیف» (InspectDialog, sales.approve).
//   INSPECTED  → «تکمیل بدون صدور یادداشت اعتباری» (sales.approve, reason)
//                — creating/posting a credit note instead lives in
//                CreditNoteSection, not here.
//   REJECTED / CANCELLED / COMPLETED — terminal, no actions.
// Every call sends the page's updatedAt; RECORD_MODIFIED disables further
// actions until the page is reloaded.
export function StatusActions({
  salesReturn,
  onUpdated,
  canApprove,
  canManage,
  canDeliver,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  salesReturn: SalesReturnDetail;
  onUpdated: (salesReturn: SalesReturnDetail) => void;
  canApprove: boolean;
  canManage: boolean;
  canDeliver: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [approving, setApproving] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);

  const disabled = staleRecord || saving || approving;

  async function approve() {
    setApproving(true);
    try {
      const updated = await apiFetch<SalesReturnDetail>(`/sales-returns/${salesReturn.id}/approve`, { method: "POST", body: JSON.stringify({ updatedAt: salesReturn.updatedAt }) });
      onUpdated(updated);
      pushSuccess(`مرجوعی ${updated.returnNumber ?? ""} تأیید شد.`);
    } catch (thrown) {
      const error = thrown as ApiError;
      if (error.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "تأیید مرجوعی ناموفق بود.");
    } finally {
      setApproving(false);
    }
  }

  function openReason(action: ReasonAction) {
    setReasonAction(action);
    setReason("");
  }
  function closeReasonDialog() {
    if (saving) return;
    setReasonAction(null);
  }

  async function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonAction) return;
    if (!reason.trim()) {
      pushError(`${reasonLabels[reasonAction]} الزامی است.`);
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<SalesReturnDetail>(`/sales-returns/${salesReturn.id}/${reasonActionPaths[reasonAction]}`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: salesReturn.updatedAt, reason: reason.trim() }),
      });
      onUpdated(updated);
      pushSuccess(`${reasonDialogTitles[reasonAction]} ثبت شد.`);
      setReasonAction(null);
    } catch (thrown) {
      const error = thrown as ApiError;
      if (error.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setReasonAction(null);
      }
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? `${reasonDialogTitles[reasonAction]} ناموفق بود.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {salesReturn.status === "REQUESTED" && canApprove ? (
          <>
            <Button variant="success" disabled={disabled} onClick={() => void approve()}>{approving ? "در حال تأیید..." : "تأیید"}</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => openReason("reject")}>رد</Button>
          </>
        ) : null}
        {(salesReturn.status === "REQUESTED" || salesReturn.status === "APPROVED") && canManage ? (
          <Button variant="outline" disabled={disabled} onClick={() => openReason("cancel")}>لغو</Button>
        ) : null}
        {salesReturn.status === "APPROVED" && canDeliver ? (
          <Button variant="success" disabled={disabled} onClick={() => setReceiveOpen(true)}>دریافت کالا</Button>
        ) : null}
        {salesReturn.status === "RECEIVED" && canApprove ? (
          <Button variant="success" disabled={disabled} onClick={() => setInspectOpen(true)}>بازرسی و تعیین تکلیف</Button>
        ) : null}
        {salesReturn.status === "INSPECTED" && canApprove ? (
          <Button variant="outline" disabled={disabled} onClick={() => openReason("completeWithoutCredit")}>تکمیل بدون یادداشت اعتباری</Button>
        ) : null}
      </div>

      <Dialog open={reasonAction !== null} onOpenChange={(isOpen) => (isOpen ? undefined : closeReasonDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{reasonAction ? reasonDialogTitles[reasonAction] : ""}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="return-reason-form" className="grid gap-3 text-sm" onSubmit={submitReason} noValidate>
              <p className="text-muted-foreground">مرجوعی «{salesReturnTitle(salesReturn)}» {reasonAction === "cancel" ? "لغو" : reasonAction === "reject" ? "رد" : "بدون صدور یادداشت اعتباری تکمیل"} می‌شود.</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="return-reason-input">
                  {reasonAction ? reasonLabels[reasonAction] : ""}
                  <RequiredMark />
                </Label>
                <textarea id="return-reason-input" className={textareaClass} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="return-reason-form" variant={reasonAction === "cancel" || reasonAction === "reject" ? "destructive" : "default"} disabled={saving}>
              {saving ? "در حال انجام..." : reasonAction ? reasonDialogTitles[reasonAction] : ""}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={closeReasonDialog}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} salesReturn={salesReturn} onUpdated={onUpdated} staleRecord={staleRecord} setStaleRecord={setStaleRecord} toasts={{ pushError, pushErrors, pushSuccess }} />
      <InspectDialog open={inspectOpen} onOpenChange={setInspectOpen} salesReturn={salesReturn} onUpdated={onUpdated} staleRecord={staleRecord} setStaleRecord={setStaleRecord} toasts={{ pushError, pushErrors, pushSuccess }} />
    </>
  );
}
