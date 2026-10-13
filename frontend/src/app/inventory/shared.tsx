// Shared types, Persian labels, and small display helpers for the Inventory
// module (stock list + stock adjustments). Mirrors the backend's
// src/inventory/inventory-rules.ts labels — keep the wording in sync there.
// Not a route: this file has no page.tsx/layout.tsx name.

import type { BadgeTone } from "@/components/ui/status-badge";

// I4: BATCH_CUTOVER converts one unbatched item (with stock) into named
// batches — always needs approval, never a reasonCode (B23/R6).
export type StockAdjustmentKind = "OPENING" | "RECEIPT" | "CORRECTION" | "WRITE_OFF" | "BATCH_CUTOVER";
export type StockDocumentStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTED";
// I2 (B11) — StockAdjustment.reasonCode. Use as-is.
export type StockAdjustmentReason =
  | "DAMAGED"
  | "EXPIRED"
  | "LOST"
  | "FOUND"
  | "COUNT_ERROR"
  | "DATA_ENTRY_ERROR"
  | "SAMPLE_OR_INTERNAL_USE"
  | "OTHER";

export const STOCK_ADJUSTMENT_KINDS: StockAdjustmentKind[] = ["OPENING", "RECEIPT", "CORRECTION", "WRITE_OFF", "BATCH_CUTOVER"];
export const STOCK_DOCUMENT_STATUSES: StockDocumentStatus[] = ["DRAFT", "PENDING_APPROVAL", "POSTED"];
export const STOCK_ADJUSTMENT_REASONS: StockAdjustmentReason[] = [
  "DAMAGED",
  "EXPIRED",
  "LOST",
  "FOUND",
  "COUNT_ERROR",
  "DATA_ENTRY_ERROR",
  "SAMPLE_OR_INTERNAL_USE",
  "OTHER",
];

export const stockAdjustmentKindLabels: Record<StockAdjustmentKind, string> = {
  OPENING: "موجودی اول دوره",
  RECEIPT: "رسید موجودی",
  CORRECTION: "اصلاح موجودی",
  WRITE_OFF: "ضایعات",
  BATCH_CUTOVER: "تبدیل به ردیابی بچ",
};

// One-line explanation shown under the kind select on the form.
export const stockAdjustmentKindHints: Record<StockAdjustmentKind, string> = {
  OPENING: "ثبت موجودی ابتدای کار با سیستم یا ابتدای دوره — مقادیر مثبت.",
  RECEIPT: "ورود کالا به انبار — مقادیر مثبت.",
  CORRECTION: "اصلاح موجودی (مثلاً پس از شمارش یا ضایعات) — مقدار مثبت یعنی افزایش و مقدار منفی یعنی کاهش.",
  WRITE_OFF: "کسر موجودی بابت ضایعات — مقادیر منفی. این نوع سند همواره نیاز به تأیید دارد.",
  BATCH_CUTOVER:
    "تقسیم کل موجودی فعلیِ بدون بچِ یک کالا بین بچ‌های نام‌دار (شماره بچ + تاریخ انقضا) و فعال‌سازی ردیابی بچ برای آن کالا — یک‌طرفه. فقط یک کالا در هر سند؛ جمع ردیف‌ها باید دقیقاً با موجودی فعلی کالا در انبار برابر باشد. همواره نیاز به تأیید دارد.",
};

export const stockAdjustmentReasonLabels: Record<StockAdjustmentReason, string> = {
  DAMAGED: "آسیب‌دیده",
  EXPIRED: "تاریخ‌گذشته",
  LOST: "مفقودشده",
  FOUND: "یافت‌شده (اضافه کشف‌شده)",
  COUNT_ERROR: "خطای شمارش",
  DATA_ENTRY_ERROR: "خطای ثبت اطلاعات",
  SAMPLE_OR_INTERNAL_USE: "نمونه یا مصرف داخلی",
  OTHER: "سایر",
};

