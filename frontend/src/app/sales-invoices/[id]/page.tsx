"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, salesInvoicingStatusLabels, salesInvoicingStatusTone, salesOrderTitle, salesPaymentStatusLabels, salesPaymentStatusTone } from "../../sales-orders/shared";
import { FormSection } from "../../sales-orders/_form/FormSection";
import { deliveryTitle } from "../../deliveries/shared";
import {
  invoiceDeliveries,
  isInvoiceOverdue,
  salesInvoiceStatusLabels,
  salesInvoiceStatusTone,
  salesInvoiceTitle,
  salesSourceTypeLabels,
  type SalesInvoiceDetail,
} from "../shared";
import { StatusActions } from "./_sections/StatusActions";
import { ItemsSection } from "./_sections/ItemsSection";
import { HistorySection } from "./_sections/HistorySection";

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 md:col-span-4" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function who(user: { username: string } | null, at: string | null) {
  if (!user && !at) return "-";
  return `${user?.username ?? "-"}${at ? ` — ${formatJalali(at)}` : ""}`;
}

// Sales-invoice detail. «ثبت فاکتور» (DRAFT → POSTED) lives in the header's
// StatusActions; printing is /sales-invoices/:id/print.
export default function SalesInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canInvoice = user?.permissions.includes("sales.invoice") ?? false;

  const [invoice, setInvoice] = useState<SalesInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const [loadingId, setLoadingId] = useState(invoiceId);
  if (loadingId !== invoiceId) {
    setLoadingId(invoiceId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<SalesInvoiceDetail>(`/sales-invoices/${invoiceId}`)
      .then((data) => {
        if (!ignore) {
          setInvoice(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فاکتور ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [invoiceId, canView]);

  function onUpdated(updated: SalesInvoiceDetail) {
    setInvoice(updated);
    setHistoryKey((current) => current + 1);
  }

  if (!canView) return <NoAccess message="اجازه مشاهده فاکتورهای فروش را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "فاکتور یافت نشد."}</p>
          <Link href="/sales-invoices" className="text-primary hover:underline">بازگشت به فاکتورها ←</Link>
        </div>
      </div>
    );
  }

  const order = invoice.salesOrder;
  const deliveries = invoiceDeliveries(invoice);
  const posted = invoice.status === "POSTED";
  const overdue = isInvoiceOverdue(invoice);
  const openingBalance = invoice.sourceType === "OPENING_BALANCE";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این فاکتور پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${invoice.invoiceNumber ? "font-mono" : ""}`}>{salesInvoiceTitle(invoice)}</h1>
              <StatusBadge label={salesInvoiceStatusLabels[invoice.status]} tone={salesInvoiceStatusTone[invoice.status]} />
              {posted ? <StatusBadge label={salesPaymentStatusLabels[invoice.paymentStatus]} tone={salesPaymentStatusTone[invoice.paymentStatus]} /> : null}
              {overdue ? <StatusBadge label="سررسید گذشته" tone="destructive" /> : null}
              {openingBalance ? <StatusBadge label={salesSourceTypeLabels.OPENING_BALANCE} tone="accent" /> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              فاکتور فروش — {invoice.customerName} — {formatJalali(invoice.invoiceDate)}
            </p>
          </div>
          <StatusActions
            invoice={invoice}
            onUpdated={onUpdated}
            canInvoice={canInvoice}
            staleRecord={staleRecord}
            setStaleRecord={setStaleRecord}
            toasts={{ pushError, pushErrors, pushSuccess }}
          />
        </div>

        {!posted ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این فاکتور پیش‌نویس است؛ هنوز شماره و سررسید ندارد و در مانده حساب مشتری حساب نمی‌شود{canInvoice ? "؛ پس از بررسی، «ثبت فاکتور» را بزنید." : "."}
          </p>
        ) : null}
        {openingBalance ? (
          <p className="rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
            فاکتور مانده افتتاحیه: بدهی تاریخی مشتری است و در آمار فروش حساب نمی‌شود.
          </p>
        ) : null}

        <FormSection title="اطلاعات فاکتور">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <Field label="شماره فاکتور">
              {invoice.invoiceNumber ? <span className="font-mono">{invoice.invoiceNumber}</span> : <span className="text-muted-foreground">پس از ثبت تخصیص می‌یابد</span>}
            </Field>
            <Field label="تاریخ فاکتور">{formatJalali(invoice.invoiceDate)}</Field>
            <Field label="سررسید">
              {invoice.dueDate ? (
                <span className={overdue ? "font-medium text-destructive" : undefined}>{formatJalali(invoice.dueDate)}</span>
              ) : (
                <span className="text-muted-foreground">پس از ثبت</span>
              )}
            </Field>
            <Field label="شرایط پرداخت">
              {invoice.paymentTermName || "نقدی"} <span className="text-xs text-muted-foreground">({invoice.paymentDueDays.toLocaleString("fa-IR")} روز)</span>
            </Field>
            <Field label="مشتری">
              <Link href={`/customers/${invoice.customer.id}`} className="text-primary hover:underline"><bdi>{invoice.customerName}</bdi></Link>{" "}
              <bdi className="font-mono text-xs text-muted-foreground">{invoice.customer.customerNumber}</bdi>
            </Field>
            <Field label="کد اقتصادی">{invoice.customerEconomicCode || "-"}</Field>
            <Field label="سفارش فروش">
              {order ? (
                <>
                  <Link href={`/sales-orders/${order.id}`} className="font-mono text-primary hover:underline">{salesOrderTitle(order)}</Link>{" "}
                  <StatusBadge label={salesInvoicingStatusLabels[order.invoicingStatus]} tone={salesInvoicingStatusTone[order.invoicingStatus]} />
                </>
              ) : (
                "-"
              )}
            </Field>
            <Field label="حواله تحویل">
              {deliveries.length > 0
                ? deliveries.map((delivery, index) => (
                    <span key={delivery.id}>
                      {index > 0 ? "، " : null}
                      <Link href={`/deliveries/${delivery.id}`} className="font-mono text-primary hover:underline">{deliveryTitle(delivery)}</Link>
                    </span>
                  ))
                : "-"}
            </Field>
            <Field label="آدرس صورتحساب" wide>
              {invoice.billingAddressText || "-"}
            </Field>
            <Field label="ثبت‌کنندهٔ پیش‌نویس">{who(invoice.createdByUser, invoice.createdAt)}</Field>
            <Field label="ثبت نهایی">{invoice.postedAt ? who(invoice.postedByUser, invoice.postedAt) : "-"}</Field>
          </dl>
        </FormSection>

        <ItemsSection invoice={invoice} />

        {invoice.note ? (
          <FormSection title="یادداشت">
            <p className="whitespace-pre-wrap text-sm">{invoice.note}</p>
          </FormSection>
        ) : null}

        <HistorySection invoiceId={invoice.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
