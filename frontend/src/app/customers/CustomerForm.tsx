"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeDigits } from "@/lib/number-input";
import {
  CUSTOMER_ADDRESS_TYPES,
  CUSTOMER_KINDS,
  RequiredMark,
  addressTypeLabels,
  customerKindLabels,
  nationalIdLabel,
  nationalIdLength,
  selectClass,
  type CustomerAddressType,
  type CustomerDetail,
  type CustomerKind,
  type DuplicateCandidate,
  type ReferenceOption,
} from "./shared";
import { FormSection } from "./_form/FormSection";
import { DuplicateCandidates } from "./_form/DuplicateCandidates";

// Create/edit form for a customer's identity, classification and
// communication fields. Status is NOT here — it changes only through the
// detail page's status buttons (PATCH /customers/:id/status).
// customerNumber is server-generated; legacyCode is read-only.
//
// Create mode also offers an optional first address and first contact
// (saved as the default address / primary contact).
//
// Duplicate policy (backend CustomersService): an exact national id match is
// a hard 409 (shown as an error); a same-name or same-phone match is a
// CUSTOMER_POSSIBLE_DUPLICATE 409 that DuplicateCandidates shows inline and
// the user may override by resubmitting with acknowledgeDuplicates: true.

type FormState = {
  customerKind: CustomerKind;
  name: string;
  legalName: string;
  nationalId: string;
  economicCode: string;
  customerGroupId: string;
  territoryId: string;
  phone: string;
  email: string;
  // create mode only
  addressType: CustomerAddressType;
  province: string;
  city: string;
  addressLine: string;
  postalCode: string;
  contactName: string;
  contactRoleTitle: string;
  contactMobile: string;
  contactEmail: string;
};

const emptyForm: FormState = {
  customerKind: "ORGANIZATION",
  name: "",
  legalName: "",
  nationalId: "",
  economicCode: "",
  customerGroupId: "",
  territoryId: "",
  phone: "",
  email: "",
  addressType: "DELIVERY",
  province: "",
  city: "",
  addressLine: "",
  postalCode: "",
  contactName: "",
  contactRoleTitle: "",
  contactMobile: "",
  contactEmail: "",
};

type Props = { mode: "create" } | { mode: "edit"; customerId: number };

