import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { salesPaymentStatusLabels, salesPaymentStatusTone } from "../sales-orders/shared";
import { invoiceOpenAmount, isInvoiceOverdue, salesInvoiceStatusLabels, salesInvoiceStatusTone, salesInvoiceTitle, type SalesInvoiceListItem } from "./shared";

// Compact invoice table for the «فاکتورها» sections on the delivery and
// sales-order detail pages (rows from GET /sales-invoices?deliveryId= /
// ?salesOrderId=). Overdue due dates are tinted, same rule as the list.
export function InvoicesTable({ invoices }: { invoices: SalesInvoiceListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[40rem] text-right text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">شماره فاکتور</th>
            <th className="px-3 py-2 font-medium">تاریخ</th>
            <th className="px-3 py-2 font-medium">سررسید</th>
            <th className="px-3 py-2 font-medium">مبلغ کل (ریال)</th>
            <th className="px-3 py-2 font-medium">مانده (ریال)</th>
            <th className="px-3 py-2 font-medium">پرداخت</th>
            <th className="px-3 py-2 font-medium">وضعیت</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoices.map((invoice) => {
            const posted = invoice.status === "POSTED";
            const overdue = isInvoiceOverdue(invoice);
            return (
              <tr key={invoice.id}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/sales-invoices/${invoice.id}`} className={`text-primary hover:underline ${invoice.invoiceNumber ? "font-mono text-xs" : "text-xs"}`}>
                    {salesInvoiceTitle(invoice)}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(invoice.invoiceDate)}</td>
                <td className={`px-3 py-2 whitespace-nowrap ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{invoice.dueDate ? formatJalali(invoice.dueDate) : "-"}</td>
                <td className="px-3 py-2 tabular-nums">{formatMoney(invoice.totalAmount)}</td>
                <td className="px-3 py-2 tabular-nums">{posted ? formatMoney(invoiceOpenAmount(invoice)) : "-"}</td>
                <td className="px-3 py-2">
                  {posted ? (
                    <StatusBadge label={overdue ? "سررسید گذشته" : salesPaymentStatusLabels[invoice.paymentStatus]} tone={overdue ? "destructive" : salesPaymentStatusTone[invoice.paymentStatus]} />
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge label={salesInvoiceStatusLabels[invoice.status]} tone={salesInvoiceStatusTone[invoice.status]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
