"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import {
  STOCK_COUNT_SCOPES,
  stockCountScopeLabels,
  stockCountTitle,
  type ItemBatches,
  type StockCountDetail,
  type StockCountFormOptions,
  type StockCountScope,
} from "../shared";
import { FormSection } from "../adjustments/_form/FormSection";
import { CountLinesGrid, emptyCountLineRow, type CountBatchesState, type CountLineRow } from "./_form/CountLinesGrid";

type FormState = {
  locationId: string;
  countDate: string;
  scope: StockCountScope;
  isBlind: boolean;
  note: string;
  lines: CountLineRow[];
};

function emptyForm(): FormState {
  return { locationId: "", countDate: todayIso(), scope: "PARTIAL", isBlind: true, note: "", lines: [emptyCountLineRow()] };
}

type Props = { mode: "create" } | { mode: "edit"; countId: number };

// Create/edit form for a DRAFT stock count (شمارش موجودی, Inventory batch
// I6). Modelled on StockAdjustmentForm.tsx / GoodsReceiptForm.tsx. Saving
// never touches stock — a count only snapshots systemQty once it's started
// ("شروع شمارش") and only posts variances once approved. FULL scope submits
// no lines at all (start() populates them from real stock balances);
// PARTIAL requires at least one line here.
export function StockCountForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const countId = props.mode === "edit" ? props.countId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [options, setOptions] = useState<StockCountFormOptions | null>(null);
  const [batchesByItem, setBatchesByItem] = useState<Map<number, CountBatchesState>>(new Map());
  const requestedBatchItems = useRef(new Set<number>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<StockCountDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [formOptions, detail] = await Promise.all([
          apiFetch<StockCountFormOptions>("/inventory/stock-counts/form-options"),
          countId !== null ? apiFetch<StockCountDetail>(`/inventory/stock-counts/${countId}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // A draft may reference a location/item deactivated since saving —
        // keep it selectable so opening and saving doesn't silently drop it.
        const merged: StockCountFormOptions = { ...formOptions, locations: [...formOptions.locations], items: [...formOptions.items] };
        if (detail) {
          if (!merged.locations.some((location) => location.id === detail.locationId)) merged.locations.push(detail.location);
          for (const line of detail.items) {
            if (!merged.items.some((item) => item.id === line.itemId)) merged.items.push(line.item);
          }
          setLoaded(detail);
          setForm({
            locationId: String(detail.locationId),
            countDate: detail.countDate.slice(0, 10),
            scope: detail.scope,
            isBlind: detail.isBlind,
            note: detail.note ?? "",
            lines: detail.items.length
              ? detail.items.map((line) => ({ key: crypto.randomUUID(), itemId: String(line.itemId), batchId: line.batchId ? String(line.batchId) : "", note: line.note ?? "" }))
              : [emptyCountLineRow()],
          });
        } else {
          setForm((current) => ({ ...current, locationId: String(formOptions.defaultLocationId) }));
        }
        setOptions(merged);
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countId]);

  // Batches for whichever items are currently picked, scoped to the chosen
  // location (same approach as StockAdjustmentForm) — only relevant while
  // scope is PARTIAL.
  const selectedItemIdsKey = useMemo(
    () => [...new Set(form.lines.map((line) => line.itemId).filter((id) => id !== ""))].sort().join(","),
    [form.lines],
  );
  useEffect(() => {
    if (form.scope !== "PARTIAL") return;
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
      const query = form.locationId ? `?locationId=${form.locationId}` : "";
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
  }, [selectedItemIdsKey, form.locationId, form.scope]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeScope(scope: StockCountScope) {
    setForm((current) => (current.scope === scope ? current : { ...current, scope, lines: current.lines.length ? current.lines : [emptyCountLineRow()] }));
  }

  const filledLines = useMemo(() => (form.scope === "PARTIAL" ? form.lines.filter((line) => line.itemId !== "") : []), [form.lines, form.scope]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    // Client-side checks are UX only — the backend DTO is authoritative.
    const problems: string[] = [];
    if (!form.locationId) problems.push("انبار را انتخاب کنید.");
    if (!form.countDate) problems.push("تاریخ شمارش الزامی است.");
    if (form.scope === "PARTIAL" && filledLines.length === 0) problems.push("برای «شمارش بخشی» حداقل یک ردیف کالا را وارد کنید.");
    const seen = new Set<string>();
    filledLines.forEach((line, index) => {
      const key = `${line.itemId}:${line.batchId || 0}`;
      if (seen.has(key)) problems.push(`ردیف ${(index + 1).toLocaleString("fa-IR")}: این کالا (و بچ) قبلاً در فهرست آمده است.`);
      seen.add(key);
    });
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      locationId: Number(form.locationId),
      countDate: form.countDate,
      scope: form.scope,
      isBlind: form.isBlind,
      note: form.note.trim(),
      items: form.scope === "FULL" ? [] : filledLines.map((line) => ({ itemId: Number(line.itemId), batchId: line.batchId ? Number(line.batchId) : undefined, note: line.note.trim() })),
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : {}),
    };

    setSaving(true);
    try {
      const saved = await apiFetch<StockCountDetail>(props.mode === "edit" ? `/inventory/stock-counts/${countId}` : "/inventory/stock-counts", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "پیش‌نویس سند شمارش ذخیره شد." : "پیش‌نویس سند شمارش ایجاد شد. برای شروع شمارش، آن را «شروع» کنید.");
      router.push(`/inventory/counts/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره سند شمارش ناموفق بود.");
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

  if (loadError || !options) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm">
          <p className="text-destructive">{loadError ?? "دریافت اطلاعات فرم ناموفق بود."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            تلاش دوباره
          </Button>
        </div>
      </div>
    );
  }

  if (props.mode === "edit" && loaded && loaded.status !== "DRAFT") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          سند {stockCountTitle(loaded)} دیگر پیش‌نویس نیست و قابل ویرایش نیست.{" "}
          <Link href={`/inventory/counts/${loaded.id}`} className="text-primary hover:underline">مشاهده سند ←</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس سند شمارش" : "سند شمارش موجودی جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded ? stockCountTitle(loaded) : "سند به‌صورت پیش‌نویس ذخیره می‌شود؛ شمارش با «شروع شمارش» روی صفحهٔ سند آغاز می‌شود."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این سند پس از باز شدن این فرم تغییر کرده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="stock-count-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات سند">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count-location">انبار<RequiredMark /></Label>
                <select id="count-location" className={selectClass} value={form.locationId} onChange={(event) => update("locationId", event.target.value)}>
                  {options.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count-date-year">تاریخ شمارش<RequiredMark /></Label>
                <JalaliDateInput idPrefix="count-date" value={form.countDate} onChange={(value) => update("countDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count-scope">نوع شمارش<RequiredMark /></Label>
                <select id="count-scope" className={selectClass} value={form.scope} onChange={(event) => changeScope(event.target.value as StockCountScope)}>
                  {STOCK_COUNT_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>{stockCountScopeLabels[scope]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col justify-center gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 rounded border-input" checked={form.isBlind} onChange={(event) => update("isBlind", event.target.checked)} />
                  شمارش کور
                </label>
                <span className="text-[11px] text-muted-foreground">
                  اگر فعال باشد، شمارشگر تا پیش از «در انتظار بررسی» موجودی سیستم و مغایرت را نمی‌بیند.
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {form.scope === "FULL"
                ? "«شمارش کامل» پس از «شروع شمارش» به‌صورت خودکار یک ردیف برای هر کالای دارای موجودی در این انبار می‌سازد."
                : "«شمارش بخشی» فقط کالاهای انتخاب‌شدهٔ زیر را شمارش می‌کند."}
            </p>
          </FormSection>

          {form.scope === "PARTIAL" ? (
            <CountLinesGrid
              lines={form.lines}
              setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
              itemOptions={options.items}
              batchesByItem={batchesByItem}
            />
          ) : null}

          <FormSection title="یادداشت">
            <textarea id="count-note" aria-label="یادداشت" className={`${textareaClass} w-full`} value={form.note} maxLength={1000} onChange={(event) => update("note", event.target.value)} placeholder="توضیحات تکمیلی (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="stock-count-form" disabled={saving || staleRecord}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(countId !== null ? `/inventory/counts/${countId}` : "/inventory/counts")}>
            انصراف
          </Button>
          {form.scope === "PARTIAL" ? (
            <span className="ms-auto text-sm text-muted-foreground">
              ردیف‌ها: <span className="font-medium text-foreground tabular-nums">{filledLines.length.toLocaleString("fa-IR")}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
