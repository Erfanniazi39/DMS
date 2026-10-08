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
import { NoAccess, salesDeliveryStatusLabels, salesDeliveryStatusTone, salesOrderStatusLabels, salesOrderTitle } from "../../sales-orders/shared";
import { FormSection } from "../../sales-orders/_form/FormSection";
import { deliveryStatusLabels, deliveryStatusTone, deliveryTitle, type DeliveryDetail } from "../shared";
import { StatusActions } from "./_sections/StatusActions";
import { ItemsSection } from "./_sections/ItemsSection";
import { HistorySection } from "./_sections/HistorySection";
import { InvoicesSection } from "./_sections/InvoicesSection";
import { ReturnsSection } from "./_sections/ReturnsSection";

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

// Delivery-note detail. «ثبت حواله» (DRAFT → POSTED) lives in the header's
// StatusActions; a DRAFT is edited on /deliveries/:id/edit; printing is
// /deliveries/:id/print.
export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const deliveryId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canDeliver = user?.permissions.includes("sales.deliver") ?? false;
  const canInvoice = user?.permissions.includes("sales.invoice") ?? false;
  const canRequestReturn = user?.permissions.includes("sales.manage") ?? false;

  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const [loadingId, setLoadingId] = useState(deliveryId);
  if (loadingId !== deliveryId) {
    setLoadingId(deliveryId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<DeliveryDetail>(`/deliveries/${deliveryId}`)
      .then((data) => {
        if (!ignore) {
          setDelivery(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات حواله ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [deliveryId, canView]);

  function onUpdated(updated: DeliveryDetail) {
    setDelivery(updated);
    setHistoryKey((current) => current + 1);
  }

  if (!canView) return <NoAccess message="اجازه مشاهده حواله‌های تحویل را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "حواله یافت نشد."}</p>
          <Link href="/deliveries" className="text-primary hover:underline">بازگشت به تحویل‌ها ←</Link>
        </div>
      </div>
    );
  }

  const order = delivery.salesOrder;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این حواله پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${delivery.deliveryNumber ? "font-mono" : ""}`}>{deliveryTitle(delivery)}</h1>
              <StatusBadge label={deliveryStatusLabels[delivery.status]} tone={deliveryStatusTone[delivery.status]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              حواله تحویل — {order.customerName} — {formatJalali(delivery.deliveryDate)}
            </p>
          </div>
          <StatusActions
            delivery={delivery}
            onUpdated={onUpdated}
            canDeliver={canDeliver}
            staleRecord={staleRecord}
            setStaleRecord={setStaleRecord}
            toasts={{ pushError, pushErrors, pushSuccess }}
          />
        </div>

        {delivery.status === "DRAFT" ? (
          order.status !== "CONFIRMED" ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
              سفارش این حواله «{salesOrderStatusLabels[order.status]}» است و دیگر حواله‌ای برای آن ثبت نمی‌شود؛ این پیش‌نویس را می‌توانید حذف کنید.
            </p>
          ) : (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
              این حواله پیش‌نویس است؛ هنوز شماره ندارد و کالایی از انبار خارج نشده است{canDeliver ? "؛ پس از تحویل کالا، «ثبت حواله» را بزنید." : "."}
            </p>
          )
        ) : null}

        <FormSection title="اطلاعات حواله">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <Field label="شماره حواله">
              {delivery.deliveryNumber ? <span className="font-mono">{delivery.deliveryNumber}</span> : <span className="text-muted-foreground">پس از ثبت تخصیص می‌یابد</span>}
            </Field>
            <Field label="تاریخ تحویل">{formatJalali(delivery.deliveryDate)}</Field>
            <Field label="سفارش فروش">
              <Link href={`/sales-orders/${order.id}`} className="font-mono text-primary hover:underline">{salesOrderTitle(order)}</Link>{" "}
              <StatusBadge label={salesDeliveryStatusLabels[order.deliveryStatus]} tone={salesDeliveryStatusTone[order.deliveryStatus]} />
            </Field>
            <Field label="مشتری">
              <Link href={`/customers/${delivery.customer.id}`} className="text-primary hover:underline"><bdi>{order.customerName}</bdi></Link>{" "}
              <bdi className="font-mono text-xs text-muted-foreground">{delivery.customer.customerNumber}</bdi>
            </Field>
            <Field label="تحویل‌گیرنده">{delivery.receivedByName || "-"}</Field>
            <Field label="راننده / وسیلهٔ نقلیه">{delivery.carrierNote || "-"}</Field>
            <Field label="انبار">{delivery.location.name}</Field>
            <Field label="شماره مرجع مشتری">{order.customerReference || "-"}</Field>
            <Field label="آدرس تحویل" wide>
              {delivery.deliveryAddressText || "-"}
            </Field>
            <Field label="ثبت‌کنندهٔ پیش‌نویس">{who(delivery.createdByUser, delivery.createdAt)}</Field>
            <Field label="ثبت نهایی">{delivery.postedAt ? who(delivery.postedByUser, delivery.postedAt) : "-"}</Field>
          </dl>
        </FormSection>

        <ItemsSection delivery={delivery} />

        {delivery.status === "POSTED" ? <InvoicesSection delivery={delivery} canInvoice={canInvoice} pushError={pushError} /> : null}

        {delivery.status === "POSTED" ? <ReturnsSection delivery={delivery} canRequestReturn={canRequestReturn} /> : null}

        {delivery.note ? (
          <FormSection title="یادداشت">
            <p className="whitespace-pre-wrap text-sm">{delivery.note}</p>
          </FormSection>
        ) : null}

        <HistorySection deliveryId={delivery.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
