"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { salesInvoicingStatusLabels, salesInvoicingStatusTone, type SalesInvoicingStatus } from "../../../sales-orders/shared";
import { createInvoiceFromDelivery } from "../../../sales-invoices/create-invoice";
import { InvoicesTable } from "../../../sales-invoices/InvoicesTable";
import type { SalesInvoiceListItem } from "../../../sales-invoices/shared";
import type { DeliveryDetail } from "../../shared";

// This delivery's own invoicing state, from its lines' invoicedQty (same
// three-way shape as the order's invoicingStatus axis).
function deliveryInvoicingStatus(delivery: DeliveryDetail): SalesInvoicingStatus {
  if (delivery.items.every((item) => Number(item.invoicedQty) <= 0)) return "NOT_INVOICED";
  if (delivery.items.every((item) => Number(item.invoicedQty) >= Number(item.quantity))) return "INVOICED";
  return "PARTIALLY_INVOICED";
}

// «فاکتورها» — this delivery's invoices: GET /sales-invoices?deliveryId=
// (sales.view, unpaginated — B7: one invoice per delivery). «ایجاد فاکتور»
// (sales.invoice) appears on a POSTED delivery with uninvoiced quantity and
// no draft invoice yet; it creates the DRAFT (POST /sales-invoices
// { deliveryId }) and opens it. Mirrors sales-orders' DeliveriesSection.
export function InvoicesSection({ delivery, canInvoice, pushError }: { delivery: DeliveryDetail; canInvoice: boolean; pushError: (message: string) => void }) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<SalesInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesInvoiceListItem[]>(`/sales-invoices?deliveryId=${delivery.id}`)
      .then((data) => {
        if (!ignore) {
          setInvoices(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت فاکتورهای این حواله ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [delivery.id, retryKey]);

  const status = deliveryInvoicingStatus(delivery);
  const hasDraft = invoices.some((invoice) => invoice.status === "DRAFT");
  const canCreate = canInvoice && delivery.status === "POSTED" && status !== "INVOICED" && !hasDraft && !loading && !loadError;

  async function create() {
    setCreating(true);
    try {
      const id = await createInvoiceFromDelivery(delivery.id);
      router.push(`/sales-invoices/${id}`);
    } catch (reason) {
      const error = reason as ApiError;
      pushError(error.messages?.length ? error.messages.join("، ") : (error.message ?? "ایجاد فاکتور ناموفق بود."));
      setCreating(false);
    }
  }

  return (
    <FormSection
      title="فاکتورها"
      description={delivery.status === "POSTED" ? `وضعیت فاکتور این حواله: ${salesInvoicingStatusLabels[status]}` : undefined}
      action={
        <div className="flex items-center gap-2">
          {delivery.status === "POSTED" ? <StatusBadge label={salesInvoicingStatusLabels[status]} tone={salesInvoicingStatusTone[status]} /> : null}
          {canCreate ? (
            <Button size="sm" variant="outline" disabled={creating} onClick={() => void create()}>
              <FilePlus2 className="size-3.5" aria-hidden="true" />
              {creating ? "در حال ایجاد..." : "ایجاد فاکتور"}
            </Button>
          ) : null}
        </div>
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
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {delivery.status === "POSTED" ? "هنوز فاکتوری برای این حواله صادر نشده است." : "پس از ثبت حواله می‌توان برای آن فاکتور صادر کرد."}
        </p>
      ) : (
        <InvoicesTable invoices={invoices} />
      )}
    </FormSection>
  );
}
