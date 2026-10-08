"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { deliveryTitle } from "../../deliveries/shared";
import { salesOrderTitle } from "../../sales-orders/shared";
import { FormSection } from "../../sales-orders/_form/FormSection";
import { NoAccess, returnReasonLabels, salesReturnStatusLabels, salesReturnStatusTone, salesReturnTitle, type SalesReturnDetail } from "../shared";
import { StatusActions } from "./_sections/StatusActions";
import { ItemsSection } from "./_sections/ItemsSection";
import { CreditNoteSection } from "./_sections/CreditNoteSection";
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

// مرجوعی detail. Status-transition buttons live in the header's
// StatusActions; credit-note create/post lives in its own section.
export default function SalesReturnDetailPage() {
  const params = useParams<{ id: string }>();
  const salesReturnId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const canApprove = user?.permissions.includes("sales.approve") ?? false;
  const canManage = user?.permissions.includes("sales.manage") ?? false;
  const canDeliver = user?.permissions.includes("sales.deliver") ?? false;
  const canInvoice = user?.permissions.includes("sales.invoice") ?? false;

  const [salesReturn, setSalesReturn] = useState<SalesReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const [loadingId, setLoadingId] = useState(salesReturnId);
  if (loadingId !== salesReturnId) {
    setLoadingId(salesReturnId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<SalesReturnDetail>(`/sales-returns/${salesReturnId}`)
      .then((data) => {
        if (!ignore) {
          setSalesReturn(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات مرجوعی ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [salesReturnId, canView, reloadKey]);

  function onUpdated(updated: SalesReturnDetail) {
    setSalesReturn(updated);
    setHistoryKey((current) => current + 1);
  }
  const reloadSalesReturn = useCallback(() => {
    setReloadKey((current) => current + 1);
    setHistoryKey((current) => current + 1);
  }, []);

  if (!canView) return <NoAccess message="اجازه مشاهده مرجوعی‌ها را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!salesReturn) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "مرجوعی یافت نشد."}</p>
          <Link href="/sales-returns" className="text-primary hover:underline">بازگشت به مرجوعی‌ها ←</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این مرجوعی پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${salesReturn.returnNumber ? "font-mono" : ""}`}>{salesReturnTitle(salesReturn)}</h1>
              <StatusBadge label={salesReturnStatusLabels[salesReturn.status]} tone={salesReturnStatusTone[salesReturn.status]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              مرجوعی فروش — {salesReturn.customer.name} — {formatJalali(salesReturn.requestDate)}
            </p>
          </div>
          <StatusActions
            salesReturn={salesReturn}
            onUpdated={onUpdated}
            canApprove={canApprove}
            canManage={canManage}
            canDeliver={canDeliver}
            staleRecord={staleRecord}
            setStaleRecord={setStaleRecord}
            toasts={{ pushError, pushErrors, pushSuccess }}
          />
        </div>

        <FormSection title="اطلاعات مرجوعی">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <Field label="شماره مرجوعی">
              {salesReturn.returnNumber ? <span className="font-mono">{salesReturn.returnNumber}</span> : <span className="text-muted-foreground">پس از تأیید تخصیص می‌یابد</span>}
            </Field>
            <Field label="تاریخ درخواست">{formatJalali(salesReturn.requestDate)}</Field>
            <Field label="حواله تحویل">
              {salesReturn.delivery ? (
                <Link href={`/deliveries/${salesReturn.delivery.id}`} className="font-mono text-primary hover:underline">{deliveryTitle(salesReturn.delivery)}</Link>
              ) : (
                "-"
              )}
            </Field>
            <Field label="سفارش فروش">
              {salesReturn.salesOrder ? <Link href={`/sales-orders/${salesReturn.salesOrder.id}`} className="font-mono text-primary hover:underline">{salesOrderTitle(salesReturn.salesOrder)}</Link> : "-"}
            </Field>
            <Field label="مشتری">
              <Link href={`/customers/${salesReturn.customer.id}`} className="text-primary hover:underline"><bdi>{salesReturn.customer.name}</bdi></Link>{" "}
              <bdi className="font-mono text-xs text-muted-foreground">{salesReturn.customer.customerNumber}</bdi>
            </Field>
            <Field label="علت مرجوعی">{returnReasonLabels[salesReturn.reason]}</Field>
            <Field label="انبار">{salesReturn.location.name}</Field>
            <Field label="ثبت‌کنندهٔ درخواست">{who(salesReturn.requestedByUser, salesReturn.createdAt)}</Field>
            {salesReturn.approvedAt ? <Field label="تأیید">{who(salesReturn.approvedByUser, salesReturn.approvedAt)}</Field> : null}
            {salesReturn.receivedAt ? <Field label="دریافت کالا">{who(salesReturn.receivedByUser, salesReturn.receivedAt)}</Field> : null}
            {salesReturn.inspectedAt ? <Field label="بازرسی">{who(salesReturn.inspectedByUser, salesReturn.inspectedAt)}</Field> : null}
            {salesReturn.status === "REJECTED" && salesReturn.rejectReason ? <Field label="علت رد" wide>{salesReturn.rejectReason}</Field> : null}
          </dl>
        </FormSection>

        <ItemsSection salesReturn={salesReturn} />

        {salesReturn.status === "INSPECTED" || salesReturn.status === "COMPLETED" ? (
          <CreditNoteSection salesReturn={salesReturn} canInvoice={canInvoice} reloadSalesReturn={reloadSalesReturn} toasts={{ pushError, pushErrors, pushSuccess }} />
        ) : null}

        {salesReturn.note ? (
          <FormSection title="یادداشت">
            <p className="whitespace-pre-wrap text-sm">{salesReturn.note}</p>
          </FormSection>
        ) : null}

        <HistorySection salesReturnId={salesReturn.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
