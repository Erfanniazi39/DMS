"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { formatMoney } from "@/lib/format";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  CREDIT_LIMIT_EXCEEDED,
  SALES_ORDER_APPROVAL_REQUIRED,
  approvalReasonLabels,
  salesOrderTitle,
  type CreditDetails,
  type SalesOrderActionResult,
  type SalesOrderApprovalReason,
  type SalesOrderBackorder,
  type SalesOrderDetail,
} from "../../shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

type ActionKind = "confirm" | "approve" | "reject" | "cancel" | "close";

// What a 409 told us — drives the second step of the confirm/approve dialog.
type Conflict = {
  code: typeof SALES_ORDER_APPROVAL_REQUIRED | typeof CREDIT_LIMIT_EXCEEDED;
  message: string;
  reasons: SalesOrderApprovalReason[];
  credit: CreditDetails | null;
};

const dialogTitles: Record<ActionKind, string> = {
  confirm: "تأیید سفارش",
  approve: "تأیید سفارش در انتظار",
  reject: "رد درخواست تأیید",
  cancel: "لغو سفارش",
  close: "بستن سفارش",
};

function readConflict(error: ApiError): Conflict | null {
  if (error.status !== 409) return null;
  if (error.code === SALES_ORDER_APPROVAL_REQUIRED) {
    const details = (error.details ?? {}) as { reasons?: SalesOrderApprovalReason[]; credit?: CreditDetails };
    return { code: SALES_ORDER_APPROVAL_REQUIRED, message: error.message, reasons: details.reasons ?? [], credit: details.credit ?? null };
  }
  if (error.code === CREDIT_LIMIT_EXCEEDED) {
    return { code: CREDIT_LIMIT_EXCEEDED, message: error.message, reasons: ["CREDIT_LIMIT"], credit: (error.details as CreditDetails | undefined) ?? null };
  }
  return null;
}

