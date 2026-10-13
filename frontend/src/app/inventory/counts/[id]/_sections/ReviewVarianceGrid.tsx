"use client";

import { selectClass } from "@/components/ui/form-field";
import {
  STOCK_ADJUSTMENT_REASONS,
  formatQuantity,
  formatSignedQuantity,
  stockAdjustmentReasonLabels,
  type StockAdjustmentReason,
  type StockCountDetail,
} from "../../../shared";

// REVIEW-state variance review grid: systemQty/countedQty/varianceQty are
// always present at this status regardless of isBlind/inventory.approve (the
// backend's maskBlindFields() only masks while COUNTING) — see
// stock-counts.service.ts. A non-zero-variance line needs a reasonCode
// before approve() will post it; reasonCode is editable here for
// inventory.approve holders (prefilled from an earlier enterCount() call, if
// any). Lines selected via the checkbox are candidates for "درخواست شمارش
// مجدد" (e.g. after a 409 COUNT_STALE names them).
export function ReviewVarianceGrid({
  count,
  canApprove,
  reasonOverrides,
  onReasonChange,
  selectedLineIds,
  onToggleLine,
  staleLineIds,
}: {
  count: StockCountDetail;
  canApprove: boolean;
  reasonOverrides: Record<number, "" | StockAdjustmentReason>;
  onReasonChange: (lineId: number, reasonCode: "" | StockAdjustmentReason) => void;
  selectedLineIds: Set<number>;
  onToggleLine: (lineId: number, checked: boolean) => void;
  staleLineIds: Set<number>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[56rem] text-right text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {canApprove ? <th className="w-8 px-2 py-1.5 font-medium"></th> : null}
            <th className="w-10 px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">کالا</th>
            <th className="w-20 px-2 py-1.5 font-medium">واحد</th>
            <th className="w-28 px-2 py-1.5 font-medium">موجودی سیستم</th>
            <th className="w-28 px-2 py-1.5 font-medium">شمارش‌شده</th>
            <th className="w-28 px-2 py-1.5 font-medium">مغایرت</th>
            <th className="w-44 px-2 py-1.5 font-medium">علت مغایرت</th>
            <th className="px-2 py-1.5 font-medium">توضیح</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {count.items.map((line, index) => {
            const variance = Number(line.varianceQty ?? 0);
            const hasVariance = variance !== 0;
            const isStale = staleLineIds.has(line.id);
            const reasonValue = reasonOverrides[line.id] ?? line.reasonCode ?? "";
            return (
              <tr key={line.id} className={isStale ? "bg-destructive/10" : undefined}>
                {canApprove ? (
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`انتخاب ردیف ${index + 1} برای شمارش مجدد`}
                      className="size-4 rounded border-input"
                      checked={selectedLineIds.has(line.id)}
                      onChange={(event) => onToggleLine(line.id, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{(index + 1).toLocaleString("fa-IR")}</td>
                <td className="px-2 py-1.5">
                  {line.item.name} <span className="font-mono text-xs text-muted-foreground">({line.item.code})</span>
                  {isStale ? <span className="ms-1 text-[11px] text-destructive">رویداد انباری جدید — شمارش مجدد لازم است</span> : null}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{line.item.unit.nameFa}</td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{formatQuantity(line.systemQty)}</td>
                <td className="px-2 py-1.5 tabular-nums">{formatQuantity(line.countedQty)}</td>
                <td className={`px-2 py-1.5 font-medium tabular-nums ${variance < 0 ? "text-destructive" : variance > 0 ? "text-success" : "text-muted-foreground"}`} dir="ltr">
                  {formatSignedQuantity(variance)}
                </td>
                <td className="px-2 py-1.5">
                  {hasVariance ? (
                    canApprove ? (
                      <select
                        aria-label={`علت مغایرت ردیف ${index + 1}`}
                        className={`${selectClass} w-full`}
                        value={reasonValue}
                        onChange={(event) => onReasonChange(line.id, event.target.value as "" | StockAdjustmentReason)}
                      >
                        <option value="">انتخاب کنید</option>
                        {STOCK_ADJUSTMENT_REASONS.map((reasonCode) => (
                          <option key={reasonCode} value={reasonCode}>{stockAdjustmentReasonLabels[reasonCode]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground">{line.reasonCode ? stockAdjustmentReasonLabels[line.reasonCode] : "-"}</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{line.note || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
