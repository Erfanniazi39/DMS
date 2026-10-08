"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { creditNoteStatusLabels, creditNoteStatusTone, creditNoteTitle, type CreditNoteDetail, type SalesReturnDetail } from "../../shared";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

// «یادداشت اعتباری» — B15: only return-based, one per return. Created from
// an INSPECTED return (POST /credit-notes {salesReturnId, reason},
// sales.invoice — mirrors invoicing's own permission) and posted inline
// (POST /credit-notes/:id/post) — no separate /credit-notes/[id] page for
// this batch (a return has at most one). Posting settles the invoice
// (settlement.ts) and completes the return (markCredited()); both are
// reflected by reloading the return from the parent.
export function CreditNoteSection({
  salesReturn,
  canInvoice,
  reloadSalesReturn,
  toasts,
}: {
  salesReturn: SalesReturnDetail;
  canInvoice: boolean;
  reloadSalesReturn: () => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState<number | null>(null);
  const [created, setCreated] = useState<CreditNoteDetail | null>(null);

  const hasAny = salesReturn.creditNotes.length > 0;
  const canCreate = canInvoice && salesReturn.status === "INSPECTED" && !hasAny;
  const draftFromList = salesReturn.creditNotes.find((note) => note.status === "DRAFT");

  function closeDialog() {
    if (saving) return;
    setCreating(false);
    setReason("");
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      pushError("علت صدور یادداشت اعتباری الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const note = await apiFetch<CreditNoteDetail>("/credit-notes", { method: "POST", body: JSON.stringify({ salesReturnId: salesReturn.id, reason: reason.trim() }) });
      setCreated(note);
      pushSuccess("پیش‌نویس یادداشت اعتباری ایجاد شد.");
      setCreating(false);
      reloadSalesReturn();
    } catch (thrown) {
      const error = thrown as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ایجاد یادداشت اعتباری ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function post(note: { id: number; updatedAt?: string }) {
    setPosting(note.id);
    try {
      await apiFetch(`/credit-notes/${note.id}/post`, { method: "POST", body: JSON.stringify({ updatedAt: note.updatedAt ?? created?.updatedAt }) });
      pushSuccess("یادداشت اعتباری ثبت شد.");
      setCreated(null);
      reloadSalesReturn();
    } catch (thrown) {
      const error = thrown as ApiError;
      pushError(error.message ?? "ثبت یادداشت اعتباری ناموفق بود.");
    } finally {
      setPosting(null);
    }
  }

  return (
    <FormSection
      title="یادداشت اعتباری"
      action={canCreate ? <Button size="sm" onClick={() => setCreating(true)}>صدور یادداشت اعتباری</Button> : undefined}
    >
      {!hasAny && !created ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {salesReturn.status === "INSPECTED" ? "هنوز یادداشت اعتباری صادر نشده است." : "پس از بازرسی مرجوعی می‌توان یادداشت اعتباری صادر کرد."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[32rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">شماره</th>
                <th className="px-3 py-2 font-medium">تاریخ</th>
                <th className="px-3 py-2 font-medium">مبلغ</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
                <th className="px-3 py-2 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {salesReturn.creditNotes.map((note) => (
                <tr key={note.id}>
                  <td className="px-3 py-2 font-mono text-xs">{creditNoteTitle(note)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatJalali(note.createdAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(note.totalAmount)}</td>
                  <td className="px-3 py-2"><StatusBadge label={creditNoteStatusLabels[note.status]} tone={creditNoteStatusTone[note.status]} /></td>
                  <td className="px-3 py-2">
                    {note.status === "DRAFT" && canInvoice ? (
                      <Button size="sm" variant="outline" disabled={posting === note.id} onClick={() => void post(note)}>
                        {posting === note.id ? "در حال ثبت..." : "ثبت"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {created && !draftFromList ? (
                <tr>
                  <td className="px-3 py-2 font-mono text-xs">{creditNoteTitle(created)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatJalali(created.creditDate)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(created.totalAmount)}</td>
                  <td className="px-3 py-2"><StatusBadge label={creditNoteStatusLabels.DRAFT} tone={creditNoteStatusTone.DRAFT} /></td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="outline" disabled={posting === created.id} onClick={() => void post(created)}>
                      {posting === created.id ? "در حال ثبت..." : "ثبت"}
                    </Button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>صدور یادداشت اعتباری</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="credit-note-create-form" className="grid gap-3 text-sm" onSubmit={submitCreate} noValidate>
              <p className="text-muted-foreground">یادداشت اعتباری از روی اقلام بازرسی‌شدهٔ این مرجوعی ساخته می‌شود و پس از ثبت، فاکتور مربوط را تسویه می‌کند.</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="credit-note-reason">علت<RequiredMark /></Label>
                <textarea id="credit-note-reason" className={textareaClass} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="credit-note-create-form" disabled={saving}>
              {saving ? "در حال ایجاد..." : "ایجاد پیش‌نویس"}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}
