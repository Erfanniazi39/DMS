"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import {
  DOCUMENT_TYPES,
  RequiredMark,
  documentTypeLabels,
  selectClass,
  textareaClass,
  type DocumentType,
  type PurchaseDetail,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

export type DocumentFormState = {
  documentType: DocumentType;
  documentNumber: string;
  date: string;
  note: string;
};

export const emptyDocumentForm: DocumentFormState = {
  documentType: "INVOICE",
  documentNumber: "",
  date: "",
  note: "",
};

// «اسناد» section plus its add dialog. All form/dialog state lives in
// page.tsx and is passed in; `onChanged` reloads the purchase.
export function DocumentsSection({
  purchaseId,
  purchase,
  canUploadDocuments,
  dialogOpen,
  setDialogOpen,
  form,
  setForm,
  file,
  setFile,
  saving,
  setSaving,
  onChanged,
  toasts,
}: {
  purchaseId: number;
  purchase: PurchaseDetail;
  canUploadDocuments: boolean;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  form: DocumentFormState;
  setForm: Dispatch<SetStateAction<DocumentFormState>>;
  file: File | null;
  setFile: (file: File | null) => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;

  async function removeDocument(documentId: number) {
    if (!window.confirm("آیا از حذف این سند مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/documents/${documentId}`, { method: "DELETE" });
      pushSuccess("سند حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سند ناموفق بود.");
    }
  }

  function openDocumentDialog() {
    setForm(emptyDocumentForm);
    setFile(null);
    setDialogOpen(true);
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.date) {
      pushError("تاریخ سند الزامی است.");
      return;
    }
    setSaving(true);
    let createdId: number | null = null;
    try {
      const created = await apiFetch<{ id: number }>(`/purchases/${purchaseId}/documents`, {
        method: "POST",
        body: JSON.stringify({
          documentType: form.documentType,
          documentNumber: form.documentNumber.trim(),
          date: form.date,
          note: form.note.trim(),
        }),
      });
      createdId = created.id;
      if (file) {
        await apiUpload(`/purchases/${purchaseId}/documents/${created.id}/file`, file);
      }
      createdId = null;
      pushSuccess("سند با موفقیت اضافه شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      // Same pattern as PurchaseForm.uploadStagedDocuments(): the metadata
      // row was created but its file was rejected — remove it (best effort)
      // so each retry doesn't leave another file-less document behind.
      if (createdId !== null) {
        await apiFetch(`/purchases/${purchaseId}/documents/${createdId}`, { method: "DELETE" }).catch(() => undefined);
      }
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت سند ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* 4. اسناد */}
      <DetailSection
        title="اسناد"
        action={
          canUploadDocuments ? (
            <Button size="sm" onClick={openDocumentDialog}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن سند
            </Button>
          ) : undefined
        }
      >
        {purchase.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            هنوز سندی اضافه نشده است.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">نوع سند</th>
                  <th className="px-3 py-2 font-medium">شماره سند</th>
                  <th className="px-3 py-2 font-medium">تاریخ</th>
                  <th className="px-3 py-2 font-medium">یادداشت</th>
                  <th className="px-3 py-2 font-medium">فایل</th>
                  <th className="px-3 py-2 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchase.documents.map((document) => (
                  <tr key={document.id}>
                    <td className="px-3 py-2">{documentTypeLabels[document.documentType]}</td>
                    <td className="px-3 py-2 text-muted-foreground">{document.documentNumber || "-"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatJalali(document.date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{document.note || "-"}</td>
                    <td className="px-3 py-2">
                      {document.filePath ? (
                        <a href={`/api${document.filePath}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Download className="size-4" aria-hidden="true" />
                          مشاهده
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {canUploadDocuments ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeDocument(document.id)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          حذف
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>

      {/* Portal-based: renders outside the page flow regardless of where it sits in the tree. */}
      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن سند</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="document-form" className="grid gap-4" onSubmit={submitDocument} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-type">نوع سند</Label>
                <select
                  id="document-type"
                  className={selectClass}
                  value={form.documentType}
                  onChange={(event) => setForm((current) => ({ ...current, documentType: event.target.value as DocumentType }))}
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{documentTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-number">شماره سند</Label>
                <Input
                  id="document-number"
                  value={form.documentNumber}
                  onChange={(event) => setForm((current) => ({ ...current, documentNumber: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-date-year">تاریخ<RequiredMark /></Label>
                <JalaliDateInput
                  idPrefix="document-date"
                  value={form.date}
                  onChange={(value) => setForm((current) => ({ ...current, date: value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-note">یادداشت</Label>
                <textarea
                  id="document-note"
                  className={textareaClass}
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-file">فایل</Label>
                <input
                  id="document-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="text-sm"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="document-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : "ثبت سند"}
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