// Kinds whose lines must be positive — mirrors INBOUND_ONLY_ADJUSTMENT_KINDS
// on the backend (which stays authoritative).
export const INBOUND_ONLY_KINDS: StockAdjustmentKind[] = ["OPENING", "RECEIPT", "BATCH_CUTOVER"];
// Kinds whose lines must be negative — mirrors OUTBOUND_ONLY_ADJUSTMENT_KINDS.
export const OUTBOUND_ONLY_KINDS: StockAdjustmentKind[] = ["WRITE_OFF"];

export const stockDocumentStatusLabels: Record<StockDocumentStatus, string> = {
  DRAFT: "پیش‌نویس",
  PENDING_APPROVAL: "در انتظار تأیید",
  POSTED: "ثبت‌شده",
};

export const stockDocumentStatusTone: Record<StockDocumentStatus, BadgeTone> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  POSTED: "success",
};

export const stockAdjustmentKindTone: Record<StockAdjustmentKind, BadgeTone> = {
  OPENING: "muted",
  RECEIPT: "primary",
  CORRECTION: "warning",
  WRITE_OFF: "destructive",
  BATCH_CUTOVER: "accent",
};

// B10/B11 — mirrors backend's stockAdjustmentNeedsApproval(): WRITE_OFF
// always needs inventory.approve; CORRECTION needs it only when the
// document's net quantity (sum of its lines) is negative. The backend stays
// authoritative — this only drives client-side UX (which button to show,
// whether reasonCode is marked required on the form).
export function stockAdjustmentNeedsApproval(kind: StockAdjustmentKind, quantities: number[]): boolean {
  if (kind === "WRITE_OFF" || kind === "BATCH_CUTOVER") return true;
  if (kind !== "CORRECTION") return false;
  return quantities.reduce((sum, value) => sum + value, 0) < 0;
}

// I4 (R6) — mirrors backend's stockAdjustmentRequiresReasonCode(): a
// deliberately SEPARATE rule from the approval one above. BATCH_CUTOVER needs
// approval but never a reasonCode (B23).
export function stockAdjustmentRequiresReasonCode(kind: StockAdjustmentKind, quantities: number[]): boolean {
  if (kind === "BATCH_CUTOVER") return false;
  return stockAdjustmentNeedsApproval(kind, quantities);
}

// --- API record shapes (backend inventory.controller.ts) -----------------

type ItemRef = { id: number; code: string; name: string; status?: "active" | "inactive"; unit: { id: number; nameFa: string } };
type LocationRef = { id: number; code: string; name: string };
type UserRef = { id: number; username: string } | null;

export type InventoryLocation = LocationRef & { isActive: boolean; isDefault: boolean; note: string | null };

// GET /inventory/item-options
export type ItemOption = ItemRef;

// --- Stock card (کاردکس) + movement browser (I1) --------------------------

export type StockBucket = "ON_HAND" | "RESERVED" | "QC";
export type StockMovementType =
  | "OPENING_BALANCE"
  | "MANUAL_RECEIPT"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "RESERVE"
  | "RELEASE"
  | "DELIVERY_ISSUE"
  | "RETURN_RECEIPT"
  | "RETURN_RESTOCK"
  | "RETURN_WRITE_OFF"
  | "WRITE_OFF"
  // I5 — goods receipts (into ON_HAND, or QC when inspectionRequired), QC
  // release (QC → ON_HAND), production output (ON_HAND).
  | "GOODS_RECEIPT"
  | "QC_RELEASE"
  | "PRODUCTION_OUTPUT"
  // I6 — a posted stock-count variance line: exactly one of the two per line.
  | "COUNT_GAIN"
  | "COUNT_LOSS";
export type StockReferenceType = "STOCK_ADJUSTMENT" | "SALES_ORDER" | "DELIVERY" | "SALES_RETURN" | "GOODS_RECEIPT" | "PRODUCTION_OUTPUT" | "STOCK_COUNT";

