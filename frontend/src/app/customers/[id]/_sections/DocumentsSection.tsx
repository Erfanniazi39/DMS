"use client";

import { useState, type FormEvent } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { JALALI_MAX_YEAR, formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import {
  CUSTOMER_DOCUMENT_TYPES,
  StatusBadge,
  documentTypeLabels,
  selectClass,
  textareaClass,
  type CustomerDetail,
  type CustomerDocumentRow,
  type CustomerDocumentType,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

type DocumentForm = { documentType: CustomerDocumentType; documentNumber: string; date: string; expiresAt: string; note: string };
const emptyDocumentForm: DocumentForm = { documentType: "BUSINESS_LICENSE", documentNumber: "", date: "", expiresAt: "", note: "" };

// Mirrors the backend (customer-documents.service.ts): PDF/PNG/JPEG, 10 MB.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// «مدارک» — same two-step upload as purchases/[id]/_sections/DocumentsSection:
// POST /customers/:id/documents (metadata) then
// POST /customers/:id/documents/:documentId/file (multipart). Files are
// served by the guarded GET /uploads/customers/:filename (customers.view).
export function DocumentsSection({
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
  const [form, setForm] = useState<DocumentForm>(emptyDocumentForm);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function openCreate() {
    setForm(emptyDocumentForm);
    setFile(null);
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file && file.size > MAX_FILE_BYTES) {
      pushError("حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.");
      return;
    }
    setSaving(true);
    let createdId: number | null = null;
    try {
      const created = await apiFetch<{ id: number }>(`/customers/${customer.id}/documents`, {
        method: "POST",
        body: JSON.stringify({
          documentType: form.documentType,
          documentNumber: form.documentNumber.trim(),
          date: form.date,
          expiresAt: form.expiresAt,
          note: form.note.trim(),
        }),
      });
      createdId = created.id;
      if (file) await apiUpload(`/customers/${customer.id}/documents/${created.id}/file`, file);
      createdId = null;
      pushSuccess("مدرک با موفقیت اضافه شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      // Metadata saved but the file was rejected — remove the file-less row
      // (best effort), same as the Purchases documents section.
      if (createdId !== null) {
        await apiFetch(`/customers/${customer.id}/documents/${createdId}`, { method: "DELETE" }).catch(() => undefined);
      }
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت مدرک ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(document: CustomerDocumentRow) {
    if (!window.confirm("آیا از حذف این مدرک مطمئن هستید؟")) return;
    try {
      await apiFetch(`/customers/${customer.id}/documents/${document.id}`, { method: "DELETE" });
      pushSuccess("مدرک حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف مدرک ناموفق بود.");
    }
  }

  return (
    <>
      <DetailSection
        title="مدارک"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن مدرک
            </Button>
          ) : undefined
        }
      >
        {customer.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز مدرکی اضافه نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[44rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">نوع مدرک</th>
                  <th className="px-3 py-2 font-medium">شماره</th>
                  <th className="px-3 py-2 font-medium">تاریخ</th>
                  <th className="px-3 py-2 font-medium">انقضا</th>
                  <th className="px-3 py-2 font-medium">یادداشت</th>
                  <th className="px-3 py-2 font-medium">فایل</th>
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.documents.map((document) => {
                  const expired = document.expiresAt !== null && document.expiresAt.slice(0, 10) < today;
                  return (
                    <tr key={document.id}>
                      <td className="px-3 py-2">{documentTypeLabels[document.documentType]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{document.documentNumber || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{document.date ? formatJalali(document.date) : "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {document.expiresAt ? (
                          <span className="inline-flex items-center gap-1.5">
                            {formatJalali(document.expiresAt)}
                            {expired ? <StatusBadge label="منقضی" tone="destructive" /> : null}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
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
                      {canManage ? (
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(document)}>
                            <Trash2 className="size-4" aria-hidden="true" />
                            حذف
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن مدرک</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="customer-document-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-document-type">نوع مدرک</Label>
                <select
                  id="customer-document-type"
                  className={selectClass}
                  value={form.documentType}
                  onChange={(event) => setForm((current) => ({ ...current, documentType: event.target.value as CustomerDocumentType }))}
                >
                  {CUSTOMER_DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{documentTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-document-number">شماره مدرک</Label>
                <Input id="customer-document-number" value={form.documentNumber} onChange={(event) => setForm((current) => ({ ...current, documentNumber: event.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-document-date-year">تاریخ صدور</Label>
                <JalaliDateInput idPrefix="customer-document-date" value={form.date} onChange={(value) => setForm((current) => ({ ...current, date: value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-document-expires-year">تاریخ انقضا</Label>
                <JalaliDateInput
                  idPrefix="customer-document-expires"
                  value={form.expiresAt}
                  onChange={(value) => setForm((current) => ({ ...current, expiresAt: value }))}
                  maxYear={JALALI_MAX_YEAR}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="customer-document-note">یادداشت</Label>
                <textarea id="customer-document-note" className={textareaClass} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="customer-document-file">فایل (PDF یا تصویر jpg/png، حداکثر ۱۰ مگابایت)</Label>
                <input id="customer-document-file" type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="customer-document-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : "ثبت مدرک"}
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
