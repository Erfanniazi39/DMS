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
} from '../../common/zod-fields';

// Strict field builders from common/zod-fields.ts (same conventions as
// sales-order.dto.ts).
//
// Never accepted from the client: deliveryNumber (assigned at POSTED),
// status (the dedicated post action only), customerId / locationId /
// deliveryAddressText (taken from the order), itemId (taken from the order
// line), and the progress counters (invoicedQty / returnedQty).

export const SALES_DOCUMENT_STATUSES = ['DRAFT', 'POSTED'] as const;

const deliveryItemSchema = z.object(
  {
    salesOrderItemId: requiredId('ردیف سفارش را انتخاب کنید'),
    quantity: requiredQuantity('مقدار تحویل'),
  },
  { error: 'ردیف تحویل نامعتبر است' },
);

const deliveryItemsSchema = z
  .array(deliveryItemSchema, { error: 'فهرست اقلام نامعتبر است' })
  .min(1, { error: 'حداقل یک ردیف با مقدار تحویل وارد کنید' })
  .refine((items) => new Set(items.map((line) => line.salesOrderItemId)).size === items.length, {
    message: 'هر ردیف سفارش فقط یک بار در حواله می‌آید',
  });

const deliveryHeaderFields = {
  deliveryDate: requiredBusinessDate('تاریخ تحویل معتبر نیست'),
  carrierNote: optionalTrimmedString(500),
  receivedByName: optionalTrimmedString(200),
  note: optionalTrimmedString(2000),
};

// Creates a DRAFT against a CONFIRMED order. `items` omitted → every order
// line with undelivered quantity, prefilled with that quantity
// (orderItem.quantity − deliveredQty).
export const createDeliverySchema = z.object({
  salesOrderId: requiredId('سفارش فروش را انتخاب کنید'),
  ...deliveryHeaderFields,
  items: deliveryItemsSchema.optional(),
});

// Full-record edit of a DRAFT (lines replaced wholesale), optimistic lock on
// updatedAt — same convention as sales orders.
export const updateDeliverySchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
  ...deliveryHeaderFields,
  items: deliveryItemsSchema,
});

// DRAFT → POSTED.
export const postDeliverySchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const deliveryListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(SALES_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  salesOrderId: optionalId('فیلتر سفارش نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export const deliveryQueueQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreateDeliveryDto = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryDto = z.infer<typeof updateDeliverySchema>;
export type DeliveryItemDto = UpdateDeliveryDto['items'][number];
export type PostDeliveryDto = z.infer<typeof postDeliverySchema>;
export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;
export type DeliveryQueueQuery = z.infer<typeof deliveryQueueQuerySchema>;
