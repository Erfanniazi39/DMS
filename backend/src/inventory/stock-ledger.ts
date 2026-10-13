import { ConflictException } from '@nestjs/common';
import { Prisma, type StockBucket, type StockMovementType, type StockReferenceType } from '@prisma/client';
import { allocateFefo, isExpiredBatch, type FefoAllocation } from './batch-allocation';
import { sumExpiredOnHand } from './inventory-queries';
import { MOVEMENT_TYPE_BUCKETS, STOCK_BUCKET_LABELS_FA, STOCK_MOVEMENT_TYPE_LABELS_FA } from './inventory-rules';

// THE ONLY CODE PATH IN THE CODEBASE ALLOWED TO WRITE StockMovement OR
// StockBalance (CLAUDE.md rule 10: a balance never changes without the
// movement that explains it). No other file may call
// tx.stockMovement.create*/update*/delete* or tx.stockBalance.create*/
// update*/delete*. StockMovement is append-only — there is deliberately no
// update/delete function here; a mistake is corrected by a new movement
// (e.g. a CORRECTION stock adjustment).
//
// DI-free: takes the caller's transaction client, so the movements and the
// source document's own write (e.g. StockAdjustment → POSTED) commit or roll
// back together. Calling it outside a transaction is a bug.
//
// Concurrency: every affected StockBalance row is locked FOR UPDATE before it
// is read — same convention as PurchasePaymentsService.lockPurchaseForPayment()
// — in a fixed order (itemId, then locationId), so two transactions touching
// overlapping items always lock them in the same order and can't deadlock.
// A missing balance row is first created (ON CONFLICT DO NOTHING via
// createMany skipDuplicates), so the lock always has a row to take.
//
// Atomicity: the whole batch is validated (shape + resulting balances) after
// all locks are taken and BEFORE anything is written. If any row is invalid
// or would make any bucket negative, nothing is written for any row; and
// because everything runs in the caller's transaction, an error thrown later
// (e.g. by the caller) rolls back every row of the batch too.
//
// Negative stock is blocked, always — there is no override parameter
// (business decision 2026-10-06). The same holds for RESERVED, QC and
// DAMAGED (I8) (a bucket can't hold less than nothing); the migration adds
// CHECK constraints on stock_balances as a database-level backstop.

export type MovementInput = {
  itemId: number;
  locationId: number;
  bucket: StockBucket;
  movementType: StockMovementType;
  // Signed: + adds to the bucket, − takes from it. Must match the direction
  // MOVEMENT_TYPE_BUCKETS gives this movementType/bucket pair.
  quantity: Prisma.Decimal | number | string;
  movementDate: Date;
  referenceType: StockReferenceType;
  referenceId: number;
  referenceLineId?: number | null;
  referenceNumber?: string | null;
  note?: string | null;
  createdByUserId?: number | null;
  // I4 (build plan §5.4; I8 extends to DAMAGED): required on ON_HAND/QC/
  // DAMAGED rows of a batch-tracked item, forbidden otherwise (untracked
  // items, and every RESERVED row — batches never apply to RESERVED).
  // Resolved by the caller (stock-batches.ts
  // resolveBatches(), or a direct pick of an existing batch) BEFORE calling
  // applyMovements() — the ledger only validates and aggregates, it never
  // creates a batch itself.
  batchId?: number | null;
  // I5 (build plan §5.5/§8, B15): per-unit cost (whole Rial) stamped on an
  // inbound row from a costed document line (goods receipt / production
  // output). Optional; null = unknown. Stored only — no valuation math here
  // until I9 (weighted average, E5).
  unitCost?: Prisma.Decimal | number | string | null;
};

const BUCKET_COLUMN: Record<StockBucket, 'onHand' | 'reserved' | 'qc' | 'damaged'> = {
  ON_HAND: 'onHand',
  RESERVED: 'reserved',
  QC: 'qc',
  // I8 (build plan §5.8): held, not sellable — never folded into "available".
  DAMAGED: 'damaged',
};

// Only ON_HAND/QC/DAMAGED have a batch-level counterpart — RESERVED stays
// item-level only (§5.4a's schema correction).
const BATCH_BUCKET_COLUMN: Partial<Record<StockBucket, 'onHand' | 'qc' | 'damaged'>> = { ON_HAND: 'onHand', QC: 'qc', DAMAGED: 'damaged' };

type LockedBalance = { id: number; onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal };
type LockedBatchBalance = { id: number; onHand: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal };
type ItemSettingsRow = { itemId: number; batchTracked: boolean; expiryRequired: boolean; shelfLifeDays: number | null };

function balanceKey(itemId: number, locationId: number) {
  return `${itemId}:${locationId}`;
}

function batchBalanceKey(batchId: number, locationId: number) {
  return `${batchId}:${locationId}`;
}

// Fixed advisory-lock namespace for Inventory's per-item settings lock
// (arbitrary constant, chosen once — never reused for anything else). Shared
// (pg_advisory_xact_lock_shared) by readers (applyMovements()/
// issueForDelivery()), exclusive (pg_advisory_xact_lock) by writers
// (settings PUT, BATCH_CUTOVER) — see §5.4a R1's full rationale in the class
// comment above. Transaction-scoped (released automatically at commit/
// rollback); re-acquiring the same lock later in the same transaction is a
// cheap no-op, so calling this more than once per item per transaction is
// safe (e.g. issueForDelivery() takes it, then applyMovements() takes it
// again for the same items).
const ITEM_SETTINGS_LOCK_NAMESPACE = 847_362_001;