export const STOCK_BUCKETS: StockBucket[] = ["ON_HAND", "RESERVED", "QC"];
export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  "OPENING_BALANCE",
  "MANUAL_RECEIPT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "RESERVE",
  "RELEASE",
  "DELIVERY_ISSUE",
  "RETURN_RECEIPT",
  "RETURN_RESTOCK",
  "RETURN_WRITE_OFF",
  "WRITE_OFF",
  "GOODS_RECEIPT",
  "QC_RELEASE",
  "PRODUCTION_OUTPUT",
  "COUNT_GAIN",
  "COUNT_LOSS",
];
export const STOCK_REFERENCE_TYPES: StockReferenceType[] = ["STOCK_ADJUSTMENT", "SALES_ORDER", "DELIVERY", "SALES_RETURN", "GOODS_RECEIPT", "PRODUCTION_OUTPUT", "STOCK_COUNT"];

export const stockBucketLabels: Record<StockBucket, string> = {
  ON_HAND: "موجودی انبار",
  RESERVED: "رزروشده",
  QC: "کنترل کیفیت",
};

export const stockMovementTypeLabels: Record<StockMovementType, string> = {
  OPENING_BALANCE: "موجودی اول دوره",
  MANUAL_RECEIPT: "رسید موجودی",
  ADJUSTMENT_IN: "اصلاح موجودی (افزایش)",
  ADJUSTMENT_OUT: "اصلاح موجودی (کاهش)",
  RESERVE: "رزرو",
  RELEASE: "آزادسازی رزرو",
  DELIVERY_ISSUE: "خروج بابت تحویل",
  RETURN_RECEIPT: "دریافت مرجوعی",
  RETURN_RESTOCK: "بازگشت مرجوعی به انبار",
  RETURN_WRITE_OFF: "ضایعات مرجوعی",
  WRITE_OFF: "ضایعات (کاهش موجودی)",
  GOODS_RECEIPT: "رسید انبار (خرید مواد)",
  QC_RELEASE: "آزادسازی از کنترل کیفیت",
  PRODUCTION_OUTPUT: "رسید تولید",
  COUNT_GAIN: "مغایرت شمارش (افزایش)",
  COUNT_LOSS: "مغایرت شمارش (کاهش)",
};

export const stockReferenceTypeLabels: Record<StockReferenceType, string> = {
  STOCK_ADJUSTMENT: "سند اصلاح موجودی",
  SALES_ORDER: "سفارش فروش",
  DELIVERY: "حواله تحویل",
  SALES_RETURN: "مرجوعی فروش",
  GOODS_RECEIPT: "رسید انبار",
  PRODUCTION_OUTPUT: "رسید تولید",
  STOCK_COUNT: "سند شمارش موجودی",
};

// GET /inventory/movements
export type StockMovementRow = {
  id: number;
  itemId: number;
  locationId: number;
  bucket: StockBucket;
  movementType: StockMovementType;
  quantity: string;
  movementDate: string;
  referenceType: StockReferenceType;
  referenceId: number;
  referenceLineId: number | null;
  referenceNumber: string | null;
  note: string | null;
  // I4: set on ON_HAND/QC rows of a batch-tracked item; never on RESERVED.
  batchId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  item: ItemRef;
  location: LocationRef;
  createdByUser: UserRef;
};

// GET /inventory/items/:itemId/stock-card
export type StockCard = {
  item: ItemRef & { itemKind?: "FINISHED_GOOD" | "RAW_MATERIAL" | "PACKAGING" };
  rows: (StockMovementRow & { balanceAfter: { onHand: string; reserved: string; qc: string } })[];
};

// GET /inventory/integrity
export type IntegrityResult = {
  ok: boolean;
  mismatches: { itemId: number; locationId: number; bucket: StockBucket; balance: string; ledger: string }[];
  // I4: batch-aware mismatch kinds (additive; see backend inventory.service.ts).
  batchMismatches?: (
    | { kind: "BATCH_LEDGER"; batchId: number; itemId: number; locationId: number; bucket: "ON_HAND" | "QC"; balance: string; ledger: string }
    | { kind: "BATCH_SUM"; itemId: number; locationId: number; bucket: "ON_HAND" | "QC"; balance: string; ledger: string }
    | { kind: "UNEXPECTED_BATCH"; itemId: number; locationId: number; batchId: number; bucket: StockBucket }
  )[];
};

