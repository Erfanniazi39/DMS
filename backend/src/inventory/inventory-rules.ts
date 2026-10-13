import {
  Prisma,
  type ItemKind,
  type StockAdjustmentKind,
  type StockAdjustmentReason,
  type StockBucket,
  type StockCountScope,
  type StockCountStatus,
  type StockDocumentStatus,
  type StockMovementType,
  type StockReferenceType,
} from '@prisma/client';

// The Inventory module's single definition of what its enums mean. Pure
// values only (no DI), so other modules (later: Sales, Returns, Reports) can
// import them without creating a module dependency cycle — same role as
// purchases/purchase-rules.ts (CLAUDE.md rule 11).

// The id of the default (and, for now, only) warehouse is not hard-coded:
// it's the InventoryLocation row with isDefault = true (seeded as MAIN).

// Which bucket(s) each movement type may touch, and in which direction.
// stock-ledger.ts applyMovements() refuses any row that doesn't match this
// map, so a caller can't e.g. "RESERVE" into ON_HAND or write a positive
// ADJUSTMENT_OUT. Most types touch exactly one bucket; RETURN_RESTOCK is a
// transfer QC → ON_HAND, written as two rows (QC −, ON_HAND +) with the
// same reference.
//
// Produced today: OPENING_BALANCE / MANUAL_RECEIPT / ADJUSTMENT_IN /
// ADJUSTMENT_OUT (stock adjustments), RESERVE / RELEASE (sales orders,
// batch 2), DELIVERY_ISSUE (deliveries, batch 3). The RETURN_* types are
// reserved for Sales batch 6 (returns receive into QC and then restock or
// write off) — their direction here follows from their meaning.
export type MovementDirection = 'IN' | 'OUT';

export const MOVEMENT_TYPE_BUCKETS: Record<StockMovementType, Partial<Record<StockBucket, MovementDirection>>> = {
  OPENING_BALANCE: { ON_HAND: 'IN' },
  MANUAL_RECEIPT: { ON_HAND: 'IN' },
  ADJUSTMENT_IN: { ON_HAND: 'IN' },
  ADJUSTMENT_OUT: { ON_HAND: 'OUT' },
  RESERVE: { RESERVED: 'IN' },
  RELEASE: { RESERVED: 'OUT' },
  // Build plan §5: a posted delivery takes ON_HAND −q and, for the part the
  // order had reserved, RESERVED −min(q, reservedQty) — two rows, same
  // reference (stock-ledger.ts issueForDelivery()).
  DELIVERY_ISSUE: { ON_HAND: 'OUT', RESERVED: 'OUT' },
  RETURN_RECEIPT: { QC: 'IN' },
  RETURN_RESTOCK: { QC: 'OUT', ON_HAND: 'IN' },
  RETURN_WRITE_OFF: { QC: 'OUT' },
  // I2 (build plan §5.10): ON_HAND out only for now — no DAMAGED bucket
  // until I8/B9.
  WRITE_OFF: { ON_HAND: 'OUT' },
  // I5 (build plan §5.10): a posted goods-receipt line lands in ON_HAND, or
  // in QC when the receipt has inspectionRequired (B19) — one row per line,
  // the bucket chosen by the document, never both.
  GOODS_RECEIPT: { ON_HAND: 'IN', QC: 'IN' },
  // I5 (B19): QC → ON_HAND release of a goods-receipt line, written as two
  // rows (QC −r, ON_HAND +r) with the same reference — same shape as
  // RETURN_RESTOCK.
  QC_RELEASE: { QC: 'OUT', ON_HAND: 'IN' },
  // I5 (build plan §5.11): a posted production-output line.
  PRODUCTION_OUTPUT: { ON_HAND: 'IN' },
  // I6 (build plan §5.6/§6): a posted stock-count variance line — exactly
  // one of the two, never both, per line (quantity sign decides which).
  COUNT_GAIN: { ON_HAND: 'IN' },
  COUNT_LOSS: { ON_HAND: 'OUT' },
  // I8 (build plan §5.8/§6, B9): a posted MARK_DAMAGED stock-adjustment
  // line — found-damaged-on-the-shelf stock, unrelated to any specific
  // receipt — written as two rows with the same reference (ON_HAND −q,
  // DAMAGED +q), posted by StockAdjustmentsService's own dedicated builder
  // (movementTypeForAdjustmentLine() refuses this kind, same as BATCH_CUTOVER).
  MARK_DAMAGED: { ON_HAND: 'OUT', DAMAGED: 'IN' },
  // I8: a sales-return line's "to damaged" disposition (SalesReturnItem
  // .damagedQty) — the third option alongside RETURN_RESTOCK/RETURN_WRITE_OFF,
  // written as two rows (QC −d, DAMAGED +d) with the same reference.
  RETURN_TO_DAMAGED: { QC: 'OUT', DAMAGED: 'IN' },
  // I8: a posted GoodsReturn line — out of whichever ONE bucket the line's
  // own fromBucket names (ON_HAND | QC | DAMAGED), never more than one per
  // row. All three keys are declared here so applyMovements()'s lookup
  // stays a plain object read regardless of which bucket a given row uses —
  // same reason GOODS_RECEIPT declares two possible buckets above.
  SUPPLIER_RETURN: { ON_HAND: 'OUT', QC: 'OUT', DAMAGED: 'OUT' },
};