export async function lockItemSettings(tx: Prisma.TransactionClient, itemIds: number[], mode: 'shared' | 'exclusive' = 'shared'): Promise<void> {
  const unique = [...new Set(itemIds)].sort((a, b) => a - b);
  for (const itemId of unique) {
    // Explicit ::int casts: Prisma's raw-query driver sends an untyped JS
    // number as bigint by default, which matches neither of Postgres's two
    // pg_advisory_xact_lock(_shared) overloads taken together
    // (`(bigint)` or `(int, int)`) — found live (42883 "function does not
    // exist"), not by the unit tests, since the fake never runs real SQL.
    if (mode === 'shared') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${ITEM_SETTINGS_LOCK_NAMESPACE}::int, ${itemId}::int)`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ITEM_SETTINGS_LOCK_NAMESPACE}::int, ${itemId}::int)`;
    }
  }
}

// Reads InventoryItemSetting for exactly the given items, AFTER the caller
// has locked them (lockItemSettings above) — an item with no row is
// untracked (the table's whole-row default). DI-free, like the rest of this
// file; takes the transaction client directly.
async function loadItemSettings(
  tx: Prisma.TransactionClient,
  itemIds: number[],
): Promise<Map<number, ItemSettingsRow>> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return new Map();
  const rows = await tx.inventoryItemSetting.findMany({
    where: { itemId: { in: unique } },
    select: { itemId: true, batchTracked: true, expiryRequired: true, shelfLifeDays: true },
  });
  return new Map(rows.map((row) => [row.itemId, row]));
}

// Rejects rows that don't make sense regardless of current stock: zero or
// malformed quantities, a bucket the movement type may not touch, or a sign
// that contradicts the movement type. These are programming errors in the
// calling module (the DTOs already validate user input), so they throw a
// plain Error (→ 500), not a user-facing message.
function validateRow(row: MovementInput, index: number): Prisma.Decimal {
  if (!Number.isInteger(row.itemId) || row.itemId < 1 || !Number.isInteger(row.locationId) || row.locationId < 1) {
    throw new Error(`Stock movement #${index}: invalid item/location id`);
  }
  if (!Number.isInteger(row.referenceId) || row.referenceId < 1) {
    throw new Error(`Stock movement #${index}: invalid referenceId`);
  }
  if (!(row.movementDate instanceof Date) || Number.isNaN(row.movementDate.getTime())) {
    throw new Error(`Stock movement #${index}: invalid movementDate`);
  }
  let quantity: Prisma.Decimal;
  try {
    quantity = new Prisma.Decimal(row.quantity);
  } catch {
    throw new Error(`Stock movement #${index}: invalid quantity`);
  }
  if (!quantity.isFinite() || quantity.isZero() || quantity.decimalPlaces() > 2) {
    throw new Error(`Stock movement #${index}: quantity must be a non-zero number with at most two decimals`);
  }
  const direction = MOVEMENT_TYPE_BUCKETS[row.movementType]?.[row.bucket];
  if (!direction) {
    throw new Error(`Stock movement #${index}: ${row.movementType} may not touch bucket ${row.bucket}`);
  }
  if ((direction === 'IN') !== quantity.isPositive()) {
    throw new Error(`Stock movement #${index}: ${row.movementType} on ${row.bucket} must be ${direction === 'IN' ? 'positive' : 'negative'}`);
  }
  // I4 (§5.4a's schema correction): a batch never applies to the RESERVED
  // bucket. No caller ever has a legitimate reason to pass one — this is a
  // programming-error guard, same severity as the checks above, not a
  // user-facing 409.
  if (row.bucket === 'RESERVED' && row.batchId) {
    throw new Error(`Stock movement #${index}: RESERVED rows may not carry a batchId`);
  }
  if (row.batchId !== undefined && row.batchId !== null && (!Number.isInteger(row.batchId) || row.batchId < 1)) {
    throw new Error(`Stock movement #${index}: invalid batchId`);
  }
  // I5: unitCost, when given, is a whole-Rial non-negative amount
  // (Decimal(15,0)) — the DTOs already enforce this; a violation here is a
  // caller bug.
  if (row.unitCost !== undefined && row.unitCost !== null) {
    let cost: Prisma.Decimal;
    try {
      cost = new Prisma.Decimal(row.unitCost);
    } catch {
      throw new Error(`Stock movement #${index}: invalid unitCost`);
    }
    if (!cost.isFinite() || cost.isNegative() || !cost.isInteger()) {
      throw new Error(`Stock movement #${index}: unitCost must be a non-negative whole number`);
    }
  }
  return quantity;
}

async function lockBalance(tx: Prisma.TransactionClient, itemId: number, locationId: number): Promise<LockedBalance> {
  const rows = await tx.$queryRaw<{ id: number; on_hand: unknown; reserved: unknown; qc: unknown; damaged: unknown }[]>`
    SELECT id, on_hand, reserved, qc, damaged FROM stock_balances
    WHERE item_id = ${itemId} AND location_id = ${locationId}
    FOR UPDATE`;
  const row = rows?.[0];
  if (!row) throw new Error(`Stock balance row missing for item ${itemId} / location ${locationId}`);
  return {
    id: Number(row.id),
    onHand: new Prisma.Decimal(String(row.on_hand)),
    reserved: new Prisma.Decimal(String(row.reserved)),
    qc: new Prisma.Decimal(String(row.qc)),
    damaged: new Prisma.Decimal(String(row.damaged)),
  };
}

