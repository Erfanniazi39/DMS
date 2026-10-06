"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { todayIso } from "@/lib/format";
import { useAdminUser } from "@/app/admin/layout";
import {
  isLinkablePurchaseRequestStatus,
  type PurchaseRequestDetail,
  type PurchaseRequestStatus,
} from "@/app/purchase-requests/shared";
import {
  PURCHASE_SOURCE_TYPES,
  RequiredMark,
  StatusBadge,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseSourceTypeLabels,
  selectClass,
  textareaClass,
  formatMoney,
  employeeFullName,
  type DepartmentOption,
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
import { FormSection } from "./_form/FormSection";
import { ItemsGrid, emptyItemRow, type ItemFormRow } from "./_form/ItemsGrid";
import { StagedDocuments, type StagedDocument } from "./_form/StagedDocuments";
import { RequestPicker } from "./_form/RequestPicker";

// Sort order for the "درخواست خرید مرتبط" picker — requests it actually
// makes sense to buy against (APPROVED/PARTIALLY_PURCHASED) float to the
// top, then ones still pending a decision (SUBMITTED/DRAFT), then the
// terminal states, which are rarely what someone is looking for here but
// are kept selectable since a purchase may still reference one historically.
const PURCHASE_REQUEST_PICKER_SORT_ORDER: Record<PurchaseRequestStatus, number> = {
  APPROVED: 0,
  PARTIALLY_PURCHASED: 1,
  SUBMITTED: 2,
  DRAFT: 3,
  COMPLETED: 4,
  REJECTED: 5,
  CANCELLED: 6,
};

// One line of the backend's PURCHASE_QUANTITY_EXCEEDS_REQUEST error details.
type RequestOverage = {
  purchaseRequestItemId: number;
  name: string;
  requested: number;
  alreadyPurchased: number;
  remaining: number;
  purchasing: number;
  excess: number;
};


// What the Purchase Request detail page encodes into the ?prefill= query
// param when the user clicks "ایجاد خرید" / "خرید باقی‌مانده" / "ایجاد خرید
// کامل" — reused here to open the *same* Purchase creation form pre-filled,
// rather than building a separate/duplicate purchase workflow.
type PrefillPayload = {
  purchaseRequestId: number;
  items: { name: string; quantity: number; unitId: number; purchaseRequestItemId: number }[];
};

// The page URL's query string, read through useSyncExternalStore so the
// server render (and hydration) see null and the client sees the real value
// right after — no hydration mismatch, no effect. The query string never
// changes while this form is mounted, so there is nothing to subscribe to.
function subscribeToNothing() {
  return () => {};
}
function readLocationSearch() {
  return window.location.search;
}
function readServerLocationSearch() {
  return null;
}

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

// purchaseDate defaults to todayIso() (lib/format.ts) — the common case
// is logging a purchase as it happens, not backdating one. Still a plain
// editable date field afterwards, and HISTORICAL_IMPORT purchases (old
// paper records) are expected to have this changed to the real date.

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
    purchaseDate: todayIso(),
    purchaseTypeId: "",
    sourceType: "OPERATIONAL",
    requesterDepartmentId: "",
    buyerEmployeeId: "",
    supplierId: "",
    purchaseRequestId: "",
    // New purchases are always created CONFIRMED (business decision
    // 2026-10-05) so payments can be recorded straight away. There is no
    // status selector on the create form (business decision 2026-10-06);
    // later progression is the detail page's dedicated status actions.
    status: "CONFIRMED",
    note: "",
    items: [emptyItemRow()],
  };
}

// Comparable snapshot of the form for the unsaved-changes guard. Row keys
// are random per load (crypto.randomUUID()), so they're blanked out.
function formSnapshot(form: FormState) {
  return JSON.stringify({ ...form, items: form.items.map((item) => ({ ...item, key: "" })) });
}

// Drops the purchase's link to a Purchase Request, including every row's
// link to one of its items (a row link without the request link is refused
// by the backend).
function withoutRequestLink(form: FormState): FormState {
  return { ...form, purchaseRequestId: "", items: form.items.map((item) => ({ ...item, purchaseRequestItemId: "" })) };
}

const UNSAVED_CHANGES_MESSAGE = "تغییرات ذخیره‌نشده در این فرم از بین می‌رود. آیا از ترک این صفحه مطمئن هستید؟";

