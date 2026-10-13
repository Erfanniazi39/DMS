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
import { formatJalali } from "@/lib/jalali";
import { todayIso } from "@/lib/format";
import { useAdminUser } from "@/app/admin/layout";
import { purchaseStatusLabels, type PurchaseStatus } from "@/app/purchases/shared";
import {
  PURCHASE_OPTIONS_LIMIT,
  goodsReceiptTitle,
  type GoodsReceiptDetail,
  type GoodsReceiptFormOptions,
  type InboundItemOption,
  type PurchaseReferenceOption,
} from "../shared";
import { FormSection } from "../adjustments/_form/FormSection";
import { InboundLinesGrid, emptyInboundLine, inboundLinePayload, validateInboundLines, type InboundLineRow } from "../_inbound/InboundLinesGrid";

type FormState = {
  receiptDate: string;
  supplierId: string;
  locationId: string;
  supplierDocumentNumber: string;
  purchaseId: string;
  inspectionRequired: boolean;
  note: string;
  lines: InboundLineRow[];
};

function emptyForm(): FormState {
  return { receiptDate: todayIso(), supplierId: "", locationId: "", supplierDocumentNumber: "", purchaseId: "", inspectionRequired: false, note: "", lines: [emptyInboundLine()] };
}

type Props = { mode: "create" } | { mode: "edit"; receiptId: number };

function purchaseOptionLabel(purchase: PurchaseReferenceOption): string {
  const status = purchaseStatusLabels[purchase.status as PurchaseStatus] ?? purchase.status;
  return `${purchase.purchaseNumber} — ${formatJalali(purchase.purchaseDate)} — ${status}`;
}