// Persian 409 for a movement batch that would take a bucket below zero.
// Names the item (code + name) — the user needs to know which line to fix.
async function negativeStockConflict(
  tx: Prisma.TransactionClient,
  itemId: number,
  bucket: StockBucket,
  current: Prisma.Decimal,
  change: Prisma.Decimal,
  movementType: StockMovementType,
) {
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
  const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
  return new ConflictException({
    statusCode: 409,
    code: 'NEGATIVE_STOCK',
    message:
      `موجودی ${itemLabel} در «${STOCK_BUCKET_LABELS_FA[bucket]}» کافی نیست: موجودی فعلی ${current.toString()}، ` +
      `تغییر درخواستی ${change.toString()} (${STOCK_MOVEMENT_TYPE_LABELS_FA[movementType]}). موجودی نمی‌تواند منفی شود.`,
    details: { itemId, bucket, current: current.toString(), change: change.toString() },
  });
}

// Same as negativeStockConflict, but names the batch (and item) — a
// batch-tracked item's ON_HAND/QC is still blocked from going negative
// per-batch, not just item-wide.
async function negativeBatchStockConflict(
  tx: Prisma.TransactionClient,
  itemId: number,
  batchId: number,
  bucket: 'ON_HAND' | 'QC' | 'DAMAGED',
  current: Prisma.Decimal,
  change: Prisma.Decimal,
  movementType: StockMovementType,
) {
  const [item, batch] = await Promise.all([
    tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } }),
    tx.stockBatch.findUnique({ where: { id: batchId }, select: { batchNumber: true } }),
  ]);
  const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
  const batchLabel = batch ? `«${batch.batchNumber}»` : `#${batchId}`;
  return new ConflictException({
    statusCode: 409,
    code: 'NEGATIVE_STOCK',
    message:
      `موجودی بچ ${batchLabel} از ${itemLabel} در «${STOCK_BUCKET_LABELS_FA[bucket]}» کافی نیست: موجودی فعلی ${current.toString()}، ` +
      `تغییر درخواستی ${change.toString()} (${STOCK_MOVEMENT_TYPE_LABELS_FA[movementType]}). موجودی نمی‌تواند منفی شود.`,
    details: { itemId, batchId, bucket, current: current.toString(), change: change.toString() },
  });
}

async function batchRequiredConflict(tx: Prisma.TransactionClient, itemId: number, bucket: StockBucket) {
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
  const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
  return new ConflictException({
    statusCode: 409,
    code: 'BATCH_REQUIRED',
    message: `${itemLabel} به‌صورت ردیابی بچ تنظیم شده است؛ برای این ردیف در «${STOCK_BUCKET_LABELS_FA[bucket]}» باید یک بچ مشخص شود.`,
    details: { itemId, bucket },
  });
}

async function unexpectedBatchConflict(tx: Prisma.TransactionClient, itemId: number, bucket: StockBucket) {
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
  const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
  return new ConflictException({
    statusCode: 409,
    code: 'UNEXPECTED_BATCH',
    message: `${itemLabel} ردیابی بچ ندارد؛ برای این ردیف در «${STOCK_BUCKET_LABELS_FA[bucket]}» نباید بچ مشخص شود.`,
    details: { itemId, bucket },
  });
}

async function lockBatchBalance(tx: Prisma.TransactionClient, batchId: number, locationId: number): Promise<LockedBatchBalance | null> {
  const rows = await tx.$queryRaw<{ id: number; on_hand: unknown; qc: unknown; damaged: unknown }[]>`
    SELECT id, on_hand, qc, damaged FROM stock_batch_balances
    WHERE batch_id = ${batchId} AND location_id = ${locationId}
    FOR UPDATE`;
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    onHand: new Prisma.Decimal(String(row.on_hand)),
    qc: new Prisma.Decimal(String(row.qc)),
    damaged: new Prisma.Decimal(String(row.damaged)),
  };
}

