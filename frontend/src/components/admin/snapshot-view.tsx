"use client";

import { FIELD_LABELS, VALUE_LABELS, formatDateTime } from "@/lib/audit-labels";

// A readable, Persian view of an archived record: scalar fields as label/value
// rows, and arrays of rows (e.g. purchase items) as small tables. Internal ids
// and foreign keys are hidden; the raw JSON stays available in the dialog.

const HIDDEN = /^(id|.*Id|.*Ids|passwordHash|snapshot)$/;
const MONEY = /(amount|price|total|salary|limit)/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function labelOf(key: string) {
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value === "***") return "پوشانده‌شده (اطلاعات حساس)";
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  if (typeof value === "number") return MONEY.test(key) ? value.toLocaleString("fa-IR") : value.toLocaleString("fa-IR", { useGrouping: false });
  if (typeof value === "string") {
    if (ISO.test(value)) return formatDateTime(value);
    if (MONEY.test(key) && /^\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("fa-IR");
    return VALUE_LABELS[value] ?? value;
  }
  return JSON.stringify(value);
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarEntries(row: Record<string, unknown>) {
  return Object.entries(row).filter(([key, value]) => !HIDDEN.test(key) && !Array.isArray(value) && !isRow(value));
}

export function SnapshotView({ snapshot }: { snapshot: unknown }) {
  if (!isRow(snapshot)) return <p className="text-sm text-muted-foreground">محتوایی برای نمایش وجود ندارد.</p>;
  const fields = scalarEntries(snapshot);
  const lists = Object.entries(snapshot).filter(([, value]) => Array.isArray(value) && value.length > 0 && value.every(isRow)) as [string, Record<string, unknown>[]][];
  const objects = Object.entries(snapshot).filter(([key, value]) => isRow(value) && !HIDDEN.test(key)) as [string, Record<string, unknown>][];

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fields.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
            <dt className="shrink-0 text-xs text-muted-foreground">{labelOf(key)}</dt>
            <dd className="min-w-0 break-words text-sm">{formatValue(key, value)}</dd>
          </div>
        ))}
      </dl>
      {objects.map(([key, row]) => (
        <div key={key}>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">{key === "financialProfile" ? "اطلاعات مالی" : labelOf(key)}</h4>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {scalarEntries(row).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
                <dt className="shrink-0 text-xs text-muted-foreground">{labelOf(k)}</dt>
                <dd className="text-sm">{formatValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {lists.map(([key, rows]) => {
        const columns = Array.from(new Set(rows.flatMap((row) => scalarEntries(row).map(([k]) => k)))).slice(0, 7);
        return (
          <div key={key}>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">{key === "items" ? "اقلام" : labelOf(key)} ({rows.length.toLocaleString("fa-IR")})</h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>{columns.map((column) => <th key={column} className="px-2 py-1.5 font-medium">{labelOf(column)}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, index) => (
                    <tr key={index}>{columns.map((column) => <td key={column} className="px-2 py-1.5">{formatValue(column, row[column])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
