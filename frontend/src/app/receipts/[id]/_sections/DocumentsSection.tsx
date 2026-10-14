"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";

export type PaymentDocument = {
  id: number;
  originalName: string;
  filePath: string;
  note: string | null;
  uploadedAt: string;
  uploadedByUser: { id: number; username: string } | null;
};

export const PAYMENT_DOCUMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg";

type Toasts = { pushError: (message: string) => void; pushSuccess: (message: string) => void };

// «مدارک» — supporting files of this receipt/refund (transfer slip, cheque
// photo): GET/POST/DELETE /receivables/payments/:id/documents. Viewing needs
// receivables.view (the page's own gate); uploading/removing needs
// receivables.manage and is allowed in any payment status.
export function DocumentsSection({ paymentId, canManage, toasts }: { paymentId: number; canManage: boolean; toasts: Toasts }) {
  const { pushError, pushSuccess } = toasts;
  const [documents, setDocuments] = useState<PaymentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ignore = false;
    apiFetch<PaymentDocument[]>(`/receivables/payments/${paymentId}/documents`)
      .then((data) => {
        if (!ignore) setDocuments(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) pushError((reason as ApiError).message ?? "دریافت مدارک ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, refresh]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      try {
        await apiUpload(`/receivables/payments/${paymentId}/documents`, file);
        uploaded += 1;
      } catch (reason) {
        pushError(`«${file.name}»: ${(reason as ApiError).message ?? "بارگذاری ناموفق بود."}`);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    setBusy(false);
    if (uploaded > 0) {
      pushSuccess(`${uploaded.toLocaleString("fa-IR")} مدرک بارگذاری شد.`);
      setRefresh((current) => current + 1);
    }
  }

  async function remove(document: PaymentDocument) {
    setBusy(true);
    try {
      await apiFetch(`/receivables/payments/${paymentId}/documents/${document.id}`, { method: "DELETE" });
      setRefresh((current) => current + 1);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف مدرک ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSection
      title="مدارک"
      description="فیش واریز، تصویر چک و …"
      action={
        canManage ? (
          <>
            <input ref={fileInput} type="file" multiple accept={PAYMENT_DOCUMENT_ACCEPT} className="hidden" onChange={(event) => void upload(event.target.files)} />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Paperclip className="size-3.5" aria-hidden="true" />
              بارگذاری مدرک
            </Button>
          </>
        ) : null
      }
    >
      {loading ? (
        <p className="py-3 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : documents.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">مدرکی ثبت نشده است.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 py-2">
              <a href={`/api${document.filePath}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-primary hover:underline">
                {document.originalName}
              </a>
              {document.note ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={document.note}>{document.note}</span> : null}
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {document.uploadedByUser?.username ?? "-"} — {formatJalali(document.uploadedAt)}
                {canManage ? (
                  <Button type="button" size="icon" variant="ghost" aria-label="حذف مدرک" disabled={busy} onClick={() => void remove(document)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}
