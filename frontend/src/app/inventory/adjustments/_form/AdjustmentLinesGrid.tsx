"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { formatQuantity, type ItemOption, type StockAdjustmentKind } from "../../shared";
import { FormSection } from "./FormSection";

export type AdjustmentLineRow = { key: string; itemId: string; quantity: string; note: string };

export function emptyLineRow(): AdjustmentLineRow {
  return { key: crypto.randomUUID(), itemId: "", quantity: "", note: "" };
}

// The lines table (کالا / موجودی فعلی / مقدار / توضیح). Rows live in
// StockAdjustmentForm's state. "موجودی فعلی" is informational only — the
// backend re-checks stock at posting time and refuses anything that would
// go negative.
export function AdjustmentLinesGrid({
  kind,
  lines,
  setLines,
  itemOptions,
  onHandByItem,
}: {
  kind: StockAdjustmentKind;
  lines: AdjustmentLineRow[];
  setLines: (update: (current: AdjustmentLineRow[]) => AdjustmentLineRow[]) => void;
  itemOptions: ItemOption[];
  // null = current stock couldn't be loaded (column shows "-").
  onHandByItem: Map<number, string> | null;
}) {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));

  function updateLine(key: string, patch: Partial<AdjustmentLineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <FormSection
      title="اقلام سند"
      description={kind === "CORRECTION" ? "مقدار مثبت = افزایش موجودی، مقدار منفی = کاهش موجودی" : "مقادیر باید مثبت باشند"}
    >
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">کالا<RequiredMark /></th>
                <th className="w-24 px-2 py-1.5 font-medium">واحد</th>
                <th className="w-28 px-2 py-1.5 font-medium">موجودی فعلی</th>
                <th className="w-32 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                <th className="w-64 px-2 py-1.5 font-medium">توضیح ردیف</th>
                <th className="w-12 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, index) => {
                const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
                const onHand = line.itemId && onHandByItem ? (onHandByItem.get(Number(line.itemId)) ?? "0") : null;
                return (
                  <tr key={line.key}>
                    <td className="px-2 py-1">
                      <select
                        aria-label={`کالای ردیف ${index + 1}`}
                        className={`${selectClass} w-full`}
                        value={line.itemId}
                        onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
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
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{onHand === null ? "-" : formatQuantity(onHand)}</td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`مقدار ردیف ${index + 1}`}
                        dir="ltr"
                        inputMode="decimal"
                        value={line.quantity}
                        placeholder={kind === "CORRECTION" ? "مثلاً 5 یا -2" : ""}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />
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
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLineRow()])}>
          <Plus className="size-4" aria-hidden="true" />
          افزودن ردیف
        </Button>
      </div>
    </FormSection>
  );
}