// --- Batch / expiry (I4) ---------------------------------------------------

// GET /inventory/items/:itemId/batches — one row per batch+location balance
// row of the item (depleted batches included, with zero quantities), sorted
// by expiry ascending (no-expiry last). isExpired = expiry date earlier than
// today (Tehran calendar day) — a batch is still deliverable ON its expiry day.
export type ItemBatchRow = {
  batchId: number;
  batchNumber: string;
  productionDate: string | null;
  expiryDate: string | null;
  isExpired: boolean;
  locationId: number;
  onHand: string;
  qc: string;
};
export type ItemBatches = { item: { id: number; code: string; name: string }; batches: ItemBatchRow[] };

// GET /inventory/reports/expiry — every dated batch with stock.
export type ExpiryReportRow = {
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  productionDate: string | null;
  itemId: number;
  item: ItemRef | null;
  locationId: number;
  onHand: string;
  qc: string;
  isExpired: boolean;
  // Negative once expired.
  daysUntilExpiry: number;
};

/** Whether a batch row still carries any physical stock. */
export function batchHasStock(row: { onHand: string; qc: string }): boolean {
  return Number(row.onHand) > 0 || Number(row.qc) > 0;
}

/** "LOT-A" or a fallback "بچ #12" when the number isn't known on this screen. */
export function batchLabel(batchId: number, numberById?: Map<number, string>): string {
  return numberById?.get(batchId) ?? `بچ #${batchId.toLocaleString("fa-IR")}`;
}

// --- Stock levels (I3, B14) ------------------------------------------------

// GET/POST /inventory/stock-levels — a threshold the user set themselves;
// the system never invents or defaults one. reorderQty/maxQty are
// display-only (no automatic purchase request is ever created from this).
export type ItemStockLevelRow = {
  id: number;
  itemId: number;
  locationId: number;
  minQty: string;
  reorderQty: string | null;
  maxQty: string | null;
  note: string | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  item: ItemRef;
  location: LocationRef;
  updatedByUser: UserRef;
};

// GET /inventory/reports/low-stock and /dashboard/low-stock-summary — low =
// available (onHand − reserved) below the item's own configured minQty
// (B14), never onHand alone.
export type LowStockRow = {
  id: number;
  itemId: number;
  locationId: number;
  minQty: string;
  reorderQty: string | null;
  maxQty: string | null;
  available: string;
  shortfall: string;
  item: ItemRef;
  location: LocationRef;
};

// No DB foreign key on StockMovement.referenceId (CLAUDE.md rule 9) — the
// link target is a plain, hand-maintained map, kept in sync with the pages
// each reference type's document actually lives at.
const REFERENCE_PATH: Record<StockReferenceType, string> = {
  STOCK_ADJUSTMENT: "/inventory/adjustments",
  SALES_ORDER: "/sales-orders",
  DELIVERY: "/deliveries",
  SALES_RETURN: "/sales-returns",
  GOODS_RECEIPT: "/inventory/receipts",
  PRODUCTION_OUTPUT: "/inventory/production",
  STOCK_COUNT: "/inventory/counts",
};

/** Where a movement's source document can be opened, or null if unknown. */
export function referenceHref(referenceType: StockReferenceType, referenceId: number): string {
  return `${REFERENCE_PATH[referenceType]}/${referenceId}`;
}

/** A readable label for a movement's source document — its number if known, else "نوع #id". */
export function referenceLabel(row: { referenceType: StockReferenceType; referenceNumber: string | null; referenceId: number }): string {
  return row.referenceNumber ?? `${stockReferenceTypeLabels[row.referenceType]} #${row.referenceId.toLocaleString("fa-IR")}`;
}