// Create/edit form for a DRAFT goods receipt (رسید انبار — raw materials /
// packaging from a supplier, Inventory batch I5). Modelled on
// adjustments/StockAdjustmentForm.tsx. Saving never touches stock — the
// receipt only affects inventory once it's posted («ثبت نهایی») on the detail
// page, which is also where it gets its GRN-<year>-NNNNNN number. Edit uses the
// usual optimistic lock (updatedAt → RECORD_MODIFIED banner).
//
// Every picker comes from GET /inventory/goods-receipts/form-options (and
// /purchase-options) — inventory.receive roles hold neither suppliers.view
// nor items.view, so the general Suppliers/Items APIs are deliberately not used.
export function GoodsReceiptForm(props: Props) {
  const router = useRouter();
  const user = useAdminUser();
  const canCost = user?.permissions.includes("inventory.cost") ?? false;
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const receiptId = props.mode === "edit" ? props.receiptId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [options, setOptions] = useState<GoodsReceiptFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<GoodsReceiptDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // Purchase-reference picker for the selected supplier (newest 100).
  const [purchases, setPurchases] = useState<{ supplierId: string; state: PurchaseReferenceOption[] | "loading" | "error" }>({ supplierId: "", state: [] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [formOptions, detail] = await Promise.all([
          apiFetch<GoodsReceiptFormOptions>("/inventory/goods-receipts/form-options"),
          receiptId !== null ? apiFetch<GoodsReceiptDetail>(`/inventory/goods-receipts/${receiptId}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // A draft may still reference a supplier/location/item deactivated
        // since — the backend lets it stay, so keep it selectable here too.
        const merged: GoodsReceiptFormOptions = { ...formOptions, suppliers: [...formOptions.suppliers], locations: [...formOptions.locations], items: [...formOptions.items] };
        if (detail) {
          if (!merged.suppliers.some((supplier) => supplier.id === detail.supplierId)) merged.suppliers.push(detail.supplier);
          if (!merged.locations.some((location) => location.id === detail.locationId)) merged.locations.push(detail.location);
          for (const line of detail.items) {
            if (!merged.items.some((item) => item.id === line.itemId)) {
              // Not in the active list: its batch settings aren't known here —
              // infer tracking from the saved line (the backend re-checks).
              merged.items.push({ ...line.item, batchTracked: line.batchNumber !== null, expiryRequired: false, shelfLifeDays: null });
            }
          }
          setLoaded(detail);
          setForm({
            receiptDate: detail.receiptDate.slice(0, 10),
            supplierId: String(detail.supplierId),
            locationId: String(detail.locationId),
            supplierDocumentNumber: detail.supplierDocumentNumber ?? "",
            purchaseId: detail.purchaseId ? String(detail.purchaseId) : "",
            inspectionRequired: detail.inspectionRequired,
            note: detail.note ?? "",
            lines: detail.items.map((line) => ({
              key: crypto.randomUUID(),
              itemId: String(line.itemId),
              quantity: String(Number(line.quantity)),
              unitCost: line.unitCost !== undefined && line.unitCost !== null ? String(Number(line.unitCost)) : "",
              costIsEstimated: false,
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
  }, [receiptId]);

  const supplierId = form.supplierId;
  useEffect(() => {
    if (!supplierId) return;
    let cancelled = false;
    // Until this resolves, `purchases.supplierId !== form.supplierId` renders as "loading".
    apiFetch<PurchaseReferenceOption[]>(`/inventory/goods-receipts/purchase-options?supplierId=${supplierId}`)
      .then((data) => {
        if (!cancelled) setPurchases({ supplierId, state: data });
      })
      .catch(() => {
        if (!cancelled) setPurchases({ supplierId, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  // The saved purchase reference of a draft may be older than the newest-100
  // window — keep it selectable from its snapshot.
  const purchaseChoices = useMemo(() => {
    const list = purchases.supplierId === form.supplierId && Array.isArray(purchases.state) ? [...purchases.state] : [];
    if (loaded?.purchaseId && loaded.purchaseNumber && String(loaded.supplierId) === form.supplierId && !list.some((purchase) => purchase.id === loaded.purchaseId)) {
      list.push({ id: loaded.purchaseId, purchaseNumber: loaded.purchaseNumber, purchaseDate: "", status: "" });
    }
    return list;
  }, [purchases, form.supplierId, loaded]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const itemById = useMemo(() => new Map((options?.items ?? []).map((item) => [item.id, item] as const)), [options]);
  const filledLines = useMemo(() => form.lines.filter((line) => line.itemId !== "" || line.quantity.trim() !== ""), [form.lines]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    // Client-side checks are UX only — the backend is authoritative.
    const problems: string[] = [];
    if (!form.receiptDate) problems.push("تاریخ رسید الزامی است.");
    if (!form.supplierId) problems.push("تأمین‌کننده را انتخاب کنید.");
    problems.push(...validateInboundLines(filledLines, options.items, canCost));
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      receiptDate: form.receiptDate,
      supplierId: Number(form.supplierId),
      inspectionRequired: form.inspectionRequired,
      items: filledLines.map((line) => inboundLinePayload(line, itemById.get(Number(line.itemId)) as InboundItemOption | undefined, { showCost: canCost, withEstimated: false })),
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : {}),
    };
    if (form.locationId) payload.locationId = Number(form.locationId);
    if (form.supplierDocumentNumber.trim()) payload.supplierDocumentNumber = form.supplierDocumentNumber.trim();
    if (form.purchaseId) payload.purchaseId = Number(form.purchaseId);
    if (form.note.trim()) payload.note = form.note.trim();

    setSaving(true);
    try {
      const saved = await apiFetch<GoodsReceiptDetail>(props.mode === "edit" ? `/inventory/goods-receipts/${receiptId}` : "/inventory/goods-receipts", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "پیش‌نویس رسید ذخیره شد." : "پیش‌نویس رسید ایجاد شد. برای اعمال بر موجودی، آن را «ثبت نهایی» کنید.");
      router.push(`/inventory/receipts/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      // ITEM_KIND_NOT_ALLOWED / batch-field refusals carry their own Persian message naming the row.
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره رسید ناموفق بود.");
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
          رسید {goodsReceiptTitle(loaded)} ثبت نهایی شده و قابل ویرایش نیست؛ برای اصلاح، یک سند «اصلاح موجودی» ثبت کنید.{" "}
          <Link href={`/inventory/receipts/${loaded.id}`} className="text-primary hover:underline">مشاهده رسید ←</Link>
        </p>
      </div>
    );
  }

  const purchasesState = purchases.supplierId === form.supplierId ? purchases.state : "loading";

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس رسید انبار" : "رسید انبار جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded ? goodsReceiptTitle(loaded) : "ورود مواد اولیه و بسته‌بندی از تأمین‌کننده — فقط پس از «ثبت نهایی» بر موجودی اثر می‌گذارد."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این رسید پس از باز شدن این فرم تغییر کرده یا ثبت نهایی شده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="goods-receipt-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات رسید">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="receipt-date-year">تاریخ رسید<RequiredMark /></Label>
                <JalaliDateInput idPrefix="receipt-date" value={form.receiptDate} onChange={(value) => update("receiptDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="receipt-supplier">تأمین‌کننده<RequiredMark /></Label>
                <select
                  id="receipt-supplier"
                  className={selectClass}
                  value={form.supplierId}
                  // Purchases belong to one supplier — a new supplier clears the reference.
                  onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value, purchaseId: "" }))}
                >
                  <option value="">انتخاب کنید</option>
                  {options.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} ({supplier.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="receipt-supplier-doc">شماره سند تأمین‌کننده</Label>
                <Input id="receipt-supplier-doc" value={form.supplierDocumentNumber} maxLength={100} placeholder="مثلاً شماره بارنامه / حواله" onChange={(event) => update("supplierDocumentNumber", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="receipt-location">انبار<RequiredMark /></Label>
                <select id="receipt-location" className={selectClass} value={form.locationId} onChange={(event) => update("locationId", event.target.value)}>
                  {options.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="receipt-purchase">خرید مرتبط</Label>
                <select id="receipt-purchase" className={selectClass} value={form.purchaseId} disabled={!form.supplierId || purchasesState === "loading"} onChange={(event) => update("purchaseId", event.target.value)}>
                  <option value="">{!form.supplierId ? "ابتدا تأمین‌کننده را انتخاب کنید" : purchasesState === "loading" ? "در حال بارگذاری خریدها..." : "بدون ارجاع به خرید"}</option>
                  {purchaseChoices.map((purchase) => (
                    <option key={purchase.id} value={purchase.id}>
                      {purchase.purchaseDate ? purchaseOptionLabel(purchase) : purchase.purchaseNumber}
                    </option>
                  ))}
                </select>
                {purchasesState === "error" ? <span className="text-[11px] text-destructive">دریافت خریدهای این تأمین‌کننده ناموفق بود.</span> : null}
                {Array.isArray(purchasesState) && purchasesState.length >= PURCHASE_OPTIONS_LIMIT ? (
                  <span className="text-[11px] text-muted-foreground">فقط {PURCHASE_OPTIONS_LIMIT.toLocaleString("fa-IR")} خرید اخیر این تأمین‌کننده نمایش داده می‌شود.</span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">فقط ارجاع است؛ رسید انبار هیچ تغییری در خرید ایجاد نمی‌کند.</span>
              </div>
              <div className="flex flex-col justify-center gap-1 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 rounded border-input" checked={form.inspectionRequired} onChange={(event) => update("inspectionRequired", event.target.checked)} />
                  نیاز به کنترل کیفیت
                </label>
                <span className="text-[11px] text-muted-foreground">
                  اگر فعال باشد، کالا پس از ثبت نهایی به «کنترل کیفیت» می‌رود و تا آزادسازی از صفحه رسید، قابل استفاده نیست.
                </span>
              </div>
            </div>
          </FormSection>

          <InboundLinesGrid
            lines={form.lines}
            setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
            itemOptions={options.items}
            showCost={canCost}
            itemKindsHint="فقط مواد اولیه و بسته‌بندی — مقادیر مثبت"
          />

          <FormSection title="یادداشت">
            <textarea id="receipt-note" aria-label="یادداشت" className={`${textareaClass} w-full`} value={form.note} maxLength={1000} onChange={(event) => update("note", event.target.value)} placeholder="توضیحات تکمیلی (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="goods-receipt-form" disabled={saving || staleRecord}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(receiptId !== null ? `/inventory/receipts/${receiptId}` : "/inventory/receipts")}>
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
