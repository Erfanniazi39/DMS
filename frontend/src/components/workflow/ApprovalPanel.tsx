"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatJalali } from "@/lib/jalali";
import { useAdminUser } from "@/app/admin/layout";
import { formatMoney } from "@/lib/format";
import {
  approvalPersonName,
  approvalRequestStatusLabels,
  approvalRequestStatusTone,
  approvalStepStatusLabels,
  type ApprovalRequestRow,
  type DocumentApproval,
} from "@/lib/approval";

type Action = "approve" | "reject" | "withdraw";

const ACTION_COPY: Record<Action, { title: string; button: string; pending: string; success: string; label: string; hint: string; required: boolean; variant: "success" | "destructive" | "outline" }> = {
  approve: {
    title: "تأیید",
    button: "تأیید",
    pending: "در حال تأیید...",
    success: "تصمیم شما ثبت شد.",
    label: "توضیح (اختیاری)",
    hint: "اگر شرط یا نکته‌ای دارید اینجا بنویسید؛ در تاریخچهٔ تأیید ثبت می‌شود.",
    required: false,
    variant: "success",
  },
  reject: {
    title: "رد درخواست تأیید",
    button: "رد",
    pending: "در حال رد...",
    success: "رد شد و سند به پیش‌نویس برگشت.",
    label: "دلیل رد",
    hint: "سند به پیش‌نویس برمی‌گردد تا ارسال‌کننده اصلاح و دوباره ارسال کند.",
    required: true,
    variant: "destructive",
  },
  withdraw: {
    title: "انصراف از درخواست تأیید",
    button: "پس‌گرفتن درخواست",
    pending: "در حال انجام...",
    success: "درخواست تأیید پس گرفته شد و سند به پیش‌نویس برگشت.",
    label: "دلیل (اختیاری)",
    hint: "سند به پیش‌نویس برمی‌گردد و می‌توانید آن را ویرایش و دوباره ارسال کنید.",
    required: false,
    variant: "outline",
  },
};

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