export async function applyMovements(tx: Prisma.TransactionClient, rows: MovementInput[]): Promise<void> {
  if (rows.length === 0) return;

  // 1. Shape checks for every row, before touching the database.
  const quantities = rows.map((row, index) => validateRow(row, index));

  // 2. Net change per item+location+bucket (one batch may carry several
  //    lines for the same item — they're judged together, not one by one).
  const deltas = new Map<string, { itemId: number; locationId: number; change: Record<StockBucket, Prisma.Decimal>; firstType: Partial<Record<StockBucket, StockMovementType>> }>();
  rows.forEach((row, index) => {
    const key = balanceKey(row.itemId, row.locationId);
    let entry = deltas.get(key);
    if (!entry) {
      const zero = new Prisma.Decimal(0);
      entry = { itemId: row.itemId, locationId: row.locationId, change: { ON_HAND: zero, RESERVED: zero, QC: zero, DAMAGED: zero }, firstType: {} };
      deltas.set(key, entry);
    }
    entry.change[row.bucket] = entry.change[row.bucket].plus(quantities[index]);
    entry.firstType[row.bucket] ??= row.movementType;
  });

  // 3. Make sure every balance row exists, then lock them in a fixed order.
  const keys = [...deltas.values()].sort((a, b) => a.itemId - b.itemId || a.locationId - b.locationId);
  await tx.stockBalance.createMany({
    data: keys.map(({ itemId, locationId }) => ({ itemId, locationId })),
    skipDuplicates: true,
  });
  const locked = new Map<string, LockedBalance>();
  for (const { itemId, locationId } of keys) {
    locked.set(balanceKey(itemId, locationId), await lockBalance(tx, itemId, locationId));
  }

  // 3b. I4 (§5.4a R1): lock each involved item's settings (shared — several
  // concurrent movers may read; only a settings change/cutover excludes
  // them) AFTER the balance-row locks above and BEFORE reading the setting
  // itself, then read it. An item with no row is untracked.
  const itemIds = [...new Set(keys.map((entry) => entry.itemId))];
  await lockItemSettings(tx, itemIds, 'shared');
  const settingsByItem = await loadItemSettings(tx, itemIds);

  // 3c. Batch validation per row: RESERVED never carries a batch (checked in
  // validateRow already); for ON_HAND/QC/DAMAGED (I8), a tracked item's row
  // must carry one and an untracked item's row must not.
  for (const row of rows) {
    if (row.bucket !== 'ON_HAND' && row.bucket !== 'QC' && row.bucket !== 'DAMAGED') continue;
    const tracked = settingsByItem.get(row.itemId)?.batchTracked ?? false;
    if (tracked && !row.batchId) throw await batchRequiredConflict(tx, row.itemId, row.bucket);
    if (!tracked && row.batchId) throw await unexpectedBatchConflict(tx, row.itemId, row.bucket);
  }

  // 3d. Every referenced batch must exist and belong to the row's item — a
  // mismatch here is a programming error in the caller (it already resolved
  // the batch via stock-batches.ts resolveBatches() or a direct, validated
  // pick), never user-triggerable, so this throws a plain Error like the
  // shape checks in validateRow().
  const batchIds = [...new Set(rows.map((row) => row.batchId).filter((id): id is number => typeof id === 'number'))];
  const batchesById = new Map((batchIds.length ? await tx.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, itemId: true, batchNumber: true } }) : []).map((b) => [b.id, b]));
  for (const row of rows) {
    if (!row.batchId) continue;
    const batch = batchesById.get(row.batchId);
    if (!batch) throw new Error(`Stock movement: batchId ${row.batchId} does not exist`);
    if (batch.itemId !== row.itemId) throw new Error(`Stock movement: batchId ${row.batchId} does not belong to item ${row.itemId}`);
  }

  // 3e. Net change per batch+location (ON_HAND/QC only — RESERVED never has
  // a batch). Mirrors step 2's per-item aggregation.
  const batchDeltas = new Map<string, { batchId: number; itemId: number; locationId: number; change: { onHand: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal }; firstType: Partial<Record<'onHand' | 'qc' | 'damaged', StockMovementType>> }>();
  rows.forEach((row, index) => {
    if (!row.batchId) return;
    const column = BATCH_BUCKET_COLUMN[row.bucket];
    if (!column) return;
    const key = batchBalanceKey(row.batchId, row.locationId);
    let entry = batchDeltas.get(key);
    if (!entry) {
      entry = { batchId: row.batchId, itemId: row.itemId, locationId: row.locationId, change: { onHand: new Prisma.Decimal(0), qc: new Prisma.Decimal(0), damaged: new Prisma.Decimal(0) }, firstType: {} };
      batchDeltas.set(key, entry);
    }
    entry.change[column] = entry.change[column].plus(quantities[index]);
    entry.firstType[column] ??= row.movementType;
  });

  // 3f. Create-if-missing, then lock batch balance rows, ordered
  // (itemId, locationId, batchId) — after the item-level locks above.
  const batchKeys = [...batchDeltas.values()].sort((a, b) => a.itemId - b.itemId || a.locationId - b.locationId || a.batchId - b.batchId);
  if (batchKeys.length > 0) {
    await tx.stockBatchBalance.createMany({
      data: batchKeys.map(({ batchId, itemId, locationId }) => ({ batchId, itemId, locationId })),
      skipDuplicates: true,
    });
  }
  const lockedBatches = new Map<string, LockedBatchBalance>();
  for (const { batchId, locationId } of batchKeys) {
    const locked2 = await lockBatchBalance(tx, batchId, locationId);
    if (!locked2) throw new Error(`Stock batch balance row missing for batch ${batchId} / location ${locationId}`);
    lockedBatches.set(batchBalanceKey(batchId, locationId), locked2);
  }

  // 4. Validate every resulting balance before writing anything — item-level
  // first, then batch-level.
  const updates: { id: number; data: { onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal } }[] = [];
  for (const entry of keys) {
    const balance = locked.get(balanceKey(entry.itemId, entry.locationId))!;
    const next = { onHand: balance.onHand, reserved: balance.reserved, qc: balance.qc, damaged: balance.damaged };
    for (const bucket of ['ON_HAND', 'RESERVED', 'QC', 'DAMAGED'] as const) {
      const change = entry.change[bucket];
      if (change.isZero()) continue;
      const column = BUCKET_COLUMN[bucket];
      const result = balance[column].plus(change);
      if (result.isNegative()) {
        throw await negativeStockConflict(tx, entry.itemId, bucket, balance[column], change, entry.firstType[bucket]!);
      }
      next[column] = result;
    }
    updates.push({ id: balance.id, data: next });
  }

  const BATCH_COLUMN_TO_BUCKET = { onHand: 'ON_HAND', qc: 'QC', damaged: 'DAMAGED' } as const;
  const batchUpdates: { id: number; data: { onHand: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal } }[] = [];
  for (const entry of batchKeys) {
    const balance = lockedBatches.get(batchBalanceKey(entry.batchId, entry.locationId))!;
    const next = { onHand: balance.onHand, qc: balance.qc, damaged: balance.damaged };
    for (const column of ['onHand', 'qc', 'damaged'] as const) {
      const change = entry.change[column];
      if (change.isZero()) continue;
      const result = balance[column].plus(change);
      if (result.isNegative()) {
        throw await negativeBatchStockConflict(tx, entry.itemId, entry.batchId, BATCH_COLUMN_TO_BUCKET[column], balance[column], change, entry.firstType[column]!);
      }
      next[column] = result;
    }
    batchUpdates.push({ id: balance.id, data: next });
  }

  // 5. Write: item balances, then batch balances, then the movement rows
  // that explain them.
  for (const update of updates) {
    await tx.stockBalance.update({ where: { id: update.id }, data: update.data });
  }
  for (const update of batchUpdates) {
    await tx.stockBatchBalance.update({ where: { id: update.id }, data: update.data });
  }
  await tx.stockMovement.createMany({
    data: rows.map((row, index) => ({
      itemId: row.itemId,
      locationId: row.locationId,
      bucket: row.bucket,
      movementType: row.movementType,
      quantity: quantities[index],
      movementDate: row.movementDate,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      referenceLineId: row.referenceLineId ?? null,
      referenceNumber: row.referenceNumber ?? null,
      note: row.note ?? null,
      createdByUserId: row.createdByUserId ?? null,
      batchId: row.batchId ?? null,
      unitCost: row.unitCost === undefined || row.unitCost === null ? null : new Prisma.Decimal(row.unitCost),
    })),
  });
}

