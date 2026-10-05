"use client";

import type { Dispatch, SetStateAction } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOCUMENT_TYPES, documentTypeLabels, selectClass, type DocumentType } from "../shared";
import { FormSection } from "./FormSection";

// A file picked on the create form, held locally until the purchase itself
// has been saved (a PurchaseDocument needs a purchase id to attach to — see
// POST /purchases/:id/documents + POST /purchases/:id/documents/:documentId/file,
// the same two-step endpoints the purchase detail page uses). Uploaded right
// after the purchase is created, inside the same submit flow
// (PurchaseForm's uploadStagedDocuments()).
export type StagedDocument = {
  key: string;
  file: File;
  documentType: DocumentType;
  documentNumber: string;
  state: "pending" | "uploading" | "done" | "failed";
  error?: string;
};

// Mirrors the backend's FileInterceptor limits on
// POST /purchases/:id/documents/:documentId/file (ALLOWED_DOCUMENT_EXTENSIONS,
// 10 MB) — checked up front so a bad file is rejected at pick time, not
// only after the purchase has already been saved.
const ALLOWED_DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function documentFileProblem(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) return `«${file.name}»: فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `«${file.name}»: حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.`;
  return null;
}

const stagedDocumentStateLabels: Record<StagedDocument["state"], string> = {
  pending: "",
  uploading: "در حال بارگذاری...",
  done: "بارگذاری شد",
  failed: "ناموفق",
};

// Section 4 — اسناد (create mode only; PurchaseForm decides whether to
// render it). The staged list lives in PurchaseForm's state;
// `updateStagedDocument` is shared with the parent's upload loop.
export function StagedDocuments({
  stagedDocuments,
  setStagedDocuments,
  updateStagedDocument,
  savedWithDocumentFailures,
  pushErrors,
}: {
  stagedDocuments: StagedDocument[];
  setStagedDocuments: Dispatch<SetStateAction<StagedDocument[]>>;
  updateStagedDocument: (key: string, patch: Partial<StagedDocument>) => void;
  // Once set, the purchase is already saved — no further files can be added.
  savedWithDocumentFailures: boolean;
  pushErrors: (messages: string[]) => void;
}) {
  function addStagedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted: StagedDocument[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const problem = documentFileProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      accepted.push({ key: crypto.randomUUID(), file, documentType: "INVOICE", documentNumber: "", state: "pending" });
    }
    if (problems.length) pushErrors(problems);
    if (accepted.length) setStagedDocuments((current) => [...current, ...accepted]);
  }

  function removeStagedDocument(key: string) {
    setStagedDocuments((current) => current.filter((doc) => doc.key !== key));
  }

  return (
    <FormSection title="اسناد" description="فایل‌ها پس از ثبت خرید بارگذاری می‌شوند (PDF یا تصویر، حداکثر ۱۰ مگابایت).">
      <div className="space-y-2">
        {stagedDocuments.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="اسناد انتخاب‌شده">
            {stagedDocuments.map((doc) => (
              <li key={doc.key} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={doc.file.name}>{doc.file.name}</span>
                <select
                  aria-label={`نوع سند ${doc.file.name}`}
                  className={`${selectClass} h-8 w-32`}
                  value={doc.documentType}
                  disabled={doc.state !== "pending"}
                  onChange={(event) => updateStagedDocument(doc.key, { documentType: event.target.value as DocumentType })}
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{documentTypeLabels[type]}</option>
                  ))}
                </select>
                <Input
                  aria-label={`شماره سند ${doc.file.name}`}
                  placeholder="شماره سند"
                  className="h-8 w-28"
                  value={doc.documentNumber}
                  disabled={doc.state !== "pending"}
                  onChange={(event) => updateStagedDocument(doc.key, { documentNumber: event.target.value })}
                />
                {doc.state !== "pending" ? (
                  <span
                    className={`text-xs ${doc.state === "failed" ? "text-destructive" : doc.state === "done" ? "text-success" : "text-muted-foreground"}`}
                    title={doc.error}
                  >
                    {stagedDocumentStateLabels[doc.state]}
                    {doc.state === "failed" && doc.error ? `: ${doc.error}` : ""}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`حذف ${doc.file.name}`}
                    onClick={() => removeStagedDocument(doc.key)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {!savedWithDocumentFailures ? (
          // The native file input's own button/label text follows
          // the browser's UI language (often English), so it's
          // visually hidden behind a Persian label-as-button.
          <label
            htmlFor="purchase-documents"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
          >
            <Paperclip className="size-4" aria-hidden="true" />
            افزودن فایل سند
            <input
              id="purchase-documents"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              className="sr-only"
              onChange={(event) => {
                addStagedFiles(event.target.files);
                // Reset so picking the same file again still fires onChange.
                event.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
    </FormSection>
  );
}
