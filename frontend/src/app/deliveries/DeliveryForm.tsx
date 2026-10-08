"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { normalizeDigits, parseNumberInput } from "@/lib/number-input";
import { formatQuantity, salesOrderStatusLabels, salesOrderTitle } from "../sales-orders/shared";
import { FormSection } from "../sales-orders/_form/FormSection";
import { deliveryStatusLabels, deliveryTitle, type DeliveryDetail, type DeliveryOrderContext } from "./shared";

type FormState = {
  deliveryDate: string;
  receivedByName: string;
  carrierNote: string;
  note: string;
  // Quantity text per order line id ("" or "0" = not on this delivery).
  quantities: Record<number, string>;
};

// Read once, client-only, without next/navigation's useSearchParams()
// Suspense requirement — same approach as purchases/PurchaseForm.tsx.
function subscribeToNothing() {
  return () => {};
}
function readLocationSearch() {
  return window.location.search;
}
function readServerLocationSearch() {
  return null;
}

// Decimal strings from the API → plain editable text ("3.00" → "3").
function decimalText(value: string | number): string {
  return String(Number(value));
}

type Props = { mode: "create" } | { mode: "edit"; deliveryId: number };

// Create/edit form for a DRAFT delivery note. Create: /deliveries/new?orderId=
// prefills every order line with its undelivered quantity (quantity −
// delivered); edit: the draft's own quantities. Saving never assigns a
// number or touches stock — that's «ثبت حواله» on the detail page. Lines
// left at 0 are not sent. The backend re-validates every cap.
export function DeliveryForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, dismiss } = useToasts();
  const deliveryId = props.mode === "edit" ? props.deliveryId : null;

  const locationSearch = useSyncExternalStore(subscribeToNothing, readLocationSearch, readServerLocationSearch);
  const queryOrderId = useMemo(() => {
    if (props.mode !== "create" || locationSearch === null) return null;
    const raw = Number(new URLSearchParams(locationSearch).get("orderId"));
    return Number.isInteger(raw) && raw > 0 ? raw : NaN;
  }, [props.mode, locationSearch]);

  const [context, setContext] = useState<DeliveryOrderContext | null>(null);
  const [loaded, setLoaded] = useState<DeliveryDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [staleRecord, setStaleRecord] = useState(false);

  const mode = props.mode;
  useEffect(() => {
    if (mode === "create" && queryOrderId === null) return; // query string not read yet
    let ignore = false;
    async function load() {
      try {
        if (mode === "create") {
          if (queryOrderId === null || Number.isNaN(queryOrderId)) {
            setLoadError("سفارش فروش مشخص نشده است؛ از صف تحویل یا صفحهٔ سفارش اقدام کنید.");
            return;
          }
          const ctx = await apiFetch<DeliveryOrderContext>(`/deliveries/order-context/${queryOrderId}`);
          if (ignore) return;
          setContext(ctx);
          setForm({
            deliveryDate: todayIso(),
            receivedByName: "",
            carrierNote: "",
            note: "",
            quantities: Object.fromEntries(ctx.items.map((line) => [line.id, Number(line.undeliveredQty) > 0 ? decimalText(line.undeliveredQty) : "0"])),
          });
        } else {
          const delivery = await apiFetch<DeliveryDetail>(`/deliveries/${deliveryId}`);
          const ctx = await apiFetch<DeliveryOrderContext>(`/deliveries/order-context/${delivery.salesOrderId}`);
          if (ignore) return;
          const own = new Map(delivery.items.map((item) => [item.salesOrderItemId, item.quantity]));
          setLoaded(delivery);
          setContext(ctx);
          setForm({
            deliveryDate: delivery.deliveryDate.slice(0, 10),
            receivedByName: delivery.receivedByName ?? "",
            carrierNote: delivery.carrierNote ?? "",
            note: delivery.note ?? "",
            quantities: Object.fromEntries(ctx.items.map((line) => [line.id, own.has(line.id) ? decimalText(own.get(line.id)!) : "0"])),
          });
        }
        setLoadError(null);
      } catch (reason) {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات سفارش ناموفق بود.");
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [mode, deliveryId, queryOrderId, reloadKey]);

  function update<K extends keyof Omit<FormState, "quantities">>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function setQuantity(lineId: number, value: string) {
    setForm((current) => (current ? { ...current, quantities: { ...current.quantities, [lineId]: value } } : current));
  }

  function fillAll(useOpen: boolean) {
    if (!context) return;
    setForm((current) =>
      current
        ? { ...current, quantities: Object.fromEntries(context.items.map((line) => [line.id, useOpen && Number(line.undeliveredQty) > 0 ? decimalText(line.undeliveredQty) : "0"])) }
        : current,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !context) return;
    const problems: string[] = [];
    if (!form.deliveryDate) problems.push("تاریخ تحویل را وارد کنید.");
    const items: { salesOrderItemId: number; quantity: number }[] = [];
    for (const line of context.items) {
      const text = normalizeDigits(form.quantities[line.id] ?? "").trim();
      if (text === "" || Number(text) === 0) continue;
      const quantity = parseNumberInput(text);
      if (!Number.isFinite(quantity) || quantity < 0) {
        problems.push(`ردیف ${line.lineNo.toLocaleString("fa-IR")}: مقدار تحویل نامعتبر است.`);
      } else if (quantity > Number(line.undeliveredQty)) {
        problems.push(`ردیف ${line.lineNo.toLocaleString("fa-IR")}: مقدار تحویل از باقی‌ماندهٔ سفارش (${formatQuantity(line.undeliveredQty)}) بیشتر است.`);
      } else {
        items.push({ salesOrderItemId: line.id, quantity });
      }
    }
    if (items.length === 0 && problems.length === 0) problems.push("حداقل برای یک ردیف مقدار تحویل وارد کنید.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }

    const body = {
      deliveryDate: form.deliveryDate,
      receivedByName: form.receivedByName.trim(),
      carrierNote: form.carrierNote.trim(),
      note: form.note.trim(),
      items,
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : { salesOrderId: context.id }),
    };
    setSaving(true);
    try {
      const saved = await apiFetch<DeliveryDetail>(props.mode === "edit" ? `/deliveries/${deliveryId}` : "/deliveries", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      router.push(`/deliveries/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره حواله ناموفق بود.");
      setSaving(false);
    }
  }

  const backHref = deliveryId !== null ? `/deliveries/${deliveryId}` : context ? `/sales-orders/${context.id}` : "/deliveries";

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p role="alert">{loadError}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش دوباره</Button>
            <Button size="sm" variant="ghost" onClick={() => router.push("/deliveries")}>بازگشت به تحویل‌ها</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!form || !context) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  // Only a DRAFT is editable — the edit route just explains that otherwise.
  if (props.mode === "edit" && loaded && loaded.status !== "DRAFT") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          حواله {deliveryTitle(loaded)} در وضعیت «{deliveryStatusLabels[loaded.status]}» است و فقط حوالهٔ پیش‌نویس قابل ویرایش است.{" "}
          <Link href={`/deliveries/${loaded.id}`} className="text-primary hover:underline">مشاهده حواله ←</Link>
        </p>
      </div>
    );
  }

  // A delivery is drafted only against a CONFIRMED order.
  if (!context.deliverable) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          سفارش {salesOrderTitle(context)} در وضعیت «{salesOrderStatusLabels[context.status]}» است؛ فقط برای سفارش تأییدشده می‌توان حواله تحویل صادر کرد.{" "}
          <Link href={`/sales-orders/${context.id}`} className="text-primary hover:underline">مشاهده سفارش ←</Link>
        </p>
      </div>
    );
  }

  const nothingOpen = context.items.every((line) => Number(line.undeliveredQty) <= 0);
  const filledCount = context.items.filter((line) => Number(parseNumberInput(form.quantities[line.id] ?? "")) > 0).length;

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس حواله تحویل" : "حواله تحویل جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded
              ? deliveryTitle(loaded)
              : "حواله به‌صورت پیش‌نویس ذخیره می‌شود؛ شماره حواله و خروج کالا از انبار پس از «ثبت حواله» در صفحه حواله انجام می‌شود."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این حواله پس از باز شدن این فرم تغییر کرده یا ثبت شده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        {nothingOpen ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">همهٔ اقلام این سفارش تحویل شده است.</div>
        ) : null}

        <form id="delivery-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات تحویل">
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border pb-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">سفارش فروش</dt>
                <dd className="mt-0.5">
                  <Link href={`/sales-orders/${context.id}`} className="font-mono text-primary hover:underline">{salesOrderTitle(context)}</Link>
                  <span className="ms-1 text-xs text-muted-foreground">({formatJalali(context.orderDate)})</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">مشتری</dt>
                <dd className="mt-0.5"><bdi>{context.customerName}</bdi></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">انبار</dt>
                <dd className="mt-0.5">{context.location.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تاریخ تحویل درخواستی</dt>
                <dd className="mt-0.5">{context.requestedDeliveryDate ? formatJalali(context.requestedDeliveryDate) : "-"}</dd>
              </div>
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">آدرس تحویل (از سفارش)</dt>
                <dd className="mt-0.5">{context.deliveryAddressText || "-"}</dd>
              </div>
            </dl>
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delivery-date-year">تاریخ تحویل<RequiredMark /></Label>
                <JalaliDateInput idPrefix="delivery-date" value={form.deliveryDate} onChange={(value) => update("deliveryDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delivery-received-by">تحویل‌گیرنده</Label>
                <Input id="delivery-received-by" value={form.receivedByName} maxLength={200} placeholder="نام امضاکنندهٔ مشتری" onChange={(event) => update("receivedByName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="delivery-carrier">راننده / وسیلهٔ نقلیه</Label>
                <Input id="delivery-carrier" value={form.carrierNote} maxLength={500} placeholder="مثلاً نام راننده و شماره پلاک" onChange={(event) => update("carrierNote", event.target.value)} />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="اقلام تحویل"
            description="مقدار هر ردیف حداکثر برابر باقی‌ماندهٔ سفارش است؛ ردیف با مقدار صفر در حواله نمی‌آید."
            action={
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => fillAll(true)}>پر کردن با باقی‌مانده</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => fillAll(false)}>صفر کردن همه</Button>
              </div>
            }
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[52rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="px-2 py-2 font-medium">واحد</th>
                    <th className="px-2 py-2 font-medium">سفارش</th>
                    <th className="px-2 py-2 font-medium">تحویل‌شده</th>
                    <th className="px-2 py-2 font-medium">باقی‌مانده</th>
                    <th className="px-2 py-2 font-medium" title="رزرو این سفارش برای این ردیف">رزرو سفارش</th>
                    <th className="px-2 py-2 font-medium" title="موجودی انبار منهای کل رزروها">موجودی آزاد</th>
                    <th className="w-32 px-2 py-2 font-medium">مقدار این حواله</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {context.items.map((line) => {
                    const open = Number(line.undeliveredQty);
                    const text = form.quantities[line.id] ?? "";
                    const quantity = parseNumberInput(text === "" ? "0" : text);
                    // Display-only hint: what this line can take without
                    // touching other orders' reservations (posting re-checks
                    // under a lock).
                    const coverable = Number(line.reservedQty) + Math.max(0, Number(line.available));
                    const short = Number.isFinite(quantity) && quantity > 0 && quantity > coverable;
                    const over = Number.isFinite(quantity) && quantity > open;
                    return (
                      <tr key={line.id} className={`align-top ${open <= 0 ? "text-muted-foreground" : short ? "bg-warning/10" : ""}`}>
                        <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                        <td className="px-2 py-2">
                          {line.itemName} <span className="font-mono text-[11px] text-muted-foreground">{line.itemCode}</span>
                          {short ? (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                              <AlertTriangle className="size-3" aria-hidden="true" />
                              موجودی قابل تحویل فعلی {formatQuantity(coverable)} است؛ ثبت حواله با این مقدار رد می‌شود.
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{line.unitName}</td>
                        <td className="px-2 py-2 tabular-nums">{formatQuantity(line.quantity)}</td>
                        <td className="px-2 py-2 tabular-nums">{formatQuantity(line.deliveredQty)}</td>
                        <td className="px-2 py-2 font-medium tabular-nums">{formatQuantity(line.undeliveredQty)}</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(line.reservedQty)}</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(Math.max(0, Number(line.available)))}</td>
                        <td className="px-2 py-1.5">
                          <Input
                            aria-label={`مقدار تحویل ردیف ${line.lineNo}`}
                            inputMode="decimal"
                            className={`h-8 tabular-nums ${over ? "border-destructive" : ""}`}
                            value={text}
                            disabled={open <= 0}
                            onChange={(event) => setQuantity(line.id, event.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="یادداشت">
            <textarea id="delivery-note" aria-label="یادداشت حواله" className={textareaClass} value={form.note} maxLength={2000} onChange={(event) => update("note", event.target.value)} placeholder="روی حواله چاپی نمایش داده می‌شود (اختیاری)" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="delivery-form" disabled={saving || staleRecord || nothingOpen}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(backHref)}>
            انصراف
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            ردیف‌های این حواله: <span className="font-medium text-foreground tabular-nums">{filledCount.toLocaleString("fa-IR")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