// ---------------------------------------------------------------------------
// Higher-level stock events (Sales batch 2). Both still write only through
// applyMovements() above; they exist so the caller never has to read a
// balance outside the lock that protects it.
// ---------------------------------------------------------------------------

export type StockEventContext = {
  locationId: number;
  movementDate: Date;
  referenceType: StockReferenceType;
  referenceId: number;
  referenceNumber?: string | null;
  createdByUserId?: number | null;
  note?: string | null;
};

export type ReserveLine = { referenceLineId: number; itemId: number; quantity: Prisma.Decimal | number | string };

export type ReserveResult = {
  referenceLineId: number;
  itemId: number;
  requested: Prisma.Decimal;
  reserved: Prisma.Decimal;
  // requested − reserved: the visible backorder (never silent, build plan §5).
  shortfall: Prisma.Decimal;
};

// RESERVE: for each line, RESERVED += min(requested, available), where
// available = onHand − reserved at this location (QC stock is not sellable —
// same definition as InventoryService.getAvailability()). Lines are served in
// the given order; several lines for the same item share that item's
// availability. A line that can't be (fully) covered is NOT an error — its
// shortfall is returned so the caller can show a backorder warning.
//
// Availability is read under the same FOR UPDATE lock applyMovements() then
// takes (re-locking a row this transaction already holds is a no-op), so two
// concurrent reservations can't both claim the same free stock.
export async function reserveAvailable(tx: Prisma.TransactionClient, context: StockEventContext, lines: ReserveLine[]): Promise<ReserveResult[]> {
  const zero = new Prisma.Decimal(0);
  const itemIds = [...new Set(lines.map((line) => line.itemId))].sort((a, b) => a - b);
  // I4 (B21): "available" excludes expired-but-not-written-off stock
  // everywhere, reservations included — otherwise an order could be
  // confirmed against stock that then fails at delivery with
  // EXPIRED_STOCK_ONLY. Settings are locked (shared) for the same reason
  // applyMovements() locks them (§5.4a R1); the expired-batch sum itself is
  // read unlocked — safe because it's read AFTER the item-level
  // stock_balances FOR UPDATE below, and any transaction that could change
  // this item's batch balances must take that same stock_balances lock
  // first (applyMovements()'s own lock order), so it can't be concurrently
  // in flight once this function holds it.
  await lockItemSettings(tx, itemIds, 'shared');
  const settingsByItem = await loadItemSettings(tx, itemIds);
  // Lock existing rows only: an item with no balance row has nothing to
  // reserve, and creating the row here would be a write without a movement.
  const free = new Map<number, Prisma.Decimal>();
  for (const itemId of itemIds) {
    const rows = await tx.$queryRaw<{ on_hand: unknown; reserved: unknown }[]>`
      SELECT on_hand, reserved FROM stock_balances
      WHERE item_id = ${itemId} AND location_id = ${context.locationId}
      FOR UPDATE`;
    const row = rows?.[0];
    let available = row ? new Prisma.Decimal(String(row.on_hand)).minus(new Prisma.Decimal(String(row.reserved))) : zero;
    if (settingsByItem.get(itemId)?.batchTracked) {
      const expired = await sumExpiredOnHand(tx, itemId, context.locationId, context.movementDate);
      available = available.minus(expired);
    }
    free.set(itemId, Prisma.Decimal.max(zero, available));
  }

  const results: ReserveResult[] = lines.map((line) => {
    const requested = new Prisma.Decimal(line.quantity);
    const remaining = free.get(line.itemId) ?? zero;
    const reserved = Prisma.Decimal.min(requested, remaining);
    free.set(line.itemId, remaining.minus(reserved));
    return { referenceLineId: line.referenceLineId, itemId: line.itemId, requested, reserved, shortfall: requested.minus(reserved) };
  });

  await applyMovements(
    tx,
    results
      .filter((result) => result.reserved.greaterThan(0))
      .map((result) => ({
        itemId: result.itemId,
        locationId: context.locationId,
        bucket: 'RESERVED' as const,
        movementType: 'RESERVE' as const,
        quantity: result.reserved,
        movementDate: context.movementDate,
        referenceType: context.referenceType,
        referenceId: context.referenceId,
        referenceLineId: result.referenceLineId,
        referenceNumber: context.referenceNumber ?? null,
        note: context.note ?? null,
        createdByUserId: context.createdByUserId ?? null,
      })),
  );
  return results;
}

