import { z } from 'zod';

// Same "empty string means not provided" convention used by the other DTOs
// in this project (see employee.dto.ts) — an empty form field should be
// treated as omitted, not validated as an empty value.
function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

// Digits only, 6–15 characters — lenient enough for a landline, a mobile
// number, or a foreign supplier's number with a country code, without
// enforcing a specific national format.
const optionalPhone = z.preprocess(
  emptyToUndefined,
  z.string().trim().regex(/^[0-9]{6,15}$/, 'تلفن معتبر نیست').optional(),
);

const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().email('ایمیل معتبر نیست').optional());

// شناسه ملی — 10 digits for an individual (همان فرمت کد ملی), 11 for a legal
// entity. A supplier can be either, so both lengths are accepted.
const optionalNationalId = z.preprocess(
  emptyToUndefined,
  z.string().trim().regex(/^[0-9]{10,11}$/, 'شناسه ملی باید ۱۰ یا ۱۱ رقم انگلیسی باشد').optional(),
);

const SUPPLIER_STATUSES = ['active', 'inactive', 'blacklisted'] as const;

export const createSupplierSchema = z.object({
  code: z.string().trim().min(1, 'کد تأمین‌کننده الزامی است').max(40),
  name: z.string().trim().min(1, 'نام تأمین‌کننده الزامی است').max(150),
  nationalId: optionalNationalId,
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalTrimmedString(500),
  // --- اطلاعات بانکی — three separate fields, not one free-text blob ---
  bankName: optionalTrimmedString(100),
  bankAccountNumber: optionalTrimmedString(34),
  bankShebaNumber: optionalTrimmedString(34),
  note: optionalTrimmedString(500),
});

export const updateSupplierSchema = createSupplierSchema.extend({
  status: z.enum(SUPPLIER_STATUSES),
});

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
