"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { useAdminUser } from "@/app/admin/layout";
import { employeeLabel, productionOutputTitle, type ProductionOutputDetail, type ProductionOutputFormOptions } from "../shared";
import { FormSection } from "../adjustments/_form/FormSection";
import { InboundLinesGrid, emptyInboundLine, inboundLinePayload, validateInboundLines, type InboundLineRow } from "../_inbound/InboundLinesGrid";

type FormState = {
  productionDate: string;
  locationId: string;
  producedByEmployeeId: string;
  note: string;
  lines: InboundLineRow[];
};

function emptyForm(): FormState {
  return { productionDate: todayIso(), locationId: "", producedByEmployeeId: "", note: "", lines: [emptyInboundLine()] };
}

type Props = { mode: "create" } | { mode: "edit"; outputId: number };

// Create/edit form for a DRAFT production output (رسید تولید — the primary
// finished-goods inbound, Inventory batch I5). Same shape as
// receipts/GoodsReceiptForm.tsx (and, before it, StockAdjustmentForm.tsx).
// The item list from GET /inventory/production-outputs/form-options is
// already FINISHED_GOOD-only — not re-filtered here. No BOM / raw-material
// consumption (explicitly out of scope, B1).
export function ProductionOutputForm(props: Props) {
  const router = useRouter();
  const user = useAdminUser();
  const canCost = user?.permissions.includes("inventory.cost") ?? false;
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const outputId = props.mode === "edit" ? props.outputId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [options, setOptions] = useState<ProductionOutputFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<ProductionOutputDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [formOptions, detail] = await Promise.all([
          apiFetch<ProductionOutputFormOptions>("/inventory/production-outputs/form-options"),
          outputId !== null ? apiFetch<ProductionOutputDetail>(`/inventory/production-outputs/${outputId}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // Keep a draft's since-deactivated location/employee/item selectable.
        const merged: ProductionOutputFormOptions = { ...formOptions, locations: [...formOptions.locations], employees: [...formOptions.employees], items: [...formOptions.items] };
        if (detail) {
          if (!merged.locations.some((location) => location.id === detail.locationId)) merged.locations.push(detail.location);
          if (detail.producedByEmployee && !merged.employees.some((employee) => employee.id === detail.producedByEmployee!.id)) merged.employees.push(detail.producedByEmployee);
          for (const line of detail.items) {
            if (!merged.items.some((item) => item.id === line.itemId)) {
              merged.items.push({ ...line.item, batchTracked: line.batchNumber !== null, expiryRequired: false, shelfLifeDays: null });
            }
          }
          setLoaded(detail);
          setForm({
            productionDate: detail.productionDate.slice(0, 10),
            locationId: String(detail.locationId),
            producedByEmployeeId: detail.producedByEmployeeId ? String(detail.producedByEmployeeId) : "",
            note: detail.note ?? "",
            lines: detail.items.map((line) => ({
              key: crypto.randomUUID(),
              itemId: String(line.itemId),
              quantity: String(Number(line.quantity)),
              unitCost: line.unitCost !== undefined && line.unitCost !== null ? String(Number(line.unitCost)) : "",
              costIsEstimated: line.costIsEstimated ?? false,
              batchNumber: line.batchNumber ?? "",
              productionDate: line.productionDate?.slice(0, 10) ?? "",
              expiryDate: line.expiryDate?.slice(0, 10) ?? "",
              note: line.note ?? "",
            })),
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
  }, [outputId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const itemById = useMemo(() => new Map((options?.items ?? []).map((item) => [item.id, item] as const)), [options]);
  const filledLines = useMemo(() => form.lines.filter((line) => line.itemId !== "" || line.quantity.trim() !== ""), [form.lines]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    const problems: string[] = [];
    if (!form.productionDate) problems.push("تاریخ تولید الزامی است.");
    problems.push(...validateInboundLines(filledLines, options.items, canCost));
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      productionDate: form.productionDate,
      items: filledLines.map((line) => inboundLinePayload(line, itemById.get(Number(line.itemId)), { showCost: canCost, withEstimated: true })),
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : {}),
    };
    if (form.locationId) payload.locationId = Number(form.locationId);
    if (form.producedByEmployeeId) payload.producedByEmployeeId = Number(form.producedByEmployeeId);
    if (form.note.trim()) payload.note = form.note.trim();

    setSaving(true);
    try {
      const saved = await apiFetch<ProductionOutputDetail>(props.mode === "edit" ? `/inventory/production-outputs/${outputId}` : "/inventory/production-outputs", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "پیش‌نویس رسید تولید ذخیره شد." : "پیش‌نویس رسید تولید ایجاد شد. برای اعمال بر موجودی، آن را «ثبت نهایی» کنید.");
      router.push(`/inventory/production/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره رسید تولید ناموفق بود.");
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
          رسید تولید {productionOutputTitle(loaded)} ثبت نهایی شده و قابل ویرایش نیست؛ برای اصلاح، یک سند «اصلاح موجودی» ثبت کنید.{" "}
          <Link href={`/inventory/production/${loaded.id}`} className="text-primary hover:underline">مشاهده رسید تولید ←</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس رسید تولید" : "رسید تولید جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded ? productionOutputTitle(loaded) : "ورود محصول نهایی تولیدشده به انبار — فقط پس از «ثبت نهایی» بر موجودی اثر می‌گذارد."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این رسید تولید پس از باز شدن این فرم تغییر کرده یا ثبت نهایی شده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="production-output-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات رسید تولید">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="production-date-year">تاریخ تولید<RequiredMark /></Label>
                <JalaliDateInput idPrefix="production-date" value={form.productionDate} onChange={(value) => update("productionDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="production-location">انبار<RequiredMark /></Label>
                <select id="production-location" className={selectClass} value={form.locationId} onChange={(event) => update("locationId", event.target.value)}>
                  {options.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="production-employee">تولیدکننده</Label>
                <select id="production-employee" className={selectClass} value={form.producedByEmployeeId} onChange={(event) => update("producedByEmployeeId", event.target.value)}>
                  <option value="">نامشخص</option>
                  {options.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeLabel(employee)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </FormSection>

          <InboundLinesGrid
            lines={form.lines}
            setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
            itemOptions={options.items}
            showCost={canCost}
            showCostEstimated
            headerProductionDate={form.productionDate}
            itemKindsHint="فقط محصول نهایی — مقادیر مثبت"
          />

          <FormSection title="یادداشت">
            <textarea id="production-note" aria-label="یادداشت" className={`${textareaClass} w-full`} value={form.note} maxLength={1000} onChange={(event) => update("note", event.target.value)} placeholder="توضیحات تکمیلی (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="production-output-form" disabled={saving || staleRecord}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(outputId !== null ? `/inventory/production/${outputId}` : "/inventory/production")}>
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
