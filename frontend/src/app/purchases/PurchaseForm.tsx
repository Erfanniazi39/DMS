"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  DOCUMENT_TYPES,
  PURCHASE_SOURCE_TYPES,
  PURCHASE_STATUSES,
  StatusBadge,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseSourceTypeLabels,
  purchaseStatusLabels,
  selectClass,
  textareaClass,
  formatMoney,
  employeeFullName,
  documentTypeLabels,
  purchaseRequestOptionLabel,
  type DepartmentOption,
  type DocumentType,
  type EmployeeOption,
  type PurchaseDetail,
  type PurchasePaymentStatus,
  type PurchaseRequestPickerOption,
  type PurchaseSourceType,
  type PurchaseStatus,
  type PurchaseTypeOption,
  type SupplierOption,
  type UnitOption,
} from "./shared";

// Section chrome shared across the four blocks below — a plain bordered
// surface with a small uppercase label, not a heavy decorative Card. Kept
// local to this form rather than added to ./shared, since it's specific to
// this page's layout.
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

type ItemFormRow = {
  key: string;
  name: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  totalPrice: string;
  // Set when this line was pre-filled from (or, in edit mode, was already
  // linked to) a Purchase Request item — see the "ایجاد خرید"/"خرید
  // باقی‌مانده" actions on the Purchase Request detail page. Empty for a
  // normal, manually-added line.
  purchaseRequestItemId: string;
};

// A file picked on the create form, held locally until the purchase itself
// has been saved (a PurchaseDocument needs a purchase id to attach to — see
// POST /purchases/:id/documents + POST /purchases/:id/documents/:documentId/file,
// the same two-step endpoints the purchase detail page uses). Uploaded right
// after the purchase is created, inside the same submit flow.
type StagedDocument = {
  key: string;
  file: File;
  documentType: DocumentType;
  documentNumber: string;
  state: "pending" | "uploading" | "done" | "failed";
  error?: string;
};