// Just what Section 3 (Payment) needs to display — the real payment
// records (amounts, methods, add/remove) still live only on the Purchase
// detail page; this form never edits payments, it only reflects their
// already-derived outcome for context while editing the purchase itself.
type PaymentSummary = { status: PurchasePaymentStatus; totalAmount: string; paidAmount: string };

type Props = { mode: "create" } | { mode: "edit"; purchaseId: number };

// Used by both /purchases/new and /purchases/[id]/edit — a
// dedicated full page in both cases, not a modal, per the module spec.
// Status is never chosen here: a new purchase is created CONFIRMED, and the
// lifecycle (CONFIRMED → RECEIVED → CLOSED, or CANCELLED) is moved through
// via the dedicated actions on the purchase detail page, never via this form.
export function PurchaseForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [loading, setLoading] = useState(props.mode === "edit");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  // The form as it was before the user touched it (create: blank or
  // prefilled; edit: as loaded) — compared against `form` for the
  // unsaved-changes guard. null until that starting point is known.
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [purchaseNumber, setPurchaseNumber] = useState<string | null>(null);
  // Optimistic locking (edit mode): the purchase's updatedAt as loaded, sent
  // back on save. `staleRecord` = the backend answered RECORD_MODIFIED —
  // someone else saved in between — so saving stays blocked until a reload.
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // Buying more than a linked request line still needs: the backend's
  // PURCHASE_QUANTITY_EXCEEDS_REQUEST details plus the payload to resubmit
  // with confirmOverage once the user explicitly confirms.
  const [pendingOverage, setPendingOverage] = useState<{ overages: RequestOverage[]; payload: Record<string, unknown> } | null>(null);
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
        // A ?prefill= link naming a request that doesn't exist must not leave
        // that id hidden in the form: the picker can't show it (it reads
        // "بدون درخواست خرید") and the save would only fail on it. Drop the
        // link (the prefilled lines stay, as plain unlinked lines) and say
        // so. A request that exists but is no longer linkable (e.g. since
        // REJECTED) is deliberately left alone: the picker still shows it and
        // the backend refuses the save with its explicit #5 message. Create
        // mode only — an edit keeps whatever request it's already linked to.
        if (props.mode === "create") {
          const prefill = readPrefill(new URLSearchParams(window.location.search).get("prefill"));
          if (prefill && !purchaseRequestsData.some((request) => request.id === prefill.purchaseRequestId)) {
            const prefilledId = String(prefill.purchaseRequestId);
            const unlink = (current: FormState) => (current.purchaseRequestId === prefilledId ? withoutRequestLink(current) : current);
            setForm(unlink);
            setBaseline((current) => (current ? unlink(current) : current));
            pushError("درخواست خرید مشخص‌شده در پیوند یافت نشد؛ اقلام بدون اتصال به درخواست خرید درج شدند.");
          } else if (prefill) {
            // Same default as picking the request manually (see
            // applyPurchaseRequestChange()): the linked request's purchase
            // type, read from the list already loaded above. Part of the
            // prefill (baseline too), and only if nothing was chosen yet.
            const linked = purchaseRequestsData.find((request) => request.id === prefill.purchaseRequestId);
            if (linked) {
              const withType = (current: FormState) =>
                current.purchaseRequestId === String(linked.id) && !current.purchaseTypeId ? { ...current, purchaseTypeId: String(linked.purchaseTypeId) } : current;
              setForm(withType);
              setBaseline((current) => (current ? withType(current) : current));
            }
          }
        }
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
  //
  // Read directly from window.location rather than next/navigation's
  // useSearchParams() — this is a one-time, client-only read, and it avoids
  // opting this form (used on a plain client-rendered page) into
  // next/navigation's Suspense-boundary requirement just for this. Applied
  // once, during render (React's "adjusting state when props change"
  // pattern) as soon as the client-side query string is available, instead
  // of in an effect — so there's no extra render with an empty form.
  const locationSearch = useSyncExternalStore(subscribeToNothing, readLocationSearch, readServerLocationSearch);
  const [prefillChecked, setPrefillChecked] = useState(false);
  if (props.mode === "create" && locationSearch !== null && !prefillChecked) {
    setPrefillChecked(true);
    const prefill = readPrefill(new URLSearchParams(locationSearch).get("prefill"));
    const startingForm: FormState = prefill
      ? {
          ...form,
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
        }
      : form;
    if (prefill) setForm(startingForm);
    // A prefilled form isn't "unsaved changes" by itself — only what the
    // user changes after it opened.
    setBaseline(startingForm);
  }

  useEffect(() => {
    if (props.mode !== "edit") return;
    async function loadPurchase() {
      if (props.mode !== "edit") return;
      setLoading(true);
      try {
        const purchase = await apiFetch<PurchaseDetail>(`/purchases/${props.purchaseId}`);
        setPurchaseNumber(purchase.purchaseNumber);
        setLoadedUpdatedAt(purchase.updatedAt);
        setPaymentSummary({ status: purchase.paymentStatus, totalAmount: purchase.totalAmount, paidAmount: purchase.paidAmount });
        const loadedForm: FormState = {
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
        };
        setForm(loadedForm);
        setBaseline(loadedForm);
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

  // Manually picking a request here (as opposed to arriving via the
  // Purchase Request detail page's "ثبت خرید"/"ایجاد خرید" actions, which
  // already pre-fill through the ?prefill= flow above) should have the same
  // effect: fetch that request's remaining items and fill Section 2 with
  // them. A request whose items are all fully purchased already is kept as
  // the link but leaves the items table untouched (nothing left to pull in).
  const [loadingPurchaseRequestItems, setLoadingPurchaseRequestItems] = useState(false);
  // Set while waiting on the inline overwrite-confirmation banner below the
  // picker (rendered in plain JSX, not a portal/modal) — two things were
  // already tried and rejected here: `window.confirm()` freezes the tab
  // while the Select's own popup is still mid-close, so the queued
  // pointer/keyboard events replay once it unblocks, duplicating the
  // selection; and a `Dialog` (Base UI, portal-based) opened from inside the
  // Select's onValueChange collides with the Select's own closing-animation
  // tracking and gets permanently stuck mid-close — its full-viewport
  // wrapper is left mounted with pointer-events enabled, silently
  // swallowing every click on the page afterwards. A plain inline banner has
  // no portal, no modal, and no exit-animation tracking to collide with.
  // The picker + banner JSX lives in ./_form/RequestPicker.tsx (presentational
  // only); this state and the handlers below stay here.
  const [pendingPurchaseRequestId, setPendingPurchaseRequestId] = useState<string | null>(null);
  // Guards against the picker's onValueChange firing more than once for a
  // single selection. Each call stamps its own token; a call only applies
  // what it fetched if it's still the most recent one when the fetch
  // finishes — an outdated call is a no-op instead of layering its result on
  // top of whichever call wins the race.
  const purchaseRequestChangeToken = useRef(0);

  async function applyPurchaseRequestChange(value: string) {
    const token = ++purchaseRequestChangeToken.current;
    setLoadingPurchaseRequestItems(true);
    try {
      const requestDetail = await apiFetch<PurchaseRequestDetail>(`/purchase-requests/${value}`);
      if (purchaseRequestChangeToken.current !== token) return;
      // The request's own purchase type becomes this purchase's default
      // (business decision 2026-10-06) — still freely editable afterwards.
      const purchaseTypeId = String(requestDetail.purchaseType.id);
      const itemsWithRemaining = requestDetail.items.filter((item) => item.remainingQuantity > 0);
      if (itemsWithRemaining.length === 0) {
        pushError("همه اقلام این درخواست خریداری شده است.");
        setForm((current) => ({ ...current, purchaseRequestId: value, purchaseTypeId }));
        return;
      }
      setForm((current) => ({
        ...current,
        purchaseRequestId: value,
        purchaseTypeId,
        items: itemsWithRemaining.map((item) => ({
          key: crypto.randomUUID(),
          name: item.name,
          quantity: String(item.remainingQuantity),
          unitId: String(item.unit.id),
          unitPrice: "",
          totalPrice: "",
          purchaseRequestItemId: String(item.id),
        })),
      }));
    } catch (reason) {
      if (purchaseRequestChangeToken.current === token) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات درخواست خرید ناموفق بود.");
      }
    } finally {
      if (purchaseRequestChangeToken.current === token) setLoadingPurchaseRequestItems(false);
    }
  }

  function handlePurchaseRequestChange(value: string) {
    if (value === form.purchaseRequestId) return;
    if (!value) {
      purchaseRequestChangeToken.current += 1;
      // "بدون درخواست خرید": also drop every row's link to a request item —
      // otherwise the save is refused ("select a purchase request first")
      // even though the user just explicitly chose none.
      setForm((current) => ({
        ...current,
        purchaseRequestId: "",
        items: current.items.map((item) => ({ ...item, purchaseRequestItemId: "" })),
      }));
      return;
    }
    const hasManualContent = form.items.some((item) => item.name.trim() !== "");
    if (hasManualContent) {
      setPendingPurchaseRequestId(value);
      return;
    }
    void applyPurchaseRequestChange(value);
  }

  function confirmPurchaseRequestOverwrite() {
    const value = pendingPurchaseRequestId;
    setPendingPurchaseRequestId(null);
    if (value) void applyPurchaseRequestChange(value);
  }

  function updateStagedDocument(key: string, patch: Partial<StagedDocument>) {
    setStagedDocuments((current) => current.map((doc) => (doc.key === key ? { ...doc, ...patch } : doc)));
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
    () => form.items.reduce((sum, item) => sum + (parseNumberInput(item.totalPrice) || 0), 0),
    [form.items],
  );

  // Unsaved-changes guard: the form differs from where it started, or files
  // are staged for upload. Off once the purchase has been saved (document-
  // failure state) and while the record is stale — that banner already says
  // a reload discards the edits, and they can't be saved anyway.
  const hasUnsavedChanges =
    savedWithDocumentFailures === null &&
    !staleRecord &&
    baseline !== null &&
    (stagedDocuments.length > 0 || formSnapshot(form) !== formSnapshot(baseline));

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    // Full page unloads: reload, closing the tab, typing a URL, external links.
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    // In-app links (sidebar, «ثبت/مشاهده پرداخت‌ها», ...) navigate client-side
    // and never fire beforeunload — intercept same-origin link clicks in the
    // capture phase, before next/link's own handler, and ask first.
    function onLinkClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return; // beforeunload covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [hasUnsavedChanges]);

  function cancelForm() {
    if (hasUnsavedChanges && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
    router.back();
  }

  // Only requests it actually makes sense to buy against — same eligibility
  // rule as canCreatePurchases on the Purchase Request detail page (status
  // APPROVED or PARTIALLY_PURCHASED). A DRAFT/SUBMITTED request isn't
  // approved yet, and REJECTED/CANCELLED/COMPLETED have nothing left to
  // offer — listing them here just invited picking something you then
  // couldn't actually do anything with. The purchase's already-linked
  // request (edit mode) is kept even if it's since moved outside this set,
  // so an existing link never silently disappears from its own picker.
  const purchaseRequestOptions = useMemo(() => {
    const eligible = purchaseRequests.filter((request) => isLinkablePurchaseRequestStatus(request.status));
    const current = purchaseRequests.find((request) => String(request.id) === form.purchaseRequestId);
    if (current && !eligible.some((request) => request.id === current.id)) {
      return [...eligible, current];
    }
    return eligible;
  }, [purchaseRequests, form.purchaseRequestId]);

  const sortedPurchaseRequests = useMemo(
    () =>
      [...purchaseRequestOptions].sort(
        (a, b) => PURCHASE_REQUEST_PICKER_SORT_ORDER[a.status] - PURCHASE_REQUEST_PICKER_SORT_ORDER[b.status],
      ),
    [purchaseRequestOptions],
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

    const payload: Record<string, unknown> = {
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
        quantity: parseNumberInput(item.quantity),
        unitId: Number(item.unitId),
        unitPrice: item.unitPrice === "" ? undefined : parseNumberInput(item.unitPrice),
        totalPrice: parseNumberInput(item.totalPrice),
        purchaseRequestItemId: item.purchaseRequestItemId === "" ? undefined : Number(item.purchaseRequestItemId),
      })),
      // Create: always CONFIRMED (see emptyForm()). Edit: the
      // status as loaded, sent back unchanged — PATCH requires the whole
      // record, but this form no longer changes status (that's the detail
      // page's status actions); updatedAt guarantees it's still current.
      status: form.status,
      ...(props.mode === "edit" ? { updatedAt: loadedUpdatedAt } : {}),
    };

    await savePurchase(payload);
  }

  async function savePurchase(payload: Record<string, unknown>) {
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
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        pushError(apiError.message);
      } else if (apiError.code === "PURCHASE_QUANTITY_EXCEEDS_REQUEST") {
        const overages = (apiError.details as { overages?: RequestOverage[] } | undefined)?.overages ?? [];
        setPendingOverage({ overages, payload });
      } else if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره خرید ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmOverage() {
    const pending = pendingOverage;
    setPendingOverage(null);
    if (pending) void savePurchase({ ...pending.payload, confirmOverage: true });
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

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>
              این خرید پس از باز شدن این فرم توسط کاربر دیگری تغییر کرده است. برای جلوگیری از بازنویسی تغییرات او، ابتدا صفحه را بازخوانی کنید
              (تغییرات واردشده در این فرم از بین می‌رود).
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

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
                <Label htmlFor="purchase-date-year">تاریخ خرید<RequiredMark /></Label>
                <JalaliDateInput idPrefix="purchase-date" value={form.purchaseDate} onChange={(value) => update("purchaseDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="purchase-type">نوع خرید<RequiredMark /></Label>
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
                <Label htmlFor="purchase-supplier">تأمین‌کننده<RequiredMark /></Label>
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
                  دپارتمان درخواست‌کننده{form.sourceType === "OPERATIONAL" ? <RequiredMark /> : null}
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
                  کارمند خریدار{form.sourceType === "OPERATIONAL" ? <RequiredMark /> : null}
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
                <RequestPicker
                  value={form.purchaseRequestId}
                  purchaseRequests={purchaseRequests}
                  sortedPurchaseRequests={sortedPurchaseRequests}
                  loadingItems={loadingPurchaseRequestItems}
                  pendingPurchaseRequestId={pendingPurchaseRequestId}
                  onChange={handlePurchaseRequestChange}
                  onConfirmOverwrite={confirmPurchaseRequestOverwrite}
                  onCancelOverwrite={() => setPendingPurchaseRequestId(null)}
                />
              ) : null}
            </div>
            {form.sourceType === "HISTORICAL_IMPORT" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                برای ثبت سوابق کاغذی قدیمی — دپارتمان و کارمند خریدار در صورت نامشخص بودن قابل خالی گذاشتن است.
              </p>
            ) : null}
          </FormSection>

          {/* Section 2 — اقلام خرید */}
          <ItemsGrid
            items={form.items}
            setItems={(updateItems) => setForm((current) => ({ ...current, items: updateItems(current.items) }))}
            units={units}
            itemsTotal={itemsTotal}
          />

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
                placeholder="یادداشت یا توضیحات تکمیلی"
              />
            </FormSection>

            {props.mode === "create" && canUploadDocuments ? (
              <StagedDocuments
                stagedDocuments={stagedDocuments}
                setStagedDocuments={setStagedDocuments}
                updateStagedDocument={updateStagedDocument}
                savedWithDocumentFailures={savedWithDocumentFailures !== null}
                pushErrors={pushErrors}
              />
            ) : null}
          </div>
        </form>

        {/* Footer actions — sticky to the bottom of the viewport so saving
            never requires scrolling down past the items first. */}
        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="purchase-form" disabled={saving || savedWithDocumentFailures !== null || staleRecord}>
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
            <Button type="button" variant="outline" onClick={cancelForm}>
              انصراف
            </Button>
          )}
          <span className="ms-auto text-sm text-muted-foreground">
            جمع کل: <span className="font-medium text-foreground tabular-nums">{formatMoney(itemsTotal)}</span> ریال
          </span>
        </div>
      </div>

      {/* Self-confirmation for buying more than the request still needs
          (business decision 2026-10-05 — a lightweight confirm, not a
          second approver). */}
      <Dialog open={pendingOverage !== null} onOpenChange={(open) => (open ? undefined : setPendingOverage(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>خرید بیش از مقدار درخواست‌شده</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-sm">مقدار این خرید برای اقلام زیر از مقدار باقی‌ماندهٔ درخواست خرید بیشتر است. آیا ادامه می‌دهید؟</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {pendingOverage?.overages.map((overage) => (
                <li key={overage.purchaseRequestItemId} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                  <span className="font-medium">{overage.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    باقی‌مانده: {formatMoney(overage.remaining)} — این خرید: {formatMoney(overage.purchasing)} — مازاد: {formatMoney(overage.excess)}
                  </span>
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={confirmOverage}>
              بله، خرید مازاد را ثبت کن
            </Button>
            <Button type="button" variant="outline" onClick={() => setPendingOverage(null)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
