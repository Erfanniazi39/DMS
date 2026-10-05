import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalDate,
  optionalId,
  optionalMoney,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredMoney,
  requiredQuantity,
  requiredText,
} from '../../common/zod-fields';

// Field builders live in common/zod-fields.ts — strict on purpose: a
// missing/blank/null/boolean value on a required field is a 400 with a
// Persian message, never coerced into 0 / 1970-01-01 / 1 (QA 2026-10-05).
// Money is whole Rial (Decimal(15,0)); quantities are >= 0.01 with at most
// two decimals (Decimal(12,2)) — anything the column would silently round is
// rejected here instead.

const PURCHASE_STATUSES = ['DRAFT', 'CONFIRMED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
// The only statuses a brand-new purchase may be created in (business
// decision 2026-10-05): entering a purchase means the decision to buy is
// already made, so it defaults to CONFIRMED (payments possible right away);
// DRAFT stays available for staging an unfinished entry. RECEIVED/CLOSED/
// CANCELLED make no sense on creation.
const PURCHASE_CREATE_STATUSES = ['DRAFT', 'CONFIRMED'] as const;
const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD'] as const;
const PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
const DOCUMENT_TYPES = ['INVOICE', 'CONTRACT', 'DELIVERY_NOTE', 'WARRANTY', 'RECEIPT', 'OTHER'] as const;
const PURCHASE_SOURCE_TYPES = ['OPERATIONAL', 'HISTORICAL_IMPORT'] as const;
const PURCHASE_PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;

// PURCHASE_ITEM.name is plain text, not a link to an Item record — see
// database_plan.txt. totalPrice is stored independently of quantity ×
// unitPrice, by explicit instruction — not enforced here as a computed rule.
// unitPrice is optional — some items (exceptions, lump-sum pricing) have no
// meaningful per-unit price; totalPrice is what's actually billed and is
// always required.
const purchaseItemSchema = z.object({
  name: requiredText(150, 'نام/شرح قلم الزامی است'),
  quantity: requiredQuantity('مقدار'),
  unitId: requiredId('واحد را انتخاب کنید'),
  unitPrice: optionalMoney('قیمت واحد'),
  totalPrice: requiredMoney('قیمت کل'),
  // Optional — the specific Purchase Request item this line fulfills, when
  // this purchase was created from a request (see the "ایجاد خرید" /
  // "خرید باقی‌مانده" actions on the Purchase Request detail page). Most
  // items have none — a normal purchase item, or an extra item added beyond
  // what was requested. Validated against purchaseRequestId in
  // PurchasesService, not here (this schema doesn't have access to the
  // sibling purchaseRequestId field at the item level).
  purchaseRequestItemId: optionalId('قلم درخواست خرید نامعتبر است'),
}, { error: 'قلم خرید نامعتبر است' });

// Requester Department only — Requester Employee is intentionally not part
// of this form. See the Purchase model in schema.prisma for why.
//
// requesterDepartmentId/buyerEmployeeId are optional at the schema level
// (see purchaseSourceRefine below) because a HISTORICAL_IMPORT purchase —
// an old paper record being digitized — may genuinely not name either, and
// this application never fabricates an Employee/Department row just to
// fill them in. A normal (OPERATIONAL) purchase still requires both.
const purchaseBaseSchema = z.object({
  purchaseDate: requiredBusinessDate('تاریخ خرید معتبر نیست'),
  purchaseTypeId: requiredId('نوع خرید را انتخاب کنید'),
  requesterDepartmentId: optionalId('دپارتمان درخواست‌کننده را انتخاب کنید'),
  buyerEmployeeId: optionalId('کارمند خریدار را انتخاب کنید'),
  supplierId: requiredId('تأمین‌کننده را انتخاب کنید'),
  // The optional Purchase Request this purchase originated from — most
  // purchases (urgent, direct, recurring) will have none at all.
  purchaseRequestId: optionalId('درخواست خرید انتخاب‌شده نامعتبر است'),
  sourceType: enumField(PURCHASE_SOURCE_TYPES, 'نوع منبع خرید نامعتبر است').default('OPERATIONAL'),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک قلم کالا را وارد کنید' }),
  // Explicit self-confirmation for buying more than a linked request line
  // still needs (business decision 2026-10-05: allowed, but only once the
  // user has confirmed it — no second approver). Without it, an overage is
  // refused with code PURCHASE_QUANTITY_EXCEEDS_REQUEST; see PurchasesService.
  confirmOverage: z.boolean({ error: 'مقدار تأیید خرید مازاد نامعتبر است' }).optional().default(false),
}, { error: 'اطلاعات خرید نامعتبر است' });

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

export const createPurchaseSchema = purchaseBaseSchema
  .extend({ status: enumField(PURCHASE_CREATE_STATUSES, 'خرید جدید فقط با وضعیت «پیش‌نویس» یا «تأییدشده» قابل ثبت است').default('CONFIRMED') })
  .superRefine(purchaseSourceRefine);

// paymentStatus is NOT part of this form — it, along with the total/paid
// amounts, is derived automatically from items and payments (see
// purchase-totals.ts) rather than set directly.
//
// updatedAt is the optimistic-locking token: the Purchase.updatedAt the
// client loaded. If the record has changed since, the update is refused
// (409, code RECORD_MODIFIED) instead of silently overwriting the newer save.
export const updatePurchaseSchema = purchaseBaseSchema
  .extend({
    status: enumField(PURCHASE_STATUSES, 'وضعیت خرید نامعتبر است'),
    updatedAt: requiredDate('نسخه رکورد (زمان آخرین ویرایش) ارسال نشده یا نامعتبر است'),
  })
  .superRefine(purchaseSourceRefine);

export const createPurchasePaymentSchema = z.object({
  amount: requiredMoney('مبلغ', { positive: true }),
  // Must not be before the purchase date (checked in PurchasePaymentsService);
  // a future date is fine — post-dated cheques.
  paymentDate: requiredBusinessDate('تاریخ پرداخت معتبر نیست'),
  method: enumField(PAYMENT_METHODS, 'روش پرداخت نامعتبر است'),
  referenceNumber: optionalTrimmedString(60),
  // COMPLETED by default (business decision 2026-10-05) — only COMPLETED
  // payments count toward paidAmount, and recording money already paid is
  // the common case.
  status: enumField(PAYMENT_STATUSES, 'وضعیت پرداخت نامعتبر است').default('COMPLETED'),
  note: optionalTrimmedString(500),
}, { error: 'اطلاعات پرداخت نامعتبر است' });

// PATCH /purchases/:id/payments/:paymentId — a full replacement of the
// payment's editable fields. status is required here (no default), so an
// edit can never silently flip a PENDING payment to COMPLETED.
export const updatePurchasePaymentSchema = createPurchasePaymentSchema.extend({
  status: enumField(PAYMENT_STATUSES, 'وضعیت پرداخت نامعتبر است'),
});

export const createPurchaseDocumentSchema = z.object({
  documentNumber: optionalTrimmedString(40),
  documentType: enumField(DOCUMENT_TYPES, 'نوع سند نامعتبر است'),
  date: requiredBusinessDate('تاریخ سند معتبر نیست'),
  note: optionalTrimmedString(500),
}, { error: 'اطلاعات سند نامعتبر است' });

// Return-to-Vendor. Each line names the exact PurchaseItem being returned;
// whether that item belongs to this purchase, and whether the quantity fits
// within what's still returnable, is checked in PurchaseReturnsService (needs the
// database). creditAmount is entered directly — never derived from
// quantity × unit price, same philosophy as PurchaseItem.totalPrice.
const purchaseReturnItemSchema = z.object({
  purchaseItemId: requiredId('قلم خرید را انتخاب کنید'),
  quantity: requiredQuantity('مقدار برگشتی'),
  creditAmount: requiredMoney('مبلغ اعتبار'),
  note: optionalTrimmedString(500),
}, { error: 'قلم برگشتی نامعتبر است' });

// returnNumber is never accepted from the client — it's server-generated
// (RTN-000001), same as purchaseNumber.
export const createPurchaseReturnSchema = z.object({
  // Must not be before the purchase date (checked in PurchaseReturnsService).
  returnDate: requiredBusinessDate('تاریخ برگشت معتبر نیست'),
  reason: requiredText(500, 'علت برگشت الزامی است'),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseReturnItemSchema, { error: 'فهرست اقلام برگشتی نامعتبر است' }).min(1, { error: 'حداقل یک قلم برگشتی را وارد کنید' }),
}, { error: 'اطلاعات برگشت نامعتبر است' });