// Approval state of a document that goes through the workflow engine
// (purchases, purchase requests, sales orders): who must decide next, the
// approve / reject / withdraw actions, and the history of every submission.
// Shown only when the document is waiting or has ever been through approval.
// The document's own page supplies `documentPath` (e.g. /purchases/5 — the
// actions POST to <documentPath>/approve | reject | withdraw), its optimistic-
// locking `updatedAt`, and `fields` when its DTOs name the comment differently
// (sales orders: note / reason).
export function ApprovalPanel({
  title = "تأیید",
  documentPath,
  updatedAt,
  approval,
  waiting,
  waitingNote,
  canManage,
  fields = { approve: "comment", reject: "comment", withdraw: "comment" },
  onChanged,
  setStaleRecord,
  toasts,
}: {
  title?: string;
  documentPath: string;
  updatedAt: string;
  approval: DocumentApproval | undefined;
  /** The document is currently held for approval (the caller knows its own status). */
  waiting: boolean;
  waitingNote?: string;
  /** May withdraw someone else's request (a manager of that document type). */
  canManage: boolean;
  fields?: { approve: string; reject: string; withdraw: string };
  onChanged: () => Promise<void>;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const user = useAdminUser();
  const [action, setAction] = useState<Action | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  if (!approval || (approval.requests.length === 0 && !waiting)) return null;

  const pending = approval.requests.find((request) => request.status === "PENDING") ?? null;
  const openStep = pending?.steps.find((step) => step.level === pending.currentLevel) ?? null;
  const canWithdraw = waiting && pending !== null && (canManage || approval.requestedByUserId === user?.id);

  function open(next: Action) {
    setComment("");
    setAction(next);
  }

  async function submit() {
    if (!action) return;
    const copy = ACTION_COPY[action];
    if (copy.required && !comment.trim()) {
      toasts.pushError("نوشتن دلیل الزامی است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`${documentPath}/${action}`, {
        method: "POST",
        body: JSON.stringify({ updatedAt, ...(comment.trim() ? { [fields[action]]: comment.trim() } : {}) }),
      });
      toasts.pushSuccess(copy.success);
      setAction(null);
      window.dispatchEvent(new Event("dms:workflow-changed"));
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) toasts.pushErrors(apiError.messages);
      else toasts.pushError(apiError.message ?? "انجام عملیات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PanelSection
        title={title}
        action={
          waiting ? (
            <div className="flex flex-wrap items-center gap-2">
              {approval.canDecide ? (
                <>
                  <Button size="sm" variant="success" onClick={() => open("approve")}>
                    تأیید
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => open("reject")}>
                    رد
                  </Button>
                </>
              ) : null}
              {canWithdraw ? (
                <Button size="sm" variant="outline" onClick={() => open("withdraw")}>
                  پس‌گرفتن درخواست
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {waiting && pending ? (
          <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            این سند در انتظار تأیید است — مرحلهٔ {pending.currentLevel.toLocaleString("fa-IR")} از {pending.steps.length.toLocaleString("fa-IR")}:{" "}
            <span className="font-medium">{openStep?.approverLabel ?? "-"}</span>.{waitingNote ? ` ${waitingNote}` : ""}
            {approval.canDecide ? <span className="mt-1 block text-xs text-muted-foreground">شما تأییدکنندهٔ این مرحله هستید.</span> : null}
          </div>
        ) : null}
        <div className="space-y-3">
          {approval.requests.map((request) => (
            <RequestHistory key={request.id} request={request} />
          ))}
        </div>
      </PanelSection>

      <Dialog open={action !== null} onOpenChange={(openState) => !openState && !saving && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? ACTION_COPY[action].title : ""}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {action ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="approval-comment">
                  {ACTION_COPY[action].label}
                  {ACTION_COPY[action].required ? <RequiredMark /> : null}
                </Label>
                <textarea id="approval-comment" className={textareaClass} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} />
                <p className="text-xs text-muted-foreground">{ACTION_COPY[action].hint}</p>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {action ? (
              <Button variant={ACTION_COPY[action].variant} disabled={saving} onClick={() => void submit()}>
                {saving ? ACTION_COPY[action].pending : ACTION_COPY[action].button}
              </Button>
            ) : null}
            <Button variant="outline" disabled={saving} onClick={() => setAction(null)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RequestHistory({ request }: { request: ApprovalRequestRow }) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={approvalRequestStatusLabels[request.status]} tone={approvalRequestStatusTone[request.status]} />
          <span>
            قانون «{request.ruleName}» (نسخهٔ {request.ruleVersion.toLocaleString("fa-IR")}) — مبلغ {formatMoney(request.amount)} ریال
          </span>
        </div>
        <span className="text-muted-foreground">
          ارسال: {approvalPersonName(request.requestedBy)} — {formatJalali(request.createdAt)}
        </span>
      </div>
      <ol className="divide-y divide-border text-sm">
        {request.steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
            <div>
              <span className="text-muted-foreground">{step.level.toLocaleString("fa-IR")}.</span> {step.approverLabel}
              {step.comment ? <p className="mt-1 text-xs text-muted-foreground">«{step.comment}»</p> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              <span className={step.status === "APPROVED" ? "text-success" : step.status === "REJECTED" ? "text-destructive" : undefined}>
                {approvalStepStatusLabels[step.status]}
              </span>
              {step.decidedBy ? ` — ${approvalPersonName(step.decidedBy)}` : ""}
              {step.decidedAt ? ` — ${formatJalali(step.decidedAt)}` : ""}
            </div>
          </li>
        ))}
      </ol>
      {request.closeReason ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">توضیح: {request.closeReason}</p> : null}
    </div>
  );
}

// Section chrome identical to the purchase detail page's DetailSection — kept
// local so this shared panel doesn't depend on any one module's page layout.
function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
