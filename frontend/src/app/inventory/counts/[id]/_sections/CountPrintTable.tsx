import { formatQuantity, formatSignedQuantity, hasSystemQty, stockAdjustmentReasonLabels, type StockCountDetail } from "../../../shared";

// The bordered lines table of the stock-count print page (I6) — same paper
// layout as InboundPrintTable.tsx (receipts/production). systemQty/variance
// columns are only rendered when the API response actually carries them
// (masked while isBlind && COUNTING for a non-approver — see
// hasSystemQty()/shared.tsx).
export function CountPrintTable({ items }: { items: StockCountDetail["items"] }) {
  const showSystemQty = items.length > 0 && hasSystemQty(items[0]);
  const hasBatch = items.some((line) => line.batch !== null);
  const cell = "border border-border px-2 py-1.5";

  return (
    <table className="w-full border-collapse text-right">
      <thead>
        <tr className="bg-muted/40 print:bg-transparent">
          <th className={`w-10 ${cell} font-medium`}>ردیف</th>
          <th className={`w-24 ${cell} font-medium`}>کد کالا</th>
          <th className={`${cell} font-medium`}>شرح کالا</th>
          <th className={`w-16 ${cell} font-medium`}>واحد</th>
          {hasBatch ? <th className={`w-28 ${cell} font-medium`}>بچ</th> : null}
          {showSystemQty ? <th className={`w-20 ${cell} font-medium`}>موجودی سیستم</th> : null}
          <th className={`w-20 ${cell} font-medium`}>شمارش‌شده</th>
          {showSystemQty ? <th className={`w-20 ${cell} font-medium`}>مغایرت</th> : null}
          <th className={`w-28 ${cell} font-medium`}>علت مغایرت</th>
        </tr>
      </thead>
      <tbody>
        {items.map((line, index) => (
          <tr key={line.id} className="break-inside-avoid">
            <td className={`${cell} tabular-nums`}>{(index + 1).toLocaleString("fa-IR")}</td>
            <td className={`${cell} font-mono text-xs`}>{line.item.code}</td>
            <td className={cell}>
              {line.item.name}
              {line.note ? <span className="block text-[11px] text-muted-foreground">{line.note}</span> : null}
            </td>
            <td className={cell}>{line.item.unit.nameFa}</td>
            {hasBatch ? <td className={`${cell} font-mono text-xs`}>{line.batch?.batchNumber ?? "-"}</td> : null}
            {showSystemQty ? <td className={`${cell} tabular-nums`}>{formatQuantity(line.systemQty)}</td> : null}
            <td className={`${cell} tabular-nums`}>{formatQuantity(line.countedQty)}</td>
            {showSystemQty ? <td className={`${cell} tabular-nums`}>{line.varianceQty !== undefined && line.varianceQty !== null ? formatSignedQuantity(line.varianceQty) : "-"}</td> : null}
            <td className={cell}>{line.reasonCode ? stockAdjustmentReasonLabels[line.reasonCode] : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
