import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  MAX_QUANTITY,
  MIN_QUANTITY,
  optionalBusinessDate,
  optionalDate,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredText,
} from '../../common/zod-fields';
import { stockAdjustmentRequiresReasonCode } from '../inventory-rules';

// Field builders from common/zod-fields.ts (strict: missing/blank/wrong-type
// on a required field is a 400 with a Persian message, never coerced).
// Quantities follow Decimal(12,2): at least 0.01 in magnitude, at most two
// decimals.

export const STOCK_ADJUSTMENT_KINDS = ['OPENING', 'RECEIPT', 'CORRECTION', 'WRITE_OFF', 'BATCH_CUTOVER', 'MARK_DAMAGED'] as const;
export const STOCK_DOCUMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'POSTED'] as const;
// I2 (B11) — StockAdjustment.reasonCode. Use as-is, not extensible without a
// new business decision.
export const STOCK_ADJUSTMENT_REASONS = [
  'DAMAGED',
  'EXPIRED',
  'LOST',
  'FOUND',
  'COUNT_ERROR',
  'DATA_ENTRY_ERROR',
  'SAMPLE_OR_INTERNAL_USE',
  'OTHER',
] as const;

// Movement browser (/inventory/movements) filter enums — keep in sync with
// schema.prisma's StockBucket / StockMovementType / StockReferenceType.
export const STOCK_BUCKETS = ['ON_HAND', 'RESERVED', 'QC', 'DAMAGED'] as const;
export const STOCK_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'MANUAL_RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'RESERVE',
  'RELEASE',
  'DELIVERY_ISSUE',
  'RETURN_RECEIPT',
  'RETURN_RESTOCK',
  'RETURN_WRITE_OFF',
  'WRITE_OFF',
  // I5
  'GOODS_RECEIPT',
  'QC_RELEASE',
  'PRODUCTION_OUTPUT',
  // I6
  'COUNT_GAIN',
  'COUNT_LOSS',
  // I8
  'MARK_DAMAGED',
  'RETURN_TO_DAMAGED',
  'SUPPLIER_RETURN',
] as const;
export const STOCK_REFERENCE_TYPES = [
  'STOCK_ADJUSTMENT',
  'SALES_ORDER',
  'DELIVERY',
  'SALES_RETURN',
  'GOODS_RECEIPT',
  'PRODUCTION_OUTPUT',
  // I6
  'STOCK_COUNT',
  // I8
  'GOODS_RETURN',
] as const;
// OPENING / RECEIPT / BATCH_CUTOVER lines bring stock in, so must be
// positive; a CORRECTION line is signed (+ increase, − decrease). Mirrors
// INBOUND_ONLY_ADJUSTMENT_KINDS in inventory-rules.ts.
const INBOUND_ONLY_KINDS: readonly string[] = ['OPENING', 'RECEIPT', 'BATCH_CUTOVER'];
// WRITE_OFF/MARK_DAMAGED lines must be negative — the mirror of
// INBOUND_ONLY_KINDS. Mirrors OUTBOUND_ONLY_ADJUSTMENT_KINDS in
// inventory-rules.ts.
const OUTBOUND_ONLY_KINDS: readonly string[] = ['WRITE_OFF', 'MARK_DAMAGED'];

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
    // I4 (build plan §5.4/§5.4a): batch fields for a batch-tracked item's
    // line. Shape-only here (not both batchId and batchNumber; dates are
    // plausible business dates) — whether they're required/forbidden at all
    // depends on the item's own tracked state, which only the service layer
    // knows (ensureBatchFieldsValid()), re-checked authoritatively by
    // applyMovements() at post/approve either way.
    batchId: optionalId('بچ انتخاب‌شده نامعتبر است'),
    batchNumber: optionalTrimmedString(100),
    productionDate: optionalBusinessDate('تاریخ تولید نامعتبر است'),
    expiryDate: optionalBusinessDate('تاریخ انقضا نامعتبر است'),
  },
  { error: 'ردیف کالا نامعتبر است' },
).superRefine((value, ctx) => {
  if (value.batchId && value.batchNumber) {
    ctx.addIssue({ code: 'custom', path: ['batchNumber'], message: 'فقط یکی از «انتخاب بچ موجود» یا «شمارهٔ بچ جدید» را وارد کنید' });
  }
  if (value.expiryDate && value.productionDate && value.expiryDate.getTime() < value.productionDate.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'تاریخ انقضا نمی‌تواند قبل از تاریخ تولید باشد' });
  }
});

