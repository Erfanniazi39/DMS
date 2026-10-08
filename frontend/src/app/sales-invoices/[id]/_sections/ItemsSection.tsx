import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { formatPercent, formatQuantity } from "../../../sales-orders/shared";
import { deliveryTitle } from "../../../deliveries/shared";
import { invoiceOpenAmount, type SalesInvoiceDetail } from "../../shared";

// «اقلام فاکتور» — the invoice lines (snapshots of the order line: code /
// name / unit / price / tax rate; quantity = what the delivery line still had
// uninvoiced) and the money summary. Paid / credited / open are shown once
// the invoice is POSTED (written by Receivables, Batch 5).
export function ItemsSection({ invoice }: { invoice: SalesInvoiceDetail }) {
  const showDelivery = invoice.items.some((line) => line.deliveryItem !== null);
  const posted = invoice.status === "POSTED";
  const columns = showDelivery ? 9 : 8;

  return (
    <FormSection title="اقلام فاکتور" description={`${invoice.items.length.toLocaleString("fa-IR")} ردیف — مبالغ به ریال`}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[52rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">شرح</th>
              {showDelivery ? <th className="px-2 py-2 font-medium">حواله</th> : null}
              <th className="px-2 py-2 font-medium">واحد</th>
              <th className="px-2 py-2 font-medium">مقدار</th>
              <th className="px-2 py-2 font-medium">مبلغ واحد</th>
              <th className="px-2 py-2 font-medium">تخفیف</th>
              <th className="px-2 py-2 font-medium">مالیات</th>
              <th className="px-2 py-2 font-medium">جمع ردیف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoice.items.map((line) => (
              <tr key={line.id}>
                <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                <td className="px-2 py-2">
                  {line.itemName} {line.itemCode ? <span className="font-mono text-[11px] text-muted-foreground">{line.itemCode}</span> : null}
                </td>
                {showDelivery ? (
                  <td className="px-2 py-2 whitespace-nowrap">
                    {line.deliveryItem ? (
                      <Link href={`/deliveries/${line.deliveryItem.delivery.id}`} className="font-mono text-xs text-primary hover:underline">
                        {deliveryTitle(line.deliveryItem.delivery)}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                ) : null}
                <td className="px-2 py-2 text-muted-foreground">{line.unitName || "-"}</td>
                <td className="px-2 py-2 tabular-nums">{formatQuantity(line.quantity)}</td>
                <td className="px-2 py-2 tabular-nums">{formatMoney(line.unitPrice)}</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{Number(line.discountAmount) > 0 ? formatMoney(line.discountAmount) : "-"}</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">
                  {Number(line.taxAmount) > 0 ? (
                    <>
                      {formatMoney(line.taxAmount)} <span className="text-[11px]">({formatPercent(line.taxRate)})</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-2 font-medium tabular-nums">{formatMoney(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20 text-sm">
            <tr>
              <td className="px-2 py-1.5 text-muted-foreground" colSpan={columns - 1}>جمع مبلغ اقلام</td>
              <td className="px-2 py-1.5 tabular-nums">{formatMoney(invoice.subtotal)}</td>
            </tr>
            {Number(invoice.discountTotal) > 0 ? (
              <tr>
                <td className="px-2 py-1.5 text-muted-foreground" colSpan={columns - 1}>تخفیف</td>
                <td className="px-2 py-1.5 tabular-nums">{formatMoney(invoice.discountTotal)}</td>
              </tr>
            ) : null}
            {Number(invoice.taxTotal) > 0 ? (
              <tr>
                <td className="px-2 py-1.5 text-muted-foreground" colSpan={columns - 1}>مالیات</td>
                <td className="px-2 py-1.5 tabular-nums">{formatMoney(invoice.taxTotal)}</td>
              </tr>
            ) : null}
            <tr>
              <td className="px-2 py-1.5 font-medium" colSpan={columns - 1}>مبلغ کل فاکتور</td>
              <td className="px-2 py-1.5 font-semibold tabular-nums">{formatMoney(invoice.totalAmount)}</td>
            </tr>
            {posted ? (
              <>
                <tr>
                  <td className="px-2 py-1.5 text-muted-foreground" colSpan={columns - 1}>دریافت‌شده / اعتبار</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {formatMoney(invoice.paidAmount)} / {formatMoney(invoice.creditedAmount)}
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium" colSpan={columns - 1}>مانده</td>
                  <td className="px-2 py-1.5 font-semibold tabular-nums">{formatMoney(invoiceOpenAmount(invoice))}</td>
                </tr>
              </>
            ) : null}
          </tfoot>
        </table>
      </div>
    </FormSection>
  );
}
