import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalEmail,
  optionalId,
  optionalMoney,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredText,
} from '../../common/zod-fields';
import {
  bankAccountFields,
  optionalDigitsText,
  optionalPhone,
  optionalWebsite,
  partyIdentityRefine,
  postalCodeRefine,
  refineBankAccountHasNumber,
  requiredPhone,
} from '../../common/party-fields';
import { REASON_REQUIRED_CUSTOMER_STATUSES } from '../customer-rules';

// Must match the Prisma enums.
export const CUSTOMER_KINDS = ['INDIVIDUAL', 'ORGANIZATION'] as const;
export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export const CUSTOMER_ADDRESS_TYPES = ['BILLING', 'DELIVERY', 'OTHER'] as const;
export const CUSTOMER_NOTE_TYPES = ['GENERAL', 'WARNING', 'DELIVERY', 'FINANCE'] as const;
export const CUSTOMER_DOCUMENT_TYPES = ['BUSINESS_LICENSE', 'REGISTRATION', 'IDENTITY', 'CONTRACT', 'TAX', 'SCANNED_PAPER_RECORD', 'OTHER'] as const;
export const COMPLAINT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD'] as const;

const VERSION_MESSAGE = 'نسخه رکورد (زمان آخرین ویرایش) ارسال نشده یا نامعتبر است';

// شناسه ملی / کد ملی. Digits only here; the exact rule depends on
// customerKind and is checked in identityRefine() (common/party-fields.ts):
// ORGANIZATION → 11-digit شناسه ملی + 12/14-digit کد اقتصادی (both required);
// INDIVIDUAL → 10-digit کد ملی with a valid check digit (required).
const nationalIdField = optionalDigitsText(11, 'شناسه/کد ملی فقط باید شامل رقم باشد');

function identityRefine(value: { customerKind: (typeof CUSTOMER_KINDS)[number]; nationalId?: string; economicCode?: string }, ctx: z.RefinementCtx) {
  partyIdentityRefine(value, value.customerKind, ctx);
}

// --- Child-record inputs (also used by the create form's optional first
// address / first contact) ------------------------------------------------

export const customerContactSchema = z.object({
  name: requiredText(150, 'نام مخاطب الزامی است'),
  roleTitle: optionalTrimmedString(100),
  mobile: optionalPhone,
  phone: optionalPhone,
  email: optionalEmail,
  isPrimary: z.boolean().default(false),
  isActive: z.boolean().default(true),
  note: optionalTrimmedString(500),
}, { error: 'اطلاعات مخاطب نامعتبر است' });

const customerAddressObject = z.object({
  addressType: enumField(CUSTOMER_ADDRESS_TYPES, 'نوع آدرس نامعتبر است'),
  label: optionalTrimmedString(100),
  province: optionalTrimmedString(100),
  city: optionalTrimmedString(100),
  addressLine: requiredText(500, 'نشانی الزامی است'),
  postalCode: optionalDigitsText(20, 'کد پستی فقط باید شامل رقم باشد'),
  // Free text, filled by users; empty = ایران.
  country: optionalTrimmedString(100),
  cityCode: optionalTrimmedString(30),
  locationNumber: optionalTrimmedString(50),
  locationName: optionalTrimmedString(150),
  phone: optionalPhone,
  deliveryInstructions: optionalTrimmedString(500),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
}, { error: 'اطلاعات آدرس نامعتبر است' });

function addressRefine(value: { postalCode?: string; country?: string }, ctx: z.RefinementCtx) {
  postalCodeRefine(value.postalCode, value.country, ctx);
}

export const customerAddressSchema = customerAddressObject.superRefine(addressRefine);

export const customerBankAccountSchema = z
  .object(bankAccountFields, { error: 'اطلاعات حساب بانکی نامعتبر است' })
  .superRefine(refineBankAccountHasNumber);

// --- Customer ----------------------------------------------------------------

