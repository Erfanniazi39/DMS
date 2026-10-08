"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiError } from "@/lib/api";
import { InvoicesTable } from "../../../sales-invoices/InvoicesTable";
import type { SalesInvoiceListItem } from "../../../sales-invoices/shared";
import { FormSection } from "../../_form/FormSection";

// «فاکتورها» — this order's invoices: GET /sales-invoices?salesOrderId=
// (sales.view, unpaginated — one order has few). Read-only here: an invoice
// is created from a posted delivery (delivery page / invoice queue, B7).
export function InvoicesSection({ orderId, reloadKey }: { orderId: number; reloadKey: number }) {
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
    <FormSection title="فاکتورها" description={invoices.length > 0 ? `${invoices.length.toLocaleString("fa-IR")} فاکتور` : undefined}>
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
    </FormSection>
  );
}
