import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  MAX_QUANTITY,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredText,
} from '../../common/zod-fields';
import { STOCK_ADJUSTMENT_REASONS } from './inventory.dto';

// Inventory batch I6 (build plan §5.6/§6, B13 — the architect's default
// adopted, not yet confirmed by the business owner: blind entry, approval by
// a different person than the submitter, stale-line detection instead of
// freezing operations). Shape-only validation here; everything that needs
// the database (item/batch existence, the item's batch-tracked state,
// whether a line is actually stale) is checked by StockCountsService.

export const STOCK_COUNT_SCOPES = ['FULL', 'PARTIAL'] as const;
export const STOCK_COUNT_STATUSES = ['DRAFT', 'COUNTING', 'REVIEW', 'POSTED', 'CANCELLED'] as const;

// Same preprocessing as inventory.dto.ts's local quantity helpers — kept
// local rather than added to common/zod-fields.ts, since only stock counts
// need a quantity that may legitimately be exactly zero (an empty shelf is a
// real count, unlike every other document's quantities which must be > 0).
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

const optionalReasonCode = z.preprocess(emptyToUndefined, enumField(STOCK_ADJUSTMENT_REASONS, 'علت نامعتبر است').optional());

const stockCountItemSchema = z.object(
  {
    itemId: requiredId('کالا را انتخاب کنید'),
    // I4 present: an existing batch only — stock counts never create a new
    // batch (unlike receipts/adjustments' typed-lot-number lines).
    batchId: optionalId('بچ انتخاب‌شده نامعتبر است'),
    note: optionalTrimmedString(500),
  },
  { error: 'ردیف کالا نامعتبر است' },
);

const stockCountBaseSchema = z.object({
  // Optional: omitted = the default warehouse.
  locationId: optionalId('انبار نامعتبر است'),
  countDate: requiredBusinessDate('تاریخ شمارش معتبر نیست'),
  scope: enumField(STOCK_COUNT_SCOPES, 'نوع شمارش را انتخاب کنید'),
  // B13: default true. While true and the document is COUNTING, systemQty
  // is omitted server-side from every response to a caller without
  // inventory.approve (StockCountsService) — not just hidden in the UI.
  isBlind: z.boolean({ error: 'مقدار «شمارش کور» نامعتبر است' }).optional().default(true),
  note: optionalTrimmedString(1000),
  // PARTIAL: the lines to count, chosen now. FULL: none here — every item
  // with a balance row at the location is populated automatically by
  // start().
  items: z.array(stockCountItemSchema, { error: 'فهرست اقلام نامعتبر است' }).optional().default([]),
});

function scopeItemsRefine(value: { scope: string; items: { itemId: number; batchId?: number }[] }, ctx: z.RefinementCtx) {
  if (value.scope === 'PARTIAL' && value.items.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'برای «شمارش بخشی» حداقل یک ردیف کالا را وارد کنید' });
  }
  if (value.scope === 'FULL' && value.items.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'برای «شمارش کامل» ردیف کالا در این مرحله وارد نمی‌شود؛ پس از شروع شمارش به‌صورت خودکار افزوده می‌شود',
    });
  }
  // Mirrors the DB's expression unique index (stock_count_id, item_id,
  // COALESCE(batch_id, 0)) — one line per item (and, if given, per batch).
  const seen = new Set<string>();
  value.items.forEach((item, index) => {
    const key = `${item.itemId}:${item.batchId ?? 0}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'itemId'], message: 'این کالا (و بچ) قبلاً در فهرست آمده است' });
    }
    seen.add(key);
  });
}

export const createStockCountSchema = stockCountBaseSchema.superRefine(scopeItemsRefine);

// Full-record edit of a DRAFT (lines replaced wholesale), same optimistic
// lock as every other document here.
export const updateStockCountSchema = stockCountBaseSchema.extend({ updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') }).superRefine(scopeItemsRefine);

// start(): DRAFT → COUNTING. No body beyond the version the client loaded.
export const startStockCountSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

// enterCount(): record countedQty (and, optionally, a reasonCode/note) per
// line while COUNTING. Any subset of lines, any number of times — later
// calls overwrite earlier ones. reasonCode is optional here (a blind counter
// can't know whether there IS a variance); approve() requires one on any
// line that turns out to have one.
export const enterStockCountSchema = z
  .object({
    updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
    lines: z
      .array(
        z.object(
          {
            stockCountItemId: requiredId('ردیف شمارش را انتخاب کنید'),
            countedQty: requiredNonNegativeQuantity('مقدار شمارش‌شده'),
            reasonCode: optionalReasonCode,
            note: optionalTrimmedString(500),
          },
          { error: 'ردیف شمارش نامعتبر است' },
        ),
        { error: 'فهرست ردیف‌های شمارش نامعتبر است' },
      )
      .min(1, { error: 'حداقل یک ردیف برای ثبت شمارش وارد کنید' }),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.stockCountItemId)) {
        ctx.addIssue({ code: 'custom', path: ['lines', index, 'stockCountItemId'], message: 'هر ردیف فقط یک بار در یک درخواست می‌آید' });
      }
      seen.add(line.stockCountItemId);
    });
  });

// submit(): COUNTING → REVIEW. No body beyond the version.
export const submitStockCountSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

// approve(): REVIEW → POSTED. `lines` lets the approver (who, unlike the
// blind counter, can see systemQty/varianceQty once in REVIEW) supply the
// reasonCode a variance line needs — the service fills any line that
// already has one from an earlier call and only requires it be present by
// the time of posting, from either source.
export const approveStockCountSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
  lines: z
    .array(
      z.object(
        {
          stockCountItemId: requiredId('ردیف شمارش را انتخاب کنید'),
          reasonCode: optionalReasonCode,
        },
        { error: 'ردیف تأیید نامعتبر است' },
      ),
    )
    .optional()
    .default([]),
});

// requestRecount(): REVIEW → COUNTING for the selected lines only — the
// un-staling mechanism (build plan §6/§5.4a-style note).
export const requestRecountStockCountSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
  lineIds: z.array(requiredId('ردیف شمارش را انتخاب کنید')).min(1, { error: 'حداقل یک ردیف برای شمارش مجدد انتخاب کنید' }),
});

// cancel(): DRAFT/COUNTING/REVIEW → CANCELLED. Reason required, same
// convention as reject()/cancel() elsewhere in this module.
export const cancelStockCountSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
  cancelReason: requiredText(500, 'علت لغو الزامی است'),
});

export const stockCountListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_COUNT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  scope: z.preprocess(emptyToUndefined, enumField(STOCK_COUNT_SCOPES, 'فیلتر نوع شمارش نامعتبر است').optional()),
  locationId: optionalId('فیلتر انبار نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export type CreateStockCountDto = z.infer<typeof createStockCountSchema>;
export type UpdateStockCountDto = z.infer<typeof updateStockCountSchema>;
export type StartStockCountDto = z.infer<typeof startStockCountSchema>;
export type EnterStockCountDto = z.infer<typeof enterStockCountSchema>;
export type SubmitStockCountDto = z.infer<typeof submitStockCountSchema>;
export type ApproveStockCountDto = z.infer<typeof approveStockCountSchema>;
export type RequestRecountStockCountDto = z.infer<typeof requestRecountStockCountSchema>;
export type CancelStockCountDto = z.infer<typeof cancelStockCountSchema>;
export type StockCountListQuery = z.infer<typeof stockCountListQuerySchema>;