const customerFields = {
  customerKind: enumField(CUSTOMER_KINDS, 'نوع شخص (حقیقی/حقوقی) نامعتبر است'),
  name: requiredText(150, 'نام مشتری الزامی است'),
  legalName: optionalTrimmedString(200),
  nationalId: nationalIdField,
  economicCode: optionalDigitsText(20, 'کد اقتصادی فقط باید شامل رقم باشد'),
  title: optionalTrimmedString(100),
  registrationNumber: optionalDigitsText(30, 'شماره ثبت فقط باید شامل رقم باشد'),
  phone: requiredPhone,
  phone2: optionalPhone,
  mobile: optionalPhone,
  fax: optionalPhone,
  telex: optionalTrimmedString(30),
  website: optionalWebsite,
  email: optionalEmail,
  taxOfficeProvince: optionalTrimmedString(100),
  taxOfficeCity: optionalTrimmedString(100),
  customerGroupId: requiredId('گروه مشتری الزامی است'),
  territoryId: optionalId('منطقهٔ فروش نامعتبر است'),
};

const MAX_EXTRA_CHILDREN = 10;

// customerNumber is never accepted — it's generated server-side
// ("CUS-000001"). legacyCode is read-only (the old user-typed code).
//
// acknowledgeDuplicates: resubmit flag for the soft duplicate warning (same
// name or same phone as an existing customer) — see
// CustomersService.ensureNoUnacknowledgedDuplicates().
//
// firstAddress / firstContact: optional, create-only convenience; saved as
// the default address of its type / the primary contact.
export const createCustomerSchema = z
  .object({
    ...customerFields,
    acknowledgeDuplicates: z.boolean().optional(),
    firstAddress: customerAddressObject.omit({ isDefault: true, isActive: true }).superRefine(addressRefine).optional(),
    firstBankAccount: z.object(bankAccountFields, { error: 'اطلاعات حساب بانکی نامعتبر است' }).omit({ isDefault: true, isActive: true }).superRefine(refineBankAccountHasNumber).optional(),
    firstContact: customerContactSchema.omit({ isPrimary: true, isActive: true }).optional(),
    // "Add another" on the create form: further entries saved right after the
    // first one, never as the default/primary. Each list needs its first entry.
    additionalAddresses: z.array(customerAddressObject.omit({ isDefault: true, isActive: true }).superRefine(addressRefine)).max(MAX_EXTRA_CHILDREN).optional(),
    additionalBankAccounts: z.array(z.object(bankAccountFields, { error: 'اطلاعات حساب بانکی نامعتبر است' }).omit({ isDefault: true, isActive: true }).superRefine(refineBankAccountHasNumber)).max(MAX_EXTRA_CHILDREN).optional(),
    additionalContacts: z.array(customerContactSchema.omit({ isPrimary: true, isActive: true })).max(MAX_EXTRA_CHILDREN).optional(),
  }, { error: 'اطلاعات مشتری نامعتبر است' })
  .superRefine(identityRefine)
  .superRefine((dto, ctx) => {
    const needsFirst: [string, unknown[] | undefined, unknown, string][] = [
      ['additionalAddresses', dto.additionalAddresses, dto.firstAddress, 'آدرس'],
      ['additionalBankAccounts', dto.additionalBankAccounts, dto.firstBankAccount, 'حساب بانکی'],
      ['additionalContacts', dto.additionalContacts, dto.firstContact, 'مخاطب'],
    ];
    for (const [path, extras, first, label] of needsFirst) {
      if (extras && extras.length > 0 && !first) ctx.addIssue({ code: 'custom', path: [path], message: `برای ثبت ${label} دوم، ابتدا ${label} اول را کامل کنید` });
    }
  });

// Full replace of the identity/classification/communication fields. Status
// is not here — it changes only through changeCustomerStatusSchema.
export const updateCustomerSchema = z
  .object({ ...customerFields, updatedAt: requiredDate(VERSION_MESSAGE) }, { error: 'اطلاعات مشتری نامعتبر است' })
  .superRefine(identityRefine);

export const changeCustomerStatusSchema = z
  .object({
    status: enumField(CUSTOMER_STATUSES, 'وضعیت مقصد نامعتبر است'),
    reason: optionalTrimmedString(500),
    updatedAt: requiredDate(VERSION_MESSAGE),
  }, { error: 'اطلاعات تغییر وضعیت نامعتبر است' })
  .superRefine((value, ctx) => {
    if (REASON_REQUIRED_CUSTOMER_STATUSES.includes(value.status) && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'برای تعلیق یا بایگانی مشتری، ذکر دلیل الزامی است' });
    }
  });

