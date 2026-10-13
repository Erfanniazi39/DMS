import { z } from 'zod';
import { MAX_QUANTITY, optionalId, optionalTrimmedString, requiredId } from '../../common/zod-fields';

// I3 (build plan §5.3, B14): ItemStockLevel — user-set min/reorder/max per
// item+location. Both cross-field rules mirror the two CHECK constraints the
// migration adds at the database level (min_qty >= 0, max_qty IS NULL OR
// max_qty >= min_qty) — enforced here first so a user sees a clean Persian
// message instead of a raw constraint violation.

// Same preprocessing as inventory.dto.ts's local helper (null/blank →
// missing, numeric string → number, anything else left for z.number() to
// reject) — kept local rather than added to common/zod-fields.ts, matching
// that file's own precedent of not sharing this particular helper.
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

// Unlike inventory.dto.ts's quantities (adjustment lines, never zero),
// min/reorder/max may legitimately be zero (e.g. "alert on any stock-out").
function requiredNonNegativeQuantity(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .min(0, { error: `${label} نمی‌تواند منفی باشد` })
      .max(MAX_QUANTITY, { error: `${label} بیش از حد مجاز است` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` }),
  );
}

function optionalNonNegativeQuantity(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .min(0, { error: `${label} نمی‌تواند منفی باشد` })
      .max(MAX_QUANTITY, { error: `${label} بیش از حد مجاز است` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` })
      .optional(),
  );
}

function maxAtLeastMinRefine(
  value: { minQty: number; maxQty?: number },
  ctx: z.RefinementCtx,
) {
  if (value.maxQty !== undefined && value.maxQty < value.minQty) {
    ctx.addIssue({ code: 'custom', path: ['maxQty'], message: 'حداکثر موجودی نمی‌تواند کمتر از حداقل موجودی باشد' });
  }
}

export const upsertStockLevelSchema = z
  .object({
    itemId: requiredId('کالا را انتخاب کنید'),
    // Optional: omitted = the default warehouse (single-warehouse setup),
    // same convention as stock-adjustment documents.
    locationId: optionalId('انبار نامعتبر است'),
    minQty: requiredNonNegativeQuantity('حداقل موجودی'),
    reorderQty: optionalNonNegativeQuantity('مقدار سفارش مجدد'),
    maxQty: optionalNonNegativeQuantity('حداکثر موجودی'),
    note: optionalTrimmedString(500),
  })
  .superRefine(maxAtLeastMinRefine);

export const stockLevelListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  locationId: optionalId('فیلتر انبار نامعتبر است'),
});

// GET /inventory/reports/low-stock
export const lowStockQuerySchema = z.object({
  locationId: optionalId('فیلتر انبار نامعتبر است'),
});

export type UpsertStockLevelDto = z.infer<typeof upsertStockLevelSchema>;
export type StockLevelListQuery = z.infer<typeof stockLevelListQuerySchema>;
export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;