// How each stock-adjustment kind is posted to the ledger. CORRECTION lines
// are signed: a positive line is ADJUSTMENT_IN, a negative one ADJUSTMENT_OUT.
// OPENING / RECEIPT lines are always positive (enforced by the DTO).
// WRITE_OFF lines are always negative (enforced by the DTO, the mirror of
// OPENING/RECEIPT) and always post as WRITE_OFF, regardless of sign.
// I4: BATCH_CUTOVER is NOT handled here — it is a two-call special
// transaction built directly in StockAdjustmentsService (one ADJUSTMENT_OUT
// of the unbatched quantity, then one ADJUSTMENT_IN per batch line, with the
// batchTracked flip in between), not the generic buildMovementRows() path
// this function feeds. Calling this with 'BATCH_CUTOVER' is a programming
// error.
// I8: MARK_DAMAGED is NOT handled here either — it always posts two rows per
// line (ON_HAND out, DAMAGED in), never one, so it has its own dedicated
// builder in StockAdjustmentsService (buildMarkDamagedMovementRows()), not
// this function. Calling this with 'MARK_DAMAGED' is the same class of
// programming error as BATCH_CUTOVER above.
export function movementTypeForAdjustmentLine(kind: StockAdjustmentKind, quantitySign: 1 | -1): StockMovementType {
  if (kind === 'OPENING') return 'OPENING_BALANCE';
  if (kind === 'RECEIPT') return 'MANUAL_RECEIPT';
  if (kind === 'WRITE_OFF') return 'WRITE_OFF';
  if (kind === 'BATCH_CUTOVER') throw new Error('movementTypeForAdjustmentLine: BATCH_CUTOVER does not use the generic movement-row builder');
  if (kind === 'MARK_DAMAGED') throw new Error('movementTypeForAdjustmentLine: MARK_DAMAGED does not use the generic movement-row builder');
  return quantitySign > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
}

// Kinds whose lines must be positive (stock can only come in). BATCH_CUTOVER
// lines are also inbound-only (B23/§6) but are validated separately in the
// DTO/service since the kind has its own dedicated posting path.
export const INBOUND_ONLY_ADJUSTMENT_KINDS: StockAdjustmentKind[] = ['OPENING', 'RECEIPT', 'BATCH_CUTOVER'];

// I2: the mirror of INBOUND_ONLY_ADJUSTMENT_KINDS — kinds whose lines must
// be negative (stock can only go out). I8: MARK_DAMAGED joins WRITE_OFF —
// the quantity entered is the magnitude marked damaged.
export const OUTBOUND_ONLY_ADJUSTMENT_KINDS: StockAdjustmentKind[] = ['WRITE_OFF', 'MARK_DAMAGED'];

// I2 (B10, resolved 2026-10-10)/I4 (B23, §5.4a R6): every stock *decrease*
// needs inventory.approve — WRITE_OFF always, CORRECTION whenever the
// document's net quantity (the sum of its line quantities) is negative.
// BATCH_CUTOVER always needs approval too (B23), even though it nets to
// zero stock-wise — converting an item to batch tracking is a one-way,
// approval-worthy change in its own right, never self-approved. OPENING/
// RECEIPT never need approval (INBOUND_ONLY_ADJUSTMENT_KINDS, inbound-only
// already). Pure value logic, no DI — shared by the DTO (used together with
// stockAdjustmentRequiresReasonCode() below — the two are deliberately
// separate functions, §5.4a R6) and StockAdjustmentsService (submit/post/
// approve gating); the backend stays authoritative either way since both
// call this same function.
export function stockAdjustmentNeedsApproval(kind: StockAdjustmentKind, quantities: (number | string | Prisma.Decimal)[]): boolean {
  // I8 (B9): MARK_DAMAGED needs approval too — same tier as WRITE_OFF, never
  // self-approved. Since stockAdjustmentRequiresReasonCode() delegates here
  // except for BATCH_CUTOVER, MARK_DAMAGED also requires a reasonCode
  // (the existing DAMAGED value of StockAdjustmentReason, B11 — no catalog
  // change needed).
  if (kind === 'WRITE_OFF' || kind === 'BATCH_CUTOVER' || kind === 'MARK_DAMAGED') return true;
  if (kind !== 'CORRECTION') return false;
  const net = quantities.reduce((sum: Prisma.Decimal, value) => sum.plus(new Prisma.Decimal(value)), new Prisma.Decimal(0));
  return net.isNegative();
}