// GET /inventory/balances — quantities are Prisma Decimal → JSON strings.
// overCommitted = available (onHand − reserved) < 0 — a posted CORRECTION
// can leave this true with nothing else surfacing it (build plan §2.3
// finding 2). Visibility only; nothing is blocked because of it.
export type StockBalanceRow = {
  id: number;
  itemId: number;
  locationId: number;
  onHand: string;
  reserved: string;
  qc: string;
  overCommitted: boolean;
  updatedAt: string;
  item: ItemRef;
  location: LocationRef;
};

// GET /inventory/stock-adjustments
export type StockAdjustmentListItem = {
  id: number;
  // null until posted — numbers are assigned only at posting.
  adjustmentNumber: string | null;
  kind: StockAdjustmentKind;
  status: StockDocumentStatus;
  locationId: number;
  adjustmentDate: string;
  reason: string;
  reasonCode: StockAdjustmentReason | null;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationRef;
  createdByUser: UserRef;
  _count: { items: number };
};

// GET /inventory/stock-adjustments/:id
export type StockAdjustmentDetail = Omit<StockAdjustmentListItem, "_count"> & {
  postedByUser: UserRef;
  submittedByUser: UserRef;
  submittedAt: string | null;
  rejectedByUser: UserRef;
  rejectedAt: string | null;
  rejectReason: string | null;
  items: {
    id: number;
    itemId: number;
    quantity: string;
    note: string | null;
    // I4: batchId = an existing batch picked; batchNumber (+ dates) = a new
    // lot typed on the line, resolved/created only at posting.
    batchId: number | null;
    batchNumber: string | null;
    productionDate: string | null;
    expiryDate: string | null;
    item: ItemRef;
  }[];
};

// --- Inbound documents (I5): goods receipts + production output ----------
//
// Cost fields (unitCost, costIsEstimated) are OMITTED from every response
// unless the caller holds inventory.cost — hence optional here — and the
// backend refuses (403) a request that carries them without it, so forms
// must leave the keys out entirely for those users.

export type ItemKind = "FINISHED_GOOD" | "RAW_MATERIAL" | "PACKAGING";

export const itemKindLabels: Record<ItemKind, string> = {
  FINISHED_GOOD: "محصول نهایی",
  RAW_MATERIAL: "مواد اولیه",
  PACKAGING: "بسته‌بندی",
};

/** The two inbound documents only offer posting — no approval step. */
export const INBOUND_DOCUMENT_STATUSES: StockDocumentStatus[] = ["DRAFT", "POSTED"];

// Item entry of GET /inventory/goods-receipts/form-options and
// /inventory/production-outputs/form-options — already filtered server-side
// to the document's allowed itemKind(s), with the I4 batch settings.
export type InboundItemOption = ItemRef & {
  itemKind: ItemKind;
  batchTracked: boolean;
  expiryRequired: boolean;
  shelfLifeDays: number | null;
};

// GET /inventory/goods-receipts/form-options
export type GoodsReceiptFormOptions = {
  defaultLocationId: number;
  locations: LocationRef[];
  suppliers: { id: number; code: string; name: string }[];
  items: InboundItemOption[];
};

// GET /inventory/goods-receipts/purchase-options?supplierId — the supplier's
// newest 100 purchases (no search yet).
export type PurchaseReferenceOption = { id: number; purchaseNumber: string; purchaseDate: string; status: string };
export const PURCHASE_OPTIONS_LIMIT = 100;

// GET /inventory/production-outputs/form-options
export type ProductionOutputFormOptions = {
  defaultLocationId: number;
  locations: LocationRef[];
  items: InboundItemOption[];
  employees: EmployeeRef[];
};

export type EmployeeRef = { id: number; code: string; firstName: string; lastName: string };

export function employeeLabel(employee: EmployeeRef): string {
  return `${employee.firstName} ${employee.lastName} (${employee.code})`;
}

