"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { fillSuggestedCode } from "@/lib/suggested-code";
import { identityErrors, isIranCountry, isValidPostalCode, normalizeSheba, shebaProblem } from "@/lib/iran-identifiers";
import { normalizeDigits } from "@/lib/number-input";
import { EMAIL_PATTERN, kindLabels, nationalIdLabel, selectClass, statusLabels, textareaClass, type PurchaseTypeRef, type SupplierDetail, type SupplierKind, type SupplierStatus } from "./shared";

type FormState = {
  code: string;
  name: string;
  supplierKind: SupplierKind | "";
  title: string;
  nationalId: string;
  economicCode: string;
  registrationNumber: string;
  status: SupplierStatus;
  phone: string;
  phone2: string;
  mobile: string;
  fax: string;
  telex: string;
  website: string;
  email: string;
  address: string;
  address2: string;
  province: string;
  city: string;
  postalCode: string;
  country: string;
  cityCode: string;
  locationNumber: string;
  locationName: string;
  taxOfficeProvince: string;
  taxOfficeCity: string;
  note: string;
  purchaseTypeIds: number[];
  goods: { name: string; note: string }[];
  // create only
  bankName: string;
  bankAccountNumber: string;
  bankSheba: string;
  bankHolder: string;
};

const emptyForm: FormState = {
  code: "", name: "", supplierKind: "", title: "", nationalId: "", economicCode: "", registrationNumber: "", status: "active",
  phone: "", phone2: "", mobile: "", fax: "", telex: "", website: "", email: "",
  address: "", address2: "", province: "", city: "", postalCode: "", country: "", cityCode: "", locationNumber: "", locationName: "",
  taxOfficeProvince: "", taxOfficeCity: "", note: "", purchaseTypeIds: [], goods: [], bankName: "", bankAccountNumber: "", bankSheba: "", bankHolder: "",
};

function fromSupplier(s: SupplierDetail): FormState {
  const v = (x: string | null) => x ?? "";
  return {
    ...emptyForm,
    code: s.code, name: s.name, supplierKind: s.supplierKind ?? "", title: v(s.title), nationalId: v(s.nationalId), economicCode: v(s.economicCode),
    registrationNumber: v(s.registrationNumber), status: s.status, phone: v(s.phone), phone2: v(s.phone2), mobile: v(s.mobile), fax: v(s.fax),
    telex: v(s.telex), website: v(s.website), email: v(s.email), address: v(s.address), address2: v(s.address2), province: v(s.province),
    city: v(s.city), postalCode: v(s.postalCode), country: v(s.country), cityCode: v(s.cityCode), locationNumber: v(s.locationNumber),
    locationName: v(s.locationName), taxOfficeProvince: v(s.taxOfficeProvince), taxOfficeCity: v(s.taxOfficeCity), note: v(s.note),
    purchaseTypeIds: s.purchaseTypes.map((type) => type.id), goods: s.goods.map((good) => ({ name: good.name, note: good.note ?? "" })),
  };
}

const sectionTitle = "mt-1 border-t border-border pt-3 col-span-full";

