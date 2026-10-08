"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintFields, PrintHeader, PrintSheet, PrintSignatures, PrintToolbar } from "@/components/print/print-document";
import { NoAccess, formatQuantity, salesOrderTitle } from "../../../sales-orders/shared";
import { deliveryTitle } from "../../../deliveries/shared";
import { invoiceDeliveries, salesInvoiceTitle, type SalesInvoiceDetail } from "../../shared";

// فاکتور فروش — browser-print page built from components/print/print-document.tsx
// (build plan §7: paper-mirror layout, no PDF library). Reads
// GET /sales-invoices/:id (sales.view). A DRAFT prints with a
// "پیش‌نویس — فاقد اعتبار" marker. The customer's economic code is printed;
// the national ID never is (B14).
export default function SalesInvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const [invoice, setInvoice] = useState<SalesInvoiceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<SalesInvoiceDetail>(`/sales-invoices/${invoiceId}`)
      .then((data) => {
        if (!ignore) setInvoice(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فاکتور ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [invoiceId, canView]);

  if (!canView) return <NoAccess message="اجازه مشاهده فاکتورهای فروش را ندارید." />;

  if (!invoice) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/sales-invoices" className="text-primary hover:underline">بازگشت به فاکتورها ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  const order = invoice.salesOrder;
  const deliveries = invoiceDeliveries(invoice);
  const meta: [string, ReactNode][] = [
    ["شماره", <span key="n" className="font-mono">{salesInvoiceTitle(invoice)}</span>],
    ["تاریخ", formatJalali(invoice.invoiceDate)],
  ];
  if (invoice.dueDate) meta.push(["سررسید", formatJalali(invoice.dueDate)]);
  if (order) meta.push(["سفارش", <span key="o" className="font-mono">{salesOrderTitle(order)}</span>]);

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/sales-invoices/${invoice.id}`} backLabel="بازگشت به فاکتور" />
      <PrintSheet>
        <PrintHeader title={invoice.sourceType === "OPENING_BALANCE" ? "فاکتور مانده افتتاحیه" : "فاکتور فروش"} draft={invoice.status === "DRAFT"} meta={meta} />

        <PrintFields
          rows={[
            ["خریدار", `${invoice.customerName} (${invoice.customer.customerNumber})`],
            ["کد اقتصادی", invoice.customerEconomicCode],
            ["شماره مرجع مشتری", order?.customerReference ?? null],
            ["شرایط پرداخت", `${invoice.paymentTermName || "نقدی"} — ${invoice.paymentDueDays.toLocaleString("fa-IR")} روز`],
            ["حواله تحویل", deliveries.length > 0 ? deliveries.map((delivery) => deliveryTitle(delivery)).join("، ") : null],
            ["آدرس", invoice.billingAddressText],
          ]}
        />

        <table className="w-full border-collapse text-right">
          <thead>
            <tr className="bg-muted/40 print:bg-transparent">
              <th className="w-10 border border-border px-2 py-1.5 font-medium">ردیف</th>
              <th className="w-24 border border-border px-2 py-1.5 font-medium">کد کالا</th>
              <th className="border border-border px-2 py-1.5 font-medium">شرح</th>
              <th className="w-16 border border-border px-2 py-1.5 font-medium">واحد</th>
              <th className="w-16 border border-border px-2 py-1.5 font-medium">مقدار</th>
              <th className="w-24 border border-border px-2 py-1.5 font-medium">مبلغ واحد</th>
              <th className="w-20 border border-border px-2 py-1.5 font-medium">تخفیف</th>
              <th className="w-20 border border-border px-2 py-1.5 font-medium">مالیات</th>
              <th className="w-28 border border-border px-2 py-1.5 font-medium">مبلغ کل</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line, index) => (
              <tr key={line.id} className="break-inside-avoid">
                <td className="border border-border px-2 py-1.5 tabular-nums">{(index + 1).toLocaleString("fa-IR")}</td>
                <td className="border border-border px-2 py-1.5 font-mono text-xs">{line.itemCode ?? ""}</td>
                <td className="border border-border px-2 py-1.5">{line.itemName}</td>
                <td className="border border-border px-2 py-1.5">{line.unitName ?? ""}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatQuantity(line.quantity)}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatMoney(line.unitPrice)}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{Number(line.discountAmount) > 0 ? formatMoney(line.discountAmount) : "-"}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{Number(line.taxAmount) > 0 ? formatMoney(line.taxAmount) : "-"}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatMoney(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="border border-border px-2 py-1.5" colSpan={8}>جمع مبلغ اقلام</td>
              <td className="border border-border px-2 py-1.5 tabular-nums">{formatMoney(invoice.subtotal)}</td>
            </tr>
            {Number(invoice.discountTotal) > 0 ? (
              <tr>
                <td className="border border-border px-2 py-1.5" colSpan={8}>تخفیف</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatMoney(invoice.discountTotal)}</td>
              </tr>
            ) : null}
            {Number(invoice.taxTotal) > 0 ? (
              <tr>
                <td className="border border-border px-2 py-1.5" colSpan={8}>مالیات و عوارض</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatMoney(invoice.taxTotal)}</td>
              </tr>
            ) : null}
            <tr>
              <td className="border border-border px-2 py-1.5 font-semibold" colSpan={8}>مبلغ قابل پرداخت (ریال)</td>
              <td className="border border-border px-2 py-1.5 font-bold tabular-nums">{formatMoney(invoice.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        {order?.customerNote || invoice.note ? (
          <div className="mt-4 space-y-1 border border-border p-3">
            {order?.customerNote ? (
              <p>
                <span className="text-muted-foreground">توضیحات سفارش: </span>
                <span className="whitespace-pre-wrap">{order.customerNote}</span>
              </p>
            ) : null}
            {invoice.note ? (
              <p>
                <span className="text-muted-foreground">توضیحات فاکتور: </span>
                <span className="whitespace-pre-wrap">{invoice.note}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <PrintSignatures boxes={[{ label: "فروشنده" }, { label: "خریدار" }]} />
      </PrintSheet>
    </div>
  );
}
