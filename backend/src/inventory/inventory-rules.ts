import type {
  StockAdjustmentKind,
  StockBucket,
  StockDocumentStatus,
  StockMovementType,
  StockReferenceType,
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
// Only OPENING_BALANCE / MANUAL_RECEIPT / ADJUSTMENT_IN / ADJUSTMENT_OUT are
// produced today (by stock adjustments). The rest are reserved for the later
// Sales batches (orders reserve/release, deliveries issue, returns receive
// into QC and then restock or write off) — their direction here follows
// from their meaning, and those batches are where they get callers.
export type MovementDirection = 'IN' | 'OUT';

export const MOVEMENT_TYPE_BUCKETS: Record<StockMovementType, Partial<Record<StockBucket, MovementDirection>>> = {
  OPENING_BALANCE: { ON_HAND: 'IN' },
  MANUAL_RECEIPT: { ON_HAND: 'IN' },
  ADJUSTMENT_IN: { ON_HAND: 'IN' },
  ADJUSTMENT_OUT: { ON_HAND: 'OUT' },
  RESERVE: { RESERVED: 'IN' },
  RELEASE: { RESERVED: 'OUT' },
  DELIVERY_ISSUE: { ON_HAND: 'OUT' },
  RETURN_RECEIPT: { QC: 'IN' },
  RETURN_RESTOCK: { QC: 'OUT', ON_HAND: 'IN' },
  RETURN_WRITE_OFF: { QC: 'OUT' },
};

// How each stock-adjustment kind is posted to the ledger. CORRECTION lines
// are signed: a positive line is ADJUSTMENT_IN, a negative one ADJUSTMENT_OUT.
// OPENING / RECEIPT lines are always positive (enforced by the DTO).
export function movementTypeForAdjustmentLine(kind: StockAdjustmentKind, quantitySign: 1 | -1): StockMovementType {
  if (kind === 'OPENING') return 'OPENING_BALANCE';
  if (kind === 'RECEIPT') return 'MANUAL_RECEIPT';
  return quantitySign > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
}

// Kinds whose lines must be positive (stock can only come in).
export const INBOUND_ONLY_ADJUSTMENT_KINDS: StockAdjustmentKind[] = ['OPENING', 'RECEIPT'];

// Statuses in which an adjustment may still be edited or deleted. A POSTED
// adjustment is immutable — corrections are a new CORRECTION adjustment.
export const EDITABLE_STOCK_DOCUMENT_STATUSES: StockDocumentStatus[] = ['DRAFT'];

// Document-number prefix for stock adjustments (common/document-sequence.ts):
// ADJ-<jalali year>-000001, assigned at posting.
export const STOCK_ADJUSTMENT_DOC_TYPE = 'ADJ';

// --- Persian labels (same pattern as PURCHASE_STATUS_LABELS_FA) -----------

export const STOCK_BUCKET_LABELS_FA: Record<StockBucket, string> = {
  ON_HAND: 'موجودی انبار',
  RESERVED: 'رزروشده',
  QC: 'در انتظار کنترل کیفیت',
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
};

export const STOCK_REFERENCE_TYPE_LABELS_FA: Record<StockReferenceType, string> = {
  STOCK_ADJUSTMENT: 'سند اصلاح موجودی',
  SALES_ORDER: 'سفارش فروش',
  DELIVERY: 'حواله تحویل',
  SALES_RETURN: 'مرجوعی فروش',
};

export const STOCK_ADJUSTMENT_KIND_LABELS_FA: Record<StockAdjustmentKind, string> = {
  OPENING: 'موجودی اول دوره',
  RECEIPT: 'رسید موجودی',
  CORRECTION: 'اصلاح موجودی',
};

export const STOCK_DOCUMENT_STATUS_LABELS_FA: Record<StockDocumentStatus, string> = {
  DRAFT: 'پیش‌نویس',
  POSTED: 'ثبت‌شده',
};
