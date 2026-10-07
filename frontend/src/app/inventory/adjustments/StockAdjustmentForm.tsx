"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  STOCK_ADJUSTMENT_KINDS,
  adjustmentTitle,
  stockAdjustmentKindHints,
  stockAdjustmentKindLabels,
  type InventoryLocation,
  type ItemOption,
  type StockAdjustmentDetail,
  type StockAdjustmentKind,
  type StockBalanceRow,
} from "../shared";
import { FormSection } from "./_form/FormSection";
import { AdjustmentLinesGrid, emptyLineRow, type AdjustmentLineRow } from "./_form/AdjustmentLinesGrid";

type FormState = {
  kind: StockAdjustmentKind;
  adjustmentDate: string;
  reason: string;
  note: string;
  lines: AdjustmentLineRow[];
};

function emptyForm(): FormState {
  return { kind: "RECEIPT", adjustmentDate: todayIso(), reason: "", note: "", lines: [emptyLineRow()] };
}

type Props = { mode: "create" } | { mode: "edit"; adjustmentId: number };

// Create/edit form for a DRAFT stock adjustment. Saving never touches stock
// — the document only affects inventory once it's posted ("ثبت نهایی") on the
// detail page, which is also where it gets its ADJ-<year>-NNNNNN number.
// Edit uses the same optimistic lock as the Purchases form (updatedAt).
export function StockAdjustmentForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const adjustmentId = props.mode === "edit" ? props.adjustmentId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [onHandByItem, setOnHandByItem] = useState<Map<number, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Edit mode only.
  const [loaded, setLoaded] = useState<StockAdjustmentDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [options, detail] = await Promise.all([
          apiFetch<ItemOption[]>("/inventory/item-options"),
          adjustmentId !== null ? apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustmentId}`) : Promise.resolve(null),
        ]);
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
            note: detail.note ?? "",
            lines: detail.items.map((line) => ({ key: crypto.randomUUID(), itemId: String(line.itemId), quantity: String(Number(line.quantity)), note: line.note ?? "" })),
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
        setOnHandByItem(new Map(balances.filter((row) => row.locationId === defaultLocation?.id).map((row) => [row.itemId, row.onHand])));
      } catch {
        if (!cancelled) setOnHandByItem(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [adjustmentId]);

  const filledLines = useMemo(() => form.lines.filter((line) => line.itemId !== "" || line.quantity.trim() !== ""), [form.lines]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side checks are UX only — the backend DTO is authoritative.
    const problems: string[] = [];
    if (!form.adjustmentDate) problems.push("تاریخ سند الزامی است.");
    if (!form.reason.trim()) problems.push("علت ثبت سند الزامی است.");
    if (filledLines.length === 0) problems.push("حداقل یک ردیف کالا را وارد کنید.");
    const inboundOnly = INBOUND_ONLY_KINDS.includes(form.kind);
    filledLines.forEach((line, index) => {
      const row = index + 1;
      const quantity = parseNumberInput(line.quantity);
      if (!line.itemId) problems.push(`ردیف ${row.toLocaleString("fa-IR")}: کالا را انتخاب کنید.`);
      if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity === 0) problems.push(`ردیف ${row.toLocaleString("fa-IR")}: مقدار باید عددی غیر از صفر باشد.`);
      else if (inboundOnly && quantity < 0) problems.push(`ردیف ${row.toLocaleString("fa-IR")}: در «${stockAdjustmentKindLabels[form.kind]}» مقدار باید مثبت باشد.`);
    });
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      kind: form.kind,
      adjustmentDate: form.adjustmentDate,
      reason: form.reason.trim(),
      note: form.note.trim(),
      items: filledLines.map((line) => ({ itemId: Number(line.itemId), quantity: parseNumberInput(line.quantity), note: line.note.trim() })),
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
                <select id="adjustment-kind" className={selectClass} value={form.kind} onChange={(event) => update("kind", event.target.value as StockAdjustmentKind)}>
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
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{stockAdjustmentKindHints[form.kind]}</p>
          </FormSection>

          <AdjustmentLinesGrid
            kind={form.kind}
            lines={form.lines}
            setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
            itemOptions={itemOptions}
            onHandByItem={onHandByItem}
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
