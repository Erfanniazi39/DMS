"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { RecordReceiptDialog, type SectionToasts } from "../../../receipts/RecordReceiptDialog";
import { customerPaymentStatusLabels, customerPaymentStatusTone, paymentMethodLabels, type CustomerPaymentStatus, type PaymentMethod } from "../../../receipts/shared";
import type { SalesInvoiceDetail } from "../../shared";

type InvoiceAllocation = {
  id: number;
  amount: string;
  allocatedAt: string;
  reversedAt: string | null;
  sourcePayment: { id: number; paymentNumber: string | null; paymentDate: string; method: PaymentMethod; status: CustomerPaymentStatus; referenceNumber: string | null } | null;
  sourceCreditNote: { id: number; creditNoteNumber: string | null } | null;
};

// «پرداخت‌ها» — GET /receivables/invoices/:id/allocations (receivables.view):
// every receipt / credit note applied to this invoice, reversed ones struck
// out. «ثبت پرداخت» (receivables.manage) opens the receipt dialog with the
// customer and this invoice preset, so the payment is allocated to it.
export function PaymentsSection({
  invoice,
  canView,
  canManage,
  reloadKey,
  onChanged,
  toasts,
}: {
  invoice: SalesInvoiceDetail;
  canView: boolean;
  canManage: boolean;
  reloadKey: number;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const [rows, setRows] = useState<InvoiceAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // Stable reference: the dialog's effect depends on it.
  const presetIds = useMemo(() => [invoice.id], [invoice.id]);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<InvoiceAllocation[]>(`/receivables/invoices/${invoice.id}/allocations`)
      .then((data) => {
        if (!ignore) {
          setRows(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت پرداخت‌های فاکتور ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [invoice.id, canView, reloadKey, refresh]);

  if (invoice.status !== "POSTED" || !canView) return null;

  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  const credited = Number(invoice.creditedAmount);
  const remaining = total - paid - credited;

  return (
    <FormSection
      title="پرداخت‌ها"
      action={
        canManage && remaining > 0 ? (
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
        <p className="py-4 text-center text-sm text-muted-foreground">هنوز پرداختی به این فاکتور تخصیص نیافته است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">سند</th>
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
                      {payment?.referenceNumber ? <span className="ms-2 text-muted-foreground">{payment.referenceNumber}</span> : null}
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
        <div><dt className="text-xs text-muted-foreground">مبلغ فاکتور</dt><dd className="tabular-nums">{formatMoney(total)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">پرداخت‌شده</dt><dd className="tabular-nums">{formatMoney(paid)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">اعتبار (برگشت از فروش)</dt><dd className="tabular-nums">{formatMoney(credited)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">مانده</dt><dd className="font-medium tabular-nums">{formatMoney(remaining)}</dd></div>
      </dl>
      <RecordReceiptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setRefresh((current) => current + 1);
          void onChanged();
        }}
        toasts={toasts}
        presetCustomerId={invoice.customerId}
        presetInvoiceIds={presetIds}
        minPaymentDate={invoice.invoiceDate.slice(0, 10)}
      />
    </FormSection>
  );
}
