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
  // Lock existing rows only: an item with no balance row has nothing to
  // reserve, and creating the row here would be a write without a movement.
  const free = new Map<number, Prisma.Decimal>();
  for (const itemId of itemIds) {
    const rows = await tx.$queryRaw<{ on_hand: unknown; reserved: unknown }[]>`
      SELECT on_hand, reserved FROM stock_balances
      WHERE item_id = ${itemId} AND location_id = ${context.locationId}
      FOR UPDATE`;
    const row = rows?.[0];
    const available = row ? new Prisma.Decimal(String(row.on_hand)).minus(new Prisma.Decimal(String(row.reserved))) : zero;
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

export type IssueResult = { referenceLineId: number; itemId: number; issued: Prisma.Decimal; reservedConsumed: Prisma.Decimal };

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
  for (const itemId of itemIds) {
    const rows = await tx.$queryRaw<{ on_hand: unknown; reserved: unknown }[]>`
      SELECT on_hand, reserved FROM stock_balances
      WHERE item_id = ${itemId} AND location_id = ${context.locationId}
      FOR UPDATE`;
    const row = rows?.[0];
    // No row / not enough on hand: applyMovements() raises NEGATIVE_STOCK.
    if (!row) continue;
    const onHand = new Prisma.Decimal(String(row.on_hand));
    const reserved = new Prisma.Decimal(String(row.reserved));
    const { issued, consumed } = perItem.get(itemId)!;
    if (issued.greaterThan(onHand)) continue;
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
    movements.push({ ...base, bucket: 'ON_HAND', quantity: result.issued.negated() });
    if (result.reservedConsumed.greaterThan(0)) movements.push({ ...base, bucket: 'RESERVED', quantity: result.reservedConsumed.negated() });
  }
  await applyMovements(tx, movements);
  return results;
}

// ---------------------------------------------------------------------------
// Returns (Sales batch 6, build plan §5's stock-effect table). Both
// functions below only ever write through applyMovements() above.
// ---------------------------------------------------------------------------

export type ReceiveReturnLine = { referenceLineId: number; itemId: number; quantity: Prisma.Decimal | number | string };

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
    }));
  await applyMovements(tx, movements);
}

export type InspectReturnLine = {
  referenceLineId: number;
  itemId: number;
  // restockQty + writeOffQty must already equal the line's receivedQty —
  // enforced by the caller (SalesReturnsService.inspect()), not here.
  restockQty: Prisma.Decimal | number | string;
  writeOffQty: Prisma.Decimal | number | string;
};

// Per-line disposition (SalesReturn RECEIVED → INSPECTED): RETURN_RESTOCK
// (QC −r, ON_HAND +r) for a line's restockQty, and/or RETURN_WRITE_OFF
// (QC −w) for its writeOffQty. QC going negative here would mean the caller
// tried to dispose of more than was received — applyMovements() blocks it
// (409 NEGATIVE_STOCK) the same as every other bucket.
export async function inspectReturn(tx: Prisma.TransactionClient, context: StockEventContext, lines: InspectReturnLine[]): Promise<void> {
  const movements: MovementInput[] = [];
  for (const line of lines) {
    const restock = new Prisma.Decimal(line.restockQty);
    const writeOff = new Prisma.Decimal(line.writeOffQty);
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
    };
    if (restock.greaterThan(0)) {
      movements.push({ ...base, bucket: 'QC', movementType: 'RETURN_RESTOCK', quantity: restock.negated() });
      movements.push({ ...base, bucket: 'ON_HAND', movementType: 'RETURN_RESTOCK', quantity: restock });
    }
    if (writeOff.greaterThan(0)) {
      movements.push({ ...base, bucket: 'QC', movementType: 'RETURN_WRITE_OFF', quantity: writeOff.negated() });
    }
  }
  await applyMovements(tx, movements);
}
