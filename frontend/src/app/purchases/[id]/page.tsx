"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  StatusBadge,
  employeeFullName,
  formatMoney,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseSourceTypeLabels,
  purchaseSourceTypeTone,
  purchaseStatusLabels,
  purchaseStatusTone,
  type PurchaseDetail,
  type PurchaseReturnRow,
  type PurchaseStatus,
} from "../shared";
import { DetailSection } from "./_sections/DetailSection";
import { StatusActions } from "./_sections/StatusActions";
import { PaymentsSection, emptyPaymentForm, type PaymentFormState } from "./_sections/PaymentsSection";
import { DocumentsSection, emptyDocumentForm, type DocumentFormState } from "./_sections/DocumentsSection";
import { ReturnsSection, emptyReturnForm, type ReturnFormState } from "./_sections/ReturnsSection";

// Page-level state (the loaded purchase, every dialog's open/form/saving
// state, the returns list) lives here and is passed down; the section
// components in ./_sections own the JSX and the handlers for their part of
// the page (status actions, payments, documents, returns).

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const purchaseId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  // Returns: reading needs purchases.view, creating/deleting needs
  // purchases.manage (business decision 2026-10-05).
  const canManageReturns = user?.permissions.includes("purchases.manage") ?? false;
  const canView = user?.permissions.includes("purchases.view") ?? false;
  const canEdit = user?.permissions.includes("purchases.edit") ?? false;
  // Payments (add/delete) are purchases.manage; documents are documents.upload.
  const canManagePayments = canManageReturns;
  const canUploadDocuments = user?.permissions.includes("documents.upload") ?? false;

  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  // null = adding a new payment; otherwise the payment being edited in place
  // (PATCH /purchases/:id/payments/:paymentId).
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(emptyDocumentForm);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [savingDocument, setSavingDocument] = useState(false);

  const [returns, setReturns] = useState<PurchaseReturnRow[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(true);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnForm, setReturnForm] = useState<ReturnFormState>(emptyReturnForm);
  const [savingReturn, setSavingReturn] = useState(false);

  // The status the purchase is currently being moved to (one action at a
  // time), and whether the backend answered RECORD_MODIFIED — the status
  // actions stay disabled until the page is reloaded (same convention as
  // the Purchase Request detail page).
  const [changingStatusTo, setChangingStatusTo] = useState<PurchaseStatus | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  // Explicit reload after an action on this page (shows the loading state).
  async function loadPurchase() {
    setLoading(true);
    try {
      setPurchase(await apiFetch<PurchaseDetail>(`/purchases/${purchaseId}`));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات خرید ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  // Navigating to a different purchase shows the loading state again —
  // adjusted during render rather than set inside the effect. (`loading`
  // already starts as true on first mount.)
  const [loadingPurchaseId, setLoadingPurchaseId] = useState(purchaseId);
  if (loadingPurchaseId !== purchaseId) {
    setLoadingPurchaseId(purchaseId);
    setLoading(true);
  }

  // Initial load / route change. State is only set from the request's own
  // callbacks (React's fetch-in-effect pattern), and a response that
  // arrives after the purchase id changed is ignored.
  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<PurchaseDetail>(`/purchases/${purchaseId}`)
      .then((data) => {
        if (!ignore) setPurchase(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) pushError((reason as ApiError).message ?? "دریافت اطلاعات خرید ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [purchaseId, canView, pushError]);

  async function loadReturns() {
    setReturnsLoading(true);
    setReturnsError(null);
    try {
      setReturns(await apiFetch<PurchaseReturnRow[]>(`/purchases/${purchaseId}/returns`));
    } catch (reason) {
      setReturnsError((reason as ApiError).message ?? "دریافت برگشت‌ها ناموفق بود.");
    } finally {
      setReturnsLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    const run = async () => loadReturns();
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId, canView]);

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">اجازه دسترسی به خریدها را ندارید.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">خرید یافت نشد.</p>
      </div>
    );
  }

  const toastActions = { pushError, pushErrors, pushSuccess };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این خرید پس از بارگذاری این صفحه توسط کاربر دیگری تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}
        {/* Header — purchase number + status shown prominently but subtly
            (a small badge beside the number, not a banner), payment/source
            badges and the Edit action grouped on the other side. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{purchase.purchaseNumber}</h1>
              <StatusBadge label={purchaseStatusLabels[purchase.status]} tone={purchaseStatusTone[purchase.status]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatJalali(purchase.purchaseDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={purchasePaymentStatusLabels[purchase.paymentStatus]} tone={purchasePaymentStatusTone[purchase.paymentStatus]} />
            <StatusBadge label={purchaseSourceTypeLabels[purchase.sourceType]} tone={purchaseSourceTypeTone[purchase.sourceType]} />
            <StatusActions
              purchase={purchase}
              setPurchase={setPurchase}
              canEdit={canEdit}
              changingStatusTo={changingStatusTo}
              setChangingStatusTo={setChangingStatusTo}
              staleRecord={staleRecord}
              setStaleRecord={setStaleRecord}
              toasts={toastActions}
            />
            {canEdit ? (
              <Button variant="outline" onClick={() => router.push(`/purchases/${purchase.id}/edit`)}>
                ویرایش
              </Button>
            ) : null}
          </div>
        </div>

        {/* 1. اطلاعات خرید */}
        <DetailSection title="اطلاعات خرید">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">شماره خرید</dt>
              <dd className="mt-1 font-mono">{purchase.purchaseNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ خرید</dt>
              <dd className="mt-1">{formatJalali(purchase.purchaseDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">نوع خرید</dt>
              <dd className="mt-1">{purchase.purchaseType.nameFa}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تأمین‌کننده</dt>
              <dd className="mt-1">{purchase.supplier.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">دپارتمان درخواست‌کننده</dt>
              <dd className="mt-1">{purchase.requesterDepartment?.name ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">کارمند خریدار</dt>
              <dd className="mt-1">{purchase.buyerEmployee ? employeeFullName(purchase.buyerEmployee) : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ ثبت</dt>
              <dd className="mt-1">{formatJalali(purchase.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">درخواست خرید مرتبط</dt>
              <dd className="mt-1">
                {purchase.purchaseRequest ? (
                  <Link href={`/purchase-requests/${purchase.purchaseRequest.id}`} className="font-mono text-primary hover:underline">
                    {purchase.purchaseRequest.requestNumber}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">بدون درخواست خرید (ثبت مستقیم)</span>
                )}
              </dd>
            </div>
          </dl>
        </DetailSection>

        {/* 2. اقلام خرید */}
        <DetailSection title="اقلام خرید">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">نام / شرح</th>
                  <th className="px-3 py-2 font-medium">مقدار</th>
                  <th className="px-3 py-2 font-medium">واحد</th>
                  <th className="px-3 py-2 font-medium">قیمت واحد</th>
                  <th className="px-3 py-2 font-medium">قیمت کل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchase.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatMoney(item.quantity)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.unit.nameFa}</td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatMoney(item.unitPrice)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(item.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={4}>جمع کل</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(purchase.totalAmount)} ریال</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </DetailSection>

        <PaymentsSection
          purchaseId={purchaseId}
          purchase={purchase}
          canManagePayments={canManagePayments}
          dialogOpen={paymentDialogOpen}
          setDialogOpen={setPaymentDialogOpen}
          form={paymentForm}
          setForm={setPaymentForm}
          editingPaymentId={editingPaymentId}
          setEditingPaymentId={setEditingPaymentId}
          saving={savingPayment}
          setSaving={setSavingPayment}
          onChanged={loadPurchase}
          toasts={toastActions}
        />

        <DocumentsSection
          purchaseId={purchaseId}
          purchase={purchase}
          canUploadDocuments={canUploadDocuments}
          dialogOpen={documentDialogOpen}
          setDialogOpen={setDocumentDialogOpen}
          form={documentForm}
          setForm={setDocumentForm}
          file={documentFile}
          setFile={setDocumentFile}
          saving={savingDocument}
          setSaving={setSavingDocument}
          onChanged={loadPurchase}
          toasts={toastActions}
        />

        <ReturnsSection
          purchaseId={purchaseId}
          purchase={purchase}
          canManageReturns={canManageReturns}
          returns={returns}
          returnsLoading={returnsLoading}
          returnsError={returnsError}
          loadReturns={loadReturns}
          dialogOpen={returnDialogOpen}
          setDialogOpen={setReturnDialogOpen}
          form={returnForm}
          setForm={setReturnForm}
          saving={savingReturn}
          setSaving={setSavingReturn}
          toasts={toastActions}
        />

        {/* 6. یادداشت */}
        <DetailSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{purchase.note || <span className="text-muted-foreground">-</span>}</p>
        </DetailSection>

        {/* یک بخش «تاریخچه تغییرات» می‌تواند در آینده اینجا اضافه شود، بدون
            نیاز به تغییر ساختار بخش‌های بالا. */}
      </div>
    </div>
  );
}
