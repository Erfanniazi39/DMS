"use client";

import { useFeature } from "@/lib/session";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeDigits } from "@/lib/number-input";
import { identityErrors, isValidPostalCode, normalizeSheba, shebaProblem } from "@/lib/iran-identifiers";
import {
  CUSTOMER_KINDS,
  RequiredMark,
  customerKindLabels,
  nationalIdLabel,
  nationalIdLength,
  selectClass,
  type CustomerDetail,
  type CustomerKind,
  type DuplicateCandidate,
  type ReferenceOption,
} from "./shared";
import { FormSection } from "./_form/FormSection";
import { DuplicateCandidates } from "./_form/DuplicateCandidates";
import { ordinal } from "./_form/ChildDrafts";
import { AddressDrafts, BankDrafts, ContactDrafts, emptyAddress, emptyBank, emptyContact, type AddressDraft, type BankDraft, type ContactDraft } from "./_form/ChildDrafts";

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
  title: string;
  registrationNumber: string;
  customerGroupId: string;
  territoryId: string;
  phone: string;
  phone2: string;
  mobile: string;
  fax: string;
  telex: string;
  website: string;
  email: string;
  taxOfficeProvince: string;
  taxOfficeCity: string;
};

const emptyForm: FormState = {
  customerKind: "ORGANIZATION",
  name: "",
  legalName: "",
  nationalId: "",
  economicCode: "",
  title: "",
  registrationNumber: "",
  customerGroupId: "",
  territoryId: "",
  phone: "",
  phone2: "",
  mobile: "",
  fax: "",
  telex: "",
  website: "",
  email: "",
  taxOfficeProvince: "",
  taxOfficeCity: "",
};

const isBlankAddress = (a: AddressDraft) => [a.province, a.city, a.addressLine, a.postalCode, a.country, a.cityCode, a.locationNumber, a.locationName].every((value) => value.trim() === "");
const isBlankBank = (b: BankDraft) => [b.bankName, b.accountNumber, b.sheba, b.holder].every((value) => value.trim() === "");
const isBlankContact = (c: ContactDraft) => [c.name, c.roleTitle, c.mobile, c.email].every((value) => value.trim() === "");

const toAddressPayload = (a: AddressDraft) => ({
  addressType: a.addressType,
  province: a.province.trim(),
  city: a.city.trim(),
  addressLine: a.addressLine.trim(),
  postalCode: normalizeDigits(a.postalCode).trim(),
  country: a.country.trim(),
  cityCode: a.cityCode.trim(),
  locationNumber: a.locationNumber.trim(),
  locationName: a.locationName.trim(),
});
const toBankPayload = (b: BankDraft) => ({
  bankName: b.bankName.trim(),
  accountNumber: normalizeDigits(b.accountNumber).trim(),
  shebaNumber: b.sheba.trim(),
  accountHolderName: b.holder.trim(),
});
const toContactPayload = (c: ContactDraft) => ({
  name: c.name.trim(),
  roleTitle: c.roleTitle.trim(),
  mobile: normalizeDigits(c.mobile).trim(),
  email: c.email.trim(),
});

type Props = { mode: "create" } | { mode: "edit"; customerId: number };

