import { ConflictException } from '@nestjs/common';
import { Prisma, type StockBucket, type StockMovementType, type StockReferenceType } from '@prisma/client';
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
// (business decision 2026-10-06). The same holds for RESERVED and QC (a
// bucket can't hold less than nothing); the migration adds CHECK constraints
// on stock_balances as a database-level backstop.

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
};

const BUCKET_COLUMN: Record<StockBucket, 'onHand' | 'reserved' | 'qc'> = {
  ON_HAND: 'onHand',
  RESERVED: 'reserved',
  QC: 'qc',
};

type LockedBalance = { id: number; onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal };

function balanceKey(itemId: number, locationId: number) {
  return `${itemId}:${locationId}`;
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
  return quantity;
}

async function lockBalance(tx: Prisma.TransactionClient, itemId: number, locationId: number): Promise<LockedBalance> {
  const rows = await tx.$queryRaw<{ id: number; on_hand: unknown; reserved: unknown; qc: unknown }[]>`
    SELECT id, on_hand, reserved, qc FROM stock_balances
    WHERE item_id = ${itemId} AND location_id = ${locationId}
    FOR UPDATE`;
  const row = rows?.[0];
  if (!row) throw new Error(`Stock balance row missing for item ${itemId} / location ${locationId}`);
  return {
    id: Number(row.id),
    onHand: new Prisma.Decimal(String(row.on_hand)),
    reserved: new Prisma.Decimal(String(row.reserved)),
    qc: new Prisma.Decimal(String(row.qc)),
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
      entry = { itemId: row.itemId, locationId: row.locationId, change: { ON_HAND: zero, RESERVED: zero, QC: zero }, firstType: {} };
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

  // 4. Validate every resulting balance before writing anything.
  const updates: { id: number; data: { onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal } }[] = [];
  for (const entry of keys) {
    const balance = locked.get(balanceKey(entry.itemId, entry.locationId))!;
    const next = { onHand: balance.onHand, reserved: balance.reserved, qc: balance.qc };
    for (const bucket of ['ON_HAND', 'RESERVED', 'QC'] as const) {
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

  // 5. Write: balances, then the movement rows that explain them.
  for (const update of updates) {
    await tx.stockBalance.update({ where: { id: update.id }, data: update.data });
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
    })),
  });
}
