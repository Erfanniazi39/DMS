import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  MAX_QUANTITY,
  MIN_QUANTITY,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredText,
} from '../../common/zod-fields';

// Field builders from common/zod-fields.ts (strict: missing/blank/wrong-type
// on a required field is a 400 with a Persian message, never coerced).
// Quantities follow Decimal(12,2): at least 0.01 in magnitude, at most two
// decimals.

export const STOCK_ADJUSTMENT_KINDS = ['OPENING', 'RECEIPT', 'CORRECTION'] as const;
export const STOCK_DOCUMENT_STATUSES = ['DRAFT', 'POSTED'] as const;
// OPENING / RECEIPT lines bring stock in, so must be positive; a
// CORRECTION line is signed (+ increase, − decrease). Mirrors
// INBOUND_ONLY_ADJUSTMENT_KINDS in inventory-rules.ts.
const INBOUND_ONLY_KINDS: readonly string[] = ['OPENING', 'RECEIPT'];

// Same preprocessing as zod-fields' quantity helpers (null/blank → missing,
// numeric string → number, anything else left for z.number() to reject).
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

// A non-zero signed quantity within Decimal(12,2). Kept local rather than
// added to common/zod-fields.ts — only stock adjustments take signed
// quantities so far.
function requiredSignedQuantity(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .refine((value) => Number.isFinite(value), { error: `${label} باید عدد باشد` })
      .refine((value) => Math.abs(value) >= MIN_QUANTITY, { error: `${label} نمی‌تواند صفر باشد (حداقل ۰٫۰۱)` })
      .refine((value) => Math.abs(value) <= MAX_QUANTITY, { error: `${label} بیش از حد مجاز است` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` }),
  );
}

const stockAdjustmentItemSchema = z.object(
  {
    itemId: requiredId('کالا را انتخاب کنید'),
    quantity: requiredSignedQuantity('مقدار'),
    note: optionalTrimmedString(500),
  },
  { error: 'ردیف کالا نامعتبر است' },
);

const stockAdjustmentBaseSchema = z.object({
  kind: enumField(STOCK_ADJUSTMENT_KINDS, 'نوع سند موجودی را انتخاب کنید'),
  // Optional: omitted = the default warehouse (single-warehouse setup).
  locationId: optionalId('انبار نامعتبر است'),
  adjustmentDate: requiredBusinessDate('تاریخ سند معتبر نیست'),
  reason: requiredText(500, 'علت ثبت سند الزامی است'),
  note: optionalTrimmedString(1000),
  items: z
    .array(stockAdjustmentItemSchema, { error: 'فهرست اقلام نامعتبر است' })
    .min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }),
});

function inboundOnlyRefine(value: { kind: string; items: { quantity: number }[] }, ctx: z.RefinementCtx) {
  if (!INBOUND_ONLY_KINDS.includes(value.kind)) return;
  value.items.forEach((item, index) => {
    if (item.quantity <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'quantity'],
        message: 'در سند «موجودی اول دوره» و «رسید موجودی» مقدار باید مثبت باشد؛ برای کاهش موجودی از «اصلاح موجودی» استفاده کنید',
      });
    }
  });
}

export const createStockAdjustmentSchema = stockAdjustmentBaseSchema.superRefine(inboundOnlyRefine);

// Full-record edit of a DRAFT (lines replaced wholesale), with the same
// optimistic lock as the Purchases edit form: updatedAt is the version the
// client loaded.
export const updateStockAdjustmentSchema = stockAdjustmentBaseSchema
  .extend({ updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') })
  .superRefine(inboundOnlyRefine);

// Posting: the client confirms the version it reviewed.
export const postStockAdjustmentSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const stockAdjustmentListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  kind: z.preprocess(emptyToUndefined, enumField(STOCK_ADJUSTMENT_KINDS, 'فیلتر نوع سند نامعتبر است').optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

// sortBy=available sorts by onHand − reserved (قابل فروش) — the "which item
// is running low" view (Sales batch 7, in place of a deferred reorder-level
// report; Item has no reorder-level field yet). Default stays the name sort
// the page always had; sortDir defaults to ascending so the lowest-stock
// items surface first when a caller does switch to it.
export const STOCK_BALANCE_SORT_FIELDS = ['name', 'available'] as const;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export const stockBalanceListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  locationId: optionalId('فیلتر انبار نامعتبر است'),
  sortBy: z.preprocess(emptyToUndefined, enumField(STOCK_BALANCE_SORT_FIELDS, 'فیلتر مرتب‌سازی نامعتبر است').optional()),
  sortDir: z.preprocess(emptyToUndefined, enumField(SORT_DIRECTIONS, 'جهت مرتب‌سازی نامعتبر است').optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export const availabilityQuerySchema = z.object({
  locationId: optionalId('انبار نامعتبر است'),
});

export type CreateStockAdjustmentDto = z.infer<typeof createStockAdjustmentSchema>;
export type UpdateStockAdjustmentDto = z.infer<typeof updateStockAdjustmentSchema>;
export type PostStockAdjustmentDto = z.infer<typeof postStockAdjustmentSchema>;
export type StockAdjustmentListQuery = z.infer<typeof stockAdjustmentListQuerySchema>;
export type StockBalanceListQuery = z.infer<typeof stockBalanceListQuerySchema>;
export type StockBalanceSortField = (typeof STOCK_BALANCE_SORT_FIELDS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
