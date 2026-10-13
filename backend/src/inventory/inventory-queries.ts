// DI-free reads other modules may import without creating a module
// dependency on InventoryModule (same pattern as
// customers/customer-rules.ts's ensureTransactableCustomer()). Plain
// functions only — importing this file never creates a NestJS DI edge, so
// Items/Sales (and, later, anything else) can call it without a cycle risk
// even though Inventory itself must never import ItemsModule/SalesModule
// (build plan §4).
//
// Structural "finder" types here deliberately spell out a literal `select`
// (and, where needed, `where`) shape matching exactly what each function
// passes — a loose `Record<string, true>` breaks Prisma 6's generic
// findMany()/GetPayload inference (it resolves to `{ [x: string]: never }`),
// the same reason ensureTransactableCustomer() does it this way.

import { Prisma } from '@prisma/client';
import { isExpiredBatch } from './batch-allocation';

type StockHistoryFinder = {
  stockMovement: { findFirst(args: { where: { itemId: number }; select: { id: true } }): Promise<{ id: number } | null> };
};

// Used by ItemsService.update() (Inventory build plan I1, finding §2.3-1) to
// refuse an Item.unitId change once the item has any StockMovement — changing
// the unit after the fact would silently change the meaning of every past
// quantity. An item with no stock history is unaffected.
export async function hasStockHistory(db: StockHistoryFinder, itemId: number): Promise<boolean> {
  const movement = await db.stockMovement.findFirst({ where: { itemId }, select: { id: true } });
  return movement !== null;
}

// --- I4 (build plan §5.4/§5.4a): batch/expiry reads ------------------------

export type ItemBatchSettings = { itemId: number; batchTracked: boolean; expiryRequired: boolean; shelfLifeDays: number | null; batchTrackedSince: Date | null };

type ItemSettingsFinder = {
  inventoryItemSetting: {
    findMany(args: {
      where: { itemId: { in: number[] } };
      select: { itemId: true; batchTracked: true; expiryRequired: true; shelfLifeDays: true; batchTrackedSince: true };
    }): Promise<ItemBatchSettings[]>;
  };
};

// What Sales needs to know about an item's batch configuration, without
// reaching into Inventory's tables directly (CLAUDE.md rule 11) — an item
// missing from the result is untracked (the table's whole-row default).
export async function getItemBatchSettings(db: ItemSettingsFinder, itemIds: number[]): Promise<Map<number, ItemBatchSettings>> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.inventoryItemSetting.findMany({
    where: { itemId: { in: unique } },
    select: { itemId: true, batchTracked: true, expiryRequired: true, shelfLifeDays: true, batchTrackedSince: true },
  });
  return new Map(rows.map((row) => [row.itemId, row]));
}

type IssuedBatchMovementFinder = {
  stockMovement: {
    findMany(args: {
      where: {
        referenceType: 'DELIVERY';
        referenceId: number;
        referenceLineId: number;
        bucket: 'ON_HAND';
        movementType: 'DELIVERY_ISSUE';
      };
      select: { batchId: true; quantity: true };
    }): Promise<{ batchId: number | null; quantity: Prisma.Decimal }[]>;
  };
  stockBatch: {
    findMany(args: { where: { id: { in: number[] } }; select: { id: true; batchNumber: true; expiryDate: true } }): Promise<
      { id: number; batchNumber: string; expiryDate: Date | null }[]
    >;
  };
};

export type IssuedBatch = { batchId: number; batchNumber: string; expiryDate: Date | null; quantity: string };

