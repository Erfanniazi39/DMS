import { z } from 'zod';

// Same "empty string means not provided" convention used by the other DTOs
// in this project (see employee.dto.ts).
function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

const PURCHASE_STATUSES = ['DRAFT', 'CONFIRMED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD'] as const;
const PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
const DOCUMENT_TYPES = ['INVOICE', 'CONTRACT', 'DELIVERY_NOTE', 'WARRANTY', 'RECEIPT', 'OTHER'] as const;
const PURCHASE_SOURCE_TYPES = ['OPERATIONAL', 'HISTORICAL_IMPORT'] as const;

// PURCHASE_ITEM.name is plain text, not a link to an Item record — see
// database_plan.txt. totalPrice is stored independently of quantity ×
// unitPrice, by explicit instruction — not enforced here as a computed rule.
// unitPrice is optional — some items (exceptions, lump-sum pricing) have no
// meaningful per-unit price; totalPrice is what's actually billed and is
// always required.
const purchaseItemSchema = z.object({
  name: z.string().trim().min(1, 'نام/شرح قلم الزامی است').max(150),
  quantity: z.coerce.number().positive('مقدار باید بزرگ‌تر از صفر باشد'),
  unitId: z.coerce.number().int().positive('واحد را انتخاب کنید'),
  unitPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0, 'قیمت واحد نمی‌تواند منفی باشد').optional()),
  totalPrice: z.coerce.number().min(0, 'قیمت کل نمی‌تواند منفی باشد'),
  // Optional — the specific Purchase Request item this line fulfills, when
  // this purchase was created from a request (see the "ایجاد خرید" /
  // "خرید باقی‌مانده" actions on the Purchase Request detail page). Most
  // items have none — a normal purchase item, or an extra item added beyond
  // what was requested. Validated against purchaseRequestId in
  // PurchasesService, not here (this schema doesn't have access to the
  // sibling purchaseRequestId field at the item level).
  purchaseRequestItemId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
});

// Requester Department only — Requester Employee is intentionally not part
// of this form. See the Purchase model in schema.prisma for why.
//
// requesterDepartmentId/buyerEmployeeId are optional at the schema level
// (see purchaseSourceRefine below) because a HISTORICAL_IMPORT purchase —
// an old paper record being digitized — may genuinely not name either, and
// this application never fabricates an Employee/Department row just to
// fill them in. A normal (OPERATIONAL) purchase still requires both.
const purchaseBaseSchema = z.object({
  purchaseDate: z.coerce.date(),
  purchaseTypeId: z.coerce.number().int().positive('نوع خرید را انتخاب کنید'),
  requesterDepartmentId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive('دپارتمان درخواست‌کننده را انتخاب کنید').optional()),
  buyerEmployeeId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive('کارمند خریدار را انتخاب کنید').optional()),
  supplierId: z.coerce.number().int().positive('تأمین‌کننده را انتخاب کنید'),
  // The optional Purchase Request this purchase originated from — most
  // purchases (urgent, direct, recurring) will have none at all.
  purchaseRequestId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  sourceType: z.enum(PURCHASE_SOURCE_TYPES).default('OPERATIONAL'),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseItemSchema).min(1, 'حداقل یک قلم کالا را وارد کنید'),
});

// Never weakens normal operational validation — only a HISTORICAL_IMPORT
// purchase is allowed to omit requesterDepartmentId/buyerEmployeeId.
function purchaseSourceRefine(data: z.infer<typeof purchaseBaseSchema>, ctx: z.RefinementCtx) {
  if (data.sourceType !== 'OPERATIONAL') return;
  if (!data.requesterDepartmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requesterDepartmentId'], message: 'دپارتمان درخواست‌کننده را انتخاب کنید' });
  }
  if (!data.buyerEmployeeId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buyerEmployeeId'], message: 'کارمند خریدار را انتخاب کنید' });
  }
}

export const createPurchaseSchema = purchaseBaseSchema.superRefine(purchaseSourceRefine);

// paymentStatus is NOT part of this form — it, along with the total/paid
// amounts, is derived automatically from items and payments (see
// PurchasesService) rather than set directly.
export const updatePurchaseSchema = purchaseBaseSchema
  .extend({ status: z.enum(PURCHASE_STATUSES) })
  .superRefine(purchaseSourceRefine);

export const createPurchasePaymentSchema = z.object({
  amount: z.coerce.number().positive('مبلغ باید بزرگ‌تر از صفر باشد'),
  paymentDate: z.coerce.date(),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: optionalTrimmedString(60),
  status: z.enum(PAYMENT_STATUSES).default('PENDING'),
  note: optionalTrimmedString(500),
});

export const createPurchaseDocumentSchema = z.object({
  documentNumber: optionalTrimmedString(40),
  documentType: z.enum(DOCUMENT_TYPES),
  date: z.coerce.date(),
  note: optionalTrimmedString(500),
});

// Return-to-Vendor. Each line names the exact PurchaseItem being returned;
// whether that item belongs to this purchase, and whether the quantity fits
// within what's still returnable, is checked in PurchasesService (needs the
// database). creditAmount is entered directly — never derived from
// quantity × unit price, same philosophy as PurchaseItem.totalPrice.
const purchaseReturnItemSchema = z.object({
  purchaseItemId: z.coerce.number().int().positive('قلم خرید را انتخاب کنید'),
  quantity: z.coerce.number().positive('مقدار برگشتی باید بزرگ‌تر از صفر باشد'),
  creditAmount: z.coerce.number().min(0, 'مبلغ اعتبار نمی‌تواند منفی باشد'),
  note: optionalTrimmedString(500),
});

// returnNumber is never accepted from the client — it's server-generated
// (RTN-000001), same as purchaseNumber.
export const createPurchaseReturnSchema = z.object({
  returnDate: z.coerce.date(),
  reason: z.string().trim().min(1, 'علت برگشت الزامی است').max(500),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseReturnItemSchema).min(1, 'حداقل یک قلم برگشتی را وارد کنید'),
});

export type CreatePurchaseDto = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseDto = z.infer<typeof updatePurchaseSchema>;
export type CreatePurchasePaymentDto = z.infer<typeof createPurchasePaymentSchema>;
export type CreatePurchaseDocumentDto = z.infer<typeof createPurchaseDocumentSchema>;
export type CreatePurchaseReturnDto = z.infer<typeof createPurchaseReturnSchema>;
