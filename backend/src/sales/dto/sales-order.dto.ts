import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
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

// Strict field builders from common/zod-fields.ts (missing/blank/wrong-type
// on a required field is a 400 with a Persian message, never coerced).
//
// Never accepted from the client: orderNumber (assigned at CONFIRMED),
// status (dedicated actions only), any derived money field (sales-totals.ts),
// any snapshot (customer name/economic code, address text, payment term,
// item code/name/unit, listUnitPrice — all read server-side), locationId
// (the default warehouse), and the progress counters.

export const SALES_ORDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'COMPLETED', 'CLOSED', 'CANCELLED'] as const;
export const SALES_DELIVERY_STATUSES = ['NOT_DELIVERED', 'PARTIALLY_DELIVERED', 'DELIVERED'] as const;
export const SALES_INVOICING_STATUSES = ['NOT_INVOICED', 'PARTIALLY_INVOICED', 'INVOICED'] as const;
export const SALES_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;

function toNumberInput(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return value;
}

function hasAtMostTwoDecimals(value: number) {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

// A percentage within Decimal(5,2): 0–100, at most two decimals.
function optionalPercent(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .min(0, { error: `${label} نمی‌تواند منفی باشد` })
      .max(100, { error: `${label} نمی‌تواند بیشتر از ۱۰۰ باشد` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` })
      .optional(),
  );
}

const salesOrderItemSchema = z
  .object(
    {
      itemId: requiredId('کالا را انتخاب کنید'),
      quantity: requiredQuantity('مقدار'),
      unitPrice: requiredMoney('قیمت واحد'),
      // Required only when unitPrice is below the item's list price (B2) —
      // checked in the service, which knows the list price.
      priceOverrideReason: optionalTrimmedString(500),
      // Discount: a percent OR an amount, never both. Only a sales.approve
      // holder may send either (B3) — enforced in the service.
      discountPercent: optionalPercent('درصد تخفیف'),
      discountAmount: optionalMoney('مبلغ تخفیف'),
      // B14: adjustable, defaults to 0.
      taxRate: optionalPercent('نرخ مالیات'),
      note: optionalTrimmedString(500),
    },
    { error: 'ردیف کالا نامعتبر است' },
  )
  .refine((line) => line.discountPercent === undefined || line.discountAmount === undefined, {
    message: 'برای تخفیف فقط یکی از «درصد» یا «مبلغ» را وارد کنید',
    path: ['discountAmount'],
  });

const salesOrderBaseSchema = z.object({
  orderDate: requiredBusinessDate('تاریخ سفارش معتبر نیست'),
  customerId: requiredId('مشتری را انتخاب کنید'),
  deliveryAddressId: optionalId('آدرس تحویل نامعتبر است'),
  salespersonEmployeeId: optionalId('فروشنده نامعتبر است'),
  customerReference: optionalTrimmedString(100),
  requestedDeliveryDate: optionalBusinessDate('تاریخ تحویل درخواستی معتبر نیست'),
  internalNote: optionalTrimmedString(2000),
  customerNote: optionalTrimmedString(2000),
  items: z.array(salesOrderItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }),
});

export const createSalesOrderSchema = salesOrderBaseSchema;

// Full-record edit of a DRAFT (lines replaced wholesale), with the same
// optimistic lock as Purchases: updatedAt is the version the client loaded.
export const updateSalesOrderSchema = salesOrderBaseSchema.extend({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

const versionField = { updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') };

// DRAFT → CONFIRMED / PENDING_APPROVAL.
//   creditOverrideReason — sales.approve only: confirm despite the credit
//     limit (B4); required when the limit is exceeded.
//   submitForApproval — a user without sales.approve explicitly sends an
//     order that needs approval to PENDING_APPROVAL (otherwise a 409
//     SALES_ORDER_APPROVAL_REQUIRED explains why it can't be confirmed).
export const confirmSalesOrderSchema = z.object({
  ...versionField,
  creditOverrideReason: optionalTrimmedString(500),
  submitForApproval: z.boolean({ error: 'مقدار ارسال برای تأیید نامعتبر است' }).optional().default(false),
});

// PENDING_APPROVAL → CONFIRMED (sales.approve).
export const approveSalesOrderSchema = z.object({
  ...versionField,
  creditOverrideReason: optionalTrimmedString(500),
  note: optionalTrimmedString(500),
});

// PENDING_APPROVAL → DRAFT (sales.approve).
export const rejectSalesOrderSchema = z.object({
  ...versionField,
  reason: optionalTrimmedString(500),
});

// CONFIRMED → CANCELLED / CLOSED — reason required (build plan §5).
export const cancelSalesOrderSchema = z.object({
  ...versionField,
  reason: requiredText(500, 'علت لغو سفارش الزامی است'),
});

export const closeSalesOrderSchema = z.object({
  ...versionField,
  reason: requiredText(500, 'علت بستن سفارش الزامی است'),
});

export const salesOrderListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(SALES_ORDER_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  deliveryStatus: z.preprocess(emptyToUndefined, enumField(SALES_DELIVERY_STATUSES, 'فیلتر وضعیت تحویل نامعتبر است').optional()),
  invoicingStatus: z.preprocess(emptyToUndefined, enumField(SALES_INVOICING_STATUSES, 'فیلتر وضعیت فاکتور نامعتبر است').optional()),
  paymentStatus: z.preprocess(emptyToUndefined, enumField(SALES_PAYMENT_STATUSES, 'فیلتر وضعیت پرداخت نامعتبر است').optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreateSalesOrderDto = z.infer<typeof createSalesOrderSchema>;
export type UpdateSalesOrderDto = z.infer<typeof updateSalesOrderSchema>;
export type SalesOrderItemDto = CreateSalesOrderDto['items'][number];
export type ConfirmSalesOrderDto = z.infer<typeof confirmSalesOrderSchema>;
export type ApproveSalesOrderDto = z.infer<typeof approveSalesOrderSchema>;
export type RejectSalesOrderDto = z.infer<typeof rejectSalesOrderSchema>;
export type CancelSalesOrderDto = z.infer<typeof cancelSalesOrderSchema>;
export type CloseSalesOrderDto = z.infer<typeof closeSalesOrderSchema>;
export type SalesOrderListQuery = z.infer<typeof salesOrderListQuerySchema>;