type InboundLineBase = {
  id: number;
  lineNo: number;
  itemId: number;
  quantity: string;
  // inventory.cost only (omitted otherwise). Whole Rial, Decimal → string.
  unitCost?: string | null;
  batchNumber: string | null;
  productionDate: string | null;
  expiryDate: string | null;
  // Resolved/created at posting.
  batchId: number | null;
  note: string | null;
  item: ItemRef & { itemKind: ItemKind };
};

export type GoodsReceiptLine = InboundLineBase & {
  // QC (B19): still in QC = quantity − releasedQty − rejectedQty.
  releasedQty: string;
  rejectedQty: string;
  returnedQty: string;
};

export type ProductionOutputLine = InboundLineBase & {
  // inventory.cost only.
  costIsEstimated?: boolean;
};

// GET /inventory/goods-receipts
export type GoodsReceiptListItem = {
  id: number;
  // null until posted — "GRN-1405-000001" is assigned at posting.
  receiptNumber: string | null;
  status: StockDocumentStatus;
  locationId: number;
  receiptDate: string;
  supplierId: number;
  supplierName: string;
  supplierDocumentNumber: string | null;
  purchaseId: number | null;
  purchaseNumber: string | null;
  inspectionRequired: boolean;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationRef;
  supplier: { id: number; code: string; name: string };
  createdByUser: UserRef;
  _count: { items: number };
};

// GET /inventory/goods-receipts/:id
export type GoodsReceiptDetail = Omit<GoodsReceiptListItem, "_count" | "supplier"> & {
  supplier: { id: number; code: string; name: string; status: "active" | "inactive" };
  postedByUser: UserRef;
  items: GoodsReceiptLine[];
};

// GET /inventory/production-outputs
export type ProductionOutputListItem = {
  id: number;
  // null until posted — "PRD-1405-000001" is assigned at posting.
  outputNumber: string | null;
  status: StockDocumentStatus;
  locationId: number;
  productionDate: string;
  producedByEmployeeId: number | null;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationRef;
  producedByEmployee: EmployeeRef | null;
  createdByUser: UserRef;
  _count: { items: number };
};

// GET /inventory/production-outputs/:id
export type ProductionOutputDetail = Omit<ProductionOutputListItem, "_count"> & {
  postedByUser: UserRef;
  items: ProductionOutputLine[];
};

/** "GRN-1405-000001", or a draft placeholder. */
export function goodsReceiptTitle(receipt: { id: number; receiptNumber: string | null }): string {
  return receipt.receiptNumber ?? `پیش‌نویس #${receipt.id.toLocaleString("fa-IR")}`;
}

/** "PRD-1405-000001", or a draft placeholder. */
export function productionOutputTitle(output: { id: number; outputNumber: string | null }): string {
  return output.outputNumber ?? `پیش‌نویس #${output.id.toLocaleString("fa-IR")}`;
}

/** A goods-receipt line's quantity still waiting in QC (B19). */
export function qcRemaining(line: { quantity: string; releasedQty: string; rejectedQty: string }): number {
  return Math.round((Number(line.quantity) - Number(line.releasedQty) - Number(line.rejectedQty)) * 100) / 100;
}

// --- Display helpers -----------------------------------------------------

/** Quantities (Decimal(12,2)) — up to two decimals, Persian digits. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/** A signed quantity with an explicit sign for increases (CORRECTION lines). */
export function formatSignedQuantity(value: string | number): string {
  const number = Number(value);
  return number > 0 ? `+${formatQuantity(number)}` : formatQuantity(number);
}

/** "ADJ-1405-000001", or a draft placeholder (drafts have no number yet). */
export function adjustmentTitle(adjustment: { id: number; adjustmentNumber: string | null }): string {
  return adjustment.adjustmentNumber ?? `پیش‌نویس #${adjustment.id.toLocaleString("fa-IR")}`;
}

/** Available-to-sell, for display only: onHand − reserved. */
export function availableQuantity(row: { onHand: string; reserved: string }): number {
  return Math.round((Number(row.onHand) - Number(row.reserved)) * 100) / 100;
}