// I4 (§5.4a R6): a SEPARATE rule from stockAdjustmentNeedsApproval() above —
// BATCH_CUTOVER needs approval but must NOT require a reasonCode (B23). Only
// WRITE_OFF and a negative-net CORRECTION (B11) ask for one; this function
// must stay independent of the approval rule, not folded back into it.
export function stockAdjustmentRequiresReasonCode(kind: StockAdjustmentKind, quantities: (number | string | Prisma.Decimal)[]): boolean {
  if (kind === 'BATCH_CUTOVER') return false;
  return stockAdjustmentNeedsApproval(kind, quantities);
}

// Statuses in which an adjustment may still be edited or deleted. A POSTED
// adjustment is immutable — corrections are a new CORRECTION adjustment.
export const EDITABLE_STOCK_DOCUMENT_STATUSES: StockDocumentStatus[] = ['DRAFT'];

// Document-number prefix for stock adjustments (common/document-sequence.ts):
// ADJ-<jalali year>-000001, assigned at posting.
export const STOCK_ADJUSTMENT_DOC_TYPE = 'ADJ';

// I5 (build plan §5.10): GRN-<jalali year>-000001 (goods receipt) and
// PRD-<jalali year>-000001 (production output), both assigned at posting.
export const GOODS_RECEIPT_DOC_TYPE = 'GRN';
export const PRODUCTION_OUTPUT_DOC_TYPE = 'PRD';

// I8 (build plan §5.8/§5.10): GRT-<jalali year>-000001, assigned at posting.
export const GOODS_RETURN_DOC_TYPE = 'GRT';

// I6 (build plan §5.6/§5.10): CNT-<jalali year>-000001, assigned at approve()
// (that is the only transition that posts movements for a stock count).
export const STOCK_COUNT_DOC_TYPE = 'CNT';

// I6: statuses in which a StockCount's header/lines may still be edited or
// deleted (create()/update()/remove()) — only DRAFT, same shape as
// EDITABLE_STOCK_DOCUMENT_STATUSES above but StockCountStatus is its own enum.
export const EDITABLE_STOCK_COUNT_STATUSES: StockCountStatus[] = ['DRAFT'];

// I6: statuses from which cancel() may move a StockCount to CANCELLED —
// anything before POSTED (build plan §6's StockCount table).
export const CANCELLABLE_STOCK_COUNT_STATUSES: StockCountStatus[] = ['DRAFT', 'COUNTING', 'REVIEW'];

// I5 (B3 reframed / B1): which Item.itemKind each inbound document accepts.
// Goods receipts are raw-material/packaging supplier receipts only (feeding
// production) — finished goods are never bought for resale (B1). Production
// output is finished goods only. Enforced server-side by each service (the
// same defense-in-depth pattern as I1's Sales-picker filtering — a picker
// filter alone is not enough).
export const GOODS_RECEIPT_ITEM_KINDS: readonly ItemKind[] = ['RAW_MATERIAL', 'PACKAGING'];
export const PRODUCTION_OUTPUT_ITEM_KINDS: readonly ItemKind[] = ['FINISHED_GOOD'];

export const ITEM_KIND_LABELS_FA: Record<ItemKind, string> = {
  FINISHED_GOOD: 'محصول نهایی',
  RAW_MATERIAL: 'مواد اولیه',
  PACKAGING: 'بسته‌بندی',
};

// --- Persian labels (same pattern as PURCHASE_STATUS_LABELS_FA) -----------

export const STOCK_BUCKET_LABELS_FA: Record<StockBucket, string> = {
  ON_HAND: 'موجودی انبار',
  RESERVED: 'رزروشده',
  QC: 'در انتظار کنترل کیفیت',
  // I8 (build plan §5.8, B9): held, not sellable — same term as
  // StockAdjustmentReason.DAMAGED for consistency.
  DAMAGED: 'آسیب‌دیده',
};

