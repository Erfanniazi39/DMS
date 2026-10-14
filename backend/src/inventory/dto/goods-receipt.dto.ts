import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalId,
  optionalMoney,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredQuantity,
} from '../../common/zod-fields';
import { STOCK_DOCUMENT_STATUSES } from './inventory.dto';

// Inventory batch I5 (build plan §5.5, B3 reframed / B15 / B19): goods
// receipts (رسید انبار) — raw materials / packaging received from a
// supplier. Shape-only validation here; everything that needs the database
// (item kind RAW_MATERIAL/PACKAGING, the item's batch-tracked state, supplier
// / purchase / location existence) is checked by GoodsReceiptsService, and
// re-checked authoritatively by stock-ledger.ts applyMovements() at posting.

const goodsReceiptItemSchema = z
  .object(
    {
      itemId: requiredId('کالا را انتخاب کنید'),
      quantity: requiredQuantity('مقدار'),
      // B15: per-unit cost (whole Rial). Optional. Only a caller holding
      // inventory.cost may send it — the service refuses it otherwise.
      unitCost: optionalMoney('بهای واحد'),
      // I4: required for a batch-tracked item, forbidden otherwise (service).
      // A typed lot number resolves to an existing batch of the same item or
      // creates a new one at posting (stock-batches.ts resolveBatches()).
      batchNumber: optionalTrimmedString(100),
      productionDate: optionalBusinessDate('تاریخ تولید نامعتبر است'),
      expiryDate: optionalBusinessDate('تاریخ انقضا نامعتبر است'),
      note: optionalTrimmedString(500),
    },
    { error: 'ردیف کالا نامعتبر است' },
  )
  .superRefine((value, ctx) => {
    if (value.expiryDate && value.productionDate && value.expiryDate.getTime() < value.productionDate.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'تاریخ انقضا نمی‌تواند قبل از تاریخ تولید باشد' });
    }
    if (!value.batchNumber && (value.productionDate || value.expiryDate)) {
      ctx.addIssue({ code: 'custom', path: ['batchNumber'], message: 'تاریخ تولید/انقضا فقط همراه با شمارهٔ بچ ثبت می‌شود' });
    }
  });

const goodsReceiptBaseSchema = z.object({
  // Optional: omitted = the default warehouse.
  locationId: optionalId('انبار نامعتبر است'),
  receiptDate: requiredBusinessDate('تاریخ رسید معتبر نیست'),
  supplierId: requiredId('تأمین‌کننده را انتخاب کنید'),
  supplierDocumentNumber: optionalTrimmedString(100),
  // Optional plain reference to a Purchase — NOT a foreign key (B3, B12
  // philosophy; Purchases never drive stock, CLAUDE.md rule 7). The service
  // checks it exists and snapshots its purchaseNumber.
  purchaseId: optionalId('خرید انتخاب‌شده نامعتبر است'),
  // B19: when true, every line posts into QC and must be released
  // (POST /inventory/goods-receipts/:id/release-qc) before it is usable.
  inspectionRequired: z.boolean({ error: 'مقدار «نیاز به کنترل کیفیت» نامعتبر است' }).optional().default(false),
  note: optionalTrimmedString(1000),
  items: z.array(goodsReceiptItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }),
});

export const createGoodsReceiptSchema = goodsReceiptBaseSchema;

// Full-record edit of a DRAFT (lines replaced wholesale) with the usual
// optimistic lock: updatedAt is the version the client loaded.
export const updateGoodsReceiptSchema = goodsReceiptBaseSchema.extend({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const postGoodsReceiptSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

// B19: QC → ON_HAND release, per line, any partial quantity up to what is
// still in QC for that line (quantity − releasedQty − rejectedQty).
export const releaseGoodsReceiptQcSchema = z
  .object({
    updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
    lines: z
      .array(
        z.object(
          {
            goodsReceiptItemId: requiredId('ردیف رسید را انتخاب کنید'),
            quantity: requiredQuantity('مقدار آزادسازی'),
          },
          { error: 'ردیف آزادسازی نامعتبر است' },
        ),
        { error: 'فهرست ردیف‌های آزادسازی نامعتبر است' },
      )
      .min(1, { error: 'حداقل یک ردیف برای آزادسازی وارد کنید' }),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.goodsReceiptItemId)) {
        ctx.addIssue({ code: 'custom', path: ['lines', index, 'goodsReceiptItemId'], message: 'هر ردیف رسید فقط یک بار در درخواست آزادسازی می‌آید' });
      }
      seen.add(line.goodsReceiptItemId);
    });
  });

export const goodsReceiptListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  supplierId: optionalId('فیلتر تأمین‌کننده نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export type CreateGoodsReceiptDto = z.infer<typeof createGoodsReceiptSchema>;
export type UpdateGoodsReceiptDto = z.infer<typeof updateGoodsReceiptSchema>;
export type PostGoodsReceiptDto = z.infer<typeof postGoodsReceiptSchema>;
export type ReleaseGoodsReceiptQcDto = z.infer<typeof releaseGoodsReceiptQcSchema>;
export type GoodsReceiptListQuery = z.infer<typeof goodsReceiptListQuerySchema>;