// RELEASE: RESERVED −= quantity per line (lines with nothing reserved are
// skipped). The caller passes what it actually holds (e.g.
// SalesOrderItem.reservedQty); releasing more than the bucket holds is a 409
// from applyMovements(), never a silent clamp.
export async function releaseReserved(
  tx: Prisma.TransactionClient,
  context: StockEventContext,
  lines: { referenceLineId: number; itemId: number; quantity: Prisma.Decimal | number | string }[],
): Promise<void> {
  await applyMovements(
    tx,
    lines
      .map((line) => ({ ...line, quantity: new Prisma.Decimal(line.quantity) }))
      .filter((line) => line.quantity.greaterThan(0))
      .map((line) => ({
        itemId: line.itemId,
        locationId: context.locationId,
        bucket: 'RESERVED' as const,
        movementType: 'RELEASE' as const,
        quantity: line.quantity.negated(),
        movementDate: context.movementDate,
        referenceType: context.referenceType,
        referenceId: context.referenceId,
        referenceLineId: line.referenceLineId,
        referenceNumber: context.referenceNumber ?? null,
        note: context.note ?? null,
        createdByUserId: context.createdByUserId ?? null,
      })),
  );
}

// Distinct 409 code: the delivery would take stock another order holds.
export const STOCK_RESERVED_FOR_OTHERS = 'STOCK_RESERVED_FOR_OTHERS';

export type IssueLine = {
  referenceLineId: number;
  itemId: number;
  // What is physically leaving the warehouse on this line (> 0).
  quantity: Prisma.Decimal | number | string;
  // What the source order line still holds in RESERVED for this item
  // (SalesOrderItem.reservedQty) — consumed first.
  reservedQty: Prisma.Decimal | number | string;
};

export type IssueResultBatch = { batchId: number; batchNumber: string; expiryDate: Date | null; quantity: Prisma.Decimal };
export type IssueResult = {
  referenceLineId: number;
  itemId: number;
  issued: Prisma.Decimal;
  reservedConsumed: Prisma.Decimal;
  // I4 (B8/§6): present only for a batch-tracked item — the FEFO split this
  // line's issued quantity was drawn from.
  batches?: IssueResultBatch[];
};

// Distinct 409 code (I4, B8/§5.4a): enough physical stock exists, and enough
// is free of other orders' reservations, but what remains is held in
// expired batches only.
export const EXPIRED_STOCK_ONLY = 'EXPIRED_STOCK_ONLY';