// GET /purchases list filters. Previously passed straight to Prisma, so an
// unknown enum value (?status=FOO) or an unparseable date (?dateTo=2026-13-45)
// surfaced as a raw 500, and ?supplierId=abc was silently ignored. Blank
// values still mean "no filter". page/pageSize are validated separately by
// parsePagination().
export const purchaseListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  purchaseTypeId: optionalId('فیلتر نوع خرید نامعتبر است'),
  status: z.preprocess(emptyToUndefined, enumField(PURCHASE_STATUSES, 'فیلتر وضعیت خرید نامعتبر است').optional()),
  paymentStatus: z.preprocess(emptyToUndefined, enumField(PURCHASE_PAYMENT_STATUSES, 'فیلتر وضعیت پرداخت نامعتبر است').optional()),
  supplierId: optionalId('فیلتر تأمین‌کننده نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  sourceType: z.preprocess(emptyToUndefined, enumField(PURCHASE_SOURCE_TYPES, 'فیلتر نوع منبع خرید نامعتبر است').optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type PurchaseListQuery = z.infer<typeof purchaseListQuerySchema>;
export type CreatePurchaseDto = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseDto = z.infer<typeof updatePurchaseSchema>;
export type CreatePurchasePaymentDto = z.infer<typeof createPurchasePaymentSchema>;
export type UpdatePurchasePaymentDto = z.infer<typeof updatePurchasePaymentSchema>;
export type CreatePurchaseDocumentDto = z.infer<typeof createPurchaseDocumentSchema>;
export type CreatePurchaseReturnDto = z.infer<typeof createPurchaseReturnSchema>;
