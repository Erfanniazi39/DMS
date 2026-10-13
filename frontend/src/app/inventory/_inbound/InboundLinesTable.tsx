import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { formatQuantity, qcRemaining, type GoodsReceiptLine, type ProductionOutputLine } from "../shared";

// Read-only lines table for the goods-receipt and production-output detail
// pages (I5) — same look as adjustments/[id]/page.tsx's items table.
// Cost columns render only for inventory.cost holders (the backend omits the
// fields for everyone else anyway). `qc` adds the goods receipt's QC columns
// (released / still in QC) for a receipt received into QC.
export function InboundLinesTable({
  lines,
  showCost,
  showCostEstimated = false,
  qc = false,
  batchExpiry,
}: {
  lines: (GoodsReceiptLine | ProductionOutputLine)[];
  showCost: boolean;
  showCostEstimated?: boolean;
  qc?: boolean;
  // Posted lines: batchId → the batch's real expiry. A line keeps only the
  // dates typed on it, so an expiry derived at posting from the item's
  // shelf life is known only from the batch itself.
  batchExpiry?: Map<number, string | null>;
}) {
  const hasBatchColumns = lines.some((line) => line.batchNumber !== null || line.batchId !== null);
  const costTotal = showCost ? lines.reduce((sum, line) => sum + (line.unitCost ? Number(line.unitCost) * Number(line.quantity) : 0), 0) : 0;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[40rem] text-right text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">کد کالا</th>
            <th className="px-3 py-2 font-medium">نام کالا</th>
            <th className="px-3 py-2 font-medium">واحد</th>
            <th className="px-3 py-2 font-medium">مقدار</th>
            {qc ? <th className="px-3 py-2 font-medium">آزادشده</th> : null}
            {qc ? <th className="px-3 py-2 font-medium">در کنترل کیفیت</th> : null}
            {showCost ? <th className="px-3 py-2 font-medium">بهای واحد (ریال)</th> : null}
            {showCost ? <th className="px-3 py-2 font-medium">جمع (ریال)</th> : null}
            {hasBatchColumns ? <th className="px-3 py-2 font-medium">بچ</th> : null}
            {hasBatchColumns ? <th className="px-3 py-2 font-medium">تاریخ تولید</th> : null}
            {hasBatchColumns ? <th className="px-3 py-2 font-medium">تاریخ انقضا</th> : null}
            <th className="px-3 py-2 font-medium">توضیح</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line) => {
            const receiptLine = "releasedQty" in line ? line : null;
            const remaining = receiptLine ? qcRemaining(receiptLine) : 0;
            const estimated = "costIsEstimated" in line && line.costIsEstimated;
            return (
              <tr key={line.id}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                <td className="px-3 py-2 font-mono text-xs">{line.item.code}</td>
                <td className="px-3 py-2">
                  <Link href={`/inventory/items/${line.itemId}`} className="hover:underline">
                    {line.item.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{line.item.unit.nameFa}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{formatQuantity(line.quantity)}</td>
                {qc ? <td className="px-3 py-2 tabular-nums text-muted-foreground">{receiptLine ? formatQuantity(receiptLine.releasedQty) : "-"}</td> : null}
                {qc ? <td className={`px-3 py-2 font-medium tabular-nums ${remaining > 0 ? "text-warning" : "text-muted-foreground"}`}>{formatQuantity(remaining)}</td> : null}
                {showCost ? (
                  <td className="px-3 py-2 tabular-nums">
                    {line.unitCost ? formatMoney(line.unitCost) : <span className="text-muted-foreground">-</span>}
                    {showCostEstimated && estimated ? <span className="ms-1 text-[11px] text-warning">(برآوردی)</span> : null}
                  </td>
                ) : null}
                {showCost ? <td className="px-3 py-2 tabular-nums text-muted-foreground">{line.unitCost ? formatMoney(Math.round(Number(line.unitCost) * Number(line.quantity))) : "-"}</td> : null}
                {hasBatchColumns ? <td className="px-3 py-2 font-mono text-xs">{line.batchNumber ?? "-"}</td> : null}
                {hasBatchColumns ? <td className="px-3 py-2 text-muted-foreground">{line.productionDate ? formatJalali(line.productionDate) : "-"}</td> : null}
                {hasBatchColumns ? (
                  <td className="px-3 py-2 text-muted-foreground">
                    {line.expiryDate ? (
                      formatJalali(line.expiryDate)
                    ) : line.batchId !== null && batchExpiry?.get(line.batchId) ? (
                      <span title="محاسبه‌شده هنگام ثبت (طول عمر کالا)">{formatJalali(batchExpiry.get(line.batchId)!)}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-muted-foreground">{line.note || "-"}</td>
              </tr>
            );
          })}
        </tbody>
        {showCost ? (
          <tfoot className="border-t border-border bg-muted/20">
            <tr>
              <td colSpan={5 + (qc ? 2 : 0) + 1} className="px-3 py-2 text-muted-foreground">جمع بهای ردیف‌های دارای بها</td>
              <td className="px-3 py-2 font-medium tabular-nums">{formatMoney(Math.round(costTotal))}</td>
              <td colSpan={(hasBatchColumns ? 3 : 0) + 1}></td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
