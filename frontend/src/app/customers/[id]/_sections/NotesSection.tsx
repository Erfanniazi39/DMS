"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  CUSTOMER_NOTE_TYPES,
  RequiredMark,
  StatusBadge,
  noteTypeLabels,
  noteTypeTone,
  selectClass,
  textareaClass,
  type CustomerDetail,
  type CustomerNoteRow,
  type CustomerNoteType,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

type NoteForm = { noteType: CustomerNoteType; body: string; isPinned: boolean };
const emptyNoteForm: NoteForm = { noteType: "GENERAL", body: "", isPinned: false };

// «یادداشت‌ها» — POST/PATCH/DELETE /customers/:id/notes[/:noteId]
// (customers.manage). A pinned WARNING note shows as a banner in the page
// header and as the warning icon on the customer list.
export function NotesSection({
  customer,
  canManage,
  onChanged,
  toasts,
}: {
  customer: CustomerDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<NoteForm>(emptyNoteForm);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(emptyNoteForm);
    setDialogOpen(true);
  }

  function openEdit(note: CustomerNoteRow) {
    setEditingId(note.id);
    setForm({ noteType: note.noteType, body: note.body, isPinned: note.isPinned });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.body.trim()) {
      pushError("متن یادداشت الزامی است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editingId === null ? `/customers/${customer.id}/notes` : `/customers/${customer.id}/notes/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH",
        body: JSON.stringify({ noteType: form.noteType, body: form.body.trim(), isPinned: form.isPinned }),
      });
      pushSuccess(editingId === null ? "یادداشت اضافه شد." : "یادداشت ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره یادداشت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(note: CustomerNoteRow) {
    if (!window.confirm("آیا از حذف این یادداشت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/customers/${customer.id}/notes/${note.id}`, { method: "DELETE" });
      pushSuccess("یادداشت حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف یادداشت ناموفق بود.");
    }
  }

  return (
    <>
      <DetailSection
        title="یادداشت‌ها"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن یادداشت
            </Button>
          ) : undefined
        }
      >
        {customer.notes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز یادداشتی ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {customer.notes.map((note) => (
              <li key={note.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {note.isPinned ? <Pin className="size-3.5 text-foreground" aria-label="سنجاق‌شده" /> : null}
                    <StatusBadge label={noteTypeLabels[note.noteType]} tone={noteTypeTone[note.noteType]} />
                    <span>{formatJalali(note.createdAt)}</span>
                    {note.createdByUser ? <span>— {note.createdByUser.username}</span> : null}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{note.body}</p>
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(note)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      ویرایش
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(note)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      حذف
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId === null ? "افزودن یادداشت" : "ویرایش یادداشت"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="note-form" className="grid gap-4" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="note-type">نوع یادداشت</Label>
                <select id="note-type" className={selectClass} value={form.noteType} onChange={(event) => setForm((current) => ({ ...current, noteType: event.target.value as CustomerNoteType }))}>
                  {CUSTOMER_NOTE_TYPES.map((type) => (
                    <option key={type} value={type}>{noteTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="note-body">متن<RequiredMark /></Label>
                <textarea id="note-body" className={`${textareaClass} min-h-28`} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
              </div>
              <label htmlFor="note-pinned" className="flex items-center gap-2 text-sm">
                <input id="note-pinned" type="checkbox" className="size-4" checked={form.isPinned} onChange={(event) => setForm((current) => ({ ...current, isPinned: event.target.checked }))} />
                سنجاق شود (یادداشت هشدارِ سنجاق‌شده در بالای صفحه مشتری نمایش داده می‌شود)
              </label>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="note-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId === null ? "افزودن یادداشت" : "ذخیره تغییرات"}
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