const stockAdjustmentBaseSchema = z.object({
  kind: enumField(STOCK_ADJUSTMENT_KINDS, 'نوع سند موجودی را انتخاب کنید'),
  // Optional: omitted = the default warehouse (single-warehouse setup).
  locationId: optionalId('انبار نامعتبر است'),
  adjustmentDate: requiredBusinessDate('تاریخ سند معتبر نیست'),
  reason: requiredText(500, 'علت ثبت سند الزامی است'),
  // B11: required for WRITE_OFF, or CORRECTION with a negative net quantity
  // (reasonCodeRefine below) — otherwise optional.
  reasonCode: z.preprocess(emptyToUndefined, enumField(STOCK_ADJUSTMENT_REASONS, 'علت سند نامعتبر است').optional()),
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

// WRITE_OFF/MARK_DAMAGED lines must be negative (mirror of
// inboundOnlyRefine) — a quantity entered is the magnitude written off /
// marked damaged, kept negative throughout so it posts straight to the
// ledger with no extra sign handling.
const OUTBOUND_ONLY_KIND_LABELS_FA: Record<string, string> = { WRITE_OFF: 'ضایعات', MARK_DAMAGED: 'اعلام آسیب‌دیدگی' };
function outboundOnlyRefine(value: { kind: string; items: { quantity: number }[] }, ctx: z.RefinementCtx) {
  if (!OUTBOUND_ONLY_KINDS.includes(value.kind)) return;
  const label = OUTBOUND_ONLY_KIND_LABELS_FA[value.kind] ?? value.kind;
  value.items.forEach((item, index) => {
    if (item.quantity >= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'quantity'],
        message: `در سند «${label}» مقدار باید منفی باشد (مقدار کسر از موجودی)`,
      });
    }
  });
}

// B10/B11, I4 R6: reasonCode is required whenever
// stockAdjustmentRequiresReasonCode() says so (WRITE_OFF, or a negative-net
// CORRECTION) — deliberately NOT the same condition as "needs approval"
// (BATCH_CUTOVER needs approval but never a reasonCode) — a single source of
// truth shared with the backend either way.
function reasonCodeRefine(value: { kind: string; items: { quantity: number }[]; reasonCode?: string }, ctx: z.RefinementCtx) {
  const needsReason = stockAdjustmentRequiresReasonCode(
    value.kind as (typeof STOCK_ADJUSTMENT_KINDS)[number],
    value.items.map((item) => item.quantity),
  );
  if (needsReason && !value.reasonCode) {
    ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'علت را برای این نوع سند انتخاب کنید' });
  }
}

// I4 (B23/§6): every BATCH_CUTOVER line names a new/matching lot — a
// batchNumber, never a pick of an existing batchId (there's no "existing
// batch" yet; that's the whole point of the cutover).
function batchCutoverRefine(value: { kind: string; items: { batchId?: number; batchNumber?: string }[] }, ctx: z.RefinementCtx) {
  if (value.kind !== 'BATCH_CUTOVER') return;
  value.items.forEach((item, index) => {
    if (item.batchId) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'batchId'], message: 'در سند «تبدیل به ردیابی بچ» باید شمارهٔ بچ جدید وارد شود، نه انتخاب بچ موجود' });
    }
    if (!item.batchNumber) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'batchNumber'], message: 'برای هر ردیف این سند، شمارهٔ بچ الزامی است' });
    }
  });
}

export const createStockAdjustmentSchema = stockAdjustmentBaseSchema
  .superRefine(inboundOnlyRefine)
  .superRefine(outboundOnlyRefine)
  .superRefine(reasonCodeRefine)
  .superRefine(batchCutoverRefine);

// Full-record edit of a DRAFT (lines replaced wholesale), with the same
// optimistic lock as the Purchases edit form: updatedAt is the version the
// client loaded.
export const updateStockAdjustmentSchema = stockAdjustmentBaseSchema
  .extend({ updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') })
  .superRefine(inboundOnlyRefine)
  .superRefine(outboundOnlyRefine)
  .superRefine(reasonCodeRefine)
  .superRefine(batchCutoverRefine);

// Posting: the client confirms the version it reviewed.
export const postStockAdjustmentSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

// Submit for approval / approve: same shape as post — the client confirms
// the version it reviewed.
export const submitStockAdjustmentSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});
export const approveStockAdjustmentSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});
// Reject: sends a PENDING_APPROVAL document back to DRAFT. A reason is
// required (build plan §6).
export const rejectStockAdjustmentSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
  rejectReason: requiredText(500, 'علت رد الزامی است'),
});

