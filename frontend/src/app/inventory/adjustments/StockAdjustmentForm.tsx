"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { todayIso } from "@/lib/format";
import {
  INBOUND_ONLY_KINDS,
  OUTBOUND_ONLY_KINDS,
  STOCK_ADJUSTMENT_KINDS,
  STOCK_ADJUSTMENT_REASONS,
  adjustmentTitle,
  stockAdjustmentKindHints,
  stockAdjustmentKindLabels,
  stockAdjustmentNeedsApproval,
  stockAdjustmentReasonLabels,
  stockAdjustmentRequiresReasonCode,
  type InventoryLocation,
  type ItemBatches,
  type ItemOption,
  type StockAdjustmentDetail,
  type StockAdjustmentKind,
  type StockAdjustmentReason,
  type StockBalanceRow,
} from "../shared";
import { FormSection } from "./_form/FormSection";
import { AdjustmentLinesGrid, emptyLineRow, type AdjustmentLineRow, type BatchesState } from "./_form/AdjustmentLinesGrid";

type FormState = {
  kind: StockAdjustmentKind;
  adjustmentDate: string;
  reason: string;
  reasonCode: "" | StockAdjustmentReason;
  note: string;
  lines: AdjustmentLineRow[];
};

function emptyForm(): FormState {
  return { kind: "RECEIPT", adjustmentDate: todayIso(), reason: "", reasonCode: "", note: "", lines: [emptyLineRow()] };
}

type Props = { mode: "create" } | { mode: "edit"; adjustmentId: number };

// Create-mode prefill (?kind=BATCH_CUTOVER&itemId=…, linked from
// /inventory/item-settings when a direct toggle is refused for an item with
// stock). Read once, client-only, without useSearchParams()'s Suspense
// requirement — same approach as sales-returns/SalesReturnRequestForm.tsx.
function subscribeToNothing() {
  return () => {};
}
function readLocationSearch() {
  return window.location.search;
}
function readServerLocationSearch() {
  return null;
}

