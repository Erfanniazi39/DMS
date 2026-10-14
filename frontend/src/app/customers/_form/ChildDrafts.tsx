"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOMER_ADDRESS_TYPES, addressTypeLabels, selectClass, type CustomerAddressType } from "../shared";
import { FormSection } from "./FormSection";

// The "first / second / … address, bank account, contact" blocks of the
// create form. Entry 0 of each list is the first (saved as default/primary);
// «افزودن … دوم» appends further blank entries. A fully blank entry is skipped
// on save (CustomerForm.tsx).

export type AddressDraft = {
  addressType: CustomerAddressType;
  province: string;
  city: string;
  addressLine: string;
  postalCode: string;
  country: string;
  cityCode: string;
  locationNumber: string;
  locationName: string;
};
export type BankDraft = { bankName: string; accountNumber: string; sheba: string; holder: string };
export type ContactDraft = { name: string; roleTitle: string; mobile: string; email: string };

export const emptyAddress = (): AddressDraft => ({ addressType: "BILLING", province: "", city: "", addressLine: "", postalCode: "", country: "", cityCode: "", locationNumber: "", locationName: "" });
export const emptyBank = (): BankDraft => ({ bankName: "", accountNumber: "", sheba: "", holder: "" });
export const emptyContact = (): ContactDraft => ({ name: "", roleTitle: "", mobile: "", email: "" });

export const MAX_DRAFTS = 10;
const ORDINALS = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم", "هفتم", "هشتم", "نهم", "دهم"];
export const ordinal = (index: number) => ORDINALS[index] ?? String(index + 1);

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// Wraps one entry: title, optional remove button (not for the first), fields.
function DraftBlock({ title, description, onRemove, children }: { title: string; description?: string; onRemove?: () => void; children: React.ReactNode }) {
  return (
    <FormSection title={title} description={description}>
      {onRemove ? (
        <div className="-mt-1 mb-1 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}><Trash2 /> حذف</Button>
        </div>
      ) : null}
      {children}
    </FormSection>
  );
}

export function AddMoreButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}><Plus /> {label}</Button>
  );
}

export function AddressDrafts({ drafts, onChange }: { drafts: AddressDraft[]; onChange: (drafts: AddressDraft[]) => void }) {
  const set = (index: number, patch: Partial<AddressDraft>) => onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  return (
    <div className="space-y-3">
      {drafts.map((draft, index) => {
        const id = `address-${index}`;
        return (
          <DraftBlock
            key={index}
            title={`آدرس ${ordinal(index)}`}
            description={index === 0 ? "اختیاری — به‌عنوان آدرس پیش‌فرض ثبت می‌شود" : undefined}
            onRemove={index > 0 ? () => onChange(drafts.filter((_, i) => i !== index)) : undefined}
          >
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <Field id={`${id}-type`} label="نوع آدرس">
                <select id={`${id}-type`} className={selectClass} value={draft.addressType} onChange={(event) => set(index, { addressType: event.target.value as CustomerAddressType })}>
                  {CUSTOMER_ADDRESS_TYPES.map((type) => <option key={type} value={type}>{addressTypeLabels[type]}</option>)}
                </select>
              </Field>
              <Field id={`${id}-province`} label="استان"><Input id={`${id}-province`} value={draft.province} onChange={(event) => set(index, { province: event.target.value })} /></Field>
              <Field id={`${id}-city`} label="شهر"><Input id={`${id}-city`} value={draft.city} onChange={(event) => set(index, { city: event.target.value })} /></Field>
              <Field id={`${id}-postal`} label="کد پستی"><Input id={`${id}-postal`} dir="ltr" inputMode="numeric" placeholder="۱۰ رقم" value={draft.postalCode} onChange={(event) => set(index, { postalCode: event.target.value })} /></Field>
              <Field id={`${id}-country`} label="کشور"><Input id={`${id}-country`} placeholder="خالی = ایران" value={draft.country} onChange={(event) => set(index, { country: event.target.value })} /></Field>
              <Field id={`${id}-city-code`} label="کد شهر"><Input id={`${id}-city-code`} dir="ltr" value={draft.cityCode} onChange={(event) => set(index, { cityCode: event.target.value })} /></Field>
              <Field id={`${id}-loc-number`} label="شماره محل"><Input id={`${id}-loc-number`} dir="ltr" value={draft.locationNumber} onChange={(event) => set(index, { locationNumber: event.target.value })} /></Field>
              <Field id={`${id}-loc-name`} label="نام محل"><Input id={`${id}-loc-name`} value={draft.locationName} onChange={(event) => set(index, { locationName: event.target.value })} /></Field>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor={`${id}-line`}>نشانی</Label>
                <Input id={`${id}-line`} value={draft.addressLine} onChange={(event) => set(index, { addressLine: event.target.value })} />
              </div>
            </div>
          </DraftBlock>
        );
      })}
      <AddMoreButton label={`افزودن آدرس ${ordinal(drafts.length)}`} onClick={() => onChange([...drafts, emptyAddress()])} disabled={drafts.length >= MAX_DRAFTS} />
    </div>
  );
}