export const stockAdjustmentListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  kind: z.preprocess(emptyToUndefined, enumField(STOCK_ADJUSTMENT_KINDS, 'فیلتر نوع سند نامعتبر است').optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
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
  // Column sort (?sortBy=&sortDir=) — validated by parseSort() + the whitelist in InventoryService.
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
  // I3 (B14): only rows below their own configured ItemStockLevel threshold.
  lowStockOnly: z.preprocess(emptyToUndefined, z.enum(['true', 'false'], { error: 'فیلتر کمبود موجودی نامعتبر است' }).optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export const availabilityQuerySchema = z.object({
  locationId: optionalId('انبار نامعتبر است'),
});

// GET /inventory/items/:itemId/stock-card (کاردکس) — itemId is a route
// param (ParseIntPipe); this covers only the optional location filter.
export const stockCardQuerySchema = z.object({
  locationId: optionalId('فیلتر انبار نامعتبر است'),
});

// GET /inventory/items/:itemId/batches (I4) — itemId is a route param
// (ParseIntPipe); this covers only the optional location filter (same shape
// as stockCardQuerySchema, kept separate for this endpoint's own clarity).
export const itemBatchesQuerySchema = z.object({
  locationId: optionalId('فیلتر انبار نامعتبر است'),
});

// GET /inventory/movements — the movement browser's filters.
export const stockMovementListQuerySchema = z.object({
  itemId: optionalId('فیلتر کالا نامعتبر است'),
  locationId: optionalId('فیلتر انبار نامعتبر است'),
  bucket: z.preprocess(emptyToUndefined, enumField(STOCK_BUCKETS, 'فیلتر نوع موجودی نامعتبر است').optional()),
  movementType: z.preprocess(emptyToUndefined, enumField(STOCK_MOVEMENT_TYPES, 'فیلتر نوع رویداد نامعتبر است').optional()),
  referenceType: z.preprocess(emptyToUndefined, enumField(STOCK_REFERENCE_TYPES, 'فیلتر نوع سند مرجع نامعتبر است').optional()),
  dateFrom: optionalDate('تاریخ شروع نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

// Inventory locations (warehouses) — plain master data, same shape as
// Units/PurchaseType: code/name/isActive + note. Not a stock-ledger
// transaction, so no optimistic-lock version (InventoryLocation has no
// updatedAt column). isDefault exclusivity (only one location may be the
// default) and the "can't unset/deactivate the only default" guards are
// enforced by InventoryService, not here — this is shape-only validation.
export const createLocationSchema = z.object({
  code: requiredText(50, 'کد انبار الزامی است'),
  name: requiredText(200, 'نام انبار الزامی است'),
  isActive: z.boolean({ error: 'وضعیت فعال/غیرفعال نامعتبر است' }).optional().default(true),
  isDefault: z.boolean({ error: 'مقدار پیش‌فرض نامعتبر است' }).optional().default(false),
  note: optionalTrimmedString(500),
});

// Full-record edit — same shape as create (no partial PATCH semantics),
// same convention as UpdateUnitDto.
export const updateLocationSchema = createLocationSchema;

export type CreateStockAdjustmentDto = z.infer<typeof createStockAdjustmentSchema>;
export type UpdateStockAdjustmentDto = z.infer<typeof updateStockAdjustmentSchema>;
export type PostStockAdjustmentDto = z.infer<typeof postStockAdjustmentSchema>;
export type SubmitStockAdjustmentDto = z.infer<typeof submitStockAdjustmentSchema>;
export type ApproveStockAdjustmentDto = z.infer<typeof approveStockAdjustmentSchema>;
export type RejectStockAdjustmentDto = z.infer<typeof rejectStockAdjustmentSchema>;
export type StockAdjustmentListQuery = z.infer<typeof stockAdjustmentListQuerySchema>;
export type StockBalanceListQuery = z.infer<typeof stockBalanceListQuerySchema>;
export type StockBalanceSortField = (typeof STOCK_BALANCE_SORT_FIELDS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type StockCardQuery = z.infer<typeof stockCardQuerySchema>;
export type ItemBatchesQuery = z.infer<typeof itemBatchesQuerySchema>;
export type CreateLocationDto = z.infer<typeof createLocationSchema>;
export type UpdateLocationDto = z.infer<typeof updateLocationSchema>;
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
