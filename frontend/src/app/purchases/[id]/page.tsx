"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  StatusBadge,
  documentTypeLabels,
  employeeFullName,
  formatMoney,
  paymentMethodLabels,
  paymentRecordStatusLabels,
  paymentRecordStatusTone,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseSourceTypeLabels,
  purchaseSourceTypeTone,
  purchaseStatusLabels,
  purchaseStatusTone,
  selectClass,
  textareaClass,
  type DocumentType,
  type PaymentMethod,
  type PaymentRecordStatus,
  type PurchaseDetail,
  type PurchaseReturnRow,
} from "../shared";

// Section chrome matching PurchaseForm.tsx's local FormSection — a plain
// bordered surface with a small header, not a heavy decorative Card. Kept
// local to this page (rather than added to ./shared) so it never affects
// any other module's look; `action` is for a section-level button such as
// "افزودن پرداخت" placed at the end of the header row.
function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

type PaymentFormState = {
  paymentDate: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string;
  status: PaymentRecordStatus;
  note: string;
};

const emptyPaymentForm: PaymentFormState = {
  paymentDate: "",
  amount: "",
  method: "CASH",
  referenceNumber: "",
  status: "PENDING",
  note: "",
};

type DocumentFormState = {
  documentType: DocumentType;
  documentNumber: string;
  date: string;
  note: string;
};

const emptyDocumentForm: DocumentFormState = {
  documentType: "INVOICE",
  documentNumber: "",
  date: "",
  note: "",
};

// Return to Vendor dialog — one header (date/reason/note) plus one or more
// lines, each pointing at one of this purchase's own items. creditAmount is
// a plain editable field: suggested from quantity × the item's unit price
// (same convenience as PurchaseForm's line total), never enforced.
type ReturnLineFormState = {
  key: string;
  purchaseItemId: string;
  quantity: string;
  creditAmount: string;
  note: string;
};

type ReturnFormState = {
  returnDate: string;
  reason: string;
  note: string;
  lines: ReturnLineFormState[];
};

function emptyReturnLine(): ReturnLineFormState {
  return { key: crypto.randomUUID(), purchaseItemId: "", quantity: "", creditAmount: "", note: "" };
}