export function ContactDrafts({ drafts, onChange }: { drafts: ContactDraft[]; onChange: (drafts: ContactDraft[]) => void }) {
  const set = (index: number, patch: Partial<ContactDraft>) => onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  return (
    <div className="space-y-3">
      {drafts.map((draft, index) => {
        const id = `contact-${index}`;
        return (
          <DraftBlock
            key={index}
            title={`مخاطب ${ordinal(index)}`}
            description={index === 0 ? "اختیاری — به‌عنوان مخاطب اصلی ثبت می‌شود" : undefined}
            onRemove={index > 0 ? () => onChange(drafts.filter((_, i) => i !== index)) : undefined}
          >
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <Field id={`${id}-name`} label="نام مخاطب"><Input id={`${id}-name`} value={draft.name} onChange={(event) => set(index, { name: event.target.value })} /></Field>
              <Field id={`${id}-role`} label="سمت"><Input id={`${id}-role`} value={draft.roleTitle} onChange={(event) => set(index, { roleTitle: event.target.value })} /></Field>
              <Field id={`${id}-mobile`} label="موبایل"><Input id={`${id}-mobile`} dir="ltr" inputMode="tel" value={draft.mobile} onChange={(event) => set(index, { mobile: event.target.value })} /></Field>
              <Field id={`${id}-email`} label="ایمیل"><Input id={`${id}-email`} dir="ltr" type="email" value={draft.email} onChange={(event) => set(index, { email: event.target.value })} /></Field>
            </div>
          </DraftBlock>
        );
      })}
      <AddMoreButton label={`افزودن مخاطب ${ordinal(drafts.length)}`} onClick={() => onChange([...drafts, emptyContact()])} disabled={drafts.length >= MAX_DRAFTS} />
    </div>
  );
}

export function BankDrafts({ drafts, onChange }: { drafts: BankDraft[]; onChange: (drafts: BankDraft[]) => void }) {
  const set = (index: number, patch: Partial<BankDraft>) => onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  return (
    <div className="space-y-3">
      {drafts.map((draft, index) => {
        const id = `bank-${index}`;
        return (
          <DraftBlock
            key={index}
            title={`حساب بانکی ${ordinal(index)}`}
            description={index === 0 ? "اختیاری — به‌عنوان حساب پیش‌فرض ثبت می‌شود" : undefined}
            onRemove={index > 0 ? () => onChange(drafts.filter((_, i) => i !== index)) : undefined}
          >
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <Field id={`${id}-name`} label="بانک"><Input id={`${id}-name`} value={draft.bankName} onChange={(event) => set(index, { bankName: event.target.value })} /></Field>
              <Field id={`${id}-holder`} label="نام صاحب حساب"><Input id={`${id}-holder`} value={draft.holder} onChange={(event) => set(index, { holder: event.target.value })} /></Field>
              <Field id={`${id}-account`} label="شماره حساب"><Input id={`${id}-account`} dir="ltr" inputMode="numeric" value={draft.accountNumber} onChange={(event) => set(index, { accountNumber: event.target.value })} /></Field>
              <Field id={`${id}-sheba`} label="شماره شبا"><Input id={`${id}-sheba`} dir="ltr" placeholder="IR…" value={draft.sheba} onChange={(event) => set(index, { sheba: event.target.value })} /></Field>
            </div>
          </DraftBlock>
        );
      })}
      <AddMoreButton label={`افزودن حساب بانکی ${ordinal(drafts.length)}`} onClick={() => onChange([...drafts, emptyBank()])} disabled={drafts.length >= MAX_DRAFTS} />
    </div>
  );
}
