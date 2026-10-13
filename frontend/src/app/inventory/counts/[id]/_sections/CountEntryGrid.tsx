"use client";

import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/ui/form-field";
import {
  STOCK_ADJUSTMENT_REASONS,
  formatQuantity,
  hasSystemQty,
  stockAdjustmentReasonLabels,
  type StockAdjustmentReason,
  type StockCountDetail,
} from "../../../shared";

// COUNTING-state entry grid: one row per stock-count line, countedQty (any
// non-negative number, zero is a valid real count) + an optional
// reasonCode/note. systemQty/variance columns only render when the API
// response actually carries them (see hasSystemQty()/shared.tsx header note)
// — a blind counter without inventory.approve never gets to see them at all,
// not even blanked out.
export function CountEntryGrid({
  count,
  values,
  onChange,
  disabled,
}: {
  count: StockCountDetail;
  values: Record<number, { countedQty: string; reasonCode: "" | StockAdjustmentReason; note: string }>;
  onChange: (lineId: number, patch: Partial<{ countedQty: string; reasonCode: "" | StockAdjustmentReason; note: string }>) => void;
  disabled: boolean;
}) {
  const showSystemQty = count.items.length > 0 && hasSystemQty(count.items[0]);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[56rem] text-right text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">کالا</th>
            <th className="w-20 px-2 py-1.5 font-medium">واحد</th>
            <th className="w-32 px-2 py-1.5 font-medium">بچ</th>
            {showSystemQty ? <th className="w-28 px-2 py-1.5 font-medium">موجودی سیستم</th> : null}
            <th className="w-28 px-2 py-1.5 font-medium">مقدار شمارش‌شده</th>
            <th className="w-44 px-2 py-1.5 font-medium">علت مغایرت (اختیاری)</th>
            <th className="px-2 py-1.5 font-medium">توضیح ردیف</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {count.items.map((line, index) => {
            const value = values[line.id] ?? { countedQty: "", reasonCode: "", note: "" };
            return (
              <tr key={line.id}>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{(index + 1).toLocaleString("fa-IR")}</td>
                <td className="px-2 py-1.5">
                  {line.item.name} <span className="font-mono text-xs text-muted-foreground">({line.item.code})</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{line.item.unit.nameFa}</td>
                <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{line.batch?.batchNumber ?? "-"}</td>
                {showSystemQty ? <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{hasSystemQty(line) ? formatQuantity(line.systemQty) : "-"}</td> : null}
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={`مقدار شمارش‌شده ردیف ${index + 1}`}
                    dir="ltr"
                    inputMode="decimal"
                    disabled={disabled}
                    value={value.countedQty}
                    onChange={(event) => onChange(line.id, { countedQty: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`علت مغایرت ردیف ${index + 1}`}
                    className={`${selectClass} w-full`}
                    disabled={disabled}
                    value={value.reasonCode}
                    onChange={(event) => onChange(line.id, { reasonCode: event.target.value as "" | StockAdjustmentReason })}
                  >
                    <option value="">بدون علت</option>
                    {STOCK_ADJUSTMENT_REASONS.map((reasonCode) => (
                      <option key={reasonCode} value={reasonCode}>{stockAdjustmentReasonLabels[reasonCode]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <Input aria-label={`توضیح ردیف ${index + 1}`} disabled={disabled} value={value.note} onChange={(event) => onChange(line.id, { note: event.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
