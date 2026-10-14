"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { RecordReceiptDialog, type SectionToasts } from "../../../receipts/RecordReceiptDialog";
import { customerPaymentStatusLabels, customerPaymentStatusTone, paymentMethodLabels, type CustomerPaymentStatus, type PaymentMethod } from "../../../receipts/shared";
import type { SalesInvoiceListItem } from "../../../sales-invoices/shared";
import { FormSection } from "../../_form/FormSection";
import type { SalesOrderDetail } from "../../shared";

type OrderAllocation = {
  id: number;
  amount: string;
  allocatedAt: string;
  reversedAt: string | null;
  targetInvoice: { id: number; invoiceNumber: string | null } | null;
  sourcePayment: { id: number; paymentNumber: string | null; paymentDate: string; method: PaymentMethod; status: CustomerPaymentStatus; referenceNumber: string | null } | null;
  sourceCreditNote: { id: number; creditNoteNumber: string | null } | null;
};

// «پرداخت‌ها» on the order page — every receipt / credit note applied to any
// of this order's invoices (GET /receivables/sales-orders/:id/allocations,
// receivables.view), with the order's invoiced / paid / remaining totals.
// «ثبت پرداخت» (receivables.manage) opens the receipt dialog with the
// customer fixed and the order's open invoices pre-allocated, so the user
// doesn't leave the page.
export function PaymentsSection({
  order,
  canView,
  canManage,
  reloadKey,
  onChanged,
  toasts,
}: {
  order: SalesOrderDetail;
  canView: boolean;
  canManage: boolean;
  reloadKey: number;
  onChanged: () => void;
  toasts: SectionToasts;
}) {
  const [rows, setRows] = useState<OrderAllocation[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    Promise.all([
      apiFetch<OrderAllocation[]>(`/receivables/sales-orders/${order.id}/allocations`),
      apiFetch<SalesInvoiceListItem[]>(`/sales-invoices?salesOrderId=${order.id}`),
    ])
      .then(([allocations, orderInvoices]) => {
        if (ignore) return;
        setRows(allocations);
        setInvoices(orderInvoices);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت پرداخت‌های این سفارش ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [order.id, canView, reloadKey, refresh]);

  const posted = useMemo(() => invoices.filter((invoice) => invoice.status === "POSTED"), [invoices]);
  const openInvoiceIds = useMemo(
    () => posted.filter((invoice) => Number(invoice.totalAmount) - Number(invoice.paidAmount) - Number(invoice.creditedAmount) > 0).map((invoice) => invoice.id),
    [posted],
  );

  if (!canView || posted.length === 0) return null;

  const total = posted.reduce((sum, invoice) => sum + Number(invoice.totalAmount), 0);
  const paid = posted.reduce((sum, invoice) => sum + Number(invoice.paidAmount), 0);
  const credited = posted.reduce((sum, invoice) => sum + Number(invoice.creditedAmount), 0);
  const remaining = total - paid - credited;

  return (
    <FormSection
      title="پرداخت‌ها"
      action={
        canManage && openInvoiceIds.length > 0 ? (
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            <HandCoins className="size-3.5" aria-hidden="true" />
            ثبت پرداخت
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <p className="py-4 text-center text-sm text-destructive">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">هنوز پرداختی به فاکتورهای این سفارش تخصیص نیافته است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">سند</th>
                <th className="px-3 py-2 font-medium">فاکتور</th>
                <th className="px-3 py-2 font-medium">تاریخ</th>
                <th className="px-3 py-2 font-medium">روش</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
                <th className="px-3 py-2 font-medium">مبلغ (ریال)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const reversed = Boolean(row.reversedAt);
                const payment = row.sourcePayment;
                return (
                  <tr key={row.id} className={reversed ? "text-muted-foreground line-through" : undefined}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {payment ? (
                        <Link href={`/receipts/${payment.id}`} className="text-primary hover:underline">{payment.paymentNumber ?? `#${payment.id}`}</Link>
                      ) : row.sourceCreditNote ? (
                        <span>{row.sourceCreditNote.creditNoteNumber ?? `#${row.sourceCreditNote.id}`}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.targetInvoice ? (
                        <Link href={`/sales-invoices/${row.targetInvoice.id}`} className="text-primary hover:underline">{row.targetInvoice.invoiceNumber ?? `#${row.targetInvoice.id}`}</Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">{formatJalali(payment?.paymentDate ?? row.allocatedAt)}</td>
                    <td className="px-3 py-2">{payment ? paymentMethodLabels[payment.method] : "اعتبار (برگشت از فروش)"}</td>
                    <td className="px-3 py-2">
                      {reversed ? (
                        <StatusBadge label="برگشت‌خورده" tone="destructive" />
                      ) : payment ? (
                        <StatusBadge label={customerPaymentStatusLabels[payment.status]} tone={customerPaymentStatusTone[payment.status]} />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm md:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">جمع فاکتورها</dt><dd className="tabular-nums">{formatMoney(total)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">پرداخت‌شده</dt><dd className="tabular-nums">{formatMoney(paid)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">اعتبار (برگشت از فروش)</dt><dd className="tabular-nums">{formatMoney(credited)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">مانده</dt><dd className="font-medium tabular-nums">{formatMoney(remaining)}</dd></div>
      </dl>
      <RecordReceiptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setRefresh((current) => current + 1);
          onChanged();
        }}
        toasts={toasts}
        presetCustomerId={order.customerId}
        presetInvoiceIds={openInvoiceIds}
      />
    </FormSection>
  );
}