export function CustomerForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<ReferenceOption[]>([]);
  const [territories, setTerritories] = useState<ReferenceOption[]>([]);
  // Edit mode: the record as loaded (number, legacy code, current
  // group/territory for the "keep a since-deactivated option" rule) and its
  // updatedAt — the optimistic-locking token sent back on save.
  const [loaded, setLoaded] = useState<CustomerDetail | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // CUSTOMER_POSSIBLE_DUPLICATE details plus the payload to resubmit with
  // acknowledgeDuplicates once the user confirms. Cleared by any edit.
  const [pendingDuplicates, setPendingDuplicates] = useState<{ candidates: DuplicateCandidate[]; payload: Record<string, unknown> } | null>(null);

  const editId = props.mode === "edit" ? props.customerId : null;

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const [groupsData, territoriesData, customer] = await Promise.all([
          apiFetch<ReferenceOption[]>("/customer-groups"),
          apiFetch<ReferenceOption[]>("/territories"),
          editId !== null ? apiFetch<CustomerDetail>(`/customers/${editId}`) : Promise.resolve(null),
        ]);
        if (ignore) return;
        // Keep the customer's current group/territory selectable even if it
        // was deactivated since (the backend accepts an unchanged reference).
        const withCurrent = (options: ReferenceOption[], current: ReferenceOption | null | undefined) =>
          current && !options.some((option) => option.id === current.id) ? [...options, current] : options;
        setGroups(withCurrent(groupsData, customer?.customerGroup));
        setTerritories(withCurrent(territoriesData, customer?.territory));
        if (customer) {
          setLoaded(customer);
          setForm({
            ...emptyForm,
            customerKind: customer.customerKind,
            name: customer.name,
            legalName: customer.legalName ?? "",
            nationalId: customer.nationalId ?? "",
            economicCode: customer.economicCode ?? "",
            customerGroupId: String(customer.customerGroupId),
            territoryId: customer.territoryId ? String(customer.territoryId) : "",
            phone: customer.phone,
            email: customer.email ?? "",
          });
        }
      } catch (reason) {
        if (!ignore) pushError((reason as ApiError).message ?? "دریافت اطلاعات فرم ناموفق بود.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [editId, pushError]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setPendingDuplicates(null);
  }

  function validate(): string[] {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push("نام مشتری الزامی است.");
    if (!form.customerGroupId) errors.push("گروه مشتری الزامی است.");
    const phone = normalizeDigits(form.phone).trim();
    if (!phone) errors.push("تلفن الزامی است.");
    else if (!/^[0-9]{6,15}$/.test(phone)) errors.push("تلفن معتبر نیست (۶ تا ۱۵ رقم).");
    const nationalId = normalizeDigits(form.nationalId).trim();
    if (nationalId) {
      const length = nationalIdLength[form.customerKind];
      if (!/^[0-9]+$/.test(nationalId) || nationalId.length !== length) {
        errors.push(`${nationalIdLabel[form.customerKind]} باید ${length.toLocaleString("fa-IR")} رقم باشد.`);
      }
    }
    if (props.mode === "create") {
      const anyAddressField = [form.province, form.city, form.postalCode].some((value) => value.trim() !== "");
      if (anyAddressField && !form.addressLine.trim()) errors.push("برای ثبت آدرس اول، نشانی الزامی است.");
      const anyContactField = [form.contactRoleTitle, form.contactMobile, form.contactEmail].some((value) => value.trim() !== "");
      if (anyContactField && !form.contactName.trim()) errors.push("برای ثبت مخاطب اول، نام مخاطب الزامی است.");
    }
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    if (errors.length > 0) {
      pushErrors(errors);
      return;
    }
    const payload: Record<string, unknown> = {
      customerKind: form.customerKind,
      name: form.name.trim(),
      legalName: form.legalName.trim(),
      nationalId: normalizeDigits(form.nationalId).trim(),
      economicCode: normalizeDigits(form.economicCode).trim(),
      customerGroupId: Number(form.customerGroupId),
      territoryId: form.territoryId ? Number(form.territoryId) : undefined,
      phone: normalizeDigits(form.phone).trim(),
      email: form.email.trim(),
    };
    if (props.mode === "create") {
      if (form.addressLine.trim()) {
        payload.firstAddress = {
          addressType: form.addressType,
          province: form.province.trim(),
          city: form.city.trim(),
          addressLine: form.addressLine.trim(),
          postalCode: normalizeDigits(form.postalCode).trim(),
        };
      }
      if (form.contactName.trim()) {
        payload.firstContact = {
          name: form.contactName.trim(),
          roleTitle: form.contactRoleTitle.trim(),
          mobile: normalizeDigits(form.contactMobile).trim(),
          email: form.contactEmail.trim(),
        };
      }
    } else {
      payload.updatedAt = loaded?.updatedAt;
    }
    await save(payload);
  }

  async function save(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const saved = await apiFetch<CustomerDetail>(props.mode === "edit" ? `/customers/${props.customerId}` : "/customers", {
        method: props.mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(props.mode === "edit" ? "مشتری با موفقیت ویرایش شد." : `مشتری ${saved.customerNumber} با موفقیت ثبت شد.`);
      router.push(`/customers/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        pushError(apiError.message);
      } else if (apiError.code === "CUSTOMER_POSSIBLE_DUPLICATE") {
        const candidates = (apiError.details as { candidates?: DuplicateCandidate[] } | undefined)?.candidates ?? [];
        setPendingDuplicates({ candidates, payload });
      } else if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره مشتری ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmDuplicates() {
    const pending = pendingDuplicates;
    setPendingDuplicates(null);
    if (pending) void save({ ...pending.payload, acknowledgeDuplicates: true });
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (props.mode === "edit" && !loaded) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">مشتری یافت نشد.</p>
      </div>
    );
  }

  const idLength = nationalIdLength[form.customerKind];

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش مشتری" : "ثبت مشتری جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {loaded ? (
              <>
                شماره مشتری: <span className="font-mono">{loaded.customerNumber}</span>
                {loaded.legacyCode ? <> — کد قدیمی: <span className="font-mono">{loaded.legacyCode}</span></> : null}
              </>
            ) : (
              "شماره مشتری پس از ثبت به‌صورت خودکار تولید می‌شود"
            )}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>
              این مشتری پس از باز شدن این فرم توسط کاربر دیگری تغییر کرده است. برای جلوگیری از بازنویسی تغییرات او، ابتدا صفحه را بازخوانی کنید
              (تغییرات واردشده در این فرم از بین می‌رود).
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="customer-form" onSubmit={submit} className="space-y-3" noValidate>
          <FormSection title="هویت">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-kind">نوع شخص<RequiredMark /></Label>
                <select
                  id="customer-kind"
                  className={selectClass}
                  value={form.customerKind}
                  onChange={(event) => update("customerKind", event.target.value as CustomerKind)}
                >
                  {CUSTOMER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{customerKindLabels[kind]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-name">نام مشتری<RequiredMark /></Label>
                <Input id="customer-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-legal-name">{form.customerKind === "ORGANIZATION" ? "نام ثبتی (حقوقی)" : "نام کامل (مطابق مدارک)"}</Label>
                <Input id="customer-legal-name" value={form.legalName} onChange={(event) => update("legalName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-national-id">{nationalIdLabel[form.customerKind]}</Label>
                <Input
                  id="customer-national-id"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={`${idLength.toLocaleString("fa-IR")} رقم`}
                  value={form.nationalId}
                  onChange={(event) => update("nationalId", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-economic-code">کد اقتصادی</Label>
                <Input
                  id="customer-economic-code"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.economicCode}
                  onChange={(event) => update("economicCode", event.target.value)}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="طبقه‌بندی">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-group">گروه مشتری<RequiredMark /></Label>
                <select
                  id="customer-group"
                  className={selectClass}
                  value={form.customerGroupId}
                  onChange={(event) => update("customerGroupId", event.target.value)}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.nameFa}{group.isActive ? "" : " (غیرفعال)"}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-territory">منطقه فروش</Label>
                <select
                  id="customer-territory"
                  className={selectClass}
                  value={form.territoryId}
                  onChange={(event) => update("territoryId", event.target.value)}
                >
                  <option value="">بدون منطقه</option>
                  {territories.map((territory) => (
                    <option key={territory.id} value={territory.id}>{territory.nameFa}{territory.isActive ? "" : " (غیرفعال)"}</option>
                  ))}
                </select>
              </div>
            </div>
          </FormSection>

          <FormSection title="ارتباطات">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-phone">تلفن<RequiredMark /></Label>
                <Input id="customer-phone" dir="ltr" inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-email">ایمیل</Label>
                <Input id="customer-email" dir="ltr" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} />
              </div>
            </div>
          </FormSection>

          {props.mode === "create" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <FormSection title="آدرس اول" description="اختیاری — به‌عنوان آدرس پیش‌فرض ثبت می‌شود">
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-address-type">نوع آدرس</Label>
                    <select
                      id="first-address-type"
                      className={selectClass}
                      value={form.addressType}
                      onChange={(event) => update("addressType", event.target.value as CustomerAddressType)}
                    >
                      {CUSTOMER_ADDRESS_TYPES.map((type) => (
                        <option key={type} value={type}>{addressTypeLabels[type]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-address-province">استان</Label>
                    <Input id="first-address-province" value={form.province} onChange={(event) => update("province", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-address-city">شهر</Label>
                    <Input id="first-address-city" value={form.city} onChange={(event) => update("city", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-address-postal-code">کد پستی</Label>
                    <Input id="first-address-postal-code" dir="ltr" inputMode="numeric" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="first-address-line">نشانی</Label>
                    <Input id="first-address-line" value={form.addressLine} onChange={(event) => update("addressLine", event.target.value)} />
                  </div>
                </div>
              </FormSection>

              <FormSection title="مخاطب اول" description="اختیاری — به‌عنوان مخاطب اصلی ثبت می‌شود">
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-contact-name">نام مخاطب</Label>
                    <Input id="first-contact-name" value={form.contactName} onChange={(event) => update("contactName", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-contact-role">سمت</Label>
                    <Input id="first-contact-role" value={form.contactRoleTitle} onChange={(event) => update("contactRoleTitle", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-contact-mobile">موبایل</Label>
                    <Input id="first-contact-mobile" dir="ltr" inputMode="tel" value={form.contactMobile} onChange={(event) => update("contactMobile", event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="first-contact-email">ایمیل</Label>
                    <Input id="first-contact-email" dir="ltr" type="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)} />
                  </div>
                </div>
              </FormSection>
            </div>
          ) : null}
        </form>

        {pendingDuplicates ? (
          <DuplicateCandidates
            candidates={pendingDuplicates.candidates}
            saving={saving}
            onConfirm={confirmDuplicates}
            onCancel={() => setPendingDuplicates(null)}
          />
        ) : null}

        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="customer-form" disabled={saving || staleRecord || pendingDuplicates !== null}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ثبت مشتری"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(props.mode === "edit" ? `/customers/${props.customerId}` : "/customers")}
          >
            انصراف
          </Button>
        </div>
      </div>
    </div>
  );
}
