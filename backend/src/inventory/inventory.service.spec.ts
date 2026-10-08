import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { applyMovements } from './stock-ledger';
import { buildInventoryService, createInventoryDb, seedStock, setBucket } from './inventory.spec-helpers';

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
      await expect(buildInventoryService(db).verifyBalances()).resolves.toEqual({ ok: true, mismatches: [] });
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
      db.stockBalance.findMany = jest.fn().mockResolvedValue([{ id: 1 }]);
      db.stockBalance.count = jest.fn().mockResolvedValue(21);
      const service = buildInventoryService(db);

      await expect(service.listBalances({ q: 'شیر', locationId: 1 }, { page: 2, pageSize: 20 })).resolves.toEqual({ items: [{ id: 1 }], total: 21, page: 2, pageSize: 20 });
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

      const result = (await service.listBalances({ sortBy: 'available' })) as { id: number }[];
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

      const result = (await service.listBalances({ sortBy: 'available', sortDir: 'desc' }, { page: 1, pageSize: 2 })) as {
        items: { id: number }[];
        total: number;
      };
      expect(result.items.map((row) => row.id)).toEqual([1, 2]);
      expect(result.total).toBe(3);
    });
  });
});
