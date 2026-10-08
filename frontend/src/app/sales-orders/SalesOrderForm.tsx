"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney, todayIso } from "@/lib/format";
import { JALALI_MAX_YEAR } from "@/lib/jalali";
import { parseNumberInput } from "@/lib/number-input";
import { employeeFullName } from "@/lib/reference-options";
import { useAdminUser } from "@/app/admin/layout";
import { salesOrderStatusLabels, salesOrderTitle, type CustomerContext, type SalesFormOptions, type SalesOrderDetail } from "./shared";
import { FormSection } from "./_form/FormSection";
import { CustomerPanel } from "./_form/CustomerPanel";
import { ItemsGrid, emptySalesLine, estimateLine, isBelowList, listPriceOf, type SalesLineRow } from "./_form/ItemsGrid";

type FormState = {
  orderDate: string;
  customerId: string;
  deliveryAddressId: string;
  salespersonEmployeeId: string;
  customerReference: string;
  requestedDeliveryDate: string;
  customerNote: string;
  internalNote: string;
  lines: SalesLineRow[];
};

function emptyForm(): FormState {
  return {
    orderDate: todayIso(),
    customerId: "",
    deliveryAddressId: "",
    salespersonEmployeeId: "",
    customerReference: "",
    requestedDeliveryDate: "",
    customerNote: "",
    internalNote: "",
    lines: [emptySalesLine()],
  };
}

// Decimal strings from the API → plain editable text ("12.50" → "12.5").
function decimalText(value: string | null | undefined): string {
  return value === null || value === undefined ? "" : String(Number(value));
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : parseNumberInput(value);
}

type Props = { mode: "create" } | { mode: "edit"; orderId: number };

