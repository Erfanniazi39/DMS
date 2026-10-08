"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney, todayIso } from "@/lib/format";
import { normalizeDigits, parseNumberInput } from "@/lib/number-input";
import { FormSection } from "../sales-orders/_form/FormSection";
import { formatQuantity } from "../sales-orders/shared";
import { deliveryTitle } from "../deliveries/shared";
import { returnReasonLabels, RETURN_REASONS, type ReturnReason, type SalesReturnDeliveryContext, type SalesReturnDetail } from "./shared";

type FormState = {
  requestDate: string;
  reason: ReturnReason;
  note: string;
  // Quantity text per delivery line id ("" or "0" = not on this return).
  quantities: Record<number, string>;
};

// Read once, client-only, without next/navigation's useSearchParams()
// Suspense requirement — same approach as deliveries/DeliveryForm.tsx.
function subscribeToNothing() {
  return () => {};
}
function readLocationSearch() {
  return window.location.search;
}
function readServerLocationSearch() {
  return null;
}

// درخواست مرجوعی — always started from a POSTED delivery
// (/sales-returns/new?deliveryId=…), same convention as
// /deliveries/new?orderId=…. Prefills every line with its still-returnable
// quantity (quantity − returnedQty, display only — request() re-checks
// under the real data). Submitting creates the return directly as
// REQUESTED (no draft stage, unlike Delivery/Invoice).
export function SalesReturnRequestForm() {
  const router = useRouter();
  const { toasts, pushError, pushErrors, dismiss } = useToasts();

  const locationSearch = useSyncExternalStore(subscribeToNothing, readLocationSearch, readServerLocationSearch);
  const deliveryId = useMemo(() => {
    if (locationSearch === null) return null;
    const raw = Number(new URLSearchParams(locationSearch).get("deliveryId"));
    return Number.isInteger(raw) && raw > 0 ? raw : NaN;
  }, [locationSearch]);

  const [context, setContext] = useState<SalesReturnDeliveryContext | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deliveryId === null) return; // query string not read yet
    let ignore = false;
    async function load() {
      if (Number.isNaN(deliveryId)) {
        setLoadError("حواله تحویل مشخص نشده است؛ از صفحهٔ حواله اقدام کنید.");
        return;
      }
      try {
        const ctx = await apiFetch<SalesReturnDeliveryContext>(`/sales-returns/delivery-context/${deliveryId}`);
        if (ignore) return;
        setContext(ctx);
        setForm({ requestDate: todayIso(), reason: "DAMAGED", note: "", quantities: Object.fromEntries(ctx.items.map((line) => [line.id, "0"])) });
        setLoadError(null);
      } catch (reason) {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات حواله ناموفق بود.");
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [deliveryId, reloadKey]);

  function update<K extends keyof Omit<FormState, "quantities">>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }
  function setQuantity(lineId: number, value: string) {
    setForm((current) => (current ? { ...current, quantities: { ...current.quantities, [lineId]: value } } : current));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !context) return;
    const problems: string[] = [];
    if (!form.requestDate) problems.push("تاریخ درخواست را وارد کنید.");
    const items: { deliveryItemId: number; quantity: number }[] = [];
    for (const line of context.items) {
      const text = normalizeDigits(form.quantities[line.id] ?? "").trim();
      if (text === "" || Number(text) === 0) continue;
      const quantity = parseNumberInput(text);
      if (!Number.isFinite(quantity) || quantity < 0) {
        problems.push(`کالای «${line.itemName}»: مقدار نامعتبر است.`);
      } else if (quantity > Number(line.returnableQty)) {
        problems.push(`کالای «${line.itemName}»: مقدار درخواستی از مقدار قابل مرجوع (${formatQuantity(line.returnableQty)}) بیشتر است.`);
      } else {
        items.push({ deliveryItemId: line.id, quantity });
      }
    }
    if (items.length === 0 && problems.length === 0) problems.push("حداقل برای یک ردیف مقدار مرجوعی وارد کنید.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const created = await apiFetch<SalesReturnDetail>("/sales-returns", {
        method: "POST",
        body: JSON.stringify({ deliveryId: context.id, requestDate: form.requestDate, reason: form.reason, note: form.note.trim(), items }),
      });
      router.push(`/sales-returns/${created.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت درخواست مرجوعی ناموفق بود.");
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p role="alert">{loadError}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش دوباره</Button>
            <Button size="sm" variant="ghost" onClick={() => router.push("/sales-returns")}>بازگشت به مرجوعی‌ها</Button>
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

  if (!context.returnable) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          فقط برای حوالهٔ «ثبت‌شده» می‌توان درخواست مرجوعی ثبت کرد.{" "}
          <Link href={`/deliveries/${context.id}`} className="text-primary hover:underline">مشاهده حواله ←</Link>
        </p>
      </div>
    );
  }

  const nothingReturnable = context.items.every((line) => Number(line.returnableQty) <= 0);
  const filledCount = context.items.filter((line) => Number(parseNumberInput(form.quantities[line.id] ?? "")) > 0).length;

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">درخواست مرجوعی جدید</h1>
          <p className="text-sm text-muted-foreground">پس از تأیید مدیر فروش، شماره مرجوعی (RMA) تخصیص می‌یابد.</p>
        </div>

        {nothingReturnable ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">همهٔ اقلام این حواله قبلاً مرجوع شده است.</div>
        ) : null}

        <form id="return-request-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات درخواست">
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border pb-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">حواله تحویل</dt>
                <dd className="mt-0.5">
                  <Link href={`/deliveries/${context.id}`} className="font-mono text-primary hover:underline">{deliveryTitle(context)}</Link>
                </dd>
              </div>
            </dl>
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="return-date-year">تاریخ درخواست<RequiredMark /></Label>
                <JalaliDateInput idPrefix="return-date" value={form.requestDate} onChange={(value) => update("requestDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="return-reason">علت مرجوعی<RequiredMark /></Label>
                <select id="return-reason" className={selectClass} value={form.reason} onChange={(event) => update("reason", event.target.value as ReturnReason)}>
                  {RETURN_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{returnReasonLabels[reason]}</option>
                  ))}
                </select>
              </div>
            </div>
          </FormSection>

          <FormSection title="اقلام مرجوعی" description="مقدار هر ردیف حداکثر برابر مقدار قابل مرجوع آن است؛ ردیف با مقدار صفر در درخواست نمی‌آید.">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[44rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="px-2 py-2 font-medium">واحد</th>
                    <th className="px-2 py-2 font-medium">قیمت واحد</th>
                    <th className="px-2 py-2 font-medium">تحویل‌شده</th>
                    <th className="px-2 py-2 font-medium">قابل مرجوع</th>
                    <th className="w-32 px-2 py-2 font-medium">مقدار مرجوعی</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {context.items.map((line) => {
                    const returnable = Number(line.returnableQty);
                    const text = form.quantities[line.id] ?? "";
                    const quantity = parseNumberInput(text === "" ? "0" : text);
                    const over = Number.isFinite(quantity) && quantity > returnable;
                    return (
                      <tr key={line.id} className={returnable <= 0 ? "text-muted-foreground" : undefined}>
                        <td className="px-2 py-2">
                          {line.itemName} <span className="font-mono text-[11px] text-muted-foreground">{line.itemCode}</span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{line.unitName}</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatMoney(line.unitPrice)}</td>
                        <td className="px-2 py-2 tabular-nums">{formatQuantity(line.quantity)}</td>
                        <td className="px-2 py-2 font-medium tabular-nums">{formatQuantity(line.returnableQty)}</td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label={`مقدار مرجوعی ${line.itemName}`}
                            inputMode="decimal"
                            className={`h-8 w-full rounded-md border bg-transparent px-2 tabular-nums outline-none ${over ? "border-destructive" : "border-input"}`}
                            value={text}
                            disabled={returnable <= 0}
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
            <textarea id="return-note" aria-label="یادداشت مرجوعی" className={textareaClass} value={form.note} maxLength={2000} onChange={(event) => update("note", event.target.value)} placeholder="اختیاری" />
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="return-request-form" disabled={saving || nothingReturnable}>
            {saving ? "در حال ثبت..." : "ثبت درخواست مرجوعی"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/deliveries/${context.id}`)}>
            انصراف
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            ردیف‌های این درخواست: <span className="font-medium text-foreground tabular-nums">{filledCount.toLocaleString("fa-IR")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
