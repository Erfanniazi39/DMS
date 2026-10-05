"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { JALALI_MAX_YEAR, formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { useAdminUser } from "@/app/admin/layout";
import {
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  RequiredMark,
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
  type PurchasePaymentRow,
  type PurchaseReturnRow,
  type PurchaseStatus,
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

// COMPLETED by default (business decision 2026-10-05) — only COMPLETED
// payments count toward the paid amount; PENDING is still selectable (e.g.
// a post-dated cheque not yet cleared).
const emptyPaymentForm: PaymentFormState = {
  paymentDate: "",
  amount: "",
  method: "CASH",
  referenceNumber: "",
  status: "COMPLETED",
  note: "",
};

// Which purchase statuses allow recording a payment / a return — mirrors
// the backend (purchase-rules.ts PAYABLE_/RETURNABLE_PURCHASE_STATUSES); the
// backend stays authoritative, this just hides actions that would be refused.
const PAYABLE_STATUSES: PurchaseStatus[] = ["CONFIRMED", "RECEIVED", "CLOSED"];
const RETURNABLE_STATUSES: PurchaseStatus[] = ["RECEIVED", "CLOSED"];

// Status changes on an existing purchase live only here, as one-click
// actions (business-owner request 2026-10-05) — no longer in the edit form.
// One forward step per status; CLOSED/CANCELLED are terminal. The backend
// stays authoritative (returns block any change, optimistic locking, etc.).
type StatusAction = {
  target: PurchaseStatus;
  label: string;
  pendingLabel: string;
  confirmMessage: string;
  successMessage: string;
  errorMessage: string;
  variant: "success" | "default" | "outline" | "destructive";
};

const FORWARD_STATUS_ACTION: Partial<Record<PurchaseStatus, StatusAction>> = {
  DRAFT: {
    target: "CONFIRMED",
    label: "تأیید خرید",
    pendingLabel: "در حال تأیید...",
    confirmMessage: "آیا از تأیید این خرید مطمئن هستید؟",
    successMessage: "خرید تأیید شد.",
    errorMessage: "تأیید خرید ناموفق بود.",
    variant: "success",
  },
  CONFIRMED: {
    target: "RECEIVED",
    label: "ثبت دریافت کالا",
    pendingLabel: "در حال ثبت دریافت...",
    confirmMessage: "آیا دریافت کالای این خرید را تأیید می‌کنید؟",
    successMessage: "دریافت کالا ثبت شد.",
    errorMessage: "ثبت دریافت کالا ناموفق بود.",
    variant: "success",
  },
  RECEIVED: {
    target: "CLOSED",
    label: "بستن خرید",
    pendingLabel: "در حال بستن...",
    confirmMessage: "آیا از بستن این خرید مطمئن هستید؟",
    successMessage: "خرید بسته شد.",
    errorMessage: "بستن خرید ناموفق بود.",
    variant: "default",
  },
};

const CANCEL_STATUS_ACTION: StatusAction = {
  target: "CANCELLED",
  label: "لغو خرید",
  pendingLabel: "در حال لغو...",
  confirmMessage: "آیا از لغو این خرید مطمئن هستید؟",
  successMessage: "خرید لغو شد.",
  errorMessage: "لغو خرید ناموفق بود.",
  variant: "destructive",
};

const CANCELLABLE_STATUSES: PurchaseStatus[] = ["DRAFT", "CONFIRMED", "RECEIVED"];

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

  // PATCH /purchases/:id requires the whole record (updatePurchaseSchema),
  // so — like setRequestStatus() on the Purchase Request detail page — the
  // purchase's own loaded values are sent back unchanged apart from status.
  // updatedAt is the optimistic-locking token from this page's load.
  function statusChangePayload(current: PurchaseDetail, status: PurchaseStatus, confirmOverage: boolean) {
    return {
      purchaseDate: current.purchaseDate.slice(0, 10),
      purchaseTypeId: current.purchaseType.id,
      sourceType: current.sourceType,
      requesterDepartmentId: current.requesterDepartment?.id,
      buyerEmployeeId: current.buyerEmployee?.id,
      supplierId: current.supplier.id,
      purchaseRequestId: current.purchaseRequest?.id,
      note: current.note ?? "",
      items: current.items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity),
        unitId: item.unit.id,
        unitPrice: item.unitPrice === null ? undefined : Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        purchaseRequestItemId: item.purchaseRequestItemId ?? undefined,
      })),
      status,
      updatedAt: current.updatedAt,
      ...(confirmOverage ? { confirmOverage: true } : {}),
    };
  }

  async function changeStatus(action: StatusAction) {
    if (!purchase) return;
    if (!window.confirm(action.confirmMessage)) return;
    setChangingStatusTo(action.target);
    try {
      let confirmOverage = false;
      for (;;) {
        try {
          const updated = await apiFetch<PurchaseDetail>(`/purchases/${purchase.id}`, {
            method: "PATCH",
            body: JSON.stringify(statusChangePayload(purchase, action.target, confirmOverage)),
          });
          setPurchase(updated);
          pushSuccess(action.successMessage);
          return;
        } catch (reason) {
          const apiError = reason as ApiError;
          // The purchase already buys more than its linked request still
          // needs (confirmed when it was saved) — the backend re-checks that
          // on every save, so ask once more, as the edit form does.
          if (apiError.code === "PURCHASE_QUANTITY_EXCEEDS_REQUEST" && !confirmOverage) {
            if (!window.confirm("مقدار این خرید بیش از مقدار باقی‌مانده درخواست خرید مرتبط است. با وجود این ادامه می‌دهید؟")) return;
            confirmOverage = true;
            continue;
          }
          if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
          if (apiError.messages?.length) pushErrors(apiError.messages);
          else pushError(apiError.message ?? action.errorMessage);
          return;
        }
      }
    } finally {
      setChangingStatusTo(null);
    }
  }

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
          const quantity = parseNumberInput(next.quantity);
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
            quantity: parseNumberInput(line.quantity),
            creditAmount: parseNumberInput(line.creditAmount),
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
    setEditingPaymentId(null);
    setPaymentForm(emptyPaymentForm);
    setPaymentDialogOpen(true);
  }

  function openEditPaymentDialog(payment: PurchasePaymentRow) {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      paymentDate: payment.paymentDate.slice(0, 10),
      amount: String(Number(payment.amount)),
      method: payment.method,
      referenceNumber: payment.referenceNumber ?? "",
      status: payment.status,
      note: payment.note ?? "",
    });
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
      await apiFetch(editingPaymentId === null ? `/purchases/${purchaseId}/payments` : `/purchases/${purchaseId}/payments/${editingPaymentId}`, {
        method: editingPaymentId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          paymentDate: paymentForm.paymentDate,
          amount: parseNumberInput(paymentForm.amount),
          method: paymentForm.method,
          referenceNumber: paymentForm.referenceNumber.trim(),
          status: paymentForm.status,
          note: paymentForm.note.trim(),
        }),
      });
      pushSuccess(editingPaymentId === null ? "پرداخت با موفقیت ثبت شد." : "پرداخت با موفقیت ویرایش شد.");
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
    let createdId: number | null = null;
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
      createdId = created.id;
      if (documentFile) {
        await apiUpload(`/purchases/${purchaseId}/documents/${created.id}/file`, documentFile);
      }
      createdId = null;
      pushSuccess("سند با موفقیت اضافه شد.");
      setDocumentDialogOpen(false);
      await loadPurchase();
    } catch (reason) {
      // Same pattern as PurchaseForm.uploadStagedDocuments(): the metadata
      // row was created but its file was rejected — remove it (best effort)
      // so each retry doesn't leave another file-less document behind.
      if (createdId !== null) {
        await apiFetch(`/purchases/${purchaseId}/documents/${createdId}`, { method: "DELETE" }).catch(() => undefined);
      }
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
  // Overpayment is allowed (business decision 2026-10-05) but must be
  // impossible to miss — see the warning banner in the payments section.
  const overpaidAmount = remainingAmount < 0 ? -remainingAmount : 0;
  const canAddPayment = canManagePayments && PAYABLE_STATUSES.includes(purchase.status);
  const canAddReturn = canManageReturns && RETURNABLE_STATUSES.includes(purchase.status);
  // Status actions: purchases.edit (same as "ویرایش"); none on CLOSED/CANCELLED.
  const forwardStatusAction = canEdit ? FORWARD_STATUS_ACTION[purchase.status] : undefined;
  const canCancelPurchase = canEdit && CANCELLABLE_STATUSES.includes(purchase.status);
  const statusActionsDisabled = changingStatusTo !== null || staleRecord;

  const returnedByItem = returnedQuantityByItem();
  const totalReturnCredit = returns.reduce(
    (sum, purchaseReturn) => sum + purchaseReturn.items.reduce((lineSum, line) => lineSum + Number(line.creditAmount), 0),
    0,
  );

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
            {forwardStatusAction ? (
              <Button variant={forwardStatusAction.variant} disabled={statusActionsDisabled} onClick={() => void changeStatus(forwardStatusAction)}>
                {changingStatusTo === forwardStatusAction.target ? forwardStatusAction.pendingLabel : forwardStatusAction.label}
              </Button>
            ) : null}
            {canCancelPurchase ? (
              <Button variant={CANCEL_STATUS_ACTION.variant} disabled={statusActionsDisabled} onClick={() => void changeStatus(CANCEL_STATUS_ACTION)}>
                {changingStatusTo === CANCEL_STATUS_ACTION.target ? CANCEL_STATUS_ACTION.pendingLabel : CANCEL_STATUS_ACTION.label}
              </Button>
            ) : null}
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
            canAddPayment ? (
              <Button size="sm" onClick={openPaymentDialog}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن پرداخت
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-4">
            {canManagePayments && !PAYABLE_STATUSES.includes(purchase.status) ? (
              <p className="text-xs text-muted-foreground">
                ثبت پرداخت فقط برای خرید «تأییدشده»، «دریافت‌شده» یا «بسته‌شده» امکان‌پذیر است.
              </p>
            ) : null}
            {overpaidAmount > 0 ? (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  پرداخت بیش از مبلغ خرید: مجموع پرداخت‌های تکمیل‌شده {formatMoney(overpaidAmount)} ریال بیشتر از مبلغ کل خرید است.
                </span>
              </div>
            ) : null}
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
                <p className={`mt-1 font-medium tabular-nums ${remainingAmountClass}`}>
                  {overpaidAmount > 0 ? `${formatMoney(overpaidAmount)} ریال اضافه پرداخت` : `${formatMoney(remainingAmount)} ریال`}
                </p>
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
                            <div className="flex gap-1">
                              {PAYABLE_STATUSES.includes(purchase.status) ? (
                                <Button size="sm" variant="ghost" onClick={() => openEditPaymentDialog(payment)}>
                                  <Pencil className="size-4" aria-hidden="true" />
                                  ویرایش
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => removePayment(payment.id)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                حذف
                              </Button>
                            </div>
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
            canAddReturn ? (
              <Button size="sm" onClick={openReturnDialog}>
                <Plus className="size-4" aria-hidden="true" />
                ثبت برگشت
              </Button>
            ) : undefined
          }
        >
          {returnsLoading ? (
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
                {canManageReturns && !RETURNABLE_STATUSES.includes(purchase.status) ? " ثبت برگشت فقط برای خرید «دریافت‌شده» یا «بسته‌شده» امکان‌پذیر است." : null}
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
                            {canManageReturns ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => removeReturn(purchaseReturn.id)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                حذف
                              </Button>
                            ) : null}
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
            <DialogTitle>{editingPaymentId === null ? "افزودن پرداخت" : "ویرایش پرداخت"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="payment-form" className="grid gap-4" onSubmit={submitPayment} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-date-year">تاریخ<RequiredMark /></Label>
                {/* Future dates allowed (post-dated cheques) up to the end of
                    the business date range — never capped at this year. */}
                <JalaliDateInput
                  idPrefix="payment-date"
                  value={paymentForm.paymentDate}
                  onChange={(value) => setPaymentForm((current) => ({ ...current, paymentDate: value }))}
                  maxYear={JALALI_MAX_YEAR}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-amount">مبلغ (ریال)<RequiredMark /></Label>
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
              {savingPayment ? "در حال ذخیره..." : editingPaymentId === null ? "ثبت پرداخت" : "ذخیره تغییرات"}
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
                  <Label htmlFor="return-date-year">تاریخ برگشت<RequiredMark /></Label>
                  <JalaliDateInput
                    idPrefix="return-date"
                    value={returnForm.returnDate}
                    onChange={(value) => setReturnForm((current) => ({ ...current, returnDate: value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="return-reason">علت برگشت<RequiredMark /></Label>
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
                        <th className="px-3 py-2 font-medium">قلم خرید<RequiredMark /></th>
                        <th className="w-28 px-3 py-2 font-medium">مقدار برگشتی<RequiredMark /></th>
                        <th className="w-32 px-3 py-2 font-medium">مبلغ اعتبار (ریال)<RequiredMark /></th>
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
                <Label htmlFor="document-date-year">تاریخ<RequiredMark /></Label>
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
                <Label htmlFor="document-file">فایل</Label>
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
