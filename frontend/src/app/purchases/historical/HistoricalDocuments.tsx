"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DOCUMENT_TYPES, documentTypeLabels, selectClass, type DocumentType } from "../shared";

// A file picked for a historical purchase, held until the purchase is saved.
export type HistoricalDocument = { key: string; file: File; documentType: DocumentType; documentNumber: string; note: string };

const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_BYTES = 10 * 1024 * 1024;

function fileProblem(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `«${file.name}»: فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است.`;
  if (file.size > MAX_BYTES) return `«${file.name}»: حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.`;
  return null;
}

// «مدارک» of one historical purchase — same behaviour as the payment
// documents on the historical-sales page: «افزودن مدرک» APPENDS to the list
// (several rounds, several files per round), each file gets a type (default
// فاکتور), an optional number and note, and can be removed before saving.
export function HistoricalDocuments({
  idPrefix,
  documents,
  onChange,
  pushErrors,
}: {
  idPrefix: string;
  documents: HistoricalDocument[];
  onChange: (next: HistoricalDocument[]) => void;
  pushErrors: (messages: string[]) => void;
}) {
  function add(files: FileList | null) {
    const accepted: HistoricalDocument[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files ?? [])) {
      const problem = fileProblem(file);
      if (problem) problems.push(problem);
      else accepted.push({ key: crypto.randomUUID(), file, documentType: "INVOICE", documentNumber: "", note: "" });
    }
    if (problems.length > 0) pushErrors(problems);
    if (accepted.length > 0) onChange([...documents, ...accepted]);
  }
  const patch = (key: string, change: Partial<HistoricalDocument>) => onChange(documents.map((doc) => (doc.key === key ? { ...doc, ...change } : doc)));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-files`}>مدارک خرید (فاکتور، رسید، …)</Label>
        <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById(`${idPrefix}-files`)?.click()}>
          <Plus className="size-3.5" aria-hidden="true" />
          افزودن مدرک
        </Button>
      </div>
      {/* Each pick APPENDS (the browser's own picker would replace the previous selection). */}
      <input
        id={`${idPrefix}-files`}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      {documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">PDF یا تصویر (jpg، png)، حداکثر ۱۰ مگابایت برای هر فایل؛ هر چند مدرک که لازم است اضافه کنید. مدارک پس از ثبت خرید بارگذاری می‌شوند.</p>
      ) : (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li key={doc.key} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 max-w-[30%] truncate" title={doc.file.name}>{doc.file.name}</span>
              <select aria-label={`نوع مدرک ${doc.file.name}`} className={`${selectClass} h-8 w-28 text-xs`} value={doc.documentType} onChange={(event) => patch(doc.key, { documentType: event.target.value as DocumentType })}>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>{documentTypeLabels[type]}</option>
                ))}
              </select>
              <Input aria-label={`شماره مدرک ${doc.file.name}`} className="h-8 w-28 text-xs" placeholder="شماره سند" maxLength={40} value={doc.documentNumber} onChange={(event) => patch(doc.key, { documentNumber: event.target.value })} />
              <Input aria-label={`توضیح مدرک ${doc.file.name}`} className="h-8 min-w-24 flex-1 text-xs" placeholder="توضیح (اختیاری)" maxLength={500} value={doc.note} onChange={(event) => patch(doc.key, { note: event.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label="حذف مدرک" onClick={() => onChange(documents.filter((entry) => entry.key !== doc.key))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