export function CustomerForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [form, setForm] = useState<FormState>(emptyForm);
  // Create mode: first (and further) address / bank account / contact. Entry 0 is the default/primary one.
  const [addresses, setAddresses] = useState<AddressDraft[]>([emptyAddress()]);
  const [banks, setBanks] = useState<BankDraft[]>([emptyBank()]);
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<ReferenceOption[]>([]);
  const [territories, setTerritories] = useState<ReferenceOption[]>([]);
  // Territories are hidden in v1 (feature flag): no picker, no request; an existing value is left untouched.
  const territoriesOn = useFeature("customerTerritories");
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
          territoriesOn ? apiFetch<ReferenceOption[]>("/territories") : Promise.resolve([] as ReferenceOption[]),
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
            title: customer.title ?? "",
            registrationNumber: customer.registrationNumber ?? "",
            customerGroupId: String(customer.customerGroupId),
            territoryId: customer.territoryId ? String(customer.territoryId) : "",
            phone: customer.phone,
            phone2: customer.phone2 ?? "",
            mobile: customer.mobile ?? "",
            fax: customer.fax ?? "",
            telex: customer.telex ?? "",
            website: customer.website ?? "",
            email: customer.email ?? "",
            taxOfficeProvince: customer.taxOfficeProvince ?? "",
            taxOfficeCity: customer.taxOfficeCity ?? "",
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
  }, [editId, pushError, territoriesOn]);

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
    errors.push(
      ...identityErrors({
        kind: form.customerKind,
        nationalId: normalizeDigits(form.nationalId).trim(),
        economicCode: normalizeDigits(form.economicCode).trim(),
      }),
    );
    if (props.mode === "create") {
      addresses.forEach((address, index) => {
        if (isBlankAddress(address)) return;
        const label = `آدرس ${ordinal(index)}`;
        const postalCode = normalizeDigits(address.postalCode).trim();
        if (!address.addressLine.trim()) errors.push(`برای ثبت ${label}، نشانی الزامی است.`);
        if (postalCode && !address.country.trim() && !isValidPostalCode(postalCode)) errors.push(`${label}: کد پستی باید ۱۰ رقم باشد.`);
      });
      banks.forEach((bank, index) => {
        if (isBlankBank(bank)) return;
        const label = `حساب بانکی ${ordinal(index)}`;
        const sheba = normalizeSheba(normalizeDigits(bank.sheba));
        if (!bank.accountNumber.trim() && !sheba) errors.push(`برای ثبت ${label}، شماره حساب یا شماره شبا الزامی است.`);
        const shebaIssue = sheba ? shebaProblem(sheba) : null;
        if (shebaIssue) errors.push(`${label}: ${shebaIssue}`);
      });
      contacts.forEach((contact, index) => {
        if (isBlankContact(contact)) return;
        if (!contact.name.trim()) errors.push(`برای ثبت مخاطب ${ordinal(index)}، نام مخاطب الزامی است.`);
      });
      // A second entry needs the first one filled in (the first is the default/primary).
      if (addresses.length > 1 && isBlankAddress(addresses[0]) && addresses.slice(1).some((a) => !isBlankAddress(a))) errors.push("برای ثبت آدرس دوم، ابتدا آدرس اول را کامل کنید.");
      if (banks.length > 1 && isBlankBank(banks[0]) && banks.slice(1).some((b) => !isBlankBank(b))) errors.push("برای ثبت حساب بانکی دوم، ابتدا حساب اول را کامل کنید.");
      if (contacts.length > 1 && isBlankContact(contacts[0]) && contacts.slice(1).some((c) => !isBlankContact(c))) errors.push("برای ثبت مخاطب دوم، ابتدا مخاطب اول را کامل کنید.");
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
      title: form.title.trim(),
      registrationNumber: normalizeDigits(form.registrationNumber).trim(),
      customerGroupId: Number(form.customerGroupId),
      territoryId: form.territoryId ? Number(form.territoryId) : undefined,
      phone: normalizeDigits(form.phone).trim(),
      phone2: normalizeDigits(form.phone2).trim(),
      mobile: normalizeDigits(form.mobile).trim(),
      fax: normalizeDigits(form.fax).trim(),
      telex: form.telex.trim(),
      website: form.website.trim(),
      email: form.email.trim(),
      taxOfficeProvince: form.taxOfficeProvince.trim(),
      taxOfficeCity: form.taxOfficeCity.trim(),
    };
    if (props.mode === "create") {
      const addressPayloads = addresses.filter((address) => !isBlankAddress(address)).map(toAddressPayload);
      const bankPayloads = banks.filter((bank) => !isBlankBank(bank)).map(toBankPayload);
      const contactPayloads = contacts.filter((contact) => !isBlankContact(contact)).map(toContactPayload);
      if (addressPayloads.length > 0) payload.firstAddress = addressPayloads[0];
      if (addressPayloads.length > 1) payload.additionalAddresses = addressPayloads.slice(1);
      if (bankPayloads.length > 0) payload.firstBankAccount = bankPayloads[0];
      if (bankPayloads.length > 1) payload.additionalBankAccounts = bankPayloads.slice(1);
      if (contactPayloads.length > 0) payload.firstContact = contactPayloads[0];
      if (contactPayloads.length > 1) payload.additionalContacts = contactPayloads.slice(1);
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
                <Label htmlFor="customer-title">عنوان</Label>
                <Input id="customer-title" placeholder="مثلاً شرکت، فروشگاه، آقای" value={form.title} onChange={(event) => update("title", event.target.value)} />
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
                <Label htmlFor="customer-national-id">{nationalIdLabel[form.customerKind]}<RequiredMark /></Label>
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
                <Label htmlFor="customer-economic-code">کد اقتصادی{form.customerKind === "ORGANIZATION" ? <RequiredMark /> : null}</Label>
                <Input
                  id="customer-economic-code"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="۱۲ یا ۱۴ رقم"
                  value={form.economicCode}
                  onChange={(event) => update("economicCode", event.target.value)}
                />
              </div>
              {form.customerKind === "ORGANIZATION" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customer-registration-number">شماره ثبت</Label>
                  <Input id="customer-registration-number" dir="ltr" inputMode="numeric" value={form.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} />
                </div>
              ) : null}
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
              {territoriesOn ? <div className="flex flex-col gap-1.5">
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
              </div> : null}
            </div>
          </FormSection>

          <FormSection title="ارتباطات">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-phone">تلفن ۱<RequiredMark /></Label>
                <Input id="customer-phone" dir="ltr" inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-phone2">تلفن ۲</Label>
                <Input id="customer-phone2" dir="ltr" inputMode="tel" value={form.phone2} onChange={(event) => update("phone2", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-email">ایمیل</Label>
                <Input id="customer-email" dir="ltr" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-mobile">موبایل</Label>
                <Input id="customer-mobile" dir="ltr" inputMode="tel" value={form.mobile} onChange={(event) => update("mobile", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-fax">فکس</Label>
                <Input id="customer-fax" dir="ltr" inputMode="tel" value={form.fax} onChange={(event) => update("fax", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-telex">تلکس</Label>
                <Input id="customer-telex" dir="ltr" value={form.telex} onChange={(event) => update("telex", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-website">وب‌سایت</Label>
                <Input id="customer-website" dir="ltr" value={form.website} onChange={(event) => update("website", event.target.value)} />
              </div>
            </div>
          </FormSection>

          <FormSection title="اداره دارایی" description="استان و شهر مطابق اداره امور مالیاتی (متن آزاد)">
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-tax-province">استان (دارایی)</Label>
                <Input id="customer-tax-province" value={form.taxOfficeProvince} onChange={(event) => update("taxOfficeProvince", event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-tax-city">شهر (دارایی)</Label>
                <Input id="customer-tax-city" value={form.taxOfficeCity} onChange={(event) => update("taxOfficeCity", event.target.value)} />
              </div>
            </div>
          </FormSection>

          {props.mode === "create" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <AddressDrafts drafts={addresses} onChange={setAddresses} />
              <ContactDrafts drafts={contacts} onChange={setContacts} />
              <BankDrafts drafts={banks} onChange={setBanks} />
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
