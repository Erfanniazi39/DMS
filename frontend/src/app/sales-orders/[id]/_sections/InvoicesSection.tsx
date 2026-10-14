"use client";

import { useEffect, useState } from "react";
import { FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiError } from "@/lib/api";
import { InvoicesTable } from "../../../sales-invoices/InvoicesTable";
import type { SalesInvoiceListItem } from "../../../sales-invoices/shared";
import { FormSection } from "../../_form/FormSection";
import type { SalesOrderDetail } from "../../shared";
import type { SectionToasts } from "../../../receipts/RecordReceiptDialog";
import { IssueInvoiceDialog } from "./IssueInvoiceDialog";

// «فاکتورها» — this order's invoices: GET /sales-invoices?salesOrderId=
// (sales.view, unpaginated — one order has few). «صدور فاکتور» (sales.invoice)
// creates + posts an invoice for one of the order's posted deliveries without
// leaving the page (B7: one invoice per delivery).
export function InvoicesSection({ order, reloadKey, canInvoice, onChanged, toasts }: { order: SalesOrderDetail; reloadKey: number; canInvoice: boolean; onChanged: () => void; toasts: SectionToasts }) {
  const orderId = order.id;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invoices, setInvoices] = useState<SalesInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesInvoiceListItem[]>(`/sales-invoices?salesOrderId=${orderId}`)
      .then((data) => {
        if (!ignore) {
          setInvoices(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت فاکتورهای این سفارش ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [orderId, reloadKey, retryKey]);

  return (
    <FormSection
      title="فاکتورها"
      description={invoices.length > 0 ? `${invoices.length.toLocaleString("fa-IR")} فاکتور` : undefined}
      action={
        canInvoice && order.status !== "CANCELLED" ? (
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <FilePlus className="size-3.5" aria-hidden="true" />
            صدور فاکتور
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : invoices.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز فاکتوری برای این سفارش صادر نشده است.</p>
      ) : (
        <InvoicesTable invoices={invoices} />
      )}
      <IssueInvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} orderId={orderId} orderNumber={order.orderNumber} onDone={onChanged} toasts={toasts} />
    </FormSection>
  );
}