// GET /customers filters. status: one status, 'ALL' (everything, archived
// included), or omitted (everything except archived).
export const customerListQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  status: z.preprocess(emptyToUndefined, z.enum([...CUSTOMER_STATUSES, 'ALL'], { error: 'وضعیت نامعتبر است' }).optional()),
  customerGroupId: optionalId('گروه مشتری نامعتبر است'),
  territoryId: optionalId('منطقهٔ فروش نامعتبر است'),
  customerKind: z.preprocess(emptyToUndefined, enumField(CUSTOMER_KINDS, 'نوع شخص نامعتبر است').optional()),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

// --- Notes / documents / complaints / financial ---------------------------

export const customerNoteSchema = z.object({
  noteType: enumField(CUSTOMER_NOTE_TYPES, 'نوع یادداشت نامعتبر است').default('GENERAL'),
  body: requiredText(2000, 'متن یادداشت الزامی است'),
  isPinned: z.boolean().default(false),
}, { error: 'اطلاعات یادداشت نامعتبر است' });

export const customerDocumentSchema = z.object({
  documentType: enumField(CUSTOMER_DOCUMENT_TYPES, 'نوع مدرک نامعتبر است'),
  documentNumber: optionalTrimmedString(60),
  date: optionalBusinessDate('تاریخ مدرک معتبر نیست'),
  expiresAt: optionalBusinessDate('تاریخ انقضا معتبر نیست'),
  note: optionalTrimmedString(500),
}, { error: 'اطلاعات مدرک نامعتبر است' }).superRefine((doc, ctx) => {
  // Both are business dates (Date | undefined). An expiry can't precede the issue date.
  if (doc.date && doc.expiresAt && doc.expiresAt.getTime() < doc.date.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'تاریخ انقضا نمی‌تواند قبل از تاریخ صدور باشد' });
  }
});

const complaintFields = {
  date: requiredBusinessDate('تاریخ شکایت معتبر نیست'),
  category: requiredText(100, 'دسته‌بندی شکایت الزامی است'),
  description: requiredText(2000, 'شرح شکایت الزامی است'),
  severity: enumField(COMPLAINT_SEVERITIES, 'شدت شکایت نامعتبر است').default('MEDIUM'),
  status: enumField(COMPLAINT_STATUSES, 'وضعیت شکایت نامعتبر است').default('OPEN'),
  resolution: optionalTrimmedString(2000),
  ownerUserId: optionalId('مسئول پیگیری نامعتبر است'),
};

export const createCustomerComplaintSchema = z.object(complaintFields, { error: 'اطلاعات شکایت نامعتبر است' });
export const updateCustomerComplaintSchema = z.object(
  { ...complaintFields, updatedAt: requiredDate(VERSION_MESSAGE) },
  { error: 'اطلاعات شکایت نامعتبر است' },
);

// Full replace of the financial policy: an omitted/blank/null optional field
// is cleared. No balance fields — balances belong to the future Sales/finance
// modules.
export const updateCustomerFinancialSchema = z.object({
  paymentTermId: optionalId('شرایط پرداخت نامعتبر است'),
  preferredPaymentMethod: z.preprocess(
    (value) => (value === null ? undefined : emptyToUndefined(value)),
    enumField(PAYMENT_METHODS, 'روش پرداخت نامعتبر است').optional(),
  ),
  creditLimit: optionalMoney('سقف اعتبار'),
  creditHold: z.boolean({ error: 'وضعیت توقف اعتباری نامعتبر است' }),
  creditHoldReason: optionalTrimmedString(500),
  updatedAt: requiredDate(VERSION_MESSAGE),
}, { error: 'اطلاعات مالی نامعتبر است' });

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
export type ChangeCustomerStatusDto = z.infer<typeof changeCustomerStatusSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerContactDto = z.infer<typeof customerContactSchema>;
export type CustomerAddressDto = z.infer<typeof customerAddressSchema>;
export type CustomerBankAccountDto = z.infer<typeof customerBankAccountSchema>;
export type CustomerNoteDto = z.infer<typeof customerNoteSchema>;
export type CustomerDocumentDto = z.infer<typeof customerDocumentSchema>;
export type CreateCustomerComplaintDto = z.infer<typeof createCustomerComplaintSchema>;
export type UpdateCustomerComplaintDto = z.infer<typeof updateCustomerComplaintSchema>;
export type UpdateCustomerFinancialDto = z.infer<typeof updateCustomerFinancialSchema>;
