"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import {
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
  type DepartmentOption,
  type EmployeeOption,
  type PurchaseDetail,
  type PurchasePaymentStatus,
  type PurchaseRequestOption,
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
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
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

// Used by both /admin/purchases/new and /admin/purchases/[id]/edit — a
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
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestOption[]>([]);

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
          apiFetch<PurchaseRequestOption[]>("/purchase-requests"),
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
        router.push("/admin/suppliers");
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
      purchaseRequestId: form.purchaseRequestId ? Number(form.purchaseRequestId) : undefined,
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
      pushSuccess(props.mode === "edit" ? "خرید با موفقیت ویرایش شد." : "خرید جدید با موفقیت ثبت شد.");
      router.push(`/admin/purchases/${saved.id}`);
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
    <div className="p-4 sm:p-6 lg:p-8 pb-24">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش خرید" : "ثبت خرید جدید"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.mode === "edit" && purchaseNumber ? `شماره خرید: ${purchaseNumber}` : "اطلاعات خرید و اقلام آن را وارد کنید"}
          </p>
        </div>

        <form id="purchase-form" onSubmit={submit} className="space-y-4">
          {/* Section 1 — اطلاعات خرید */}
          <FormSection title="اطلاعات خرید">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-source-type">نوع ثبت</Label>
                <select
                  id="purchase-source-type"
                  className={selectClass}
                  value={form.sourceType}
                  onChange={(event) => update("sourceType", event.target.value as PurchaseSourceType)}
                >
                  {PURCHASE_SOURCE_TYPES.map((sourceType) => (
                    <option key={sourceType} value={sourceType}>
                      {purchaseSourceTypeLabels[sourceType]}
                    </option>
                  ))}
                </select>
                {form.sourceType === "HISTORICAL_IMPORT" ? (
                  <p className="text-xs text-muted-foreground">
                    برای ثبت سوابق کاغذی قدیمی — دپارتمان و کارمند خریدار در صورت نامشخص بودن قابل خالی گذاشتن است.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
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
                      {request.requestNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-date-year">تاریخ خرید</Label>
                <JalaliDateInput idPrefix="purchase-date" value={form.purchaseDate} onChange={(value) => update("purchaseDate", value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="purchase-type">نوع خرید</Label>
                <div className="flex gap-2">
                  <select
                    id="purchase-type"
                    className={`${selectClass} flex-1`}
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
              <div className="flex flex-col gap-2">
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
              <div className="flex flex-col gap-2">
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
              <div className="flex flex-col gap-2">
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
              {props.mode === "edit" ? (
                <div className="flex flex-col gap-2">
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
          </FormSection>

          {/* Section 2 — اقلام خرید */}
          <FormSection title="اقلام خرید" description="نام قلم متن آزاد است و به کاتالوگ اقلام شرکت مرتبط نمی‌شود.">
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[48rem] text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">نام / شرح</th>
                      <th className="w-24 px-3 py-2 font-medium">مقدار</th>
                      <th className="w-32 px-3 py-2 font-medium">واحد</th>
                      <th className="w-32 px-3 py-2 font-medium">قیمت واحد (اختیاری)</th>
                      <th className="w-32 px-3 py-2 font-medium">قیمت کل</th>
                      <th className="w-12 px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {form.items.map((item) => (
                      <tr key={item.key}>
                        <td className="px-3 py-2">
                          <Input
                            aria-label="نام یا شرح قلم"
                            value={item.name}
                            onChange={(event) => updateItem(item.key, { name: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label="مقدار"
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2">
                          <Input
                            aria-label="قیمت واحد (اختیاری)"
                            inputMode="decimal"
                            placeholder="-"
                            value={item.unitPrice}
                            onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label="قیمت کل"
                            inputMode="decimal"
                            value={item.totalPrice}
                            onChange={(event) => updateItem(item.key, { totalPrice: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
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
                      <td className="px-3 py-2" colSpan={4}>جمع کل اقلام</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(itemsTotal)} ریال</td>
                      <td className="px-3 py-2"></td>
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

          {/* Section 3 — پرداخت (فقط نمایش؛ ثبت/حذف پرداخت در صفحه جزئیات خرید انجام می‌شود) */}
          {props.mode === "edit" && paymentSummary ? (
            <FormSection title="پرداخت" description="ثبت و حذف پرداخت‌ها در صفحه جزئیات خرید انجام می‌شود.">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <StatusBadge label={purchasePaymentStatusLabels[paymentSummary.status]} tone={purchasePaymentStatusTone[paymentSummary.status]} />
                  <span className="text-muted-foreground">
                    پرداخت‌شده: <span className="font-medium text-foreground tabular-nums">{formatMoney(paymentSummary.paidAmount)}</span> از{" "}
                    <span className="font-medium text-foreground tabular-nums">{formatMoney(paymentSummary.totalAmount)}</span> ریال
                  </span>
                </div>
                {props.mode === "edit" ? (
                  <Link href={`/admin/purchases/${props.purchaseId}`} className="text-sm text-primary hover:underline">
                    ثبت/مشاهده پرداخت‌ها ←
                  </Link>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* Section 4 — یادداشت */}
          <FormSection title="یادداشت">
            <textarea
              id="purchase-note"
              className={`${textareaClass} w-full`}
              value={form.note}
              onChange={(event) => update("note", event.target.value)}
              placeholder="یادداشت یا توضیحات تکمیلی (اختیاری)"
            />
          </FormSection>
        </form>

        {/* Footer actions — a thin bordered bar rather than large buttons,
            with the primary action first (RTL: leftmost) and clearly the
            more prominent of the two without being oversized. */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <Button type="submit" form="purchase-form" disabled={saving}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ثبت خرید"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            انصراف
          </Button>
        </div>
      </div>

      <Dialog open={typeDialogOpen} onOpenChange={(open) => setTypeDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن نوع خرید جدید</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="purchase-type-form" className="grid gap-4" onSubmit={submitPurchaseType}>
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