function CreditFigures({ credit }: { credit: CreditDetails }) {
  const rows: [string, string][] = [
    ["سقف اعتبار", credit.creditLimit === null ? "تعریف نشده (فقط فروش نقدی)" : `${formatMoney(credit.creditLimit)} ریال`],
    ["تعهدات باز فعلی", `${formatMoney(credit.exposure)} ریال`],
    ["مبلغ این سفارش", `${formatMoney(credit.orderAmount)} ریال`],
    ["مجموع پس از تأیید", `${formatMoney(credit.projected)} ریال`],
    ["مازاد بر سقف", `${formatMoney(credit.excess)} ریال`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The order's status-transition buttons (page header) and their dialogs.
// Every status change is a dedicated backend action — there is no generic
// "set status" and none of this lives in the edit form:
//   DRAFT            → «تأیید سفارش» (POST :id/confirm, sales.manage).
//                      A 409 SALES_ORDER_APPROVAL_REQUIRED turns the dialog
//                      into «ارسال برای تأیید» (submitForApproval: true); a
//                      409 CREDIT_LIMIT_EXCEEDED (sales.approve holders only)
//                      asks for the credit-override reason and retries.
//   PENDING_APPROVAL → «تأیید» / «رد» (POST :id/approve | :id/reject, sales.approve).
//   CONFIRMED        → «بستن سفارش» / «لغو سفارش» (POST :id/close | :id/cancel,
//                      sales.manage, reason required; both release reservations).
// The dialogs are opened from buttons (never from a Select callback). Every
// call sends the page's updatedAt; RECORD_MODIFIED disables further actions
// until the page is reloaded.
export function StatusActions({
  order,
  onUpdated,
  canManage,
  canApprove,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  order: SalesOrderDetail;
  onUpdated: (order: SalesOrderDetail, backorders?: SalesOrderBackorder[]) => void;
  canManage: boolean;
  canApprove: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const router = useRouter();
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nothingDelivered = order.items.every((line) => Number(line.deliveredQty) === 0);
  const showConfirm = canManage && order.status === "DRAFT";
  const showApproval = canApprove && order.status === "PENDING_APPROVAL";
  const showClose = canManage && order.status === "CONFIRMED";
  const showCancel = showClose && nothingDelivered;
  const disabled = staleRecord || saving || deleting;

  function open(kind: ActionKind) {
    setAction(kind);
    setReason("");
    setNote("");
    setConflict(null);
  }

  function closeDialog() {
    if (saving) return;
    setAction(null);
  }

  function handleError(error: ApiError, fallback: string) {
    const nextConflict = readConflict(error);
    if (nextConflict) {
      // Stay in the dialog and show the next step.
      setConflict(nextConflict);
      setReason("");
      return;
    }
    if (error.code === "RECORD_MODIFIED") {
      setStaleRecord(true);
      setAction(null);
    }
    if (error.messages?.length) pushErrors(error.messages);
    else pushError(error.message ?? fallback);
  }

  async function post<T>(path: string, body: Record<string, unknown>) {
    return apiFetch<T>(`/sales-orders/${order.id}/${path}`, { method: "POST", body: JSON.stringify({ updatedAt: order.updatedAt, ...body }) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const needsCreditReason = conflict?.code === CREDIT_LIMIT_EXCEEDED;
    if ((action === "cancel" || action === "close" || needsCreditReason) && !reason.trim()) {
      pushError(needsCreditReason ? "علت عبور از سقف اعتبار را وارد کنید." : action === "cancel" ? "علت لغو سفارش الزامی است." : "علت بستن سفارش الزامی است.");
      return;
    }
    setSaving(true);
    try {
      if (action === "confirm") {
        const body =
          conflict?.code === SALES_ORDER_APPROVAL_REQUIRED
            ? { submitForApproval: true }
            : conflict?.code === CREDIT_LIMIT_EXCEEDED
              ? { creditOverrideReason: reason.trim() }
              : {};
        const result = await post<SalesOrderActionResult>("confirm", body);
        const { backorders, ...updated } = result;
        onUpdated(updated, backorders);
        pushSuccess(
          updated.status === "PENDING_APPROVAL"
            ? "سفارش برای تأیید کاربر دارای مجوز «تأیید فروش» ارسال شد."
            : `سفارش ${updated.orderNumber ?? ""} تأیید شد و موجودی اقلام رزرو شد.`,
        );
      } else if (action === "approve") {
        const result = await post<SalesOrderActionResult>("approve", {
          note: note.trim(),
          ...(conflict?.code === CREDIT_LIMIT_EXCEEDED ? { creditOverrideReason: reason.trim() } : {}),
        });
        const { backorders, ...updated } = result;
        onUpdated(updated, backorders);
        pushSuccess(`سفارش ${updated.orderNumber ?? ""} تأیید شد و موجودی اقلام رزرو شد.`);
      } else if (action === "reject") {
        onUpdated(await post<SalesOrderDetail>("reject", { reason: reason.trim() }));
        pushSuccess("درخواست تأیید رد شد و سفارش به پیش‌نویس بازگشت.");
      } else {
        onUpdated(await post<SalesOrderDetail>(action, { reason: reason.trim() }));
        pushSuccess(action === "cancel" ? "سفارش لغو شد و رزرو موجودی آزاد شد." : "سفارش بسته شد و رزرو باقی‌مانده آزاد شد.");
      }
      setAction(null);
    } catch (reasonError) {
      handleError(reasonError as ApiError, `${dialogTitles[action]} ناموفق بود.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`آیا از حذف «${salesOrderTitle(order)}» (${order.customerName}) مطمئن هستید؟`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/sales-orders/${order.id}`, { method: "DELETE" });
      router.push("/sales-orders");
    } catch (reasonError) {
      pushError((reasonError as ApiError).message ?? "حذف سفارش ناموفق بود.");
      setDeleting(false);
    }
  }

  const reasonRequired = action === "cancel" || action === "close" || conflict?.code === CREDIT_LIMIT_EXCEEDED;
  const showReasonField = action === "reject" || action === "cancel" || action === "close" || conflict?.code === CREDIT_LIMIT_EXCEEDED;
  const reasonLabel =
    conflict?.code === CREDIT_LIMIT_EXCEEDED ? "علت عبور از سقف اعتبار" : action === "cancel" ? "علت لغو" : action === "close" ? "علت بستن" : "علت رد";

  let submitLabel = "";
  if (action === "confirm") {
    submitLabel =
      conflict?.code === SALES_ORDER_APPROVAL_REQUIRED ? "ارسال برای تأیید" : conflict?.code === CREDIT_LIMIT_EXCEEDED ? "تأیید با عبور از سقف اعتبار" : "تأیید سفارش";
  } else if (action === "approve") {
    submitLabel = conflict?.code === CREDIT_LIMIT_EXCEEDED ? "تأیید با عبور از سقف اعتبار" : "تأیید سفارش";
  } else if (action === "reject") submitLabel = "رد درخواست";
  else if (action === "cancel") submitLabel = "لغو سفارش";
  else if (action === "close") submitLabel = "بستن سفارش";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showConfirm ? (
          <>
            <Button variant="success" disabled={disabled} onClick={() => open("confirm")}>تأیید سفارش</Button>
            <Button variant="outline" disabled={disabled} onClick={() => router.push(`/sales-orders/${order.id}/edit`)}>ویرایش</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => void remove()}>{deleting ? "در حال حذف..." : "حذف"}</Button>
          </>
        ) : null}
        {showApproval ? (
          <>
            <Button variant="success" disabled={disabled} onClick={() => open("approve")}>تأیید</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => open("reject")}>رد</Button>
          </>
        ) : null}
        {showClose ? <Button variant="outline" disabled={disabled} onClick={() => open("close")}>بستن سفارش</Button> : null}
        {showCancel ? <Button variant="destructive" disabled={disabled} onClick={() => open("cancel")}>لغو سفارش</Button> : null}
      </div>

      <Dialog open={action !== null} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{action ? dialogTitles[action] : ""}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="sales-order-action-form" className="grid gap-3 text-sm" onSubmit={submit} noValidate>
              {conflict ? (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="space-y-1">
                    <p>{conflict.message}</p>
                    {conflict.code === SALES_ORDER_APPROVAL_REQUIRED && conflict.reasons.length > 0 ? (
                      <ul className="list-disc ps-5 text-xs text-muted-foreground">
                        {conflict.reasons.map((item) => (
                          <li key={item}>{approvalReasonLabels[item]}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : action === "confirm" ? (
                <p className="text-muted-foreground">
                  با تأیید، شماره سفارش تخصیص می‌یابد و موجودی اقلام در انبار رزرو می‌شود؛ کسری موجودی مانع تأیید نیست و به‌صورت پس‌افت نمایش داده
                  می‌شود. سفارش تأییدشده دیگر قابل ویرایش یا حذف نیست. اگر سفارش نیاز به تأیید مدیر داشته باشد، در مرحله بعد اطلاع داده می‌شود.
                </p>
              ) : action === "approve" ? (
                <p className="text-muted-foreground">با تأیید، شماره سفارش تخصیص می‌یابد و موجودی اقلام رزرو می‌شود. اعتبار مشتری در همین لحظه دوباره بررسی می‌شود.</p>
              ) : action === "reject" ? (
                <p className="text-muted-foreground">سفارش به وضعیت پیش‌نویس بازمی‌گردد و دوباره قابل ویرایش می‌شود.</p>
              ) : action === "cancel" ? (
                <p className="text-muted-foreground">سفارش لغو و تمام رزرو موجودی آن آزاد می‌شود. شماره سفارش حفظ می‌شود. این عمل قابل بازگشت نیست.</p>
              ) : action === "close" ? (
                <p className="text-muted-foreground">سفارش بسته می‌شود و رزرو باقی‌مانده آزاد می‌شود؛ اقلام تحویل‌شده تغییری نمی‌کنند. این عمل قابل بازگشت نیست.</p>
              ) : null}

              {conflict?.credit ? <CreditFigures credit={conflict.credit} /> : null}

              {action === "approve" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sales-order-approve-note">یادداشت تأیید</Label>
                  <textarea id="sales-order-approve-note" className={textareaClass} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="اختیاری" />
                </div>
              ) : null}

              {showReasonField ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sales-order-action-reason">
                    {reasonLabel}
                    {reasonRequired ? <RequiredMark /> : null}
                  </Label>
                  <textarea
                    id="sales-order-action-reason"
                    className={textareaClass}
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={reasonRequired ? "" : "اختیاری"}
                  />
                </div>
              ) : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="sales-order-action-form" variant={action === "cancel" || action === "reject" ? "destructive" : "default"} disabled={saving}>
              {saving ? "در حال انجام..." : submitLabel}
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