// DELIVERY_ISSUE (Sales batch 3, build plan §5): per line, ON_HAND −q and
// RESERVED −min(q, reservedQty). Several lines of the same item are judged
// together.
//
// Two blocks, both under the same FOR UPDATE lock applyMovements() takes
// (re-locking a row this transaction already holds is a no-op):
//   - ON_HAND would go negative → 409 NEGATIVE_STOCK from applyMovements().
//     No override, ever (B11).
//   - The part NOT covered by this order's own reservation may only come
//     from free stock (onHand − reserved): a delivery never takes stock that
//     is reserved for another order. Equivalently, the issue must not leave
//     RESERVED > ON_HAND. → 409 STOCK_RESERVED_FOR_OTHERS.
// So an order whose confirm-time shortfall was never reserved (a backorder)
// can still be delivered from stock that arrived later, as long as it is
// free — no re-reservation step is needed first.
export async function issueForDelivery(tx: Prisma.TransactionClient, context: StockEventContext, lines: IssueLine[]): Promise<IssueResult[]> {
  const zero = new Prisma.Decimal(0);
  const results: IssueResult[] = lines.map((line) => {
    const issued = new Prisma.Decimal(line.quantity);
    const held = Prisma.Decimal.max(zero, new Prisma.Decimal(line.reservedQty));
    return { referenceLineId: line.referenceLineId, itemId: line.itemId, issued, reservedConsumed: Prisma.Decimal.min(issued, held) };
  });

  const perItem = new Map<number, { issued: Prisma.Decimal; consumed: Prisma.Decimal }>();
  for (const result of results) {
    const entry = perItem.get(result.itemId) ?? { issued: zero, consumed: zero };
    perItem.set(result.itemId, { issued: entry.issued.plus(result.issued), consumed: entry.consumed.plus(result.reservedConsumed) });
  }

  const itemIds = [...perItem.keys()].sort((a, b) => a - b);
  // I4 (§5.4a R1): settings locked (shared) for the same reason
  // applyMovements() locks them — read AFTER the item-level stock_balances
  // locks below for each item, so this happens inside that same per-item
  // loop, in the same order.
  const settingsByItem = await (async () => {
    await lockItemSettings(tx, itemIds, 'shared');
    return loadItemSettings(tx, itemIds);
  })();

  // Per-item FEFO allocations, for tracked items only — built while the
  // existing NEGATIVE_STOCK/STOCK_RESERVED_FOR_OTHERS checks run below, in
  // the same per-item loop (batch rows locked FOR UPDATE after the item-level
  // row, ordered by (itemId, locationId, batchId) — §6/§5.4a).
  const allocationsByLine = new Map<number, FefoAllocation[]>();

  for (const itemId of itemIds) {
    const rows = await tx.$queryRaw<{ on_hand: unknown; reserved: unknown }[]>`
      SELECT on_hand, reserved FROM stock_balances
      WHERE item_id = ${itemId} AND location_id = ${context.locationId}
      FOR UPDATE`;
    const row = rows?.[0];
    const onHand = row ? new Prisma.Decimal(String(row.on_hand)) : zero;
    const reserved = row ? new Prisma.Decimal(String(row.reserved)) : zero;
    const { issued, consumed } = perItem.get(itemId)!;
    // I4: thrown here directly (not left for applyMovements() to catch
    // later) so NEGATIVE_STOCK always wins the error-order race even for a
    // batch-tracked item — previously, skipping straight to applyMovements()
    // meant a tracked item's unallocated ON_HAND row (no batchId, since no
    // FEFO allocation ran) surfaced as BATCH_REQUIRED instead, masking the
    // real problem (build plan §16 resume step 3 found this).
    if (issued.greaterThan(onHand)) {
      throw await negativeStockConflict(tx, itemId, 'ON_HAND', onHand, issued.negated(), 'DELIVERY_ISSUE');
    }
    const fromFree = issued.minus(consumed);
    const free = Prisma.Decimal.max(zero, onHand.minus(reserved));
    if (fromFree.greaterThan(free)) {
      const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
      const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
      throw new ConflictException({
        statusCode: 409,
        code: STOCK_RESERVED_FOR_OTHERS,
        message:
          `موجودی آزاد ${itemLabel} کافی نیست: از مقدار ${issued.toString()} فقط ${consumed.toString()} برای این سفارش رزرو شده و ` +
          `موجودی آزاد (رزرونشده) ${free.toString()} است. بقیهٔ موجودی انبار برای سفارش‌های دیگر رزرو شده است.`,
        details: { itemId, onHand: onHand.toString(), reserved: reserved.toString(), issued: issued.toString(), reservedForThisOrder: consumed.toString(), free: free.toString() },
      });
    }

    if (!settingsByItem.get(itemId)?.batchTracked) continue;

    // Lock this item's batch balance rows at this location, ordered by
    // batchId (after the item-level row above), then read their expiry.
    const batchRows = await tx.$queryRaw<{ batch_id: number; on_hand: unknown }[]>`
      SELECT batch_id, on_hand FROM stock_batch_balances
      WHERE item_id = ${itemId} AND location_id = ${context.locationId} AND on_hand > 0
      ORDER BY batch_id ASC
      FOR UPDATE`;
    const batchMeta = batchRows.length
      ? await tx.stockBatch.findMany({ where: { id: { in: batchRows.map((r) => Number(r.batch_id)) } }, select: { id: true, batchNumber: true, expiryDate: true } })
      : [];
    const metaById = new Map(batchMeta.map((b) => [b.id, b]));
    const candidates = batchRows.map((r) => {
      const meta = metaById.get(Number(r.batch_id));
      return { batchId: Number(r.batch_id), batchNumber: meta?.batchNumber ?? '', expiryDate: meta?.expiryDate ?? null, onHand: new Prisma.Decimal(String(r.on_hand)) };
    });

    const nonExpiredTotal = candidates.reduce(
      (sum, batch) => (isExpiredBatch(batch.expiryDate, context.movementDate) ? sum : sum.plus(batch.onHand)),
      zero,
    );
    if (issued.greaterThan(nonExpiredTotal)) {
      const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
      const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
      throw new ConflictException({
        statusCode: 409,
        code: EXPIRED_STOCK_ONLY,
        message:
          `موجودی غیرمنقضی ${itemLabel} برای این تحویل کافی نیست: مقدار موردنیاز ${issued.toString()}، موجودی غیرمنقضی موجود ${nonExpiredTotal.toString()} است. ` +
          `بقیهٔ موجودی در بچ‌های منقضی‌شده است که قابل تحویل نیستند.`,
        details: { itemId, issued: issued.toString(), nonExpiredOnHand: nonExpiredTotal.toString() },
      });
    }

    const linesForItem = lines.filter((line) => line.itemId === itemId).map((line) => ({ referenceLineId: line.referenceLineId, quantity: line.quantity }));
    const { allocations, shortfall } = allocateFefo(linesForItem, candidates, context.movementDate);
    if (shortfall.greaterThan(0)) {
      // Defensive — nonExpiredTotal already guarantees coverage; a shortfall
      // here would mean the two sums disagree, a programming error.
      throw new Error(`issueForDelivery: FEFO allocation shortfall ${shortfall.toString()} for item ${itemId}, despite sufficient non-expired total`);
    }
    for (const allocation of allocations) {
      const list = allocationsByLine.get(allocation.referenceLineId) ?? [];
      list.push(allocation);
      allocationsByLine.set(allocation.referenceLineId, list);
    }
  }

  const movements: MovementInput[] = [];
  for (const result of results) {
    const base = {
      itemId: result.itemId,
      locationId: context.locationId,
      movementType: 'DELIVERY_ISSUE' as const,
      movementDate: context.movementDate,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      referenceLineId: result.referenceLineId,
      referenceNumber: context.referenceNumber ?? null,
      note: context.note ?? null,
      createdByUserId: context.createdByUserId ?? null,
    };
    const lineAllocations = allocationsByLine.get(result.referenceLineId);
    if (lineAllocations && lineAllocations.length > 0) {
      for (const allocation of lineAllocations) {
        movements.push({ ...base, bucket: 'ON_HAND', quantity: allocation.quantity.negated(), batchId: allocation.batchId });
      }
      result.batches = lineAllocations.map((allocation) => ({
        batchId: allocation.batchId,
        batchNumber: allocation.batchNumber,
        expiryDate: allocation.expiryDate,
        quantity: allocation.quantity,
      }));
    } else {
      movements.push({ ...base, bucket: 'ON_HAND', quantity: result.issued.negated() });
    }
    if (result.reservedConsumed.greaterThan(0)) movements.push({ ...base, bucket: 'RESERVED', quantity: result.reservedConsumed.negated() });
  }
  await applyMovements(tx, movements);
  return results;
}

