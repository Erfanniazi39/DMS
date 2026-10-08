"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { FormSection } from "../../sales-orders/_form/FormSection";
import {
  customerPaymentDirectionLabels,
  customerPaymentDirectionTone,
  customerPaymentStatusLabels,
  customerPaymentStatusTone,
  customerPaymentTitle,
  NoAccess,
  paymentMethodLabels,
  unappliedAmount,
  type CustomerPaymentDetail,
} from "../shared";
import { StatusActions } from "./_sections/StatusActions";
import { AllocationsSection } from "./_sections/AllocationsSection";
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

// دریافت/پرداخت detail — header info, status-transition buttons
// (StatusActions), allocations table (AllocationsSection) and history.
export default function CustomerPaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const paymentId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("receivables.view") ?? false;
  const canManage = user?.permissions.includes("receivables.manage") ?? false;

  const [payment, setPayment] = useState<CustomerPaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const [loadingId, setLoadingId] = useState(paymentId);
  if (loadingId !== paymentId) {
    setLoadingId(paymentId);
    setLoading(true);
  }

  async function reload() {
    try {
      setPayment(await apiFetch<CustomerPaymentDetail>(`/receivables/payments/${paymentId}`));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات ناموفق بود.");
    }
    setHistoryKey((current) => current + 1);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<CustomerPaymentDetail>(`/receivables/payments/${paymentId}`)
      .then((data) => {
        if (!ignore) {
          setPayment(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [paymentId, canView]);

  function onUpdated(updated: CustomerPaymentDetail) {
    setPayment(updated);
    setHistoryKey((current) => current + 1);
  }

  if (!canView) return <NoAccess message="اجازه مشاهده دریافت‌ها را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "رکورد یافت نشد."}</p>
          <Link href="/receipts" className="text-primary hover:underline">بازگشت به دریافت‌ها ←</Link>
        </div>
      </div>
    );
  }

  const unapplied = unappliedAmount(payment);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این رکورد پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight font-mono">{customerPaymentTitle(payment)}</h1>
              <StatusBadge label={customerPaymentDirectionLabels[payment.direction]} tone={customerPaymentDirectionTone[payment.direction]} />
              <StatusBadge label={customerPaymentStatusLabels[payment.status]} tone={customerPaymentStatusTone[payment.status]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {payment.customer.name} — {formatJalali(payment.paymentDate)}
            </p>
          </div>
          <StatusActions payment={payment} onUpdated={onUpdated} canManage={canManage} staleRecord={staleRecord} setStaleRecord={setStaleRecord} toasts={{ pushError, pushErrors, pushSuccess }} />
        </div>

        <FormSection title="اطلاعات دریافت/پرداخت">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <Field label="مشتری">
              <Link href={`/customers/${payment.customer.id}`} className="text-primary hover:underline"><bdi>{payment.customer.name}</bdi></Link>{" "}
              <bdi className="font-mono text-xs text-muted-foreground">{payment.customer.customerNumber}</bdi>
            </Field>
            <Field label="مبلغ">{formatMoney(payment.amount)} ریال</Field>
            <Field label="روش پرداخت">{paymentMethodLabels[payment.method]}</Field>
            <Field label="شماره مرجع">{payment.referenceNumber || "-"}</Field>
            {payment.method === "CHECK" ? (
              <>
                <Field label="سررسید چک">{payment.chequeDueDate ? formatJalali(payment.chequeDueDate) : "-"}</Field>
                <Field label="بانک">{payment.bankName || "-"}</Field>
              </>
            ) : null}
            <Field label="تخصیص‌نیافته">
              <span className={unapplied > 0 ? "font-medium text-warning" : undefined}>{formatMoney(unapplied)} ریال</span>
            </Field>
            {payment.status === "CANCELLED" ? (
              <>
                <Field label="لغوشده توسط">{who(payment.cancelledByUser, payment.cancelledAt)}</Field>
                <Field label="علت لغو" wide>{payment.cancelReason || "-"}</Field>
              </>
            ) : null}
            <Field label="ثبت توسط">{who(payment.createdByUser, payment.createdAt)}</Field>
            {payment.note ? <Field label="یادداشت" wide>{payment.note}</Field> : null}
          </dl>
        </FormSection>

        <AllocationsSection payment={payment} canManage={canManage} onChanged={reload} toasts={{ pushError, pushErrors, pushSuccess }} />

        <HistorySection paymentId={payment.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
