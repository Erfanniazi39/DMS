import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredQuantity,
  requiredText,
} from '../../common/zod-fields';
import { STOCK_DOCUMENT_STATUSES } from './inventory.dto';

// Inventory batch I8 (build plan §5.8, B9): goods returns (برگشت کالا به
// تأمین‌کننده) — physical stock leaving ON_HAND/QC/DAMAGED back to the
// supplier. Shape-only validation here; everything that needs the database
// (supplier/location/goods-receipt existence, the goods-receipt-item cap,
// the item's batch-tracked state, free-stock checks) is checked by
// GoodsReturnsService, and re-checked authoritatively by stock-ledger.ts
// applyMovements() at posting.
//
// Never accepted from the client: returnNumber (assigned at posting),
// status (one dedicated action per transition only), supplierName
// (snapshotted from the supplier), purchaseReturnNumber (snapshotted from
// the referenced PurchaseReturn, when given — no FK, display only).

export const GOODS_RETURN_FROM_BUCKETS = ['ON_HAND', 'QC', 'DAMAGED'] as const;

const goodsReturnItemSchema = z.object(
  {
    // Optional: caps this line's quantity by goodsReceiptItem.quantity −
    // returnedQty (service-enforced) — a return of general DAMAGED/ON_HAND
    // stock not traceable to one receipt doesn't need this.
    goodsReceiptItemId: optionalId('ردیف رسید انبار نامعتبر است'),
    itemId: requiredId('کالا را انتخاب کنید'),
    // I4: required for a batch-tracked item (an existing batch only — the
    // line is always outbound, never creates a new lot), forbidden otherwise
    // (service).
    batchId: optionalId('بچ انتخاب‌شده نامعتبر است'),
    fromBucket: enumField(GOODS_RETURN_FROM_BUCKETS, 'مبدا موجودی را انتخاب کنید'),
    quantity: requiredQuantity('مقدار'),
    note: optionalTrimmedString(500),
  },
  { error: 'ردیف کالا نامعتبر است' },
);

const goodsReturnBaseSchema = z.object({
  // Optional: omitted = the default warehouse.
  locationId: optionalId('انبار نامعتبر است'),
  supplierId: requiredId('تأمین‌کننده را انتخاب کنید'),
  // Optional plain reference to a GoodsReceipt — caps goodsReceiptItemId
  // lines (service).
  goodsReceiptId: optionalId('رسید انبار انتخاب‌شده نامعتبر است'),
  // Optional plain reference to Purchases' own financial Return-to-Vendor
  // record — NOT a foreign key (B3/B12 philosophy, CLAUDE.md rule 5); the
  // service checks it exists and snapshots its returnNumber.
  purchaseReturnId: optionalId('برگشت از خرید انتخاب‌شده نامعتبر است'),
  returnDate: requiredBusinessDate('تاریخ برگشت معتبر نیست'),
  reason: requiredText(500, 'علت برگشت الزامی است'),
  note: optionalTrimmedString(1000),
  items: z.array(goodsReturnItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }),
});

export const createGoodsReturnSchema = goodsReturnBaseSchema;

// Full-record edit of a DRAFT (lines replaced wholesale) with the usual
// optimistic lock: updatedAt is the version the client loaded.
export const updateGoodsReturnSchema = goodsReturnBaseSchema.extend({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const postGoodsReturnSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const goodsReturnListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  supplierId: optionalId('فیلتر تأمین‌کننده نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export type CreateGoodsReturnDto = z.infer<typeof createGoodsReturnSchema>;
export type UpdateGoodsReturnDto = z.infer<typeof updateGoodsReturnSchema>;
export type PostGoodsReturnDto = z.infer<typeof postGoodsReturnSchema>;
export type GoodsReturnListQuery = z.infer<typeof goodsReturnListQuerySchema>;
