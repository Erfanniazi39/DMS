import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { applyMovements } from './stock-ledger';
import { buildInventoryService, createInventoryDb, seedBatch, seedStock, setBucket, trackItem } from './inventory.spec-helpers';

describe('InventoryService', () => {
  describe('getAvailability', () => {
    it('returns zeros for an item that has never had stock', async () => {
      const db = createInventoryDb();
      const result = await buildInventoryService(db).getAvailability(5, 1);
      expect(result.onHand.toString()).toBe('0');
      expect(result.reserved.toString()).toBe('0');
      expect(result.qc.toString()).toBe('0');
      expect(result.available.toString()).toBe('0');
    });

    it('available = onHand − reserved; QC stock is not available', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'RESERVED', 3.5);
      setBucket(db, 1, 'QC', 2);
      const result = await buildInventoryService(db).getAvailability(1, 1);
      expect(result).toEqual(expect.objectContaining({ itemId: 1, locationId: 1 }));
      expect(result.available.toString()).toBe('6.5');
    });

    // I4 (B21): expired-but-not-written-off batch stock is excluded from
    // "available" too — otherwise this display could show stock that then
    // fails at delivery with EXPIRED_STOCK_ONLY.
    it('excludes expired batch stock from available (B21)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      seedBatch(db, { itemId: 1, batchNumber: 'EXPIRED', expiryDate: new Date('2026-01-01T00:00:00.000Z'), onHand: 4 });
      seedBatch(db, { itemId: 1, batchNumber: 'FRESH', expiryDate: new Date('2027-01-01T00:00:00.000Z'), onHand: 6 });
      const result = await buildInventoryService(db).getAvailability(1, 1);
      expect(result.available.toString()).toBe('6'); // 10 on-hand − 4 expired
    });
  });

  // I4 (B21): same "sellable on hand" definition as getAvailability()/
  // reserveAvailable() — expired batch stock excluded here too.
  describe('listAvailability', () => {
    it('subtracts expired batch stock per item, leaving an untracked item unaffected', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      seedBatch(db, { itemId: 1, batchNumber: 'EXPIRED', expiryDate: new Date('2026-01-01T00:00:00.000Z'), onHand: 4 });
      seedStock(db, 2, 5); // untracked — no batches at all

      const result = await buildInventoryService(db).listAvailability(1);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: 1, available: new Prisma.Decimal(6) }),
          expect.objectContaining({ itemId: 2, available: new Prisma.Decimal(5) }),
        ]),
      );
    });
  });

  describe('verifyBalances', () => {
    it('reports ok when every balance equals the SUM of its movements', async () => {
      const db = createInventoryDb();
      await db.$transaction((tx: never) =>
        applyMovements(tx, [
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'MANUAL_RECEIPT', quantity: 10, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 1 },
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'ADJUSTMENT_OUT', quantity: -2.25, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 2 },
          { itemId: 2, locationId: 1, bucket: 'ON_HAND', movementType: 'OPENING_BALANCE', quantity: 4, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 3 },
        ]),
      );
      await expect(buildInventoryService(db).verifyBalances()).resolves.toEqual({ ok: true, mismatches: [], batchMismatches: [] });
    });

    it('catches an intentionally corrupted balance (a silent 500 → 700 with no movement)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 500);
      seedStock(db, 2, 3);
      // Simulate someone bypassing the ledger.
      db.state.balances.find((b: { itemId: number }) => b.itemId === 1).onHand = new Prisma.Decimal(700);

      const result = await buildInventoryService(db).verifyBalances();
      expect(result.ok).toBe(false);
      expect(result.mismatches).toEqual([{ itemId: 1, locationId: 1, bucket: 'ON_HAND', balance: '700', ledger: '500' }]);
    });

    it('catches movements that have no balance row, and a non-zero bucket with no movements', async () => {
      const db = createInventoryDb();
      db.state.movements.push({ itemId: 3, locationId: 1, bucket: 'ON_HAND', quantity: new Prisma.Decimal(8) });
      seedStock(db, 4, 1);
      setBucket(db, 4, 'RESERVED', 1);

      const { ok, mismatches } = await buildInventoryService(db).verifyBalances();
      expect(ok).toBe(false);
      expect(mismatches).toEqual(
        expect.arrayContaining([
          { itemId: 3, locationId: 1, bucket: 'ON_HAND', balance: '0', ledger: '8' },
          { itemId: 4, locationId: 1, bucket: 'RESERVED', balance: '1', ledger: '0' },
        ]),
      );
      expect(mismatches).toHaveLength(2);
    });

    // I4 (build plan §5.4a, §16 resume step 9): the three additive
    // batch-aware mismatch kinds.
    it('no false positive: a consistent batch-tracked item reports ok (the fake’s groupBy used to produce a false BATCH_SUM/BATCH_LEDGER mismatch here before step 1’s fix)', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'B1', onHand: 0 });
      await db.$transaction((tx: never) =>
        applyMovements(tx, [
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'ADJUSTMENT_IN', quantity: 10, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 1, batchId: batch.id },
        ]),
      );
      await expect(buildInventoryService(db).verifyBalances()).resolves.toEqual({ ok: true, mismatches: [], batchMismatches: [] });
    });

    it('catches BATCH_LEDGER: a batch balance that drifted from the SUM of its own movements', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'B1', onHand: 10 });
      db.state.movements.push({ itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'ADJUSTMENT_IN', quantity: new Prisma.Decimal(10), batchId: batch.id });
      // Simulate drift: the batch balance was bypassed (same class of bug as
      // the plain 500 → 700 case above, but at the batch level).
      db.state.batchBalances.find((b: { batchId: number }) => b.batchId === batch.id)!.onHand = new Prisma.Decimal(15);

      const result = await buildInventoryService(db).verifyBalances();
      expect(result.ok).toBe(false);
      expect(result.batchMismatches).toEqual(
        expect.arrayContaining([{ kind: 'BATCH_LEDGER', batchId: batch.id, itemId: 1, locationId: 1, bucket: 'ON_HAND', balance: '15', ledger: '10' }]),
      );
    });

    it('catches BATCH_SUM: a tracked item’s item-level balance ≠ the SUM of its batch balances', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      seedBatch(db, { itemId: 1, batchNumber: 'B1', onHand: 6 }); // item says 10, batches only add up to 6

      const result = await buildInventoryService(db).verifyBalances();
      expect(result.ok).toBe(false);
      expect(result.batchMismatches).toEqual(
        expect.arrayContaining([{ kind: 'BATCH_SUM', itemId: 1, locationId: 1, bucket: 'ON_HAND', balance: '10', ledger: '6' }]),
      );
    });

    it('catches UNEXPECTED_BATCH: a RESERVED movement carrying a batchId (never allowed, even historically)', async () => {
      const db = createInventoryDb();
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'B1' });
      db.state.movements.push({ itemId: 1, locationId: 1, bucket: 'RESERVED', movementType: 'RESERVE', quantity: new Prisma.Decimal(5), batchId: batch.id });

      const result = await buildInventoryService(db).verifyBalances();
      expect(result.batchMismatches).toEqual(
        expect.arrayContaining([{ kind: 'UNEXPECTED_BATCH', itemId: 1, locationId: 1, batchId: batch.id, bucket: 'RESERVED' }]),
      );
    });

    it('catches UNEXPECTED_BATCH: an untracked item carrying a batch movement', async () => {
      const db = createInventoryDb();
      const batch = seedBatch(db, { itemId: 2, batchNumber: 'B2' });
      db.state.movements.push({ itemId: 2, locationId: 1, bucket: 'ON_HAND', movementType: 'ADJUSTMENT_IN', quantity: new Prisma.Decimal(5), batchId: batch.id });

      const result = await buildInventoryService(db).verifyBalances();
      expect(result.batchMismatches).toEqual(
        expect.arrayContaining([{ kind: 'UNEXPECTED_BATCH', itemId: 2, locationId: 1, batchId: batch.id, bucket: 'ON_HAND' }]),
      );
    });

    it('can be scoped to one item/location and rejects malformed ids', async () => {
      const db = createInventoryDb();
      const service = buildInventoryService(db);
      await service.verifyBalances(1, 1);
      expect(db.stockMovement.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { itemId: 1, locationId: 1 } }));
      await expect(service.verifyBalances(0)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listItemOptions', () => {
    it('returns active items with display fields only (no price/description/note)', async () => {
      const db = createInventoryDb();
      db.item.findMany = jest.fn().mockResolvedValue([]);
      await buildInventoryService(db).listItemOptions();
      const args = db.item.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'active' });
      expect(Object.keys(args.select).sort()).toEqual(['code', 'id', 'name', 'unit']);
    });
  });

  describe('getDefaultLocation / listBalances', () => {
    it('reports a missing default warehouse clearly', async () => {
      const db = createInventoryDb();
      db.inventoryLocation.findFirst.mockResolvedValue(null);
      await expect(buildInventoryService(db).getDefaultLocation()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('searches balances by item name/code and paginates on request', async () => {
      const db = createInventoryDb();
      db.stockBalance.findMany = jest.fn().mockResolvedValue([{ id: 1, onHand: new Prisma.Decimal(5), reserved: new Prisma.Decimal(0) }]);
      db.stockBalance.count = jest.fn().mockResolvedValue(21);
      const service = buildInventoryService(db);

      await expect(service.listBalances({ q: 'شیر', locationId: 1 }, { page: 2, pageSize: 20 })).resolves.toEqual({
        items: [{ id: 1, onHand: new Prisma.Decimal(5), reserved: new Prisma.Decimal(0), overCommitted: false }],
        total: 21,
        page: 2,
        pageSize: 20,
      });
      const args = db.stockBalance.findMany.mock.calls[0][0];
      expect(args.where.locationId).toBe(1);
      expect(args.where.item.OR).toHaveLength(2);
      expect(args).toEqual(expect.objectContaining({ skip: 20, take: 20 }));
    });

    it('sorts by available (onHand − reserved) ascending by default — lowest stock first', async () => {
      const db = createInventoryDb();
      db.stockBalance.findMany = jest.fn().mockResolvedValue([
        { id: 1, onHand: new Prisma.Decimal(10), reserved: new Prisma.Decimal(2) }, // available 8
        { id: 2, onHand: new Prisma.Decimal(5), reserved: new Prisma.Decimal(4) }, // available 1
        { id: 3, onHand: new Prisma.Decimal(20), reserved: new Prisma.Decimal(20) }, // available 0
      ]);
      const service = buildInventoryService(db);

      const result = (await service.listBalances({ sort: { sortBy: 'available', sortDir: 'asc' } })) as { id: number }[];
      expect(result.map((row) => row.id)).toEqual([3, 2, 1]);
    });

    it('sorts by available descending on request, and paginates after sorting (not before)', async () => {
      const db = createInventoryDb();
      db.stockBalance.findMany = jest.fn().mockResolvedValue([
        { id: 1, onHand: new Prisma.Decimal(10), reserved: new Prisma.Decimal(2) }, // available 8
        { id: 2, onHand: new Prisma.Decimal(5), reserved: new Prisma.Decimal(4) }, // available 1
        { id: 3, onHand: new Prisma.Decimal(20), reserved: new Prisma.Decimal(20) }, // available 0
      ]);
      const service = buildInventoryService(db);

      const result = (await service.listBalances({ sort: { sortBy: 'available', sortDir: 'desc' } }, { page: 1, pageSize: 2 })) as {
        items: { id: number }[];
        total: number;
      };
      expect(result.items.map((row) => row.id)).toEqual([1, 2]);
      expect(result.total).toBe(3);
    });

    // Build plan §2.3 finding 2: a posted CORRECTION can leave onHand <
    // reserved (available negative) with nothing surfacing it otherwise.
    it('flags overCommitted (available < 0) on every row, without blocking anything', async () => {
      const db = createInventoryDb();
      db.stockBalance.findMany = jest.fn().mockResolvedValue([
        { id: 1, onHand: new Prisma.Decimal(10), reserved: new Prisma.Decimal(2) }, // available 8
        { id: 2, onHand: new Prisma.Decimal(5), reserved: new Prisma.Decimal(8) }, // available -3 (over-committed)
      ]);
      const service = buildInventoryService(db);

      const result = (await service.listBalances()) as { id: number; overCommitted: boolean }[];
      expect(result.find((row) => row.id === 1)!.overCommitted).toBe(false);
      expect(result.find((row) => row.id === 2)!.overCommitted).toBe(true);
    });

    // I3 (B14): lowStockOnly compares *available* (onHand − reserved), not
    // onHand alone — this test deliberately picks a row where the two would
    // disagree (enough onHand to clear the threshold, but reserved eats into
    // it), so a bug that compared onHand instead would pass it incorrectly.
    describe('lowStockOnly (B14)', () => {
      it('includes only rows below their own configured threshold, by available not onHand', async () => {
        const db = createInventoryDb();
        db.itemStockLevel.findMany.mockResolvedValue([
          { itemId: 1, locationId: 1, minQty: new Prisma.Decimal(5) }, // available 3 < 5 → low
          { itemId: 2, locationId: 1, minQty: new Prisma.Decimal(5) }, // available 20 ≥ 5 → not low
          // itemId 3 has no stock row at all but also no threshold here, so it's absent.
        ]);
        db.stockBalance.findMany = jest.fn().mockResolvedValue([
          { id: 1, itemId: 1, locationId: 1, onHand: new Prisma.Decimal(8), reserved: new Prisma.Decimal(5) }, // onHand 8, available 3
          { id: 2, itemId: 2, locationId: 1, onHand: new Prisma.Decimal(20), reserved: new Prisma.Decimal(0) }, // available 20
        ]);
        const service = buildInventoryService(db);

        const result = (await service.listBalances({ lowStockOnly: true })) as { itemId: number }[];
        expect(result.map((row) => row.itemId)).toEqual([1]);
      });

      it('never flags an item+location with no configured threshold', async () => {
        const db = createInventoryDb();
        db.itemStockLevel.findMany.mockResolvedValue([]); // nothing configured
        db.stockBalance.findMany = jest.fn().mockResolvedValue([
          { id: 1, itemId: 1, locationId: 1, onHand: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) },
        ]);
        const service = buildInventoryService(db);

        await expect(service.listBalances({ lowStockOnly: true })).resolves.toEqual([]);
      });

      it('paginates the (bounded) low-stock set after filtering, same as the available-sort branch', async () => {
        const db = createInventoryDb();
        db.itemStockLevel.findMany.mockResolvedValue([
          { itemId: 1, locationId: 1, minQty: new Prisma.Decimal(100) },
          { itemId: 2, locationId: 1, minQty: new Prisma.Decimal(100) },
        ]);
        db.stockBalance.findMany = jest.fn().mockResolvedValue([
          { id: 1, itemId: 1, locationId: 1, onHand: new Prisma.Decimal(1), reserved: new Prisma.Decimal(0) },
          { id: 2, itemId: 2, locationId: 1, onHand: new Prisma.Decimal(2), reserved: new Prisma.Decimal(0) },
        ]);
        const service = buildInventoryService(db);

        const result = (await service.listBalances({ lowStockOnly: true }, { page: 1, pageSize: 1 })) as {
          items: { itemId: number }[];
          total: number;
        };
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(1);
      });
    });
  });

  describe('getStockCard', () => {
    it('404s for an unknown item', async () => {
      const db = createInventoryDb();
      db.item.findUnique = jest.fn().mockResolvedValue(null);
      await expect(buildInventoryService(db).getStockCard(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('orders movements by posting order (id) and computes a running balance per bucket', async () => {
      const db = createInventoryDb();
      db.item.findUnique = jest.fn().mockResolvedValue({ id: 1, code: 'ITM1', name: 'شیر', status: 'active', itemKind: 'FINISHED_GOOD', unit: { id: 1, nameFa: 'لیتر' } });
      await db.$transaction((tx: never) =>
        applyMovements(tx, [
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'OPENING_BALANCE', quantity: 10, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 1 },
        ]),
      );
      await db.$transaction((tx: never) =>
        applyMovements(tx, [
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'ADJUSTMENT_OUT', quantity: -3, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 2 },
          { itemId: 1, locationId: 1, bucket: 'RESERVED', movementType: 'RESERVE', quantity: 2, movementDate: new Date(), referenceType: 'SALES_ORDER', referenceId: 5 },
        ]),
      );

      const card = await buildInventoryService(db).getStockCard(1);
      expect(card.item).toEqual(expect.objectContaining({ id: 1, code: 'ITM1' }));
      expect(card.rows).toHaveLength(3);
      expect(card.rows[0].balanceAfter).toEqual({ onHand: '10', reserved: '0', qc: '0' });
      expect(card.rows[2].balanceAfter).toEqual({ onHand: '7', reserved: '2', qc: '0' });
    });
  });

  // I4 (build plan §5.4/§16 resume step 7): the batch picker/expiry view.
  describe('listItemBatches', () => {
    it('404s for an unknown item', async () => {
      const db = createInventoryDb();
      db.item.findUnique = jest.fn().mockResolvedValue(null);
      await expect(buildInventoryService(db).listItemBatches(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns an empty list for an item with no batches', async () => {
      const db = createInventoryDb();
      const result = await buildInventoryService(db).listItemBatches(1);
      expect(result).toEqual(expect.objectContaining({ batches: [] }));
    });

    it('lists every batch with stock, flags an expired one, and sorts by expiry ascending', async () => {
      const db = createInventoryDb();
      const late = seedBatch(db, { itemId: 1, batchNumber: 'LATE', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 4 });
      const early = seedBatch(db, { itemId: 1, batchNumber: 'EARLY', expiryDate: new Date('2026-01-01T00:00:00.000Z'), onHand: 2, qc: 1 });

      const result = await buildInventoryService(db).listItemBatches(1);
      expect(result.batches).toEqual([
        expect.objectContaining({ batchId: early.id, batchNumber: 'EARLY', onHand: '2', qc: '1', isExpired: true }),
        expect.objectContaining({ batchId: late.id, batchNumber: 'LATE', onHand: '4', qc: '0', isExpired: false }),
      ]);
    });

    it('filters to one location when requested', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'MAIN', onHand: 1, locationId: 1 });
      seedBatch(db, { itemId: 1, batchNumber: 'OTHER', onHand: 1, locationId: 2 });
      const result = await buildInventoryService(db).listItemBatches(1, 2);
      expect(result.batches.map((b) => b.batchNumber)).toEqual(['OTHER']);
    });
  });

  describe('listMovements', () => {
    it('filters by item/location/type/reference and paginates on request', async () => {
      const db = createInventoryDb();
      await db.$transaction((tx: never) =>
        applyMovements(tx, [
          { itemId: 1, locationId: 1, bucket: 'ON_HAND', movementType: 'OPENING_BALANCE', quantity: 10, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 1 },
          { itemId: 2, locationId: 1, bucket: 'ON_HAND', movementType: 'OPENING_BALANCE', quantity: 4, movementDate: new Date(), referenceType: 'STOCK_ADJUSTMENT', referenceId: 2 },
        ]),
      );
      const service = buildInventoryService(db);

      const all = await service.listMovements();
      expect(all).toHaveLength(2);

      const filtered = await service.listMovements({ itemId: 1 });
      expect(filtered).toHaveLength(1);

      const paged = (await service.listMovements({}, { page: 1, pageSize: 1 })) as { items: unknown[]; total: number };
      expect(paged.items).toHaveLength(1);
      expect(paged.total).toBe(2);
    });
  });
});

// I5 (B15): StockMovement.unitCost is cost data (inventory.cost). The
// stock card and movement browser are inventory.view reads — they must ask
// Prisma to omit it, never return it.
describe('InventoryService — unitCost never leaves the inventory.view reads (I5)', () => {
  it('getStockCard and listMovements both omit unitCost', async () => {
    const db = createInventoryDb();
    const service = buildInventoryService(db);
    await service.getStockCard(1);
    await service.listMovements({});
    for (const call of db.stockMovement.findMany.mock.calls) {
      expect(call[0].omit).toEqual({ unitCost: true });
    }
    expect(db.stockMovement.findMany).toHaveBeenCalledTimes(2);
  });
});

// Location (warehouse) admin — plain master-data CRUD, no stock-ledger
// involvement, so a lightweight flat Prisma mock is enough (same style as
// StockLevelsService's own spec) rather than the heavy stock-ledger fake
// above.
type FakeLocation = { id: number; code: string; name: string; isActive: boolean; isDefault: boolean; note: string | null };

function createLocationsPrismaMock(seed: FakeLocation[] = []) {
  const state = { locations: seed.map((location) => ({ ...location })), nextId: seed.length + 1 };
  const prisma: Record<string, unknown> = {
    inventoryLocation: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => state.locations.find((location) => location.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { code: string; NOT?: { id: number } } }) => {
        return (
          state.locations.find((location) => location.code === where.code && (where.NOT === undefined || location.id !== where.NOT.id)) ?? null
        );
      }),
      create: jest.fn(async ({ data }: { data: Omit<FakeLocation, 'id'> }) => {
        const row: FakeLocation = { id: state.nextId++, ...data };
        state.locations.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Partial<FakeLocation> }) => {
        const row = state.locations.find((location) => location.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { isDefault: boolean }; data: Partial<FakeLocation> }) => {
        const matched = state.locations.filter((location) => location.isDefault === where.isDefault);
        matched.forEach((location) => Object.assign(location, data));
        return { count: matched.length };
      }),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  return { prisma, state };
}