// Create/edit form for a DRAFT stock adjustment. Saving never touches stock
// — the document only affects inventory once it's posted ("ثبت نهایی") on the
// detail page, which is also where it gets its ADJ-<year>-NNNNNN number.
// Edit uses the same optimistic lock as the Purchases form (updatedAt).
export function StockAdjustmentForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const adjustmentId = props.mode === "edit" ? props.adjustmentId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const locationSearch = useSyncExternalStore(subscribeToNothing, readLocationSearch, readServerLocationSearch);
  const [prefillApplied, setPrefillApplied] = useState(false);
  if (!prefillApplied && locationSearch !== null && props.mode === "create") {
    setPrefillApplied(true);
    const params = new URLSearchParams(locationSearch);
    const kind = params.get("kind");
    const itemId = params.get("itemId");
    if (kind && (STOCK_ADJUSTMENT_KINDS as string[]).includes(kind)) {
      setForm((current) => ({ ...current, kind: kind as StockAdjustmentKind, lines: [emptyLineRow(itemId && /^\d+$/.test(itemId) ? itemId : "")] }));
    }
  }
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [onHandByItem, setOnHandByItem] = useState<Map<number, string> | null>(null);
  // I4: the document's own location (edit) or the default warehouse — batch
  // pickers only offer batches held there.
  const [locationId, setLocationId] = useState<number | null>(null);
  const [batchesByItem, setBatchesByItem] = useState<Map<number, BatchesState>>(new Map());
  const requestedBatchItems = useRef(new Set<number>());
  // True once the location/current-stock lookup settled (either way).
  const [stockContextReady, setStockContextReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Edit mode only.
  const [loaded, setLoaded] = useState<StockAdjustmentDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let detail: StockAdjustmentDetail | null = null;
      try {
        const [options, fetchedDetail] = await Promise.all([
          apiFetch<ItemOption[]>("/inventory/item-options"),
          adjustmentId !== null ? apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustmentId}`) : Promise.resolve(null),
        ]);
        detail = fetchedDetail;
        if (cancelled) return;
        // An item already on a draft may have been deactivated since — keep
        // it selectable so opening and saving doesn't silently drop it.
        const merged = [...options];
        for (const line of detail?.items ?? []) {
          if (!merged.some((option) => option.id === line.itemId)) merged.push(line.item);
        }
        setItemOptions(merged);
        if (detail) {
          setLoaded(detail);
          setForm({
            kind: detail.kind,
            adjustmentDate: detail.adjustmentDate.slice(0, 10),
            reason: detail.reason,
            reasonCode: detail.reasonCode ?? "",
            note: detail.note ?? "",
            lines: detail.items.map((line) => ({
              key: crypto.randomUUID(),
              itemId: String(line.itemId),
              quantity: String(Number(line.quantity)),
              note: line.note ?? "",
              batchMode: line.batchId ? "existing" : line.batchNumber ? "new" : "",
              batchId: line.batchId ? String(line.batchId) : "",
              batchNumber: line.batchNumber ?? "",
              productionDate: line.productionDate?.slice(0, 10) ?? "",
              expiryDate: line.expiryDate?.slice(0, 10) ?? "",
            })),
          });
        }
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Current stock per item (informational column). Failure here just
      // leaves the column as "-" — it never blocks the form.
      try {
        const [locations, balances] = await Promise.all([
          apiFetch<InventoryLocation[]>("/inventory/locations"),
          apiFetch<StockBalanceRow[]>("/inventory/balances"),
        ]);
        if (cancelled) return;
        const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0];
        // An existing draft keeps its own location; a new one uses the default.
        const documentLocationId = detail?.locationId ?? defaultLocation?.id ?? null;
        setLocationId(documentLocationId);
        setOnHandByItem(new Map(balances.filter((row) => row.locationId === documentLocationId).map((row) => [row.itemId, row.onHand])));
      } catch {
        if (!cancelled) setOnHandByItem(null);
      } finally {
        if (!cancelled) setStockContextReady(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [adjustmentId]);

  // I4: load each selected item's batches once (batch picker + the
  // cutover "already tracked" hint). Keyed on the distinct selected item ids;
  // re-keyed when the document's location becomes known.
  const selectedItemIdsKey = useMemo(
    () => [...new Set(form.lines.map((line) => line.itemId).filter((id) => id !== ""))].sort().join(","),
    [form.lines],
  );
  useEffect(() => {
    if (!stockContextReady) return;
    const missing = selectedItemIdsKey
      .split(",")
      .filter((id) => id !== "")
      .map(Number)
      .filter((id) => !requestedBatchItems.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requestedBatchItems.current.add(id);
    let cancelled = false;
    async function loadBatches() {
      setBatchesByItem((current) => new Map([...current, ...missing.map((id) => [id, "loading"] as const)]));
      const query = locationId !== null ? `?locationId=${locationId}` : "";
      const results = await Promise.all(
        missing.map((id) =>
          apiFetch<ItemBatches>(`/inventory/items/${id}/batches${query}`)
            .then((data) => [id, data.batches] as const)
            .catch(() => [id, "error"] as const),
        ),
      );
      if (cancelled) {
        for (const id of missing) requestedBatchItems.current.delete(id);
        return;
      }
      setBatchesByItem((current) => new Map([...current, ...results]));
    }
    void loadBatches();
    return () => {
      cancelled = true;
    };
  }, [selectedItemIdsKey, locationId, stockContextReady]);

  const filledLines = useMemo(() => form.lines.filter((line) => line.itemId !== "" || line.quantity.trim() !== ""), [form.lines]);
  const filledQuantities = useMemo(() => filledLines.map((line) => parseNumberInput(line.quantity)).filter((value) => Number.isFinite(value)), [filledLines]);
  // B10/B11: whether this document needs inventory.approve (the notice under
  // the kind select) and — a separate rule since I4/R6 — whether reasonCode
  // is required (BATCH_CUTOVER needs approval but never a reasonCode). The
  // backend re-checks both authoritatively.
  const needsApproval = useMemo(() => stockAdjustmentNeedsApproval(form.kind, filledQuantities), [form.kind, filledQuantities]);
  const needsReasonCode = useMemo(() => stockAdjustmentRequiresReasonCode(form.kind, filledQuantities), [form.kind, filledQuantities]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Switching into BATCH_CUTOVER: one item per document, every line a new
  // lot. Switching out: typed lot numbers stay as "new batch" lines.
  function changeKind(kind: StockAdjustmentKind) {
    setForm((current) => {
      if (kind === current.kind) return current;
      if (kind === "BATCH_CUTOVER") {
        const itemId = current.lines.find((line) => line.itemId !== "")?.itemId ?? "";
        return { ...current, kind, lines: current.lines.map((line) => ({ ...line, itemId, batchMode: "", batchId: "" })) };
      }
      if (current.kind === "BATCH_CUTOVER") {
        return { ...current, kind, lines: current.lines.map((line) => ({ ...line, batchMode: line.batchNumber.trim() ? "new" : "" })) };
      }
      return { ...current, kind };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side checks are UX only — the backend DTO is authoritative.
    const problems: string[] = [];
    if (!form.adjustmentDate) problems.push("تاریخ سند الزامی است.");
    if (!form.reason.trim()) problems.push("علت ثبت سند الزامی است.");
    if (filledLines.length === 0) problems.push("حداقل یک ردیف کالا را وارد کنید.");
    const inboundOnly = INBOUND_ONLY_KINDS.includes(form.kind);
    const outboundOnly = OUTBOUND_ONLY_KINDS.includes(form.kind);
    const cutover = form.kind === "BATCH_CUTOVER";
    const quantities: number[] = [];
    filledLines.forEach((line, index) => {
      const row = `ردیف ${(index + 1).toLocaleString("fa-IR")}`;
      const quantity = parseNumberInput(line.quantity);
      if (!line.itemId) problems.push(`${row}: کالا را انتخاب کنید.`);
      if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity === 0) problems.push(`${row}: مقدار باید عددی غیر از صفر باشد.`);
      else {
        quantities.push(quantity);
        if (inboundOnly && quantity < 0) problems.push(`${row}: در «${stockAdjustmentKindLabels[form.kind]}» مقدار باید مثبت باشد.`);
        if (outboundOnly && quantity > 0) problems.push(`${row}: در «${stockAdjustmentKindLabels[form.kind]}» مقدار باید منفی باشد.`);
      }
      // I4 batch fields (UX only — the backend validates per item's real tracked state).
      const typesLot = cutover || line.batchMode === "new";
      if (typesLot && !line.batchNumber.trim()) problems.push(`${row}: شماره بچ را وارد کنید.`);
      if (!cutover && line.batchMode === "existing" && !line.batchId) problems.push(`${row}: بچ را انتخاب کنید.`);
      if (!cutover && line.batchMode === "new" && Number.isFinite(quantity) && quantity < 0) problems.push(`${row}: برای کاهش موجودی باید بچ موجود انتخاب شود، نه بچ جدید.`);
      if (typesLot && line.productionDate && line.expiryDate && line.expiryDate < line.productionDate) problems.push(`${row}: تاریخ انقضا نمی‌تواند قبل از تاریخ تولید باشد.`);
    });
    if (cutover && new Set(filledLines.map((line) => line.itemId).filter((id) => id !== "")).size > 1) {
      problems.push("سند «تبدیل به ردیابی بچ» فقط می‌تواند برای یک کالا باشد.");
    }
    if (stockAdjustmentRequiresReasonCode(form.kind, quantities) && !form.reasonCode) problems.push("علت را برای این نوع سند انتخاب کنید.");
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      kind: form.kind,
      adjustmentDate: form.adjustmentDate,
      reason: form.reason.trim(),
      reasonCode: form.reasonCode || undefined,
      note: form.note.trim(),
      items: filledLines.map((line) => {
        const base = { itemId: Number(line.itemId), quantity: parseNumberInput(line.quantity), note: line.note.trim() };
        const typesLot = cutover || line.batchMode === "new";
        if (typesLot) {
          return { ...base, batchNumber: line.batchNumber.trim(), productionDate: line.productionDate || undefined, expiryDate: line.expiryDate || undefined };
        }
        if (line.batchMode === "existing" && line.batchId) return { ...base, batchId: Number(line.batchId) };
        return base;
      }),
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : {}),
    };

    setSaving(true);
    try {
      const saved = await apiFetch<StockAdjustmentDetail>(props.mode === "edit" ? `/inventory/stock-adjustments/${adjustmentId}` : "/inventory/stock-adjustments", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "پیش‌نویس سند ذخیره شد." : "پیش‌نویس سند ایجاد شد. برای اعمال بر موجودی، آن را «ثبت نهایی» کنید.");
      router.push(`/inventory/adjustments/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره سند ناموفق بود.");
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

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm">
          <p className="text-destructive">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            تلاش دوباره
          </Button>
        </div>
      </div>
    );
  }

  // A posted document is immutable — the edit route just explains that.
  if (props.mode === "edit" && loaded && loaded.status !== "DRAFT") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          سند {adjustmentTitle(loaded)} ثبت نهایی شده و قابل ویرایش نیست؛ برای اصلاح، یک سند «اصلاح موجودی» جدید ثبت کنید.{" "}
          <Link href={`/inventory/adjustments/${loaded.id}`} className="text-primary hover:underline">مشاهده سند ←</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس سند موجودی" : "سند موجودی جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded ? adjustmentTitle(loaded) : "سند به‌صورت پیش‌نویس ذخیره می‌شود و فقط پس از «ثبت نهایی» بر موجودی اثر می‌گذارد."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این سند پس از باز شدن این فرم تغییر کرده یا ثبت نهایی شده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="stock-adjustment-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات سند">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adjustment-kind">نوع سند<RequiredMark /></Label>
                <select id="adjustment-kind" className={selectClass} value={form.kind} onChange={(event) => changeKind(event.target.value as StockAdjustmentKind)}>
                  {STOCK_ADJUSTMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{stockAdjustmentKindLabels[kind]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adjustment-date-year">تاریخ سند<RequiredMark /></Label>
                <JalaliDateInput idPrefix="adjustment-date" value={form.adjustmentDate} onChange={(value) => update("adjustmentDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="adjustment-reason">علت<RequiredMark /></Label>
                <Input id="adjustment-reason" value={form.reason} maxLength={500} placeholder="مثلاً: شمارش انبار پایان ماه" onChange={(event) => update("reason", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adjustment-reason-code">
                  کد علت{needsReasonCode ? <RequiredMark /> : null}
                </Label>
                <select
                  id="adjustment-reason-code"
                  className={selectClass}
                  value={form.reasonCode}
                  onChange={(event) => update("reasonCode", event.target.value as FormState["reasonCode"])}
                >
                  <option value="">{needsReasonCode ? "انتخاب کنید" : "بدون کد علت"}</option>
                  {STOCK_ADJUSTMENT_REASONS.map((reasonCode) => (
                    <option key={reasonCode} value={reasonCode}>{stockAdjustmentReasonLabels[reasonCode]}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{stockAdjustmentKindHints[form.kind]}</p>
            {needsApproval ? (
              <p className="mt-1 text-xs text-warning">
                این سند پس از ذخیره باید برای تأیید ارسال شود (inventory.approve) — کاهش موجودی بدون تأیید کاربر دیگر ثبت نهایی نمی‌شود.
              </p>
            ) : null}
          </FormSection>

          <AdjustmentLinesGrid
            kind={form.kind}
            lines={form.lines}
            setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
            itemOptions={itemOptions}
            onHandByItem={onHandByItem}
            batchesByItem={batchesByItem}
          />

          <FormSection title="یادداشت">
            <textarea id="adjustment-note" aria-label="یادداشت" className={`${textareaClass} w-full`} value={form.note} maxLength={1000} onChange={(event) => update("note", event.target.value)} placeholder="توضیحات تکمیلی (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="stock-adjustment-form" disabled={saving || staleRecord}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(adjustmentId !== null ? `/inventory/adjustments/${adjustmentId}` : "/inventory/adjustments")}>
            انصراف
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            ردیف‌ها: <span className="font-medium text-foreground tabular-nums">{filledLines.length.toLocaleString("fa-IR")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
