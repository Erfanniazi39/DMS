import { z } from 'zod';
import { emptyToUndefined, enumField, optionalEmail, optionalTrimmedString } from '../../common/zod-fields';
import {
  asciiDigitsInput,
  bankAccountFields,
  optionalDigitsText,
  optionalPhone,
  optionalWebsite,
  partyIdentityRefine,
  postalCodeRefine,
  refineBankAccountHasNumber,
} from '../../common/party-fields';

// Shared "empty string means not provided" convention (common/zod-fields.ts)
// — an empty form field is treated as omitted, not validated as empty.
// Persian/Arabic digits in numeric fields are accepted and stored as ASCII.

export const SUPPLIER_KINDS = ['INDIVIDUAL', 'ORGANIZATION'] as const;
const SUPPLIER_STATUSES = ['active', 'inactive', 'blacklisted'] as const;

// کد ملی (INDIVIDUAL, 10 digits) / شناسه ملی (ORGANIZATION, 11 digits) — one
// column, the exact rule depends on supplierKind (identityRefine below).
const nationalIdField = optionalDigitsText(11, 'شناسه/کد ملی فقط باید شامل رقم باشد');

const supplierFields = {
  code: z.string().trim().min(1, 'کد تأمین‌کننده الزامی است').max(40),
  name: z.string().trim().min(1, 'نام تأمین‌کننده الزامی است').max(150),
  supplierKind: z.preprocess((value) => (value === '' || value === null ? undefined : value), enumField(SUPPLIER_KINDS, 'نوع شخص (حقیقی/حقوقی) نامعتبر است').optional()),
  title: optionalTrimmedString(100),
  nationalId: nationalIdField,
  economicCode: optionalDigitsText(20, 'کد اقتصادی فقط باید شامل رقم باشد'),
  registrationNumber: optionalDigitsText(30, 'شماره ثبت فقط باید شامل رقم باشد'),
  phone: optionalPhone,
  phone2: optionalPhone,
  mobile: optionalPhone,
  fax: optionalPhone,
  telex: optionalTrimmedString(30),
  website: optionalWebsite,
  email: optionalEmail,
  // «نشانی ۱» / «نشانی ۲»
  address: optionalTrimmedString(500),
  address2: optionalTrimmedString(500),
  province: optionalTrimmedString(100),
  city: optionalTrimmedString(100),
  // Iranian addresses are held to exactly 10 digits in identityRefine; a
  // foreign postal code may contain letters.
  postalCode: z.preprocess(asciiDigitsInput, z.string().max(20, 'حداکثر ۲۰ کاراکتر مجاز است').optional()),
  // Free text; empty = ایران. A non-Iranian country is exempt from the
  // Iranian identifier/postal-code formats.
  country: optionalTrimmedString(100),
  cityCode: optionalTrimmedString(30),
  locationNumber: optionalTrimmedString(50),
  locationName: optionalTrimmedString(150),
  taxOfficeProvince: optionalTrimmedString(100),
  taxOfficeCity: optionalTrimmedString(100),
  note: optionalTrimmedString(500),
};

type IdentityShape = {
  supplierKind?: (typeof SUPPLIER_KINDS)[number];
  nationalId?: string;
  economicCode?: string;
  postalCode?: string;
  country?: string;
  status?: (typeof SUPPLIER_STATUSES)[number];
};

// Identity is enforced only while the supplier is (or becomes) active: status
// changes ride on the same full-replace PATCH, and an old incomplete record
// must still be deactivatable/blacklistable.
function identityRefine(value: IdentityShape, ctx: z.RefinementCtx) {
  if (value.status && value.status !== 'active') return;
  if (!value.supplierKind) {
    ctx.addIssue({ code: 'custom', path: ['supplierKind'], message: 'نوع شخص (حقیقی/حقوقی) الزامی است' });
    return;
  }
  partyIdentityRefine(value, value.supplierKind, ctx);
  postalCodeRefine(value.postalCode, value.country, ctx);
}

export const supplierBankAccountSchema = z
  .object(bankAccountFields, { error: 'اطلاعات حساب بانکی نامعتبر است' })
  .superRefine(refineBankAccountHasNumber);

const firstBankAccountSchema = z
  .object(bankAccountFields, { error: 'اطلاعات حساب بانکی نامعتبر است' })
  .omit({ isDefault: true, isActive: true })
  .superRefine(refineBankAccountHasNumber);

// What we buy from the supplier: its purchase types (ids) and a free-text list
// of goods. Both are a full replace on update (omitted = empty).
const purchaseTypeIdsSchema = z
  .array(z.number().int().positive(), { error: 'نوع خرید نامعتبر است' })
  .max(20, 'حداکثر ۲۰ نوع خرید')
  .default([])
  .transform((ids) => [...new Set(ids)]);

const supplierGoodSchema = z.object({
  name: z.string().trim().min(1, 'نام کالا الزامی است').max(150),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()),
});
const goodsSchema = z.array(supplierGoodSchema, { error: 'فهرست کالاها نامعتبر است' }).max(100, 'حداکثر ۱۰۰ کالا').default([]);

const supplierOfferingFields = { purchaseTypeIds: purchaseTypeIdsSchema, goods: goodsSchema };

export const createSupplierSchema = z
  .object({ ...supplierFields, ...supplierOfferingFields, firstBankAccount: firstBankAccountSchema.optional() })
  .superRefine(identityRefine);

export const updateSupplierSchema = z
  .object({ ...supplierFields, ...supplierOfferingFields, status: z.enum(SUPPLIER_STATUSES) })
  .superRefine(identityRefine);

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
export type SupplierBankAccountDto = z.infer<typeof supplierBankAccountSchema>;