// Create/edit form for a DRAFT sales order. Saving never assigns a number or
// reserves stock — that happens only on «تأیید سفارش» on the detail page
// (no "save and confirm" combo here, by design). The payment term always
// comes from the customer's financial profile and is shown read-only.
// Edit replaces the lines wholesale, with the updatedAt optimistic lock.
// Customer / item / salesperson pickers are native <select>s (no Base UI
// Select, so the Select→Dialog landmine in purchases/README.md can't occur).
export function SalesOrderForm(props: Props) {
  const router = useRouter();
  const user = useAdminUser();
  const canApprove = user?.permissions.includes("sales.approve") ?? false;
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const orderId = props.mode === "edit" ? props.orderId : null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [options, setOptions] = useState<SalesFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<SalesOrderDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  const [context, setContext] = useState<CustomerContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  // Ignore a customer-context response for a customer that is no longer selected.
  const contextRequest = useRef(0);

  // Customer panel + delivery addresses for the selected customer. Called
  // from the customer <select>'s change handler (and once for an opened
  // draft) — not from an effect. `keepAddressId` is the draft's saved
  // address on first load; on a user change the customer's default
  // delivery address (if any) is preselected instead. Either way the user
  // can change it.
  function loadCustomerContext(customerId: string, keepAddressId: string | null) {
    const requestId = ++contextRequest.current;
    setContextError(null);
    if (!customerId) {
      setContext(null);
      setContextLoading(false);
      return;
    }
    setContextLoading(true);
    apiFetch<CustomerContext>(`/sales-orders/customer-context/${customerId}`)
      .then((data) => {
        if (requestId !== contextRequest.current) return;
        setContext(data);
        if (keepAddressId === null) {
          const preferred = data.addresses.find((address) => address.isDefault && address.addressType === "DELIVERY");
          setForm((current) => ({ ...current, deliveryAddressId: preferred ? String(preferred.id) : "" }));
        }
      })
      .catch((reason: unknown) => {
        if (requestId !== contextRequest.current) return;
        setContext(null);
        setContextError((reason as ApiError).message ?? "دریافت اطلاعات مشتری ناموفق بود.");
      })
      .finally(() => {
        if (requestId === contextRequest.current) setContextLoading(false);
      });
  }

  function changeCustomer(customerId: string) {
    setForm((current) => ({ ...current, customerId, deliveryAddressId: "" }));
    loadCustomerContext(customerId, null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [optionsData, detail] = await Promise.all([
          apiFetch<SalesFormOptions>("/sales-orders/form-options"),
          orderId !== null ? apiFetch<SalesOrderDetail>(`/sales-orders/${orderId}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // A draft may still reference a customer / item / salesperson that
        // was deactivated since — keep them selectable so opening and saving
        // the draft doesn't silently drop them (backend accepts unchanged refs).
        const merged: SalesFormOptions = {
          ...optionsData,
          customers: [...optionsData.customers],
          items: [...optionsData.items],
          employees: [...optionsData.employees],
        };
        if (detail) {
          if (!merged.customers.some((customer) => customer.id === detail.customerId)) {
            merged.customers.push({ id: detail.customer.id, customerNumber: detail.customer.customerNumber, name: detail.customer.name, creditHold: false });
          }
          for (const line of detail.items) {
            if (!merged.items.some((item) => item.id === line.itemId)) {
              merged.items.push({ id: line.itemId, code: line.itemCode, name: line.itemName, sellingPrice: line.listUnitPrice, unit: { id: line.unitId, nameFa: line.unitName }, available: "0" });
            }
          }
          if (detail.salespersonEmployee && !merged.employees.some((employee) => employee.id === detail.salespersonEmployee!.id)) {
            merged.employees.push(detail.salespersonEmployee);
          }
          setLoaded(detail);
          setForm({
            orderDate: detail.orderDate.slice(0, 10),
            customerId: String(detail.customerId),
            deliveryAddressId: detail.deliveryAddressId ? String(detail.deliveryAddressId) : "",
            salespersonEmployeeId: detail.salespersonEmployeeId ? String(detail.salespersonEmployeeId) : "",
            customerReference: detail.customerReference ?? "",
            requestedDeliveryDate: detail.requestedDeliveryDate ? detail.requestedDeliveryDate.slice(0, 10) : "",
            customerNote: detail.customerNote ?? "",
            internalNote: detail.internalNote ?? "",
            lines: detail.items.map((line) => ({
              key: crypto.randomUUID(),
              itemId: String(line.itemId),
              quantity: decimalText(line.quantity),
              unitPrice: decimalText(line.unitPrice),
              priceOverrideReason: line.priceOverrideReason ?? "",
              discountPercent: line.discountPercent !== null ? decimalText(line.discountPercent) : "",
              discountAmount: line.discountPercent === null && Number(line.discountAmount) > 0 ? decimalText(line.discountAmount) : "",
              taxRate: Number(line.taxRate) > 0 ? decimalText(line.taxRate) : "",
              note: line.note ?? "",
            })),
          });
        }
        setOptions(merged);
        if (detail) loadCustomerContext(String(detail.customerId), detail.deliveryAddressId ? String(detail.deliveryAddressId) : "");
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
  }, [orderId]);

  const itemById = useMemo(() => new Map((options?.items ?? []).map((item) => [item.id, item])), [options]);
  const listPriceFallback = useMemo(() => new Map((loaded?.items ?? []).map((line) => [line.itemId, line.listUnitPrice])), [loaded]);
  const filledLines = useMemo(
    () => form.lines.filter((line) => line.itemId !== "" || line.quantity.trim() !== "" || line.unitPrice.trim() !== ""),
    [form.lines],
  );
  const estimatedTotal = useMemo(() => filledLines.reduce((sum, line) => sum + estimateLine(line).total, 0), [filledLines]);

  // Delivery-address options: the customer's active addresses, plus the
  // draft's saved address if it has since been deactivated.
  const addressOptions = useMemo(() => {
    const list = (context?.addresses ?? []).map((address) => ({ id: address.id, text: `${address.label ? `${address.label} — ` : ""}${address.text}` }));
    if (loaded?.deliveryAddressId && String(loaded.customerId) === form.customerId && !list.some((address) => address.id === loaded.deliveryAddressId)) {
      list.push({ id: loaded.deliveryAddressId, text: `${loaded.deliveryAddressText ?? "آدرس قبلی"} (غیرفعال)` });
    }
    return list;
  }, [context, loaded, form.customerId]);

  // B3: a non-approver can't save a draft that already carries a discount.
  const draftHasDiscount = (loaded?.items ?? []).some((line) => Number(line.discountAmount) > 0 || (line.discountPercent !== null && Number(line.discountPercent) > 0));
  const discountLocked = props.mode === "edit" && !canApprove && draftHasDiscount;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side checks are UX only — the backend DTO/service is authoritative.
    const problems: string[] = [];
    if (!form.orderDate) problems.push("تاریخ سفارش الزامی است.");
    if (!form.customerId) problems.push("مشتری را انتخاب کنید.");
    if (filledLines.length === 0) problems.push("حداقل یک ردیف کالا را وارد کنید.");
    filledLines.forEach((line, index) => {
      const row = `ردیف ${(index + 1).toLocaleString("fa-IR")}`;
      const quantity = parseNumberInput(line.quantity);
      const unitPrice = parseNumberInput(line.unitPrice);
      if (!line.itemId) problems.push(`${row}: کالا را انتخاب کنید.`);
      if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) problems.push(`${row}: مقدار باید عددی بزرگ‌تر از صفر باشد.`);
      if (line.unitPrice.trim() === "" || !Number.isInteger(unitPrice) || unitPrice < 0) problems.push(`${row}: قیمت واحد باید عدد صحیح (ریال) و غیرمنفی باشد.`);
      if (isBelowList(line, listPriceOf(line.itemId, itemById, listPriceFallback)) && !line.priceOverrideReason.trim()) {
        problems.push(`${row}: قیمت کمتر از قیمت فهرست است؛ علت کاهش قیمت را وارد کنید.`);
      }
      if (canApprove && line.discountPercent.trim() !== "" && line.discountAmount.trim() !== "") {
        problems.push(`${row}: برای تخفیف فقط یکی از «درصد» یا «مبلغ» را وارد کنید.`);
      }
    });
    if (problems.length) {
      pushErrors(problems);
      return;
    }

    const payload: Record<string, unknown> = {
      orderDate: form.orderDate,
      customerId: Number(form.customerId),
      deliveryAddressId: form.deliveryAddressId ? Number(form.deliveryAddressId) : undefined,
      salespersonEmployeeId: form.salespersonEmployeeId ? Number(form.salespersonEmployeeId) : undefined,
      customerReference: form.customerReference.trim(),
      requestedDeliveryDate: form.requestedDeliveryDate || undefined,
      customerNote: form.customerNote.trim(),
      internalNote: form.internalNote.trim(),
      items: filledLines.map((line) => ({
        itemId: Number(line.itemId),
        quantity: parseNumberInput(line.quantity),
        unitPrice: parseNumberInput(line.unitPrice),
        priceOverrideReason: line.priceOverrideReason.trim(),
        // Only sales.approve holders see/send discount fields (B3).
        ...(canApprove ? { discountPercent: optionalNumber(line.discountPercent), discountAmount: optionalNumber(line.discountAmount) } : {}),
        taxRate: optionalNumber(line.taxRate),
        note: line.note.trim(),
      })),
      ...(props.mode === "edit" && loaded ? { updatedAt: loaded.updatedAt } : {}),
    };

    setSaving(true);
    try {
      const saved = await apiFetch<SalesOrderDetail>(props.mode === "edit" ? `/sales-orders/${orderId}` : "/sales-orders", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "پیش‌نویس سفارش ذخیره شد." : "پیش‌نویس سفارش ایجاد شد.");
      router.push(`/sales-orders/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره سفارش ناموفق بود.");
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

  // Only a DRAFT is editable — the edit route just explains that otherwise.
  if (props.mode === "edit" && loaded && loaded.status !== "DRAFT") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          سفارش {salesOrderTitle(loaded)} در وضعیت «{salesOrderStatusLabels[loaded.status]}» است و فقط سفارش پیش‌نویس قابل ویرایش است.{" "}
          <Link href={`/sales-orders/${loaded.id}`} className="text-primary hover:underline">مشاهده سفارش ←</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش پیش‌نویس سفارش فروش" : "سفارش فروش جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && loaded
              ? salesOrderTitle(loaded)
              : "سفارش به‌صورت پیش‌نویس ذخیره می‌شود؛ شماره سفارش و رزرو موجودی پس از «تأیید سفارش» در صفحه سفارش انجام می‌شود."}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این سفارش پس از باز شدن این فرم تغییر کرده یا از حالت پیش‌نویس خارج شده است. ابتدا صفحه را بازخوانی کنید (تغییرات این فرم از بین می‌رود).</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        {discountLocked ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سفارش دارای تخفیف است و فقط کاربر دارای مجوز «تأیید فروش» می‌تواند آن را ویرایش کند.
          </div>
        ) : null}

        <form id="sales-order-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="اطلاعات سفارش">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-date-year">تاریخ سفارش<RequiredMark /></Label>
                <JalaliDateInput idPrefix="order-date" value={form.orderDate} onChange={(value) => update("orderDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="order-customer">مشتری<RequiredMark /></Label>
                <select id="order-customer" className={selectClass} value={form.customerId} onChange={(event) => changeCustomer(event.target.value)}>
                  <option value="">انتخاب کنید</option>
                  {options.customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.customerNumber}){customer.creditHold ? " — توقف اعتباری" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-salesperson">فروشنده</Label>
                <select id="order-salesperson" className={selectClass} value={form.salespersonEmployeeId} onChange={(event) => update("salespersonEmployeeId", event.target.value)}>
                  <option value="">—</option>
                  {options.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeFullName(employee)} ({employee.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="order-address">آدرس تحویل</Label>
                <select
                  id="order-address"
                  className={selectClass}
                  value={form.deliveryAddressId}
                  disabled={!form.customerId || contextLoading}
                  onChange={(event) => update("deliveryAddressId", event.target.value)}
                >
                  <option value="">{form.customerId && addressOptions.length === 0 && !contextLoading ? "آدرسی برای این مشتری ثبت نشده است" : "—"}</option>
                  {addressOptions.map((address) => (
                    <option key={address.id} value={address.id}>{address.text}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-reference">شماره مرجع مشتری</Label>
                <Input id="order-reference" value={form.customerReference} maxLength={100} placeholder="مثلاً شماره سفارش خرید مشتری" onChange={(event) => update("customerReference", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-requested-date-year">تاریخ تحویل درخواستی</Label>
                <JalaliDateInput idPrefix="order-requested-date" value={form.requestedDeliveryDate} maxYear={JALALI_MAX_YEAR} onChange={(value) => update("requestedDeliveryDate", value)} />
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-2.5">
              <CustomerPanel context={form.customerId ? context : null} loading={contextLoading} error={contextError} />
            </div>
          </FormSection>

          <ItemsGrid
            lines={form.lines}
            setLines={(updateLines) => setForm((current) => ({ ...current, lines: updateLines(current.lines) }))}
            itemOptions={options.items}
            listPriceFallback={listPriceFallback}
            canDiscount={canApprove}
            locationName={options.location.name}
          />

          <FormSection title="یادداشت‌ها">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-customer-note">یادداشت برای مشتری</Label>
                <textarea id="order-customer-note" className={textareaClass} value={form.customerNote} maxLength={2000} onChange={(event) => update("customerNote", event.target.value)} placeholder="روی اسناد چاپی نمایش داده می‌شود (اختیاری)" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-internal-note">یادداشت داخلی</Label>
                <textarea id="order-internal-note" className={textareaClass} value={form.internalNote} maxLength={2000} onChange={(event) => update("internalNote", event.target.value)} placeholder="فقط برای کاربران سیستم (اختیاری)" />
              </div>
            </div>
          </FormSection>
        </form>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="sales-order-form" disabled={saving || staleRecord || discountLocked}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(orderId !== null ? `/sales-orders/${orderId}` : "/sales-orders")}>
            انصراف
          </Button>
          <span className="ms-auto flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
            <span>
              ردیف‌ها: <span className="font-medium text-foreground tabular-nums">{filledLines.length.toLocaleString("fa-IR")}</span>
            </span>
            <span title="مبلغ نهایی پس از ذخیره توسط سیستم محاسبه می‌شود">
              جمع کل (برآورد): <span className="font-semibold text-foreground tabular-nums">{formatMoney(estimatedTotal)} ریال</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