export const STOCK_MOVEMENT_TYPE_LABELS_FA: Record<StockMovementType, string> = {
  OPENING_BALANCE: 'موجودی اول دوره',
  MANUAL_RECEIPT: 'رسید موجودی',
  ADJUSTMENT_IN: 'اصلاح موجودی (افزایش)',
  ADJUSTMENT_OUT: 'اصلاح موجودی (کاهش)',
  RESERVE: 'رزرو',
  RELEASE: 'آزادسازی رزرو',
  DELIVERY_ISSUE: 'خروج بابت تحویل',
  RETURN_RECEIPT: 'دریافت مرجوعی',
  RETURN_RESTOCK: 'بازگشت مرجوعی به انبار',
  RETURN_WRITE_OFF: 'ضایعات مرجوعی',
  WRITE_OFF: 'ضایعات (کاهش موجودی)',
  GOODS_RECEIPT: 'رسید انبار (خرید مواد)',
  QC_RELEASE: 'آزادسازی از کنترل کیفیت',
  PRODUCTION_OUTPUT: 'رسید تولید',
  COUNT_GAIN: 'مغایرت شمارش (افزایش)',
  COUNT_LOSS: 'مغایرت شمارش (کاهش)',
  MARK_DAMAGED: 'اعلام آسیب‌دیدگی',
  RETURN_TO_DAMAGED: 'انتقال مرجوعی به آسیب‌دیده',
  SUPPLIER_RETURN: 'برگشت کالا به تأمین‌کننده',
};

export const STOCK_REFERENCE_TYPE_LABELS_FA: Record<StockReferenceType, string> = {
  STOCK_ADJUSTMENT: 'سند اصلاح موجودی',
  SALES_ORDER: 'سفارش فروش',
  DELIVERY: 'حواله تحویل',
  SALES_RETURN: 'مرجوعی فروش',
  GOODS_RECEIPT: 'رسید انبار',
  PRODUCTION_OUTPUT: 'رسید تولید',
  STOCK_COUNT: 'سند شمارش موجودی',
  GOODS_RETURN: 'برگشت کالا به تأمین‌کننده',
};

export const STOCK_ADJUSTMENT_KIND_LABELS_FA: Record<StockAdjustmentKind, string> = {
  OPENING: 'موجودی اول دوره',
  RECEIPT: 'رسید موجودی',
  CORRECTION: 'اصلاح موجودی',
  WRITE_OFF: 'ضایعات',
  BATCH_CUTOVER: 'تبدیل به ردیابی بچ',
  MARK_DAMAGED: 'اعلام آسیب‌دیدگی',
};

export const STOCK_DOCUMENT_STATUS_LABELS_FA: Record<StockDocumentStatus, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تأیید',
  POSTED: 'ثبت‌شده',
};

// I3 (build plan §5.3, B14): an item+location is "low" when *available*
// (onHand − reserved) is below its own user-set ItemStockLevel.minQty —
// never onHand alone, and never a system-invented default. Shared by
// InventoryService.listBalances() (the /inventory low-stock filter) and
// InventoryReportsService.lowStockSummary() (the dedicated report + the
// Dashboard KPI) so "what counts as low" is defined in exactly one place.
export function isBelowMinimum(available: Prisma.Decimal | string | number, minQty: Prisma.Decimal | string | number): boolean {
  return new Prisma.Decimal(available).lessThan(new Prisma.Decimal(minQty));
}

// I2 (B11) — StockAdjustment.reasonCode.
export const STOCK_ADJUSTMENT_REASON_LABELS_FA: Record<StockAdjustmentReason, string> = {
  DAMAGED: 'آسیب‌دیده',
  EXPIRED: 'تاریخ‌گذشته',
  LOST: 'مفقودشده',
  FOUND: 'یافت‌شده (اضافه کشف‌شده)',
  COUNT_ERROR: 'خطای شمارش',
  DATA_ENTRY_ERROR: 'خطای ثبت اطلاعات',
  SAMPLE_OR_INTERNAL_USE: 'نمونه یا مصرف داخلی',
  OTHER: 'سایر',
};

// I6 (build plan §5.6/§6).
export const STOCK_COUNT_STATUS_LABELS_FA: Record<StockCountStatus, string> = {
  DRAFT: 'پیش‌نویس',
  COUNTING: 'در حال شمارش',
  REVIEW: 'در انتظار بررسی',
  POSTED: 'ثبت‌شده',
  CANCELLED: 'لغوشده',
};

export const STOCK_COUNT_SCOPE_LABELS_FA: Record<StockCountScope, string> = {
  FULL: 'شمارش کامل',
  PARTIAL: 'شمارش بخشی',
};
