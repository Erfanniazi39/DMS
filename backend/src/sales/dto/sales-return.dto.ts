import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalDate,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredQuantity,
  requiredText,
  MAX_QUANTITY,
} from '../../common/zod-fields';

// Strict field builders from common/zod-fields.ts (same conventions as
// delivery.dto.ts / sales-invoice.dto.ts).
//
// Never accepted from the client: returnNumber (assigned at APPROVED),
// status (one dedicated action per transition only), customerId /
// salesOrderId / locationId (taken from the delivery), itemId / itemName /
// unitName / unitPrice (snapshotted from the delivery's order line),
// requestedByUserId/approvedByUserId/receivedByUserId/inspectedByUserId and
// their *At timestamps (set by the server), every progress counter
// (receivedQty/restockQty/writeOffQty/creditedQty — written only by
// receive()/inspect()/CreditNotesService.post() via markCredited()).

export const SALES_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED'] as const;
export const RETURN_REASONS = ['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'QUALITY', 'CUSTOMER_REFUSED', 'OTHER'] as const;

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

// A quantity that may legitimately be zero (e.g. nothing of a requested line
// actually arrived, or a line is fully written off with nothing restocked) —
// requiredQuantity() in zod-fields.ts requires > 0, which doesn't fit here.
function nonNegativeQuantity(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .min(0, { error: `${label} نمی‌تواند منفی باشد` })
      .max(MAX_QUANTITY, { error: `${label} بیش از حد مجاز است` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` }),
  );
}

const requestItemSchema = z.object(
  {
    deliveryItemId: requiredId('ردیف حواله را انتخاب کنید'),
    quantity: requiredQuantity('مقدار درخواستی'),
    conditionNote: optionalTrimmedString(500),
  },
  { error: 'ردیف مرجوعی نامعتبر است' },
);

const requestItemsSchema = z
  .array(requestItemSchema, { error: 'فهرست اقلام نامعتبر است' })
  .min(1, { error: 'حداقل یک ردیف با مقدار درخواستی وارد کنید' })
  .max(100, { error: 'حداکثر ۱۰۰ ردیف مجاز است' })
  .refine((items) => new Set(items.map((line) => line.deliveryItemId)).size === items.length, {
    message: 'هر ردیف حواله فقط یک بار در مرجوعی می‌آید',
  });

// REQUESTED — created against a POSTED delivery (B8: every return
// references a delivery). customerId/salesOrderId/locationId come from the
// delivery; itemId/itemName/unitName/unitPrice from each line's order line.
export const requestSalesReturnSchema = z.object({
  deliveryId: requiredId('حواله تحویل را انتخاب کنید'),
  requestDate: requiredBusinessDate('تاریخ درخواست معتبر نیست'),
  reason: enumField(RETURN_REASONS, 'علت مرجوعی نامعتبر است'),
  note: optionalTrimmedString(2000),
  items: requestItemsSchema,
});

const versionField = { updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') };

// REQUESTED → APPROVED. RMA number assigned here.
export const approveSalesReturnSchema = z.object({ ...versionField });

// REQUESTED → REJECTED (reason required).
export const rejectSalesReturnSchema = z.object({ ...versionField, reason: requiredText(500, 'علت رد الزامی است') });

// REQUESTED|APPROVED → CANCELLED (reason required).
export const cancelSalesReturnSchema = z.object({ ...versionField, reason: requiredText(500, 'علت لغو الزامی است') });

const receiveItemSchema = z.object(
  {
    salesReturnItemId: requiredId('ردیف مرجوعی را انتخاب کنید'),
    // Defaults to the line's requestedQty on the server when omitted — see
    // sales-returns.service.ts receive().
    receivedQty: nonNegativeQuantity('مقدار دریافت‌شده').optional(),
  },
  { error: 'ردیف دریافت نامعتبر است' },
);

// APPROVED → RECEIVED. Stock effect RETURN_RECEIPT (QC +q) per line.
export const receiveSalesReturnSchema = z.object({
  ...versionField,
  items: z.array(receiveItemSchema, { error: 'فهرست ردیف‌ها نامعتبر است' }).max(100, { error: 'حداکثر ۱۰۰ ردیف مجاز است' }).optional(),
});

const inspectItemSchema = z.object(
  {
    salesReturnItemId: requiredId('ردیف مرجوعی را انتخاب کنید'),
    restockQty: nonNegativeQuantity('مقدار بازگشت به انبار'),
    writeOffQty: nonNegativeQuantity('مقدار ضایعات'),
  },
  { error: 'ردیف بازرسی نامعتبر است' },
);

// RECEIVED → INSPECTED. Per line: restockQty + writeOffQty must equal the
// line's receivedQty (checked server-side — see sales-returns.service.ts
// inspect()). Stock effects RETURN_RESTOCK / RETURN_WRITE_OFF.
export const inspectSalesReturnSchema = z.object({
  ...versionField,
  items: z
    .array(inspectItemSchema, { error: 'فهرست ردیف‌ها نامعتبر است' })
    .min(1, { error: 'حداقل یک ردیف بازرسی وارد کنید' })
    .max(100, { error: 'حداکثر ۱۰۰ ردیف مجاز است' }),
});

// INSPECTED → COMPLETED, an explicit no-credit close (reason required) —
// build plan §5's alternative to a credit note posting.
export const completeReturnWithoutCreditSchema = z.object({ ...versionField, reason: requiredText(500, 'علت تکمیل بدون صدور یادداشت اعتباری الزامی است') });

export const salesReturnListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(SALES_RETURN_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  salesOrderId: optionalId('فیلتر سفارش نامعتبر است'),
  deliveryId: optionalId('فیلتر حواله نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type RequestSalesReturnDto = z.infer<typeof requestSalesReturnSchema>;
export type SalesReturnRequestItemDto = RequestSalesReturnDto['items'][number];
export type ApproveSalesReturnDto = z.infer<typeof approveSalesReturnSchema>;
export type RejectSalesReturnDto = z.infer<typeof rejectSalesReturnSchema>;
export type CancelSalesReturnDto = z.infer<typeof cancelSalesReturnSchema>;
export type ReceiveSalesReturnDto = z.infer<typeof receiveSalesReturnSchema>;
export type InspectSalesReturnDto = z.infer<typeof inspectSalesReturnSchema>;
export type CompleteReturnWithoutCreditDto = z.infer<typeof completeReturnWithoutCreditSchema>;
export type SalesReturnListQuery = z.infer<typeof salesReturnListQuerySchema>;
