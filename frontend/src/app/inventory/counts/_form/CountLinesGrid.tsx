"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { formatJalali } from "@/lib/jalali";
import { batchHasStock, type ItemBatchRow, type StockCountFormOptions } from "../../shared";
import { FormSection } from "../../adjustments/_form/FormSection";

// PARTIAL-scope line picker for the stock-count create/edit form (I6). Only
// item + an EXISTING batch may be picked — a count line never creates a new
// batch (unlike receipts/adjustments' typed-lot-number lines; see the
// backend's ensureBatchesValid()). No quantity column: countedQty is entered
// later, during the COUNTING step on the detail page.
export type CountLineRow = { key: string; itemId: string; batchId: string; note: string };

export function emptyCountLineRow(): CountLineRow {
  return { key: crypto.randomUUID(), itemId: "", batchId: "", note: "" };
}

export type CountBatchesState = ItemBatchRow[] | "loading" | "error";

function batchOptionLabel(batch: ItemBatchRow): string {
  const expiry = batch.expiryDate ? `انقضا ${formatJalali(batch.expiryDate)}` : "بدون تاریخ انقضا";
  const expired = batch.isExpired ? " — منقضی‌شده" : "";
  return `${batch.batchNumber} — ${expiry}${expired}`;
}

export function CountLinesGrid({
  lines,
  setLines,
  itemOptions,
  batchesByItem,
}: {
  lines: CountLineRow[];
  setLines: (update: (current: CountLineRow[]) => CountLineRow[]) => void;
  itemOptions: StockCountFormOptions["items"];
  batchesByItem: Map<number, CountBatchesState>;
}) {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));

  function updateLine(key: string, patch: Partial<CountLineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <FormSection title="اقلام شمارش" description="برای «شمارش بخشی»، کالاهایی که باید شمارش شوند را انتخاب کنید — مقدار شمارش‌شده پس از «شروع شمارش» وارد می‌شود">
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[42rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">کالا<RequiredMark /></th>
                <th className="w-20 px-2 py-1.5 font-medium">واحد</th>
                <th className="w-64 px-2 py-1.5 font-medium">بچ (اختیاری)</th>
                <th className="w-56 px-2 py-1.5 font-medium">توضیح ردیف</th>
                <th className="w-12 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, index) => {
                const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
                const batches = line.itemId ? batchesByItem.get(Number(line.itemId)) : undefined;
                return (
                  <tr key={line.key}>
                    <td className="px-2 py-1">
                      <select
                        aria-label={`کالای ردیف ${index + 1}`}
                        className={`${selectClass} w-full`}
                        value={line.itemId}
                        onChange={(event) => updateLine(line.key, { itemId: event.target.value, batchId: "" })}
                      >
                        <option value="">انتخاب کنید</option>
                        {itemOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} ({option.code})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{item?.unit.nameFa ?? "-"}</td>
                    <td className="px-2 py-1">
                      <BatchPicker itemId={line.itemId} batchId={line.batchId} batches={batches} onChange={(batchId) => updateLine(line.key, { batchId })} />
                    </td>
                    <td className="px-2 py-1">
                      <Input aria-label={`توضیح ردیف ${index + 1}`} value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف ردیف ${index + 1}`}
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => (current.length > 1 ? current.filter((row) => row.key !== line.key) : current))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyCountLineRow()])}>
          <Plus className="size-4" aria-hidden="true" />
          افزودن ردیف
        </Button>
      </div>
    </FormSection>
  );
}

// Native <select> (never Base-UI Select) — nothing here opens a dialog or
// confirm, so the picker landmine (build plan §9) doesn't apply.
function BatchPicker({
  itemId,
  batchId,
  batches,
  onChange,
}: {
  itemId: string;
  batchId: string;
  batches: CountBatchesState | undefined;
  onChange: (batchId: string) => void;
}) {
  if (!itemId) return <span className="text-xs text-muted-foreground">-</span>;
  if (batches === undefined || batches === "loading") return <span className="text-xs text-muted-foreground">در حال بارگذاری بچ‌ها...</span>;
  if (batches === "error") return <span className="text-xs text-destructive">دریافت بچ‌های این کالا ناموفق بود.</span>;
  // Any batch (even depleted) is a valid thing to count — stock counts find
  // out what's really there, so a zero-stock batch isn't excluded here the
  // way a stock-decreasing adjustment line would.
  if (batches.length === 0) return <span className="text-xs text-muted-foreground">بدون بچ</span>;

  return (
    <select aria-label="بچ" className={`${selectClass} w-full`} value={batchId} onChange={(event) => onChange(event.target.value)}>
      <option value="">بدون بچ مشخص</option>
      {batches.map((batch) => (
        <option key={batch.batchId} value={batch.batchId}>
          {batchOptionLabel(batch)}
          {batchHasStock(batch) ? "" : " — موجودی صفر"}
        </option>
      ))}
    </select>
  );
}
