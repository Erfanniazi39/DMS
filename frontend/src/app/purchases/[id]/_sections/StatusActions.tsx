"use client";

import { Button } from "@/components/ui/button";
import { apiFetch, type ApiError } from "@/lib/api";
import type { PurchaseDetail, PurchaseStatus } from "../../shared";
import type { SectionToasts } from "./DetailSection";

// Status changes on an existing purchase live only here, as one-click
// actions (business-owner request 2026-10-05) — no longer in the edit form.
// One forward step per status; CLOSED/CANCELLED are terminal. Each button
// calls PATCH /purchases/:id/status — the only way an existing purchase's
// status changes (PATCH /purchases/:id refuses a status change). The backend
// stays authoritative: legal transitions (ALLOWED_PURCHASE_STATUS_TRANSITIONS
// in backend purchase-rules.ts), returns blocking CANCEL (but not CLOSE),
// optimistic locking.
type StatusAction = {
  target: PurchaseStatus;
  label: string;
  pendingLabel: string;
  confirmMessage: string;
  successMessage: string;
  errorMessage: string;
  variant: "success" | "default" | "outline" | "destructive";
};

const FORWARD_STATUS_ACTION: Partial<Record<PurchaseStatus, StatusAction>> = {
  DRAFT: {
    target: "CONFIRMED",
    label: "تأیید خرید",
    pendingLabel: "در حال تأیید...",
    confirmMessage: "آیا از تأیید این خرید مطمئن هستید؟",
    successMessage: "خرید تأیید شد.",
    errorMessage: "تأیید خرید ناموفق بود.",
    variant: "success",
  },
  CONFIRMED: {
    target: "RECEIVED",
    label: "ثبت دریافت کالا",
    pendingLabel: "در حال ثبت دریافت...",
    confirmMessage: "آیا دریافت کالای این خرید را تأیید می‌کنید؟",
    successMessage: "دریافت کالا ثبت شد.",
    errorMessage: "ثبت دریافت کالا ناموفق بود.",
    variant: "success",
  },
  RECEIVED: {
    target: "CLOSED",
    label: "بستن خرید",
    pendingLabel: "در حال بستن...",
    confirmMessage: "آیا از بستن این خرید مطمئن هستید؟",
    successMessage: "خرید بسته شد.",
    errorMessage: "بستن خرید ناموفق بود.",
    variant: "default",
  },
};

const CANCEL_STATUS_ACTION: StatusAction = {
  target: "CANCELLED",
  label: "لغو خرید",
  pendingLabel: "در حال لغو...",
  confirmMessage: "آیا از لغو این خرید مطمئن هستید؟",
  successMessage: "خرید لغو شد.",
  errorMessage: "لغو خرید ناموفق بود.",
  variant: "destructive",
};

const CANCELLABLE_STATUSES: PurchaseStatus[] = ["DRAFT", "CONFIRMED", "RECEIVED"];

// The status-transition buttons in the page header (rendered as a fragment
// so they sit in the header's own flex row, before «ویرایش»). State —
// which transition is in flight, and whether the backend answered
// RECORD_MODIFIED — lives in page.tsx, which also renders the stale-record
// banner at the top of the page.
export function StatusActions({
  purchase,
  setPurchase,
  canEdit,
  changingStatusTo,
  setChangingStatusTo,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  purchase: PurchaseDetail;
  setPurchase: (purchase: PurchaseDetail) => void;
  canEdit: boolean;
  changingStatusTo: PurchaseStatus | null;
  setChangingStatusTo: (status: PurchaseStatus | null) => void;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;

  async function changeStatus(action: StatusAction) {
    if (!window.confirm(action.confirmMessage)) return;
    setChangingStatusTo(action.target);
    try {
      // Status-only endpoint (PATCH /purchases/:id/status): just the target
      // status plus this page's updatedAt as the optimistic-locking token.
      // No items/amounts are sent, so the overage re-check that the full
      // edit runs never applies here.
      const updated = await apiFetch<PurchaseDetail>(`/purchases/${purchase.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: action.target, updatedAt: purchase.updatedAt }),
      });
      setPurchase(updated);
      pushSuccess(action.successMessage);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? action.errorMessage);
    } finally {
      setChangingStatusTo(null);
    }
  }

  // Status actions: purchases.edit (same as "ویرایش"); none on CLOSED/CANCELLED.
  const forwardStatusAction = canEdit ? FORWARD_STATUS_ACTION[purchase.status] : undefined;
  const canCancelPurchase = canEdit && CANCELLABLE_STATUSES.includes(purchase.status);
  const statusActionsDisabled = changingStatusTo !== null || staleRecord;

  return (
    <>
      {forwardStatusAction ? (
        <Button variant={forwardStatusAction.variant} disabled={statusActionsDisabled} onClick={() => void changeStatus(forwardStatusAction)}>
          {changingStatusTo === forwardStatusAction.target ? forwardStatusAction.pendingLabel : forwardStatusAction.label}
        </Button>
      ) : null}
      {canCancelPurchase ? (
        <Button variant={CANCEL_STATUS_ACTION.variant} disabled={statusActionsDisabled} onClick={() => void changeStatus(CANCEL_STATUS_ACTION)}>
          {changingStatusTo === CANCEL_STATUS_ACTION.target ? CANCEL_STATUS_ACTION.pendingLabel : CANCEL_STATUS_ACTION.label}
        </Button>
      ) : null}
    </>
  );
}
