"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatJalali } from "@/lib/jalali";
import { formatQuantity, type ItemBatchRow } from "../shared";

// I4: one item's batches (GET /inventory/items/:itemId/batches) as a dense
// read-only table — used by the /inventory drill-down row and the stock card.
// "منقضی‌شده" comes straight from the backend's isExpired (expiry date before
// today, Tehran calendar day); the frontend never re-derives expiry status.
export function BatchBreakdownTable({
  batches,
  locationNames,
  compact = false,
}: {
  batches: ItemBatchRow[];
  // Shown as a column only when there is more than one location.
  locationNames?: Map<number, string>;
  compact?: boolean;
}) {
  const showLocation = (locationNames?.size ?? 0) > 1;
  const cell = compact ? "px-3 py-1.5" : "px-3 py-2";
  return (
    <table className="w-full text-right text-sm">
      <thead className="bg-muted/40 text-xs text-muted-foreground">
        <tr>
          <th className={`${cell} font-medium`}>شماره بچ</th>
          {showLocation ? <th className={`${cell} font-medium`}>انبار</th> : null}
          <th className={`${cell} font-medium`}>تاریخ تولید</th>
          <th className={`${cell} font-medium`}>تاریخ انقضا</th>
          <th className={`${cell} font-medium`}>موجودی انبار</th>
          <th className={`${cell} font-medium`}>کنترل کیفیت</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {batches.map((batch) => (
          <tr key={`${batch.batchId}:${batch.locationId}`} className={batch.isExpired ? "bg-destructive/5" : undefined}>
            <td className={`${cell} font-mono text-xs`}>{batch.batchNumber}</td>
            {showLocation ? <td className={`${cell} text-muted-foreground`}>{locationNames?.get(batch.locationId) ?? "-"}</td> : null}
            <td className={`${cell} text-muted-foreground`}>{batch.productionDate ? formatJalali(batch.productionDate) : "-"}</td>
            <td className={cell}>
              <span className="inline-flex items-center gap-1.5">
                {batch.expiryDate ? formatJalali(batch.expiryDate) : <span className="text-muted-foreground">بدون تاریخ انقضا</span>}
                {batch.isExpired ? <StatusBadge label="منقضی‌شده" tone="destructive" /> : null}
              </span>
            </td>
            <td className={`${cell} font-medium tabular-nums`}>{formatQuantity(batch.onHand)}</td>
            <td className={`${cell} tabular-nums text-muted-foreground`}>{formatQuantity(batch.qc)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