// --- Stock counts (شمارش موجودی, I6) --------------------------------------
//
// B13 (architect's default, not yet confirmed by the business owner): blind
// entry while COUNTING, approval by someone other than the submitter, and
// "stale-line" (409 COUNT_STALE) detection instead of freezing warehouse
// operations during a count.
//
// systemQty/varianceQty on each line are OMITTED (the key is absent, not
// null/zero) from GET /inventory/stock-counts/:id whenever the document
// isBlind && status === "COUNTING" and the caller lacks inventory.approve —
// hence optional here. Use hasSystemQty() below instead of checking for a
// falsy value.

export type StockCountScope = "FULL" | "PARTIAL";
export type StockCountStatus = "DRAFT" | "COUNTING" | "REVIEW" | "POSTED" | "CANCELLED";

export const STOCK_COUNT_SCOPES: StockCountScope[] = ["FULL", "PARTIAL"];
export const STOCK_COUNT_STATUSES: StockCountStatus[] = ["DRAFT", "COUNTING", "REVIEW", "POSTED", "CANCELLED"];

export const stockCountScopeLabels: Record<StockCountScope, string> = {
  FULL: "شمارش کامل",
  PARTIAL: "شمارش بخشی",
};

export const stockCountStatusLabels: Record<StockCountStatus, string> = {
  DRAFT: "پیش‌نویس",
  COUNTING: "در حال شمارش",
  REVIEW: "در انتظار بررسی",
  POSTED: "ثبت‌شده",
  CANCELLED: "لغوشده",
};

export const stockCountStatusTone: Record<StockCountStatus, BadgeTone> = {
  DRAFT: "secondary",
  COUNTING: "warning",
  REVIEW: "accent",
  POSTED: "success",
  CANCELLED: "destructive",
};

export const stockCountScopeTone: Record<StockCountScope, BadgeTone> = {
  FULL: "primary",
  PARTIAL: "muted",
};

// GET /inventory/stock-counts/form-options (inventory.count) — not
// restricted by itemKind: a physical count covers whatever is on the shelf.
export type StockCountFormOptions = {
  defaultLocationId: number;
  locations: LocationRef[];
  items: (ItemRef & { itemKind: ItemKind })[];
};

// GET /inventory/stock-counts (list — no item lines, just a count).
export type StockCountListItem = {
  id: number;
  // null until POSTED — "CNT-1405-000001" is assigned at approve().
  countNumber: string | null;
  locationId: number;
  countDate: string;
  scope: StockCountScope;
  isBlind: boolean;
  status: StockCountStatus;
  startedAt: string | null;
  submittedAt: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationRef;
  createdByUser: UserRef;
  _count: { items: number };
};

export type StockCountItemLine = {
  id: number;
  itemId: number;
  batchId: number | null;
  // Absent entirely (not null) when masked — see the file header note.
  systemQty?: string | null;
  countedQty: string | null;
  varianceQty?: string | null;
  reasonCode: StockAdjustmentReason | null;
  recountCount: number;
  countedByUserId: number | null;
  note: string | null;
  item: ItemRef & { itemKind: ItemKind };
  batch: { id: number; batchNumber: string; expiryDate: string | null } | null;
  countedByUser: UserRef;
};

// GET /inventory/stock-counts/:id
export type StockCountDetail = Omit<StockCountListItem, "_count"> & {
  startedByUser: UserRef;
  submittedByUser: UserRef;
  postedByUser: UserRef;
  cancelledByUser: UserRef;
  items: StockCountItemLine[];
};

/** "CNT-1405-000001", or a draft placeholder (no number until POSTED). */
export function stockCountTitle(count: { id: number; countNumber: string | null }): string {
  return count.countNumber ?? `پیش‌نویس #${count.id.toLocaleString("fa-IR")}`;
}

/** Whether this response actually carries systemQty/varianceQty for a line (see the file header note — the key may be entirely absent). */
export function hasSystemQty(line: StockCountItemLine): boolean {
  return line.systemQty !== undefined;
}

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
