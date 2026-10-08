import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalDate,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredMoney,
  requiredQuantity,
} from '../../common/zod-fields';
import { SALES_DOCUMENT_STATUSES } from './delivery.dto';
import { SALES_PAYMENT_STATUSES } from './sales-order.dto';

// Strict field builders from common/zod-fields.ts (same conventions as
// sales-order.dto.ts / delivery.dto.ts).
//
// Never accepted from the client: invoiceNumber / dueDate (assigned at
// POSTED), status (the dedicated post action only), sourceType (fixed by the
// endpoint), every snapshot (customer name / economic code / billing address
// / payment term, item code / name / unit), the lines of an invoice built
// from a delivery (quantities, prices, discounts and tax rates all come from
// the delivery and its order lines), every derived money field
// (sales-totals.ts) and the settlement fields (paidAmount / creditedAmount /
// paymentStatus — SalesInvoicesService.applySettlement() only).

export const SALES_SOURCE_TYPES = ['OPERATIONAL', 'OPENING_BALANCE'] as const;

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

// A percentage within Decimal(5,2): 0–100, at most two decimals (same rule
// as sales-order.dto.ts).
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

// Creates a DRAFT invoice for a POSTED delivery (B7: one invoice per
// delivery), lines = every delivery line's not-yet-invoiced quantity.
// invoiceDate omitted → today (or the delivery date, if that is later).
export const createSalesInvoiceSchema = z.object({
  deliveryId: requiredId('حوالهٔ تحویل را انتخاب کنید'),
  invoiceDate: optionalBusinessDate('تاریخ فاکتور معتبر نیست'),
  note: optionalTrimmedString(2000),
});

const openingBalanceLineSchema = z.object(
  {
    // Blank → "مانده افتتاحیه".
    itemName: optionalTrimmedString(200),
    quantity: requiredQuantity('مقدار'),
    unitPrice: requiredMoney('مبلغ واحد'),
    taxRate: optionalPercent('نرخ مالیات'),
  },
  { error: 'ردیف فاکتور نامعتبر است' },
);

// Opening-balance invoice: historical receivables, no order/delivery
// (build plan §4.2). A data-entry escape hatch for migrating old AR.
export const createOpeningBalanceInvoiceSchema = z.object({
  customerId: requiredId('مشتری را انتخاب کنید'),
  invoiceDate: requiredBusinessDate('تاریخ فاکتور معتبر نیست'),
  note: optionalTrimmedString(2000),
  items: z
    .array(openingBalanceLineSchema, { error: 'فهرست ردیف‌ها نامعتبر است' })
    .min(1, { error: 'حداقل یک ردیف وارد کنید' })
    .max(50, { error: 'حداکثر ۵۰ ردیف مجاز است' }),
});

// DRAFT → POSTED.
export const postSalesInvoiceSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const salesInvoiceListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(SALES_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  sourceType: z.preprocess(emptyToUndefined, enumField(SALES_SOURCE_TYPES, 'فیلتر نوع فاکتور نامعتبر است').optional()),
  paymentStatus: z.preprocess(emptyToUndefined, enumField(SALES_PAYMENT_STATUSES, 'فیلتر وضعیت پرداخت نامعتبر است').optional()),
  overdue: z.preprocess(emptyToUndefined, z.enum(['true', 'false'], { error: 'فیلتر سررسید نامعتبر است' }).optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  salesOrderId: optionalId('فیلتر سفارش نامعتبر است'),
  deliveryId: optionalId('فیلتر حواله نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export const salesInvoiceQueueQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreateSalesInvoiceDto = z.infer<typeof createSalesInvoiceSchema>;
export type CreateOpeningBalanceInvoiceDto = z.infer<typeof createOpeningBalanceInvoiceSchema>;
export type PostSalesInvoiceDto = z.infer<typeof postSalesInvoiceSchema>;
export type SalesInvoiceListQuery = z.infer<typeof salesInvoiceListQuerySchema>;
export type SalesInvoiceQueueQuery = z.infer<typeof salesInvoiceQueueQuerySchema>;