// ---------------------------------------------------------------------------
// Returns (Sales batch 6, build plan §5's stock-effect table). Both
// functions below only ever write through applyMovements() above.
// ---------------------------------------------------------------------------

export type ReceiveReturnLine = {
  referenceLineId: number;
  itemId: number;
  quantity: Prisma.Decimal | number | string;
  // I4 (§5.4a R7/B22/B24): required for a batch-tracked item (applyMovements()
  // enforces this); resolved by SalesReturnsService before calling this —
  // either the single batch a delivery line issued from, the caller's pick
  // among several, or a typed lot number resolved via stock-batches.ts
  // (B22, a pre-cutover delivery with no batch to return into).
  batchId?: number | null;
};

// RETURN_RECEIPT: QC += quantity per line (SalesReturn APPROVED → RECEIVED).
// Lines with a zero/negative quantity are skipped (nothing physically came
// back on that line). No negative-balance concern here — QC only ever goes
// up on receipt.
export async function receiveReturn(tx: Prisma.TransactionClient, context: StockEventContext, lines: ReceiveReturnLine[]): Promise<void> {
  const movements: MovementInput[] = lines
    .map((line) => ({ ...line, quantity: new Prisma.Decimal(line.quantity) }))
    .filter((line) => line.quantity.greaterThan(0))
    .map((line) => ({
      itemId: line.itemId,
      locationId: context.locationId,
      bucket: 'QC' as const,
      movementType: 'RETURN_RECEIPT' as const,
      quantity: line.quantity,
      movementDate: context.movementDate,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      referenceLineId: line.referenceLineId,
      referenceNumber: context.referenceNumber ?? null,
      note: context.note ?? null,
      createdByUserId: context.createdByUserId ?? null,
      batchId: line.batchId ?? null,
    }));
  await applyMovements(tx, movements);
}

export type InspectReturnLine = {
  referenceLineId: number;
  itemId: number;
  // restockQty + writeOffQty + damagedQty must already equal the line's
  // receivedQty — enforced by the caller (SalesReturnsService.inspect()),
  // not here.
  restockQty: Prisma.Decimal | number | string;
  writeOffQty: Prisma.Decimal | number | string;
  // I8 (build plan §5.8, B9): "to damaged" disposition — physically held,
  // not sellable (posts RETURN_TO_DAMAGED instead of RETURN_WRITE_OFF).
  // Optional — existing callers keep their signature unchanged (this
  // project's own settled-foundations rule); omitted means none.
  damagedQty?: Prisma.Decimal | number | string;
  // I4: the same batch the line's QC stock was received into (receiveReturn()
  // above) — QC leaves from, and restock re-enters ON_HAND as, that batch.
  batchId?: number | null;
};

// Per-line disposition (SalesReturn RECEIVED → INSPECTED): RETURN_RESTOCK
// (QC −r, ON_HAND +r) for a line's restockQty, RETURN_WRITE_OFF (QC −w) for
// its writeOffQty, and/or RETURN_TO_DAMAGED (QC −d, DAMAGED +d, I8) for its
// damagedQty. QC going negative here would mean the caller tried to dispose
// of more than was received — applyMovements() blocks it (409
// NEGATIVE_STOCK) the same as every other bucket.
export async function inspectReturn(tx: Prisma.TransactionClient, context: StockEventContext, lines: InspectReturnLine[]): Promise<void> {
  const movements: MovementInput[] = [];
  for (const line of lines) {
    const restock = new Prisma.Decimal(line.restockQty);
    const writeOff = new Prisma.Decimal(line.writeOffQty);
    const damaged = new Prisma.Decimal(line.damagedQty ?? 0);
    const base = {
      itemId: line.itemId,
      locationId: context.locationId,
      movementDate: context.movementDate,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      referenceLineId: line.referenceLineId,
      referenceNumber: context.referenceNumber ?? null,
      note: context.note ?? null,
      createdByUserId: context.createdByUserId ?? null,
      batchId: line.batchId ?? null,
    };
    if (restock.greaterThan(0)) {
      movements.push({ ...base, bucket: 'QC', movementType: 'RETURN_RESTOCK', quantity: restock.negated() });
      movements.push({ ...base, bucket: 'ON_HAND', movementType: 'RETURN_RESTOCK', quantity: restock });
    }
    if (writeOff.greaterThan(0)) {
      movements.push({ ...base, bucket: 'QC', movementType: 'RETURN_WRITE_OFF', quantity: writeOff.negated() });
    }
    if (damaged.greaterThan(0)) {
      movements.push({ ...base, bucket: 'QC', movementType: 'RETURN_TO_DAMAGED', quantity: damaged.negated() });
      movements.push({ ...base, bucket: 'DAMAGED', movementType: 'RETURN_TO_DAMAGED', quantity: damaged });
    }
  }
  await applyMovements(tx, movements);
}
