import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { formatQuantity, type GoodsReceiptLine, type ProductionOutputLine } from "../shared";

// The bordered lines table of the GRN / PRD print pages (I5) — same paper
// layout as deliveries/[id]/print/page.tsx. Cost columns only for
// inventory.cost holders (the backend omits the fields for everyone else).
export function InboundPrintTable({
  lines,
  showCost,
  batchExpiry,
}: {
  lines: (GoodsReceiptLine | ProductionOutputLine)[];
  showCost: boolean;
  batchExpiry: Map<number, string | null>;
}) {
  const hasBatch = lines.some((line) => line.batchNumber !== null);
  const totalQuantity = lines.reduce((sum, line) => sum + Number(line.quantity), 0);
  const costTotal = lines.reduce((sum, line) => sum + (line.unitCost ? Math.round(Number(line.unitCost) * Number(line.quantity)) : 0), 0);
  const cell = "border border-border px-2 py-1.5";

  return (
    <table className="w-full border-collapse text-right">
      <thead>
        <tr className="bg-muted/40 print:bg-transparent">
          <th className={`w-10 ${cell} font-medium`}>ردیف</th>
          <th className={`w-24 ${cell} font-medium`}>کد کالا</th>
          <th className={`${cell} font-medium`}>شرح کالا</th>
          <th className={`w-16 ${cell} font-medium`}>واحد</th>
          <th className={`w-20 ${cell} font-medium`}>مقدار</th>
          {hasBatch ? <th className={`w-28 ${cell} font-medium`}>بچ</th> : null}
          {hasBatch ? <th className={`w-24 ${cell} font-medium`}>انقضا</th> : null}
          {showCost ? <th className={`w-24 ${cell} font-medium`}>بهای واحد</th> : null}
          {showCost ? <th className={`w-28 ${cell} font-medium`}>جمع (ریال)</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => {
          const expiry = line.expiryDate ?? (line.batchId !== null ? (batchExpiry.get(line.batchId) ?? null) : null);
          return (
            <tr key={line.id} className="break-inside-avoid">
              <td className={`${cell} tabular-nums`}>{(index + 1).toLocaleString("fa-IR")}</td>
              <td className={`${cell} font-mono text-xs`}>{line.item.code}</td>
              <td className={cell}>
                {line.item.name}
                {line.note ? <span className="block text-[11px] text-muted-foreground">{line.note}</span> : null}
              </td>
              <td className={cell}>{line.item.unit.nameFa}</td>
              <td className={`${cell} tabular-nums`}>{formatQuantity(line.quantity)}</td>
              {hasBatch ? <td className={`${cell} font-mono text-xs`}>{line.batchNumber ?? "-"}</td> : null}
              {hasBatch ? <td className={cell}>{expiry ? formatJalali(expiry) : "-"}</td> : null}
              {showCost ? <td className={`${cell} tabular-nums`}>{line.unitCost ? formatMoney(line.unitCost) : "-"}</td> : null}
              {showCost ? <td className={`${cell} tabular-nums`}>{line.unitCost ? formatMoney(Math.round(Number(line.unitCost) * Number(line.quantity))) : "-"}</td> : null}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td className={`${cell} font-medium`} colSpan={4}>جمع مقدار ({lines.length.toLocaleString("fa-IR")} ردیف)</td>
          <td className={`${cell} font-semibold tabular-nums`}>{formatQuantity(totalQuantity)}</td>
          {hasBatch ? <td className={cell} colSpan={2}></td> : null}
          {showCost ? <td className={cell}></td> : null}
          {showCost ? <td className={`${cell} font-semibold tabular-nums`}>{formatMoney(costTotal)}</td> : null}
        </tr>
      </tfoot>
    </table>
  );
}
