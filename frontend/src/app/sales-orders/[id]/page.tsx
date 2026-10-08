"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PackageX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { employeeFullName } from "@/lib/reference-options";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  formatQuantity,
  salesDeliveryStatusLabels,
  salesDeliveryStatusTone,
  salesInvoicingStatusLabels,
  salesInvoicingStatusTone,
  salesOrderStatusLabels,
  salesOrderStatusTone,
  salesOrderTitle,
  salesPaymentStatusLabels,
  salesPaymentStatusTone,
  type SalesOrderBackorder,
  type SalesOrderDetail,
} from "../shared";
import { FormSection } from "../_form/FormSection";
import { StatusActions } from "./_sections/StatusActions";
import { ItemsSection } from "./_sections/ItemsSection";
import { HistorySection } from "./_sections/HistorySection";
import { DeliveriesSection } from "./_sections/DeliveriesSection";
import { InvoicesSection } from "./_sections/InvoicesSection";

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

// Sales-order detail. All status changes live in the header's StatusActions
// (confirm / submit for approval / approve / reject / cancel / close);
// a DRAFT is edited on /sales-orders/:id/edit. Deliveries (batch 3) are
// listed once the order is confirmed; invoices and returns sections arrive
// with their own batches (none shown until then).
export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canManage = user?.permissions.includes("sales.manage") ?? false;
  const canApprove = user?.permissions.includes("sales.approve") ?? false;
  const canDeliver = user?.permissions.includes("sales.deliver") ?? false;

  const [order, setOrder] = useState<SalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // Shortfalls reported by the last confirm/approve response (not stored on
  // the order — the items table tints unreserved lines persistently).
  const [backorders, setBackorders] = useState<SalesOrderBackorder[]>([]);
  const [historyKey, setHistoryKey] = useState(0);

  const [loadingId, setLoadingId] = useState(orderId);
  if (loadingId !== orderId) {
    setLoadingId(orderId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<SalesOrderDetail>(`/sales-orders/${orderId}`)
      .then((data) => {
        if (!ignore) {
          setOrder(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات سفارش ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [orderId, canView]);

  function onUpdated(updated: SalesOrderDetail, nextBackorders?: SalesOrderBackorder[]) {
    setOrder(updated);
    setBackorders(nextBackorders ?? []);
    setHistoryKey((current) => current + 1);
  }

  if (!canView) return <NoAccess message="اجازه مشاهده سفارش‌های فروش را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "سفارش یافت نشد."}</p>
          <Link href="/sales-orders" className="text-primary hover:underline">بازگشت به فهرست سفارش‌ها ←</Link>
        </div>
      </div>
    );
  }

  const confirmed = order.orderNumber !== null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این سفارش پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${order.orderNumber ? "font-mono" : ""}`}>{salesOrderTitle(order)}</h1>
              <StatusBadge label={salesOrderStatusLabels[order.status]} tone={salesOrderStatusTone[order.status]} />
              {confirmed ? (
                <>
                  <StatusBadge label={salesDeliveryStatusLabels[order.deliveryStatus]} tone={salesDeliveryStatusTone[order.deliveryStatus]} />
                  <StatusBadge label={salesInvoicingStatusLabels[order.invoicingStatus]} tone={salesInvoicingStatusTone[order.invoicingStatus]} />
                  <StatusBadge label={salesPaymentStatusLabels[order.paymentStatus]} tone={salesPaymentStatusTone[order.paymentStatus]} />
                </>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.customerName} — {formatJalali(order.orderDate)}
            </p>
          </div>
          <StatusActions
            order={order}
            onUpdated={onUpdated}
            canManage={canManage}
            canApprove={canApprove}
            staleRecord={staleRecord}
            setStaleRecord={setStaleRecord}
            toasts={{ pushError, pushErrors, pushSuccess }}
          />
        </div>

        {order.status === "DRAFT" ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سفارش پیش‌نویس است؛ هنوز شماره ندارد و موجودی برای آن رزرو نشده است{canManage ? "؛ برای ثبت قطعی، «تأیید سفارش» را بزنید." : "."}
          </p>
        ) : order.status === "PENDING_APPROVAL" ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سفارش در انتظار تأیید کاربر دارای مجوز «تأیید فروش» است{canApprove ? "؛ می‌توانید آن را تأیید یا رد کنید." : "."}
          </p>
        ) : order.status === "CANCELLED" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            این سفارش لغو شده است{order.cancelReason ? ` — علت: ${order.cancelReason}` : ""}.
          </p>
        ) : order.status === "CLOSED" ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
            این سفارش بسته شده است{order.closeReason ? ` — علت: ${order.closeReason}` : ""}.
          </p>
        ) : null}

        {backorders.length > 0 ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <PackageX className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <p className="font-medium">کسری موجودی (پس‌افت) — سفارش تأیید شد، اما موجودی این ردیف‌ها به‌طور کامل رزرو نشد:</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {backorders.map((line) => (
                      <li key={line.lineNo}>
                        ردیف {line.lineNo.toLocaleString("fa-IR")} — {line.itemName}: سفارش {formatQuantity(line.quantity)}، رزرو {formatQuantity(line.reserved)}،{" "}
                        <span className="font-medium text-warning">کسری {formatQuantity(line.shortfall)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button type="button" aria-label="بستن پیام" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setBackorders([])}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        ) : null}

        <FormSection title="اطلاعات سفارش">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <Field label="شماره سفارش">
              {order.orderNumber ? <span className="font-mono">{order.orderNumber}</span> : <span className="text-muted-foreground">پس از تأیید تخصیص می‌یابد</span>}
            </Field>
            <Field label="تاریخ سفارش">{formatJalali(order.orderDate)}</Field>
            <Field label="مشتری">
              <Link href={`/customers/${order.customer.id}`} className="text-primary hover:underline"><bdi>{order.customerName}</bdi></Link>{" "}
              <bdi className="font-mono text-xs text-muted-foreground">{order.customer.customerNumber}</bdi>
            </Field>
            <Field label="کد اقتصادی">{order.customerEconomicCode || "-"}</Field>
            <Field label="شرایط پرداخت">
              {order.paymentTermName ? `${order.paymentTermName} (${order.paymentDueDays.toLocaleString("fa-IR")} روز)` : "تعریف نشده"}
            </Field>
            <Field label="فروشنده">{order.salespersonEmployee ? employeeFullName(order.salespersonEmployee) : "-"}</Field>
            <Field label="شماره مرجع مشتری">{order.customerReference || "-"}</Field>
            <Field label="تاریخ تحویل درخواستی">{order.requestedDeliveryDate ? formatJalali(order.requestedDeliveryDate) : "-"}</Field>
            <Field label="آدرس تحویل" wide>
              {order.deliveryAddressText || "-"}
            </Field>
            <Field label="ثبت‌کننده">{who(order.createdByUser, order.createdAt)}</Field>
            <Field label="تأییدکننده">{who(order.confirmedByUser, order.confirmedAt)}</Field>
            {order.approvedAt ? <Field label="تأیید مدیر">{who(order.approvedByUser, order.approvedAt)}</Field> : null}
            {order.approvalReason ? <Field label="یادداشت تأیید">{order.approvalReason}</Field> : null}
            {order.creditOverrideAt ? (
              <Field label="عبور از سقف اعتبار" wide>
                {who(order.creditOverrideByUser, order.creditOverrideAt)}
                {order.creditOverrideReason ? <span className="text-muted-foreground"> — علت: {order.creditOverrideReason}</span> : null}
              </Field>
            ) : null}
            {order.cancelledAt ? <Field label="لغو">{who(order.cancelledByUser, order.cancelledAt)}</Field> : null}
            {order.closedAt ? <Field label="بستن">{who(order.closedByUser, order.closedAt)}</Field> : null}
          </dl>
        </FormSection>

        <ItemsSection order={order} />

        {confirmed ? <DeliveriesSection order={order} canDeliver={canDeliver} reloadKey={historyKey} /> : null}

        {confirmed ? <InvoicesSection orderId={order.id} reloadKey={historyKey} /> : null}

        {order.customerNote || order.internalNote ? (
          <FormSection title="یادداشت‌ها">
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <Field label="یادداشت برای مشتری">
                <span className="whitespace-pre-wrap">{order.customerNote || "-"}</span>
              </Field>
              <Field label="یادداشت داخلی">
                <span className="whitespace-pre-wrap">{order.internalNote || "-"}</span>
              </Field>
            </dl>
          </FormSection>
        ) : null}

        <HistorySection orderId={order.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