function emptyReturnForm(): ReturnFormState {
  return { returnDate: "", reason: "", note: "", lines: [emptyReturnLine()] };
}

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const purchaseId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  // Returns (list + create + delete) are all gated on purchases.manage on
  // the backend — the section shows a no-permission note otherwise.
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

  useEffect(() => {
    if (!canView) return;
    void loadPurchase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId, canView]);

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
    if (!canManageReturns) return;
    const run = async () => loadReturns();
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId, canManageReturns]);

  // Quantity already returned per purchase item, summed across every
  // return on this purchase — drives the "قابل برگشت" hint in the dialog.
  // The backend re-checks this authoritatively on submit.
  function returnedQuantityByItem(): Map<number, number> {
    const totals = new Map<number, number>();
    for (const purchaseReturn of returns) {
      for (const line of purchaseReturn.items) {
        totals.set(line.purchaseItemId, (totals.get(line.purchaseItemId) ?? 0) + Number(line.quantity));
      }
    }
    return totals;
  }

  function openReturnDialog() {
    setReturnForm(emptyReturnForm());
    setReturnDialogOpen(true);
  }

  function updateReturnLine(key: string, patch: Partial<ReturnLineFormState>) {
    setReturnForm((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if (("quantity" in patch || "purchaseItemId" in patch) && !("creditAmount" in patch)) {
          const item = purchase?.items.find((candidate) => String(candidate.id) === next.purchaseItemId);
          const quantity = Number(next.quantity);
          const unitPrice = Number(item?.unitPrice);
          if (item?.unitPrice && next.quantity !== "" && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
            next.creditAmount = String(Math.round(quantity * unitPrice));
          }
        }
        return next;
      }),
    }));
  }

  function addReturnLine() {
    setReturnForm((current) => ({ ...current, lines: [...current.lines, emptyReturnLine()] }));
  }

  function removeReturnLine(key: string) {
    setReturnForm((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.key !== key) : current.lines,
    }));
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returnForm.returnDate || !returnForm.reason.trim()) {
      pushError("تاریخ و علت برگشت الزامی است.");
      return;
    }
    if (returnForm.lines.some((line) => !line.purchaseItemId || line.quantity === "" || line.creditAmount === "")) {
      pushError("برای هر ردیف، قلم خرید، مقدار و مبلغ اعتبار را وارد کنید.");
      return;
    }
    setSavingReturn(true);
    try {
      await apiFetch(`/purchases/${purchaseId}/returns`, {
        method: "POST",
        body: JSON.stringify({
          returnDate: returnForm.returnDate,
          reason: returnForm.reason.trim(),
          note: returnForm.note.trim(),
          items: returnForm.lines.map((line) => ({
            purchaseItemId: Number(line.purchaseItemId),
            quantity: Number(line.quantity),
            creditAmount: Number(line.creditAmount),
            note: line.note.trim(),
          })),
        }),
      });
      pushSuccess("برگشت به تأمین‌کننده با موفقیت ثبت شد.");
      setReturnDialogOpen(false);
      await loadReturns();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت برگشت ناموفق بود.");
    } finally {
      setSavingReturn(false);
    }
  }

  async function removeReturn(returnId: number) {
    if (!window.confirm("آیا از حذف این برگشت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/returns/${returnId}`, { method: "DELETE" });
      pushSuccess("برگشت حذف شد.");
      await loadReturns();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف برگشت ناموفق بود.");
    }
  }

  function openPaymentDialog() {
    setPaymentForm(emptyPaymentForm);
    setPaymentDialogOpen(true);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentForm.paymentDate || !paymentForm.amount) {
      pushError("تاریخ و مبلغ پرداخت الزامی است.");
      return;
    }
    setSavingPayment(true);
    try {
      await apiFetch(`/purchases/${purchaseId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          paymentDate: paymentForm.paymentDate,
          amount: Number(paymentForm.amount),
          method: paymentForm.method,
          referenceNumber: paymentForm.referenceNumber.trim(),
          status: paymentForm.status,
          note: paymentForm.note.trim(),
        }),
      });
      pushSuccess("پرداخت با موفقیت ثبت شد.");
      setPaymentDialogOpen(false);
      await loadPurchase();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت پرداخت ناموفق بود.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function removePayment(paymentId: number) {
    if (!window.confirm("آیا از حذف این پرداخت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/payments/${paymentId}`, { method: "DELETE" });
      pushSuccess("پرداخت حذف شد.");
      await loadPurchase();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف پرداخت ناموفق بود.");
    }
  }

  async function removeDocument(documentId: number) {
    if (!window.confirm("آیا از حذف این سند مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/documents/${documentId}`, { method: "DELETE" });
      pushSuccess("سند حذف شد.");
      await loadPurchase();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سند ناموفق بود.");
    }
  }

  function openDocumentDialog() {
    setDocumentForm(emptyDocumentForm);
    setDocumentFile(null);
    setDocumentDialogOpen(true);
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentForm.date) {
      pushError("تاریخ سند الزامی است.");
      return;
    }
    setSavingDocument(true);
    try {
      const created = await apiFetch<{ id: number }>(`/purchases/${purchaseId}/documents`, {
        method: "POST",
        body: JSON.stringify({
          documentType: documentForm.documentType,
          documentNumber: documentForm.documentNumber.trim(),
          date: documentForm.date,
          note: documentForm.note.trim(),
        }),
      });
      if (documentFile) {
        await apiUpload(`/purchases/${purchaseId}/documents/${created.id}/file`, documentFile);
      }
      pushSuccess("سند با موفقیت اضافه شد.");
      setDocumentDialogOpen(false);
      await loadPurchase();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت سند ناموفق بود.");
    } finally {
      setSavingDocument(false);
    }
  }

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

  const remainingAmount = Number(purchase.totalAmount) - Number(purchase.paidAmount);
  // 0 → fully settled (success/green). Negative → paid more than the total,
  // i.e. overpaid (warning/yellow). Positive → still owed (destructive/red,
  // unchanged from before).
  const remainingAmountClass =
    remainingAmount === 0 ? "text-success" : remainingAmount < 0 ? "text-warning" : "text-destructive";

  const returnedByItem = returnedQuantityByItem();
  const totalReturnCredit = returns.reduce(
    (sum, purchaseReturn) => sum + purchaseReturn.items.reduce((lineSum, line) => lineSum + Number(line.creditAmount), 0),
    0,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
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
          <div className="flex items-center gap-2">
            <StatusBadge label={purchasePaymentStatusLabels[purchase.paymentStatus]} tone={purchasePaymentStatusTone[purchase.paymentStatus]} />
            <StatusBadge label={purchaseSourceTypeLabels[purchase.sourceType]} tone={purchaseSourceTypeTone[purchase.sourceType]} />
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

        {/* 3. پرداخت‌ها */}
        <DetailSection
          title="پرداخت‌ها"
          action={
            canManagePayments ? (
              <Button size="sm" onClick={openPaymentDialog}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن پرداخت
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">مبلغ کل</p>
                <p className="mt-1 font-medium tabular-nums">{formatMoney(purchase.totalAmount)} ریال</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مبلغ پرداخت‌شده</p>
                <p className="mt-1 font-medium text-success tabular-nums">{formatMoney(purchase.paidAmount)} ریال</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مبلغ باقی‌مانده</p>
                <p className={`mt-1 font-medium tabular-nums ${remainingAmountClass}`}>{formatMoney(remainingAmount)} ریال</p>
              </div>
            </div>

            {purchase.payments.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                هنوز پرداختی ثبت نشده است.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[40rem] text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">تاریخ</th>
                      <th className="px-3 py-2 font-medium">مبلغ</th>
                      <th className="px-3 py-2 font-medium">روش پرداخت</th>
                      <th className="px-3 py-2 font-medium">شماره مرجع</th>
                      <th className="px-3 py-2 font-medium">وضعیت</th>
                      <th className="px-3 py-2 font-medium">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {purchase.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-3 py-2 text-muted-foreground">{formatJalali(payment.paymentDate)}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(payment.amount)} ریال</td>
                        <td className="px-3 py-2 text-muted-foreground">{paymentMethodLabels[payment.method]}</td>
                        <td className="px-3 py-2 text-muted-foreground">{payment.referenceNumber || "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge label={paymentRecordStatusLabels[payment.status]} tone={paymentRecordStatusTone[payment.status]} />
                        </td>
                        <td className="px-3 py-2">
                          {canManagePayments ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removePayment(payment.id)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              حذف
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DetailSection>

        {/* 4. اسناد */}
        <DetailSection
          title="اسناد"
          action={
            canUploadDocuments ? (
              <Button size="sm" onClick={openDocumentDialog}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن سند
              </Button>
            ) : undefined
          }
        >
          {purchase.documents.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              هنوز سندی اضافه نشده است.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[40rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">نوع سند</th>
                    <th className="px-3 py-2 font-medium">شماره سند</th>
                    <th className="px-3 py-2 font-medium">تاریخ</th>
                    <th className="px-3 py-2 font-medium">یادداشت</th>
                    <th className="px-3 py-2 font-medium">فایل</th>
                    <th className="px-3 py-2 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {purchase.documents.map((document) => (
                    <tr key={document.id}>
                      <td className="px-3 py-2">{documentTypeLabels[document.documentType]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{document.documentNumber || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatJalali(document.date)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{document.note || "-"}</td>
                      <td className="px-3 py-2">
                        {document.filePath ? (
                          <a href={`/api${document.filePath}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Download className="size-4" aria-hidden="true" />
                            مشاهده
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {canUploadDocuments ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeDocument(document.id)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            حذف
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        {/* 5. بازگشت به تأمین‌کننده */}
        <DetailSection
          title="بازگشت به تأمین‌کننده"
          action={
            canManageReturns ? (
              <Button size="sm" onClick={openReturnDialog}>
                <Plus className="size-4" aria-hidden="true" />
                ثبت برگشت
              </Button>
            ) : undefined
          }
        >
          {!canManageReturns ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              اجازه دسترسی به برگشت‌های این خرید را ندارید.
            </p>
          ) : returnsLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : returnsError ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/40 p-6 text-center">
              <p className="text-sm text-destructive" role="alert">{returnsError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadReturns()}>
                تلاش مجدد
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                برگشت‌ها فقط سابقه کالای برگشتی و مبلغ اعتبار آن را ثبت می‌کنند و مبلغ کل، مبلغ پرداخت‌شده و وضعیت پرداخت خرید را تغییر نمی‌دهند.
                {returns.length > 0 ? " خریدی که برگشت دارد تا زمان حذف برگشت‌ها قابل ویرایش نیست." : null}
              </p>
              {returns.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  هنوز برگشتی ثبت نشده است.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[44rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">شماره برگشت</th>
                        <th className="px-3 py-2 font-medium">تاریخ</th>
                        <th className="px-3 py-2 font-medium">اقلام برگشتی</th>
                        <th className="px-3 py-2 font-medium">مبلغ اعتبار</th>
                        <th className="px-3 py-2 font-medium">علت</th>
                        <th className="px-3 py-2 font-medium">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {returns.map((purchaseReturn) => (
                        <tr key={purchaseReturn.id} className="align-top">
                          <td className="px-3 py-2 font-mono">{purchaseReturn.returnNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground">{formatJalali(purchaseReturn.returnDate)}</td>
                          <td className="px-3 py-2">
                            <ul className="space-y-0.5">
                              {purchaseReturn.items.map((line) => (
                                <li key={line.id}>
                                  {line.purchaseItem.name}
                                  <span className="text-muted-foreground tabular-nums">
                                    {" "}— {formatMoney(line.quantity)} {line.purchaseItem.unit.nameFa}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatMoney(purchaseReturn.items.reduce((sum, line) => sum + Number(line.creditAmount), 0))} ریال
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {purchaseReturn.reason}
                            {purchaseReturn.note ? <span className="block text-xs">{purchaseReturn.note}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeReturn(purchaseReturn.id)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              حذف
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/30 font-medium">
                        <td className="px-3 py-2" colSpan={3}>جمع اعتبار برگشت‌ها</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(totalReturnCredit)} ریال</td>
                        <td className="px-3 py-2" colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </DetailSection>

        {/* 6. یادداشت */}
        <DetailSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{purchase.note || <span className="text-muted-foreground">-</span>}</p>
        </DetailSection>

        {/* یک بخش «تاریخچه تغییرات» می‌تواند در آینده اینجا اضافه شود، بدون
            نیاز به تغییر ساختار بخش‌های بالا. */}
      </div>

      <Dialog open={paymentDialogOpen} onOpenChange={(open) => setPaymentDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن پرداخت</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="payment-form" className="grid gap-4" onSubmit={submitPayment} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-date-year">تاریخ</Label>
                <JalaliDateInput
                  idPrefix="payment-date"
                  value={paymentForm.paymentDate}
                  onChange={(value) => setPaymentForm((current) => ({ ...current, paymentDate: value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-amount">مبلغ (ریال)</Label>
                <Input
                  id="payment-amount"
                  inputMode="decimal"
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-method">روش پرداخت</Label>
                <select
                  id="payment-method"
                  className={selectClass}
                  value={paymentForm.method}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value as PaymentMethod }))}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-reference">شماره مرجع</Label>
                <Input
                  id="payment-reference"
                  value={paymentForm.referenceNumber}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, referenceNumber: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-status">وضعیت</Label>
                <select
                  id="payment-status"
                  className={selectClass}
                  value={paymentForm.status}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, status: event.target.value as PaymentRecordStatus }))}
                >
                  {PAYMENT_RECORD_STATUSES.map((status) => (
                    <option key={status} value={status}>{paymentRecordStatusLabels[status]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-note">یادداشت</Label>
                <textarea
                  id="payment-note"
                  className={textareaClass}
                  value={paymentForm.note}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="payment-form" disabled={savingPayment}>
              {savingPayment ? "در حال ذخیره..." : "ثبت پرداخت"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnDialogOpen} onOpenChange={(open) => setReturnDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت برگشت به تأمین‌کننده</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="return-form" className="grid gap-4" onSubmit={submitReturn} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="return-date-year">تاریخ برگشت</Label>
                  <JalaliDateInput
                    idPrefix="return-date"
                    value={returnForm.returnDate}
                    onChange={(value) => setReturnForm((current) => ({ ...current, returnDate: value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="return-reason">علت برگشت</Label>
                  <Input
                    id="return-reason"
                    value={returnForm.reason}
                    onChange={(event) => setReturnForm((current) => ({ ...current, reason: event.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>اقلام برگشتی</Label>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[40rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">قلم خرید</th>
                        <th className="w-28 px-3 py-2 font-medium">مقدار برگشتی</th>
                        <th className="w-32 px-3 py-2 font-medium">مبلغ اعتبار (ریال)</th>
                        <th className="px-3 py-2 font-medium">یادداشت</th>
                        <th className="w-12 px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {returnForm.lines.map((line) => {
                        const item = purchase.items.find((candidate) => String(candidate.id) === line.purchaseItemId);
                        const returnable = item ? Number(item.quantity) - (returnedByItem.get(item.id) ?? 0) : null;
                        return (
                          <tr key={line.key} className="align-top">
                            <td className="px-3 py-2">
                              <select
                                aria-label="قلم خرید"
                                className={`${selectClass} w-full`}
                                value={line.purchaseItemId}
                                onChange={(event) => updateReturnLine(line.key, { purchaseItemId: event.target.value })}
                              >
                                <option value="">-</option>
                                {purchase.items.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name} ({formatMoney(candidate.quantity)} {candidate.unit.nameFa})
                                  </option>
                                ))}
                              </select>
                              {item && returnable !== null ? (
                                <p className={`mt-1 text-xs tabular-nums ${returnable > 0 ? "text-muted-foreground" : "text-destructive"}`}>
                                  قابل برگشت: {formatMoney(returnable)} {item.unit.nameFa}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="مقدار برگشتی"
                                inputMode="decimal"
                                value={line.quantity}
                                onChange={(event) => updateReturnLine(line.key, { quantity: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="مبلغ اعتبار"
                                inputMode="decimal"
                                value={line.creditAmount}
                                onChange={(event) => updateReturnLine(line.key, { creditAmount: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="یادداشت ردیف"
                                value={line.note}
                                onChange={(event) => updateReturnLine(line.key, { note: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="حذف ردیف"
                                onClick={() => removeReturnLine(line.key)}
                                disabled={returnForm.lines.length === 1}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addReturnLine}>
                  <Plus className="size-4" aria-hidden="true" />
                  افزودن ردیف
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="return-note">یادداشت</Label>
                <textarea
                  id="return-note"
                  className={textareaClass}
                  value={returnForm.note}
                  onChange={(event) => setReturnForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="return-form" disabled={savingReturn}>
              {savingReturn ? "در حال ذخیره..." : "ثبت برگشت"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setReturnDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={documentDialogOpen} onOpenChange={(open) => setDocumentDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن سند</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="document-form" className="grid gap-4" onSubmit={submitDocument} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-type">نوع سند</Label>
                <select
                  id="document-type"
                  className={selectClass}
                  value={documentForm.documentType}
                  onChange={(event) => setDocumentForm((current) => ({ ...current, documentType: event.target.value as DocumentType }))}
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{documentTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-number">شماره سند</Label>
                <Input
                  id="document-number"
                  value={documentForm.documentNumber}
                  onChange={(event) => setDocumentForm((current) => ({ ...current, documentNumber: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-date-year">تاریخ</Label>
                <JalaliDateInput
                  idPrefix="document-date"
                  value={documentForm.date}
                  onChange={(value) => setDocumentForm((current) => ({ ...current, date: value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-note">یادداشت</Label>
                <textarea
                  id="document-note"
                  className={textareaClass}
                  value={documentForm.note}
                  onChange={(event) => setDocumentForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document-file">فایل (اختیاری)</Label>
                <input
                  id="document-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="text-sm"
                  onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="document-form" disabled={savingDocument}>
              {savingDocument ? "در حال ذخیره..." : "ثبت سند"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDocumentDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
