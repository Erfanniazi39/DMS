import { formatMoney } from "@/lib/format";
import { FormSection } from "../../_form/FormSection";
import { formatPercent, formatQuantity, type SalesOrderDetail } from "../../shared";

// «اقلام سفارش» — the order lines exactly as the backend stored them (item
// code/name/unit and list price are snapshots; every amount is server-
// computed). Reserved / delivered columns appear once the order has been
// confirmed. On a CONFIRMED order a line whose open quantity (ordered −
// delivered) isn't fully reserved is tinted as a backorder — display only.
export function ItemsSection({ order }: { order: SalesOrderDetail }) {
  const showProgress = order.orderNumber !== null;
  const hasDiscount = Number(order.discountTotal) > 0;

  return (
    <FormSection title="اقلام سفارش" description={`${order.items.length.toLocaleString("fa-IR")} ردیف — انبار: ${order.location.name}`}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[56rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">کالا</th>
              <th className="px-2 py-2 font-medium">واحد</th>
              <th className="px-2 py-2 font-medium">مقدار</th>
              <th className="px-2 py-2 font-medium">قیمت فهرست</th>
              <th className="px-2 py-2 font-medium">قیمت واحد</th>
              {hasDiscount ? <th className="px-2 py-2 font-medium">تخفیف</th> : null}
              <th className="px-2 py-2 font-medium">مالیات</th>
              <th className="px-2 py-2 font-medium">جمع ردیف</th>
              {showProgress ? (
                <>
                  <th className="px-2 py-2 font-medium">رزرو</th>
                  <th className="px-2 py-2 font-medium">تحویل‌شده</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.items.map((line) => {
              const open = Number(line.quantity) - Number(line.deliveredQty);
              const backordered = order.status === "CONFIRMED" && Number(line.reservedQty) < open;
              return (
                <tr key={line.id} className={`align-top ${backordered ? "bg-warning/10" : ""}`}>
                  <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                  <td className="px-2 py-2">
                    <div>
                      {line.itemName} <span className="font-mono text-[11px] text-muted-foreground">{line.itemCode}</span>
                    </div>
                    {line.priceOverrideReason ? <div className="mt-0.5 text-xs text-warning">علت کاهش قیمت: {line.priceOverrideReason}</div> : null}
                    {line.note ? <div className="mt-0.5 text-xs text-muted-foreground">{line.note}</div> : null}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{line.unitName}</td>
                  <td className="px-2 py-2 tabular-nums">{formatQuantity(line.quantity)}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{line.listUnitPrice === null ? "-" : formatMoney(line.listUnitPrice)}</td>
                  <td className="px-2 py-2 tabular-nums">{formatMoney(line.unitPrice)}</td>
                  {hasDiscount ? (
                    <td className="px-2 py-2 tabular-nums">
                      {Number(line.discountAmount) > 0 ? (
                        <>
                          {formatMoney(line.discountAmount)}
                          {line.discountPercent !== null ? <span className="ms-1 text-xs text-muted-foreground">({formatPercent(line.discountPercent)})</span> : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  ) : null}
                  <td className="px-2 py-2 tabular-nums">
                    {Number(line.taxAmount) > 0 ? (
                      <>
                        {formatMoney(line.taxAmount)} <span className="text-xs text-muted-foreground">({formatPercent(line.taxRate)})</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2 py-2 font-medium tabular-nums">{formatMoney(line.lineTotal)}</td>
                  {showProgress ? (
                    <>
                      <td className={`px-2 py-2 tabular-nums ${backordered ? "font-medium text-warning" : ""}`} title={backordered ? "بخشی از این ردیف رزرو نشده است (پس‌افت)" : undefined}>
                        {formatQuantity(line.reservedQty)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{formatQuantity(line.deliveredQty)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 ms-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">جمع ناخالص</dt>
        <dd className="text-left tabular-nums">{formatMoney(order.subtotal)} ریال</dd>
        <dt className="text-muted-foreground">تخفیف</dt>
        <dd className="text-left tabular-nums">{formatMoney(order.discountTotal)} ریال</dd>
        <dt className="text-muted-foreground">مالیات</dt>
        <dd className="text-left tabular-nums">{formatMoney(order.taxTotal)} ریال</dd>
        <dt className="border-t border-border pt-1 font-semibold">مبلغ کل</dt>
        <dd className="border-t border-border pt-1 text-left font-semibold tabular-nums">{formatMoney(order.totalAmount)} ریال</dd>
      </dl>
    </FormSection>
  );
}