function buildLocationsService(prisma: unknown) {
  return new InventoryService(prisma as never, new AuditService(prisma as never));
}

const MAIN: FakeLocation = { id: 1, code: 'MAIN', name: 'انبار مرکزی', isActive: true, isDefault: true, note: null };

describe('InventoryService — location (warehouse) admin', () => {
  describe('createLocation', () => {
    it('creates a non-default location', async () => {
      const { prisma, state } = createLocationsPrismaMock([MAIN]);
      const result = await buildLocationsService(prisma).createLocation({ code: 'BR1', name: 'شعبه ۱', isActive: true, isDefault: false, note: null }, 1);
      expect(result).toEqual(expect.objectContaining({ code: 'BR1', isDefault: false }));
      expect(state.locations).toHaveLength(2);
      expect((prisma as any).auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a duplicate code', async () => {
      const { prisma } = createLocationsPrismaMock([MAIN]);
      await expect(
        buildLocationsService(prisma).createLocation({ code: 'MAIN', name: 'انبار دوم', isActive: true, isDefault: false, note: null }, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an inactive default', async () => {
      const { prisma } = createLocationsPrismaMock([MAIN]);
      await expect(
        buildLocationsService(prisma).createLocation({ code: 'BR1', name: 'شعبه ۱', isActive: false, isDefault: true, note: null }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a new default unsets the previous one', async () => {
      const { prisma, state } = createLocationsPrismaMock([MAIN]);
      await buildLocationsService(prisma).createLocation({ code: 'BR1', name: 'شعبه ۱', isActive: true, isDefault: true, note: null }, 1);
      const main = state.locations.find((location) => location.code === 'MAIN')!;
      const branch = state.locations.find((location) => location.code === 'BR1')!;
      expect(main.isDefault).toBe(false);
      expect(branch.isDefault).toBe(true);
    });
  });

  describe('updateLocation', () => {
    it('throws NotFoundException for a missing id', async () => {
      const { prisma } = createLocationsPrismaMock([MAIN]);
      await expect(
        buildLocationsService(prisma).updateLocation(999, { code: 'X', name: 'X', isActive: true, isDefault: false, note: null }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to unset the current default directly', async () => {
      const { prisma } = createLocationsPrismaMock([MAIN]);
      await expect(
        buildLocationsService(prisma).updateLocation(1, { code: 'MAIN', name: 'انبار مرکزی', isActive: true, isDefault: false, note: null }, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('making a different location default atomically clears the old one', async () => {
      const { prisma, state } = createLocationsPrismaMock([MAIN, { id: 2, code: 'BR1', name: 'شعبه ۱', isActive: true, isDefault: false, note: null }]);
      await buildLocationsService(prisma).updateLocation(2, { code: 'BR1', name: 'شعبه ۱', isActive: true, isDefault: true, note: null }, 1);
      const main = state.locations.find((location) => location.id === 1)!;
      const branch = state.locations.find((location) => location.id === 2)!;
      expect(main.isDefault).toBe(false);
      expect(branch.isDefault).toBe(true);
    });

    it('rejects a duplicate code from another location', async () => {
      const { prisma } = createLocationsPrismaMock([MAIN, { id: 2, code: 'BR1', name: 'شعبه ۱', isActive: true, isDefault: false, note: null }]);
      await expect(
        buildLocationsService(prisma).updateLocation(2, { code: 'MAIN', name: 'شعبه ۱', isActive: true, isDefault: false, note: null }, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows keeping its own unchanged code', async () => {
      const { prisma, state } = createLocationsPrismaMock([MAIN]);
      const result = await buildLocationsService(prisma).updateLocation(1, { code: 'MAIN', name: 'انبار اصلی', isActive: true, isDefault: true, note: 'یادداشت' }, 1);
      expect(result).toEqual(expect.objectContaining({ name: 'انبار اصلی', note: 'یادداشت' }));
      expect(state.locations[0].name).toBe('انبار اصلی');
    });
  });
});
