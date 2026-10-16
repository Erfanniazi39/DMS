"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/ui/form-field";
import { RequirePermission } from "@/components/require-permission";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";

// تنظیمات › قالب شماره‌گذاری — how each document's number looks:
// <پیشوند><جداکننده><سال شمسی | متن ثابت | هیچ><جداکننده><شمارنده با N رقم>.
// GET/PUT/DELETE /numbering (numbering.manage). Existing documents keep their
// numbers; the counter can only be raised, never lowered.
type MiddleMode = "year" | "fixed" | "none";
type Format = { prefix: string; middleMode: MiddleMode; middleText: string | null; separator: string; digits: number };
type Row = { docType: string; label: string; format: Format; isDefault: boolean; fiscalYear: number; nextNumber: number; nextPreview: string };
type Draft = { prefix: string; middleMode: MiddleMode; middleText: string; separator: string; digits: string; nextNumber: string };

const SEPARATOR_OPTIONS: [string, string][] = [["-", "خط تیره ( - )"], ["/", "اسلش ( / )"], ["_", "زیرخط ( _ )"], [".", "نقطه ( . )"], ["", "بدون"]];
const MODE_OPTIONS: [MiddleMode, string][] = [["year", "سال شمسی"], ["fixed", "متن ثابت"], ["none", "بدون بخش میانی"]];

function toDraft(row: Row): Draft {
  return { prefix: row.format.prefix, middleMode: row.format.middleMode, middleText: row.format.middleText ?? "", separator: row.format.separator, digits: String(row.format.digits), nextNumber: String(row.nextNumber) };
}

function preview(draft: Draft, year: number): string {
  const digits = Math.min(9, Math.max(3, Number(draft.digits) || 6));
  const next = Math.max(1, Number(draft.nextNumber) || 1);
  const middle = draft.middleMode === "year" ? String(year) : draft.middleMode === "fixed" ? draft.middleText.trim() : "";
  const counter = String(next).padStart(digits, "0");
  const sep = draft.separator;
  return middle ? `${draft.prefix}${sep}${middle}${sep}${counter}` : `${draft.prefix}${sep}${counter}`;
}

function NumberingContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  function apply(list: Row[]) {
    setRows(list);
    setDrafts(Object.fromEntries(list.map((row) => [row.docType, toDraft(row)])));
  }

  useEffect(() => {
    apiFetch<Row[]>("/numbering")
      .then(apply)
      .catch((reason: unknown) => setLoadError((reason as ApiError).message ?? "دریافت تنظیمات ناموفق بود."))
      .finally(() => setLoading(false));
  }, []);

  const setField = (docType: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [docType]: { ...current[docType], ...patch } }));

  function reportError(reason: unknown, fallback: string) {
    const apiError = reason as ApiError;
    if (apiError.messages && apiError.messages.length > 0) pushErrors(apiError.messages);
    else pushError(apiError.message ?? fallback);
  }

  async function save(row: Row) {
    const draft = drafts[row.docType];
    setBusy(row.docType);
    try {
      const updated = await apiFetch<Row>(`/numbering/${row.docType}`, {
        method: "PUT",
        body: JSON.stringify({
          format: { prefix: draft.prefix.trim(), middleMode: draft.middleMode, middleText: draft.middleMode === "fixed" ? draft.middleText.trim() : null, separator: draft.separator, digits: Number(draft.digits) },
          // Only when the user changed it: a format switch starts a new counter on its own.
          ...(draft.nextNumber !== String(row.nextNumber) && draft.nextNumber.trim() ? { nextNumber: Number(draft.nextNumber) } : {}),
        }),
      });
      apply(rows.map((r) => (r.docType === row.docType ? updated : r)));
      pushSuccess(`قالب ${row.label} ذخیره شد.`);
    } catch (reason) {
      reportError(reason, "ذخیره قالب ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function reset(row: Row) {
    setBusy(row.docType);
    try {
      const updated = await apiFetch<Row>(`/numbering/${row.docType}`, { method: "DELETE" });
      apply(rows.map((r) => (r.docType === row.docType ? updated : r)));
      pushSuccess(`قالب ${row.label} به حالت پیش‌فرض برگشت.`);
    } catch (reason) {
      reportError(reason, "بازگردانی ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p role="alert" className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">قالب شماره‌گذاری اسناد</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            شمارهٔ هر سند را مشخص کنید؛ مثلاً <span dir="ltr" className="font-mono">SO-1405-000005</span> (پیشوند، سال شمسی، شمارندهٔ ۶ رقمی) یا <span dir="ltr" className="font-mono">SO-7050-000005</span> با متن ثابت. تغییر قالب فقط روی اسناد جدید اثر دارد و شمارهٔ اسناد قبلی عوض نمی‌شود. «شمارهٔ بعدی» را فقط می‌توان بالا برد (برای ادامهٔ شماره‌گذاری قبلی)، چون شمارهٔ صادرشده نباید تکرار شود.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">اسناد</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-right text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">سند</th>
                  <th className="px-2 py-2 font-medium">پیشوند</th>
                  <th className="px-2 py-2 font-medium">بخش میانی</th>
                  <th className="px-2 py-2 font-medium">جداکننده</th>
                  <th className="px-2 py-2 font-medium">ارقام</th>
                  <th className="px-2 py-2 font-medium">شمارهٔ بعدی</th>
                  <th className="px-2 py-2 font-medium">پیش‌نمایش</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = drafts[row.docType];
                  if (!draft) return null;
                  return (
                    <tr key={row.docType} className="border-b border-border/60 align-middle">
                      <td className="px-2 py-2">
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-muted-foreground">{row.isDefault ? "پیش‌فرض" : "سفارشی"}</div>
                      </td>
                      <td className="px-2 py-2">
                        <Input className="w-24" dir="ltr" value={draft.prefix} maxLength={10} onChange={(event) => setField(row.docType, { prefix: event.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <select className={`${selectClass} w-36`} value={draft.middleMode} onChange={(event) => setField(row.docType, { middleMode: event.target.value as MiddleMode })}>
                            {MODE_OPTIONS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          {draft.middleMode === "fixed" ? <Input className="w-24" dir="ltr" value={draft.middleText} maxLength={10} placeholder="مثلاً 7050" onChange={(event) => setField(row.docType, { middleText: event.target.value })} /> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <select className={`${selectClass} w-32`} value={draft.separator} onChange={(event) => setField(row.docType, { separator: event.target.value })}>
                          {SEPARATOR_OPTIONS.map(([value, label]) => (
                            <option key={label} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <Input className="w-16" dir="ltr" inputMode="numeric" value={draft.digits} onChange={(event) => setField(row.docType, { digits: event.target.value.replace(/\D/g, "") })} />
                      </td>
                      <td className="px-2 py-2">
                        <Input className="w-28" dir="ltr" inputMode="numeric" value={draft.nextNumber} onChange={(event) => setField(row.docType, { nextNumber: event.target.value.replace(/\D/g, "") })} />
                      </td>
                      <td className="px-2 py-2">
                        <span dir="ltr" className="inline-block font-mono text-xs">{preview(draft, row.fiscalYear)}</span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1.5">
                          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void save(row)}>
                            <Save className="size-3.5" aria-hidden="true" />
                            ذخیره
                          </Button>
                          {!row.isDefault ? (
                            <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void reset(row)} title="بازگشت به قالب پیش‌فرض">
                              <RotateCcw className="size-3.5" aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function NumberingSettingsPage() {
  return (
    <RequirePermission permission="numbering.manage" message="شما اجازهٔ تغییر قالب شماره‌گذاری را ندارید.">
      <NumberingContent />
    </RequirePermission>
  );
}