// Create / edit page form (/suppliers/new, /suppliers/[id]/edit). Identity
// (نوع شخص + شناسه/کد ملی + کد اقتصادی) is required while the supplier is
// active; an inactive or blacklisted old record can be saved without it. Bank
// accounts are managed on the detail page; create offers an optional first
// account. «نوع خرید» (several) and «کالاهای تأمین‌شده» (free text) say what we
// buy from the supplier — the first drives the type auto-fill on purchases.
export function SupplierForm({ editing }: { editing: SupplierDetail | null }) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const [purchaseTypes, setPurchaseTypes] = useState<PurchaseTypeRef[]>([]);
  const [form, setForm] = useState<FormState>(editing ? fromSupplier(editing) : emptyForm);
  const [saving, setSaving] = useState(false);

  // New supplier: offer the next code (editable); the dialog is mounted per open.
  useEffect(() => {
    apiFetch<PurchaseTypeRef[]>("/purchase-types").then(setPurchaseTypes).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (editing) return;
    fillSuggestedCode("/suppliers/next-code", (code) => setForm((current) => (current.code === "" ? { ...current, code } : current)));
  }, [editing]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function text(id: string, label: string, key: keyof FormState, options: { ltr?: boolean; numeric?: boolean; placeholder?: string; required?: boolean } = {}) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{label}{options.required ? <span className="text-destructive"> *</span> : null}</Label>
        <Input
          id={id}
          dir={options.ltr ? "ltr" : undefined}
          inputMode={options.numeric ? "numeric" : undefined}
          placeholder={options.placeholder}
          value={form[key] as string}
          onChange={(event) => update(key, event.target.value as never)}
        />
      </div>
    );
  }

  function validate(): string[] {
    const errors: string[] = [];
    if (!form.code.trim() || !form.name.trim()) errors.push("کد و نام تأمین‌کننده الزامی است.");
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.push("ایمیل معتبر نیست.");
    const postalCode = normalizeDigits(form.postalCode).trim();
    if (form.status === "active") {
      if (!form.supplierKind) errors.push("نوع شخص (حقیقی/حقوقی) الزامی است.");
      else {
        errors.push(
          ...identityErrors({
            kind: form.supplierKind,
            nationalId: normalizeDigits(form.nationalId).trim(),
            economicCode: normalizeDigits(form.economicCode).trim(),
            country: form.country,
          }),
        );
        if (postalCode && isIranCountry(form.country) && !isValidPostalCode(postalCode)) errors.push("کد پستی باید ۱۰ رقم باشد.");
      }
    }
    if (!editing) {
      const sheba = normalizeSheba(normalizeDigits(form.bankSheba));
      const any = [form.bankName, form.bankHolder, form.bankAccountNumber].some((x) => x.trim()) || sheba;
      if (any && !form.bankAccountNumber.trim() && !sheba) errors.push("برای ثبت حساب بانکی، شماره حساب یا شماره شبا الزامی است.");
      const shebaIssue = sheba ? shebaProblem(sheba) : null;
      if (shebaIssue) errors.push(shebaIssue);
    }
    return errors;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    if (errors.length > 0) {
      pushErrors(errors);
      return;
    }
    const digits = (value: string) => normalizeDigits(value).trim();
    const payload: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      supplierKind: form.supplierKind || undefined,
      title: form.title.trim(),
      nationalId: digits(form.nationalId),
      economicCode: digits(form.economicCode),
      registrationNumber: digits(form.registrationNumber),
      phone: digits(form.phone),
      phone2: digits(form.phone2),
      mobile: digits(form.mobile),
      fax: digits(form.fax),
      telex: form.telex.trim(),
      website: form.website.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      address2: form.address2.trim(),
      province: form.province.trim(),
      city: form.city.trim(),
      postalCode: digits(form.postalCode),
      country: form.country.trim(),
      cityCode: form.cityCode.trim(),
      locationNumber: form.locationNumber.trim(),
      locationName: form.locationName.trim(),
      taxOfficeProvince: form.taxOfficeProvince.trim(),
      taxOfficeCity: form.taxOfficeCity.trim(),
      note: form.note.trim(),
      purchaseTypeIds: form.purchaseTypeIds,
      goods: form.goods.filter((good) => good.name.trim()).map((good) => ({ name: good.name.trim(), note: good.note.trim() })),
    };
    if (editing) payload.status = form.status;
    else if (form.bankAccountNumber.trim() || form.bankSheba.trim()) {
      payload.firstBankAccount = {
        bankName: form.bankName.trim(),
        accountNumber: digits(form.bankAccountNumber),
        shebaNumber: form.bankSheba.trim(),
        accountHolderName: form.bankHolder.trim(),
      };
    }
    setSaving(true);
    try {
      const saved = await apiFetch<{ id: number }>(editing ? `/suppliers/${editing.id}` : "/suppliers", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      pushSuccess(editing ? "اطلاعات تأمین‌کننده با موفقیت ویرایش شد." : "تأمین‌کننده جدید با موفقیت ایجاد شد.");
      router.push(`/suppliers/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره تأمین‌کننده ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  const kind = form.supplierKind || null;
  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-3">
        <h1 className="text-lg font-semibold tracking-tight">{editing ? "ویرایش تأمین‌کننده" : "ثبت تأمین‌کننده جدید"}</h1>
        <div className="rounded-lg border border-border bg-card p-4">
          <form id="supplier-form" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" onSubmit={save} noValidate>
            <div className="col-span-full"><h3 className="text-sm font-medium text-foreground">هویت</h3></div>
            {text("supplier-code", "کد تأمین‌کننده", "code", { required: true })}
            {text("supplier-name", "نام تأمین‌کننده", "name", { required: true })}
            <div className="flex flex-col gap-2">
              <Label htmlFor="supplier-kind">نوع شخص{form.status === "active" ? <span className="text-destructive"> *</span> : null}</Label>
              <select id="supplier-kind" className={selectClass} value={form.supplierKind} onChange={(event) => update("supplierKind", event.target.value as SupplierKind | "")}>
                <option value="">انتخاب کنید</option>
                {(Object.keys(kindLabels) as SupplierKind[]).map((k) => (
                  <option key={k} value={k}>{kindLabels[k]}</option>
                ))}
              </select>
            </div>
            {text("supplier-title", "عنوان", "title", { placeholder: "مثلاً شرکت، فروشگاه، آقای" })}
            {text("supplier-national-id", kind ? nationalIdLabel[kind] : "شناسه / کد ملی", "nationalId", { ltr: true, numeric: true, required: form.status === "active" })}
            {text("supplier-economic-code", "کد اقتصادی", "economicCode", { ltr: true, numeric: true, placeholder: "۱۲ یا ۱۴ رقم", required: form.status === "active" && kind === "ORGANIZATION" })}
            {kind === "ORGANIZATION" ? text("supplier-registration", "شماره ثبت", "registrationNumber", { ltr: true, numeric: true }) : null}
            {editing ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="supplier-status">وضعیت</Label>
                <select id="supplier-status" className={selectClass} value={form.status} onChange={(event) => update("status", event.target.value as SupplierStatus)}>
                  {(Object.keys(statusLabels) as SupplierStatus[]).map((s) => (
                    <option key={s} value={s}>{statusLabels[s]}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">اطلاعات تماس</h3></div>
            {text("supplier-phone", "تلفن ۱", "phone", { ltr: true, numeric: true })}
            {text("supplier-phone2", "تلفن ۲", "phone2", { ltr: true, numeric: true })}
            {text("supplier-mobile", "موبایل", "mobile", { ltr: true, numeric: true })}
            {text("supplier-fax", "فکس", "fax", { ltr: true, numeric: true })}
            {text("supplier-telex", "تلکس", "telex", { ltr: true })}
            {text("supplier-website", "وب‌سایت", "website", { ltr: true })}
            {text("supplier-email", "ایمیل", "email", { ltr: true })}

            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">نشانی</h3></div>
            {text("supplier-country", "کشور", "country", { placeholder: "خالی = ایران" })}
            {text("supplier-province", "استان", "province")}
            {text("supplier-city", "شهر", "city")}
            {text("supplier-city-code", "کد شهر", "cityCode", { ltr: true })}
            {text("supplier-postal", "کد پستی", "postalCode", { ltr: true, numeric: true, placeholder: "۱۰ رقم" })}
            {text("supplier-location-number", "شماره محل", "locationNumber", { ltr: true })}
            {text("supplier-location-name", "نام محل", "locationName")}
            <div className="flex flex-col gap-2 col-span-full">
              <Label htmlFor="supplier-address">نشانی ۱</Label>
              <textarea id="supplier-address" className={textareaClass} value={form.address} onChange={(event) => update("address", event.target.value)} />
            </div>
            <div className="flex flex-col gap-2 col-span-full">
              <Label htmlFor="supplier-address2">نشانی ۲</Label>
              <textarea id="supplier-address2" className={textareaClass} value={form.address2} onChange={(event) => update("address2", event.target.value)} />
            </div>

            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">اداره دارایی</h3></div>
            {text("supplier-tax-province", "استان (دارایی)", "taxOfficeProvince")}
            {text("supplier-tax-city", "شهر (دارایی)", "taxOfficeCity")}

            {!editing ? (
              <>
                <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">حساب بانکی اول (اختیاری)</h3></div>
                {text("supplier-bank-name", "نام بانک", "bankName")}
                {text("supplier-bank-holder", "نام صاحب حساب", "bankHolder")}
                {text("supplier-bank-account", "شماره حساب", "bankAccountNumber", { ltr: true, numeric: true })}
                {text("supplier-bank-sheba", "شماره شبا", "bankSheba", { ltr: true, placeholder: "IR…" })}
              </>
            ) : null}


            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">نوع خرید</h3><p className="mt-0.5 text-xs text-muted-foreground">انواع خریدی که از این تأمین‌کننده انجام می‌شود. در فرم خرید، با انتخاب تأمین‌کننده نوع خرید خودکار پر می‌شود (اگر یک نوع باشد).</p></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 col-span-full">
              {purchaseTypes.filter((type) => type.isActive || form.purchaseTypeIds.includes(type.id)).map((type) => (
                <label key={type.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.purchaseTypeIds.includes(type.id)}
                    onChange={(event) => update("purchaseTypeIds", event.target.checked ? [...form.purchaseTypeIds, type.id] : form.purchaseTypeIds.filter((id) => id !== type.id))}
                  />
                  {type.nameFa}{type.isActive ? "" : " (غیرفعال)"}
                </label>
              ))}
              {purchaseTypes.length === 0 ? <p className="text-sm text-muted-foreground">نوع خریدی تعریف نشده است.</p> : null}
            </div>

            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">کالاهای تأمین‌شده</h3><p className="mt-0.5 text-xs text-muted-foreground">چه کالا یا موادی از این تأمین‌کننده می‌گیریم (متن آزاد؛ جستجوی تأمین‌کنندگان در این فهرست هم انجام می‌شود).</p></div>
            <div className="space-y-2 col-span-full">
              {form.goods.map((good, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
                  <Input aria-label={`نام کالا ${index + 1}`} placeholder="نام کالا (مثلاً شیر خام)" value={good.name} onChange={(event) => update("goods", form.goods.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
                  <Input aria-label={`توضیح کالا ${index + 1}`} placeholder="توضیح (اختیاری)" value={good.note} onChange={(event) => update("goods", form.goods.map((item, i) => (i === index ? { ...item, note: event.target.value } : item)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label="حذف کالا" onClick={() => update("goods", form.goods.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={form.goods.length >= 100} onClick={() => update("goods", [...form.goods, { name: "", note: "" }])}><Plus /> افزودن کالا</Button>
            </div>

            <div className={sectionTitle}><h3 className="text-sm font-medium text-foreground">یادداشت</h3></div>
            <div className="flex flex-col gap-2 col-span-full">
              <textarea id="supplier-note" aria-label="یادداشت" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
            </div>
          </form>
        </div>
        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="supplier-form" disabled={saving}>
            {saving ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : "ثبت تأمین‌کننده"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(editing ? `/suppliers/${editing.id}` : "/suppliers")}>
            انصراف
          </Button>
        </div>
      </div>
    </div>
  );
}