// Mirrors the backend's FileInterceptor limits on
// POST /purchases/:id/documents/:documentId/file (ALLOWED_DOCUMENT_EXTENSIONS,
// 10 MB) — checked up front so a bad file is rejected at pick time, not
// only after the purchase has already been saved.
const ALLOWED_DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function documentFileProblem(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) return `«${file.name}»: فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `«${file.name}»: حجم فایل نباید بیشتر از ۱۰ مگابایت باشد.`;
  return null;
}

const stagedDocumentStateLabels: Record<StagedDocument["state"], string> = {
  pending: "",
  uploading: "در حال بارگذاری...",
  done: "بارگذاری شد",
  failed: "ناموفق",
};

function emptyItemRow(): ItemFormRow {
  return { key: crypto.randomUUID(), name: "", quantity: "", unitId: "", unitPrice: "", totalPrice: "", purchaseRequestItemId: "" };
}

// What the Purchase Request detail page encodes into the ?prefill= query
// param when the user clicks "ایجاد خرید" / "خرید باقی‌مانده" / "ایجاد خرید
// کامل" — reused here to open the *same* Purchase creation form pre-filled,
// rather than building a separate/duplicate purchase workflow.
type PrefillPayload = {
  purchaseRequestId: number;
  items: { name: string; quantity: number; unitId: number; purchaseRequestItemId: number }[];
};

function readPrefill(raw: string | null): PrefillPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PrefillPayload>;
    if (!parsed || typeof parsed.purchaseRequestId !== "number" || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    return parsed as PrefillPayload;
  } catch {
    return null;
  }
}

type FormState = {
  purchaseDate: string;
  purchaseTypeId: string;
  // OPERATIONAL (default) = entered as it happens, and requires a requester
  // department + buyer employee like any normal purchase. HISTORICAL_IMPORT
  // = an old paper record digitized after the fact, where that department
  // or buyer may simply be unknown — never fabricated, just left blank
  // (see PurchasesService / purchase.dto.ts on the backend).
  sourceType: PurchaseSourceType;
  requesterDepartmentId: string;
  buyerEmployeeId: string;
  supplierId: string;
  // Optional link back to the Purchase Request this purchase fulfills —
  // most purchases (urgent/direct/recurring) have none.
  purchaseRequestId: string;
  status: PurchaseStatus;
  note: string;
  items: ItemFormRow[];
};

function emptyForm(): FormState {
  return {
    purchaseDate: "",
    purchaseTypeId: "",
    sourceType: "OPERATIONAL",
    requesterDepartmentId: "",
    buyerEmployeeId: "",
    supplierId: "",
    purchaseRequestId: "",
    status: "DRAFT",
    note: "",
    items: [emptyItemRow()],
  };
}

// Just what Section 3 (Payment) needs to display — the real payment
// records (amounts, methods, add/remove) still live only on the Purchase
// detail page; this form never edits payments, it only reflects their
// already-derived outcome for context while editing the purchase itself.
type PaymentSummary = { status: PurchasePaymentStatus; totalAmount: string; paidAmount: string };

type Props = { mode: "create" } | { mode: "edit"; purchaseId: number };

// Used by both /purchases/new and /purchases/[id]/edit — a
// dedicated full page in both cases, not a modal, per the module spec.
// Status is only shown once a purchase exists (edit mode): a new purchase
// always starts as DRAFT (see PurchasesService.create()), and the status
// lifecycle (CONFIRMED/RECEIVED/CLOSED/CANCELLED) only makes sense to move
// through afterwards.
export function PurchaseForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [loading, setLoading] = useState(props.mode === "edit");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [purchaseNumber, setPurchaseNumber] = useState<string | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);

  const [purchaseTypes, setPurchaseTypes] = useState<PurchaseTypeOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestPickerOption[]>([]);

  const user = useAdminUser();
  // Same permission the detail page's "افزودن سند" action requires
  // (documents.upload on POST /purchases/:id/documents[/...]/file).
  const canUploadDocuments = user?.permissions.includes("documents.upload") ?? false;
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);
  // Set once a create-mode purchase has been saved but one or more staged
  // documents failed to upload afterwards — the form then stays put (so the
  // failure is visible) but locks its submit button, so the purchase can't
  // accidentally be created a second time.
  const [savedWithDocumentFailures, setSavedWithDocumentFailures] = useState<{ id: number; purchaseNumber: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  // Small "add a new purchase type inline" affordance — PurchaseType is
  // still master data seeded from database_plan.txt (see prisma/seed.ts),
  // not a full admin module; this just avoids blocking on that later.
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeForm, setTypeForm] = useState({ code: "", nameFa: "", nameEn: "" });
  const [savingType, setSavingType] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      try {
        const [purchaseTypesData, suppliersData, departmentsData, employeesData, unitsData, purchaseRequestsData] = await Promise.all([
          apiFetch<PurchaseTypeOption[]>("/purchase-types"),
          apiFetch<SupplierOption[]>("/suppliers"),
          apiFetch<DepartmentOption[]>("/departments"),
          apiFetch<EmployeeOption[]>("/employees"),
          apiFetch<UnitOption[]>("/units"),
          apiFetch<PurchaseRequestPickerOption[]>("/purchase-requests"),
        ]);
        setPurchaseTypes(purchaseTypesData);
        setSuppliers(suppliersData.filter((supplier) => supplier.status === "active"));
        setDepartments(departmentsData.filter((department) => department.status === "active"));
        // Kept unfiltered here — the select below filters to active
        // employees itself, but still needs to special-case an edit-mode
        // purchase whose buyer is no longer active (see buyerEmployeeOptions).
        setEmployees(employeesData);
        setUnits(unitsData);
        setPurchaseRequests(purchaseRequestsData);
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات پایه ناموفق بود.");
      }
    }
    void loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill from a Purchase Request item — see "ایجاد خرید"/"خرید
  // باقی‌مانده"/"ایجاد خرید کامل" on the Purchase Request detail page. This
  // reuses the same create form rather than a separate workflow: the
  // requested item(s), quantity (or remaining quantity), unit, and the
  // originating request are filled in, but everything else (supplier,
  // buyer, price, ...) is still entered normally, and quantity stays fully
  // editable before saving.
  useEffect(() => {
    if (props.mode !== "create") return;
    // Read directly from window.location rather than next/navigation's
    // useSearchParams() — this is a one-time, client-only read on mount, and
    // it avoids opting this form (used on a plain client-rendered page) into
    // next/navigation's Suspense-boundary requirement just for this.
    const prefill = readPrefill(new URLSearchParams(window.location.search).get("prefill"));
    if (!prefill) return;
    setForm((current) => ({
      ...current,
      purchaseRequestId: String(prefill.purchaseRequestId),
      items: prefill.items.map((item) => ({
        key: crypto.randomUUID(),
        name: item.name,
        quantity: String(item.quantity),
        unitId: String(item.unitId),
        unitPrice: "",
        totalPrice: "",
        purchaseRequestItemId: String(item.purchaseRequestItemId),
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  useEffect(() => {
    if (props.mode !== "edit") return;
    async function loadPurchase() {
      if (props.mode !== "edit") return;
      setLoading(true);
      try {
        const purchase = await apiFetch<PurchaseDetail>(`/purchases/${props.purchaseId}`);
        setPurchaseNumber(purchase.purchaseNumber);
        setPaymentSummary({ status: purchase.paymentStatus, totalAmount: purchase.totalAmount, paidAmount: purchase.paidAmount });
        setForm({
          purchaseDate: purchase.purchaseDate.slice(0, 10),
          purchaseTypeId: String(purchase.purchaseType.id),
          sourceType: purchase.sourceType,
          requesterDepartmentId: purchase.requesterDepartment ? String(purchase.requesterDepartment.id) : "",
          buyerEmployeeId: purchase.buyerEmployee ? String(purchase.buyerEmployee.id) : "",
          supplierId: String(purchase.supplier.id),
          purchaseRequestId: purchase.purchaseRequest ? String(purchase.purchaseRequest.id) : "",
          status: purchase.status,
          note: purchase.note ?? "",
          items: purchase.items.length
            ? purchase.items.map((item) => ({
                key: crypto.randomUUID(),
                name: item.name,
                quantity: item.quantity,
                unitId: String(item.unit.id),
                unitPrice: item.unitPrice ?? "",
                totalPrice: item.totalPrice,
                // Preserved so re-saving an edited purchase doesn't silently
                // drop its link back to the Purchase Request item it fulfills.
                purchaseRequestItemId: item.purchaseRequestItemId ? String(item.purchaseRequestItemId) : "",
              }))
            : [emptyItemRow()],
        });
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات خرید ناموفق بود.");
      } finally {
        setLoading(false);
      }
    }
    void loadPurchase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === "edit" ? props.purchaseId : null]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // "درخواست خرید مرتبط" only applies to an OPERATIONAL purchase — a
  // HISTORICAL_IMPORT is an old paper record and is never part of the
  // Purchase Request workflow. Switching to historical clears any request
  // already picked, so a now-hidden value is never silently submitted.
  function changeSourceType(sourceType: PurchaseSourceType) {
    setForm((current) => ({
      ...current,
      sourceType,
      purchaseRequestId: sourceType === "OPERATIONAL" ? current.purchaseRequestId : "",
    }));
  }

  function addStagedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted: StagedDocument[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const problem = documentFileProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      accepted.push({ key: crypto.randomUUID(), file, documentType: "INVOICE", documentNumber: "", state: "pending" });
    }
    if (problems.length) pushErrors(problems);
    if (accepted.length) setStagedDocuments((current) => [...current, ...accepted]);
  }

  function updateStagedDocument(key: string, patch: Partial<StagedDocument>) {
    setStagedDocuments((current) => current.map((doc) => (doc.key === key ? { ...doc, ...patch } : doc)));
  }

  function removeStagedDocument(key: string) {
    setStagedDocuments((current) => current.filter((doc) => doc.key !== key));
  }

  // Runs only after the purchase itself was created successfully. Each
  // staged file goes through the same two calls the detail page makes:
  // create the PurchaseDocument record (dated with the purchase date), then
  // attach the file to it. Returns how many failed; never throws — a
  // document failure must not look like the purchase itself failed.
  async function uploadStagedDocuments(purchaseId: number, purchaseDate: string): Promise<number> {
    const queue = stagedDocuments.filter((doc) => doc.state !== "done");
    let failed = 0;
    setUploadProgress({ done: 0, total: queue.length });
    for (const [index, doc] of queue.entries()) {
      updateStagedDocument(doc.key, { state: "uploading", error: undefined });
      let createdId: number | null = null;
      try {
        const created = await apiFetch<{ id: number }>(`/purchases/${purchaseId}/documents`, {
          method: "POST",
          body: JSON.stringify({
            documentType: doc.documentType,
            documentNumber: doc.documentNumber.trim(),
            date: purchaseDate,
          }),
        });
        createdId = created.id;
        await apiUpload(`/purchases/${purchaseId}/documents/${created.id}/file`, doc.file);
        updateStagedDocument(doc.key, { state: "done" });
      } catch (reason) {
        failed += 1;
        updateStagedDocument(doc.key, { state: "failed", error: (reason as ApiError).message ?? "بارگذاری فایل ناموفق بود." });
        // The metadata row was created but its file never arrived — remove
        // it (best effort) so a retry from the detail page doesn't leave a
        // duplicate, file-less document behind.
        if (createdId !== null) {
          await apiFetch(`/purchases/${purchaseId}/documents/${createdId}`, { method: "DELETE" }).catch(() => undefined);
        }
      }
      setUploadProgress({ done: index + 1, total: queue.length });
    }
    setUploadProgress(null);
    return failed;
  }

  function updateItem(key: string, patch: Partial<ItemFormRow>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        // Auto-suggest the line total from quantity × unit price whenever
        // either changes — still a plain, directly-editable field
        // afterwards. The backend never enforces this (Total Price is a
        // stored field, not a derived one), so a user free to override it
        // for a case where the arithmetic doesn't apply.
        if (("quantity" in patch || "unitPrice" in patch) && !("totalPrice" in patch)) {
          const quantity = Number(next.quantity);
          const unitPrice = Number(next.unitPrice);
          if (next.quantity !== "" && next.unitPrice !== "" && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
            next.totalPrice = String(Math.round(quantity * unitPrice));
          }
        }
        return next;
      }),
    }));
  }

  function addItemRow() {
    setForm((current) => ({ ...current, items: [...current.items, emptyItemRow()] }));
  }

  function removeItemRow(key: string) {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.key !== key) : current.items,
    }));
  }

  function openTypeDialog() {
    setTypeForm({ code: "", nameFa: "", nameEn: "" });
    setTypeDialogOpen(true);
  }

  async function submitPurchaseType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typeForm.code.trim() || !typeForm.nameFa.trim() || !typeForm.nameEn.trim()) {
      pushError("کد، نام فارسی و نام انگلیسی نوع خرید الزامی است.");
      return;
    }
    setSavingType(true);
    try {
      const created = await apiFetch<PurchaseTypeOption>("/purchase-types", {
        method: "POST",
        body: JSON.stringify({
          code: typeForm.code.trim(),
          nameFa: typeForm.nameFa.trim(),
          nameEn: typeForm.nameEn.trim(),
        }),
      });
      setPurchaseTypes((current) => [...current, created]);
      update("purchaseTypeId", String(created.id));
      pushSuccess("نوع خرید جدید با موفقیت اضافه شد.");
      setTypeDialogOpen(false);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ثبت نوع خرید ناموفق بود.");
      }
    } finally {
      setSavingType(false);
    }
  }

  const itemsTotal = useMemo(
    () => form.items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0),
    [form.items],
  );

  // Active employees, plus — in edit mode — the purchase's current buyer
  // even if that employee has since become inactive, so the select never
  // silently shows a blank/mismatched value for an existing purchase.
  const buyerEmployeeOptions = useMemo(() => {
    const active = employees.filter((employee) => employee.status === "active");
    const current = employees.find((employee) => String(employee.id) === form.buyerEmployeeId);
    if (current && current.status !== "active" && !active.some((employee) => employee.id === current.id)) {
      return [...active, current];
    }
    return active;
  }, [employees, form.buyerEmployeeId]);

  const employeeStatusLabels: Record<EmployeeOption["status"], string> = {
    active: "فعال",
    on_leave: "مرخصی",
    terminated: "پایان‌همکاری",
  };

  function handleSupplierChange(value: string) {
    if (value === "__new__") {
      if (
        window.confirm(
          "برای افزودن تأمین‌کننده جدید به صفحه تأمین‌کنندگان منتقل می‌شوید و اطلاعات واردشده در این فرم ذخیره نخواهد شد. ادامه می‌دهید؟",
        )
      ) {
        router.push("/suppliers");
      } else {
        // The <select> is controlled, but the browser already moved its DOM
        // selection to "__new__" before onChange fired. Re-set the same
        // value so React re-renders and snaps it back to the real selection
        // instead of visually sticking on "add new".
        update("supplierId", form.supplierId);
      }
      return;
    }
    update("supplierId", value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savedWithDocumentFailures) return;

    // Requester department and buyer employee are only mandatory for a
    // normal (OPERATIONAL) purchase — a historical import may simply not
    // know them, and the app never fabricates a value to fill the gap
    // (matches purchaseSourceRefine() on the backend).
    if (
      !form.purchaseDate ||
      !form.purchaseTypeId ||
      !form.supplierId ||
      (form.sourceType === "OPERATIONAL" && (!form.requesterDepartmentId || !form.buyerEmployeeId))
    ) {
      pushError(
        form.sourceType === "OPERATIONAL"
          ? "همه فیلدهای اطلاعات خرید الزامی است."
          : "تاریخ خرید، نوع خرید و تأمین‌کننده الزامی است.",
      );
      return;
    }
    const items = form.items.filter((item) => item.name.trim() !== "");
    if (items.length === 0) {
      pushError("حداقل یک قلم کالا را وارد کنید.");
      return;
    }
    for (const item of items) {
      // Unit price is optional (exceptions, lump-sum pricing) — only
      // quantity, unit and total price are required.
      if (!item.unitId || item.quantity === "" || item.totalPrice === "") {
        pushError("مقدار، واحد و قیمت کل همه اقلام باید تکمیل شود.");
        return;
      }
    }

    const payload = {
      purchaseDate: form.purchaseDate,
      purchaseTypeId: Number(form.purchaseTypeId),
      sourceType: form.sourceType,
      requesterDepartmentId: form.requesterDepartmentId ? Number(form.requesterDepartmentId) : undefined,
      buyerEmployeeId: form.buyerEmployeeId ? Number(form.buyerEmployeeId) : undefined,
      supplierId: Number(form.supplierId),
      // Never sent for a HISTORICAL_IMPORT (see changeSourceType()) — belt
      // and braces in case state ever carries one over.
      purchaseRequestId: form.sourceType === "OPERATIONAL" && form.purchaseRequestId ? Number(form.purchaseRequestId) : undefined,
      note: form.note.trim(),
      items: items.map((item) => ({
        name: item.name.trim(),
        quantity: Number(item.quantity),
        unitId: Number(item.unitId),
        unitPrice: item.unitPrice === "" ? undefined : Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        purchaseRequestItemId: item.purchaseRequestItemId === "" ? undefined : Number(item.purchaseRequestItemId),
      })),
      ...(props.mode === "edit" ? { status: form.status } : {}),
    };

    setSaving(true);
    try {
      const saved = await apiFetch<PurchaseDetail>(props.mode === "edit" ? `/purchases/${props.purchaseId}` : "/purchases", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (props.mode === "create" && stagedDocuments.length > 0) {
        const failed = await uploadStagedDocuments(saved.id, form.purchaseDate);
        if (failed > 0) {
          // The purchase is saved — stay on this page so the per-file
          // failure is visible, but lock the form against a second create.
          setSavedWithDocumentFailures({ id: saved.id, purchaseNumber: saved.purchaseNumber });
          pushError(
            `خرید ${saved.purchaseNumber} ذخیره شد اما بارگذاری ${failed.toLocaleString("fa-IR")} سند ناموفق بود — از صفحه جزئیات خرید دوباره تلاش کنید.`,
          );
          return;
        }
      }
      pushSuccess(props.mode === "edit" ? "خرید با موفقیت ویرایش شد." : "خرید جدید با موفقیت ثبت شد.");
      router.push(`/purchases/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره خرید ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {/* Wide container + compact chrome: this is a high-volume data-entry
          screen (hundreds of purchases, many of them historical paper
          records), so the header fields sit 4-per-row on desktop and the
          items table starts within the first screenful. */}
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش خرید" : "ثبت خرید جدید"}</h1>
            <p className="text-sm text-muted-foreground">
              {props.mode === "edit" && purchaseNumber ? `شماره خرید: ${purchaseNumber}` : "اطلاعات خرید و اقلام آن را وارد کنید"}
            </p>
          </div>
          {/* پرداخت — display only; payments are added/removed on the
              purchase detail page. Shown inline in the header row rather
              than as its own section, to save a full block of height. */}
          {props.mode === "edit" && paymentSummary ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge label={purchasePaymentStatusLabels[paymentSummary.status]} tone={purchasePaymentStatusTone[paymentSummary.status]} />
              <span className="text-muted-foreground">
                پرداخت‌شده: <span className="font-medium text-foreground tabular-nums">{formatMoney(paymentSummary.paidAmount)}</span> از{" "}
                <span className="font-medium text-foreground tabular-nums">{formatMoney(paymentSummary.totalAmount)}</span> ریال
              </span>
              <Link href={`/purchases/${props.purchaseId}`} className="text-primary hover:underline">
                ثبت/مشاهده پرداخت‌ها ←
              </Link>
            </div>
          ) : null}
        </div>

        {savedWithDocumentFailures ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            <span>
              خرید <span className="font-medium">{savedWithDocumentFailures.purchaseNumber}</span> ذخیره شد اما بارگذاری برخی اسناد ناموفق بود —
              از صفحه جزئیات خرید دوباره تلاش کنید.
            </span>
            <Link href={`/purchases/${savedWithDocumentFailures.id}`} className="font-medium text-primary hover:underline">
              رفتن به صفحه جزئیات خرید ←
            </Link>
          </div>
        ) : null}

        <form id="purchase-form" onSubmit={submit} className="space-y-3" noValidate>
          {/* Section 1 — اطلاعات خرید */}
          <FormSection title="اطلاعات خرید">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-source-type">نوع ثبت</Label>
                <select
                  id="purchase-source-type"
                  className={selectClass}
                  value={form.sourceType}
                  onChange={(event) => changeSourceType(event.target.value as PurchaseSourceType)}
                >
                  {PURCHASE_SOURCE_TYPES.map((sourceType) => (
                    <option key={sourceType} value={sourceType}>
                      {purchaseSourceTypeLabels[sourceType]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-date-year">تاریخ خرید</Label>
                <JalaliDateInput idPrefix="purchase-date" value={form.purchaseDate} onChange={(value) => update("purchaseDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-type">نوع خرید</Label>
                <div className="flex gap-2">
                  <select
                    id="purchase-type"
                    className={`${selectClass} min-w-0 flex-1`}
                    value={form.purchaseTypeId}
                    onChange={(event) => update("purchaseTypeId", event.target.value)}
                    required
                  >
                    <option value="">انتخاب کنید</option>
                    {purchaseTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.nameFa}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" size="icon" aria-label="افزودن نوع خرید جدید" onClick={openTypeDialog}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-supplier">تأمین‌کننده</Label>
                <select
                  id="purchase-supplier"
                  className={selectClass}
                  value={form.supplierId}
                  onChange={(event) => handleSupplierChange(event.target.value)}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} ({supplier.code})
                    </option>
                  ))}
                  <option value="__new__">+ افزودن تأمین‌کننده جدید...</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-department">
                  دپارتمان درخواست‌کننده{form.sourceType === "HISTORICAL_IMPORT" ? " (اختیاری)" : ""}
                </Label>
                <select
                  id="purchase-department"
                  className={selectClass}
                  value={form.requesterDepartmentId}
                  onChange={(event) => update("requesterDepartmentId", event.target.value)}
                  required={form.sourceType === "OPERATIONAL"}
                >
                  <option value="">{form.sourceType === "HISTORICAL_IMPORT" ? "نامشخص" : "انتخاب کنید"}</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-buyer">
                  کارمند خریدار{form.sourceType === "HISTORICAL_IMPORT" ? " (اختیاری)" : ""}
                </Label>
                <select
                  id="purchase-buyer"
                  className={selectClass}
                  value={form.buyerEmployeeId}
                  onChange={(event) => update("buyerEmployeeId", event.target.value)}
                  required={form.sourceType === "OPERATIONAL"}
                >
                  <option value="">{form.sourceType === "HISTORICAL_IMPORT" ? "نامشخص" : "انتخاب کنید"}</option>
                  {buyerEmployeeOptions.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeFullName(employee)} ({employee.code})
                      {employee.status !== "active" ? ` — ${employeeStatusLabels[employee.status]}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {/* Only for an OPERATIONAL purchase — a HISTORICAL_IMPORT
                  (old paper record) is never part of the Purchase Request
                  workflow. Two columns wide since its labels are long. */}
              {form.sourceType === "OPERATIONAL" ? (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="purchase-request">درخواست خرید مرتبط (اختیاری)</Label>
                  <select
                    id="purchase-request"
                    className={selectClass}
                    value={form.purchaseRequestId}
                    onChange={(event) => update("purchaseRequestId", event.target.value)}
                  >
                    <option value="">بدون درخواست خرید</option>
                    {purchaseRequests.map((request) => (
                      <option key={request.id} value={request.id}>
                        {purchaseRequestOptionLabel(request)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {props.mode === "edit" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="purchase-status">وضعیت خرید</Label>
                  <select
                    id="purchase-status"
                    className={selectClass}
                    value={form.status}
                    onChange={(event) => update("status", event.target.value as PurchaseStatus)}
                  >
                    {PURCHASE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {purchaseStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {form.sourceType === "HISTORICAL_IMPORT" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                برای ثبت سوابق کاغذی قدیمی — دپارتمان و کارمند خریدار در صورت نامشخص بودن قابل خالی گذاشتن است.
              </p>
            ) : null}
          </FormSection>

          {/* Section 2 — اقلام خرید */}
          <FormSection title="اقلام خرید" description="نام قلم متن آزاد است و به کاتالوگ اقلام شرکت مرتبط نمی‌شود.">
            <div className="space-y-2">
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[48rem] text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">نام / شرح</th>
                      <th className="w-28 px-2 py-1.5 font-medium">مقدار</th>
                      <th className="w-36 px-2 py-1.5 font-medium">واحد</th>
                      <th className="w-40 px-2 py-1.5 font-medium">قیمت واحد (اختیاری)</th>
                      <th className="w-40 px-2 py-1.5 font-medium">قیمت کل</th>
                      <th className="w-12 px-2 py-1.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {form.items.map((item) => (
                      <tr key={item.key}>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="نام یا شرح قلم"
                            value={item.name}
                            onChange={(event) => updateItem(item.key, { name: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="مقدار"
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            aria-label="واحد"
                            className={`${selectClass} w-full`}
                            value={item.unitId}
                            onChange={(event) => updateItem(item.key, { unitId: event.target.value })}
                          >
                            <option value="">-</option>
                            {units.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.nameFa}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="قیمت واحد (اختیاری)"
                            inputMode="decimal"
                            placeholder="-"
                            value={item.unitPrice}
                            onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="قیمت کل"
                            inputMode="decimal"
                            value={item.totalPrice}
                            onChange={(event) => updateItem(item.key, { totalPrice: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="حذف قلم"
                            onClick={() => removeItemRow(item.key)}
                            disabled={form.items.length === 1}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-medium">
                      <td className="px-2 py-1.5" colSpan={4}>جمع کل اقلام</td>
                      <td className="px-2 py-1.5 tabular-nums">{formatMoney(itemsTotal)} ریال</td>
                      <td className="px-2 py-1.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItemRow}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن قلم
              </Button>
            </div>
          </FormSection>

          {/* Sections 3 & 4 — یادداشت and (create mode) اسناد side by side
              on desktop, rather than stacked, to save another block of height. */}
          <div className={`grid gap-3 ${props.mode === "create" && canUploadDocuments ? "lg:grid-cols-2" : ""}`}>
            <FormSection title="یادداشت">
              <textarea
                id="purchase-note"
                aria-label="یادداشت"
                className={`${textareaClass} w-full`}
                value={form.note}
                onChange={(event) => update("note", event.target.value)}
                placeholder="یادداشت یا توضیحات تکمیلی (اختیاری)"
              />
            </FormSection>

            {props.mode === "create" && canUploadDocuments ? (
              <FormSection title="اسناد" description="فایل‌ها پس از ثبت خرید بارگذاری می‌شوند (PDF یا تصویر، حداکثر ۱۰ مگابایت).">
                <div className="space-y-2">
                  {stagedDocuments.length > 0 ? (
                    <ul className="divide-y divide-border rounded-md border border-border" aria-label="اسناد انتخاب‌شده">
                      {stagedDocuments.map((doc) => (
                        <li key={doc.key} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                          <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate" title={doc.file.name}>{doc.file.name}</span>
                          <select
                            aria-label={`نوع سند ${doc.file.name}`}
                            className={`${selectClass} h-8 w-32`}
                            value={doc.documentType}
                            disabled={doc.state !== "pending"}
                            onChange={(event) => updateStagedDocument(doc.key, { documentType: event.target.value as DocumentType })}
                          >
                            {DOCUMENT_TYPES.map((type) => (
                              <option key={type} value={type}>{documentTypeLabels[type]}</option>
                            ))}
                          </select>
                          <Input
                            aria-label={`شماره سند ${doc.file.name}`}
                            placeholder="شماره سند"
                            className="h-8 w-28"
                            value={doc.documentNumber}
                            disabled={doc.state !== "pending"}
                            onChange={(event) => updateStagedDocument(doc.key, { documentNumber: event.target.value })}
                          />
                          {doc.state !== "pending" ? (
                            <span
                              className={`text-xs ${doc.state === "failed" ? "text-destructive" : doc.state === "done" ? "text-success" : "text-muted-foreground"}`}
                              title={doc.error}
                            >
                              {stagedDocumentStateLabels[doc.state]}
                              {doc.state === "failed" && doc.error ? `: ${doc.error}` : ""}
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`حذف ${doc.file.name}`}
                              onClick={() => removeStagedDocument(doc.key)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!savedWithDocumentFailures ? (
                    // The native file input's own button/label text follows
                    // the browser's UI language (often English), so it's
                    // visually hidden behind a Persian label-as-button.
                    <label
                      htmlFor="purchase-documents"
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                    >
                      <Paperclip className="size-4" aria-hidden="true" />
                      افزودن فایل سند
                      <input
                        id="purchase-documents"
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg"
                        className="sr-only"
                        onChange={(event) => {
                          addStagedFiles(event.target.files);
                          // Reset so picking the same file again still fires onChange.
                          event.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              </FormSection>
            ) : null}
          </div>
        </form>

        {/* Footer actions — sticky to the bottom of the viewport so saving
            never requires scrolling down past the items first. */}
        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="purchase-form" disabled={saving || savedWithDocumentFailures !== null}>
            {uploadProgress
              ? `در حال بارگذاری اسناد (${uploadProgress.done.toLocaleString("fa-IR")} از ${uploadProgress.total.toLocaleString("fa-IR")})...`
              : saving
                ? "در حال ذخیره..."
                : props.mode === "edit"
                  ? "ذخیره تغییرات"
                  : "ثبت خرید"}
          </Button>
          {savedWithDocumentFailures ? (
            <Button type="button" variant="outline" onClick={() => router.push(`/purchases/${savedWithDocumentFailures.id}`)}>
              رفتن به صفحه جزئیات خرید
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => router.back()}>
              انصراف
            </Button>
          )}
          <span className="ms-auto text-sm text-muted-foreground">
            جمع کل: <span className="font-medium text-foreground tabular-nums">{formatMoney(itemsTotal)}</span> ریال
          </span>
        </div>
      </div>

      <Dialog open={typeDialogOpen} onOpenChange={(open) => setTypeDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن نوع خرید جدید</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="purchase-type-form" className="grid gap-4" onSubmit={submitPurchaseType} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-type-code">کد</Label>
                <Input
                  id="purchase-type-code"
                  value={typeForm.code}
                  onChange={(event) => setTypeForm((current) => ({ ...current, code: event.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-type-name-fa">نام (فارسی)</Label>
                <Input
                  id="purchase-type-name-fa"
                  value={typeForm.nameFa}
                  onChange={(event) => setTypeForm((current) => ({ ...current, nameFa: event.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-type-name-en">نام (انگلیسی)</Label>
                <Input
                  id="purchase-type-name-en"
                  value={typeForm.nameEn}
                  onChange={(event) => setTypeForm((current) => ({ ...current, nameEn: event.target.value }))}
                  required
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="purchase-type-form" disabled={savingType}>
              {savingType ? "در حال ذخیره..." : "افزودن"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setTypeDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