// Which batch(es) a specific delivery line's stock actually came out of —
// sums posted DELIVERY_ISSUE (ON_HAND) movements by batch, for exactly that
// delivery + delivery line. Used by Sales (SalesReturnsService) to offer the
// right batch choice(s) at return receipt (§5.4a R7) — Sales never reads
// stock_movements/stock_batches directly, only through this function.
export async function listIssuedBatches(db: IssuedBatchMovementFinder, deliveryId: number, deliveryItemId: number): Promise<IssuedBatch[]> {
  const movements = await db.stockMovement.findMany({
    where: {
      referenceType: 'DELIVERY',
      referenceId: deliveryId,
      referenceLineId: deliveryItemId,
      bucket: 'ON_HAND',
      movementType: 'DELIVERY_ISSUE',
    },
    select: { batchId: true, quantity: true },
  });
  const tracked = movements.filter((m): m is { batchId: number; quantity: Prisma.Decimal } => m.batchId !== null);
  if (tracked.length === 0) return [];
  const sums = new Map<number, Prisma.Decimal>();
  for (const movement of tracked) {
    // DELIVERY_ISSUE rows are negative (ON_HAND out) — report the positive
    // quantity that left the warehouse from this batch.
    const current = sums.get(movement.batchId) ?? new Prisma.Decimal(0);
    sums.set(movement.batchId, current.plus(movement.quantity.abs()));
  }
  const batchIds = [...sums.keys()];
  const batches = await db.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, batchNumber: true, expiryDate: true } });
  const byId = new Map(batches.map((b) => [b.id, b]));
  return batchIds
    .map((batchId) => {
      const batch = byId.get(batchId);
      if (!batch) return null;
      return { batchId, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: sums.get(batchId)!.toString() };
    })
    .filter((row): row is IssuedBatch => row !== null);
}

type ExpiredBatchFinder = {
  stockBatchBalance: {
    findMany(args: {
      where: { locationId: number; itemId?: number; onHand: { gt: 0 } };
      select: { itemId: true; batchId: true; onHand: true };
    }): Promise<{ itemId: number; batchId: number; onHand: Prisma.Decimal }[]>;
  };
  stockBatch: {
    findMany(args: { where: { id: { in: number[] } }; select: { id: true; expiryDate: true } }): Promise<{ id: number; expiryDate: Date | null }[]>;
  };
};

// B21: the ON_HAND quantity, per item, held in batches already expired as of
// `asOfDate` at `locationId` — the amount every "available" definition
// (reservations, the order form, low-stock) must subtract. Read-only, no
// lock: see stock-ledger.ts reserveAvailable()'s comment on why an unlocked
// read here is still consistent (it piggybacks on the item-level
// stock_balances lock already held by the time this runs).
export async function listExpiredOnHandByItem(db: ExpiredBatchFinder, locationId: number, asOfDate: Date): Promise<Map<number, Prisma.Decimal>> {
  const balances = await db.stockBatchBalance.findMany({
    where: { locationId, onHand: { gt: 0 } },
    select: { itemId: true, batchId: true, onHand: true },
  });
  if (balances.length === 0) return new Map();
  const batchIds = [...new Set(balances.map((b) => b.batchId))];
  const batches = await db.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, expiryDate: true } });
  const expiryById = new Map(batches.map((b) => [b.id, b.expiryDate]));
  const result = new Map<number, Prisma.Decimal>();
  for (const balance of balances) {
    const expiryDate = expiryById.get(balance.batchId) ?? null;
    if (!isExpiredBatch(expiryDate, asOfDate)) continue;
    result.set(balance.itemId, (result.get(balance.itemId) ?? new Prisma.Decimal(0)).plus(balance.onHand));
  }
  return result;
}

// Single-item convenience wrapper over listExpiredOnHandByItem, for callers
// (reserveAvailable()) that already loop item by item.
export async function sumExpiredOnHand(db: ExpiredBatchFinder, itemId: number, locationId: number, asOfDate: Date): Promise<Prisma.Decimal> {
  const balances = await db.stockBatchBalance.findMany({
    where: { itemId, locationId, onHand: { gt: 0 } },
    select: { itemId: true, batchId: true, onHand: true },
  });
  if (balances.length === 0) return new Prisma.Decimal(0);
  const batches = await db.stockBatch.findMany({ where: { id: { in: balances.map((b) => b.batchId) } }, select: { id: true, expiryDate: true } });
  const expiryById = new Map(batches.map((b) => [b.id, b.expiryDate]));
  let total = new Prisma.Decimal(0);
  for (const balance of balances) {
    const expiryDate = expiryById.get(balance.batchId) ?? null;
    if (isExpiredBatch(expiryDate, asOfDate)) total = total.plus(balance.onHand);
  }
  return total;
}
