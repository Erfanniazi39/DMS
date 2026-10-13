import { Prisma } from '@prisma/client';
import { buildInventoryReportsService, createInventoryDb, seedBatch, seedStock, setBucket } from './inventory.spec-helpers';

const ASOF = new Date('2026-10-10T00:00:00.000Z');

describe('InventoryReportsService', () => {
  describe('lowStockSummary (B14)', () => {
    it('returns nothing when no item+location has a configured threshold', async () => {
      const db = createInventoryDb();
      db.itemStockLevel.findMany.mockResolvedValue([]);
      await expect(buildInventoryReportsService(db).lowStockSummary()).resolves.toEqual([]);
    });

    // The core B14 assertion: compares *available* (onHand − reserved), not
    // onHand — an item with plenty on hand but fully reserved is still low.
    it('flags an item whose available is below minQty even though onHand alone would clear it', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10); // onHand 10
      setBucket(db, 1, 'RESERVED', 7); // available 3
      db.itemStockLevel.findMany.mockResolvedValue([
        {
          id: 1,
          itemId: 1,
          locationId: 1,
          minQty: new Prisma.Decimal(5),
          reorderQty: null,
          maxQty: null,
          item: { id: 1, code: 'ITM1', name: 'کالا ۱', status: 'active', unit: { id: 1, nameFa: 'عدد' } },
          location: { id: 1, code: 'MAIN', name: 'انبار مرکزی' },
        },
      ]);

      const result = await buildInventoryReportsService(db).lowStockSummary();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({ itemId: 1, locationId: 1, available: '3', minQty: '5', shortfall: '2' }),
      );
    });

    it('does not flag an item whose available meets or exceeds minQty', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10); // available 10, no reservation
      db.itemStockLevel.findMany.mockResolvedValue([
        {
          id: 1,
          itemId: 1,
          locationId: 1,
          minQty: new Prisma.Decimal(10),
          reorderQty: null,
          maxQty: null,
          item: { id: 1, code: 'ITM1', name: 'کالا ۱', status: 'active', unit: { id: 1, nameFa: 'عدد' } },
          location: { id: 1, code: 'MAIN', name: 'انبار مرکزی' },
        },
      ]);
      await expect(buildInventoryReportsService(db).lowStockSummary()).resolves.toEqual([]);
    });

    // An item with a configured threshold but zero movement history ever —
    // available defaults to zero, which is still "below" any minQty > 0.
    it('flags a configured item that has never had a stock movement (available defaults to zero)', async () => {
      const db = createInventoryDb();
      db.itemStockLevel.findMany.mockResolvedValue([
        {
          id: 9,
          itemId: 99,
          locationId: 1,
          minQty: new Prisma.Decimal(1),
          reorderQty: new Prisma.Decimal(20),
          maxQty: new Prisma.Decimal(50),
          item: { id: 99, code: 'ITM99', name: 'کالای جدید', status: 'active', unit: { id: 1, nameFa: 'عدد' } },
          location: { id: 1, code: 'MAIN', name: 'انبار مرکزی' },
        },
      ]);

      const result = await buildInventoryReportsService(db).lowStockSummary();
      expect(result).toEqual([
        expect.objectContaining({ itemId: 99, available: '0', minQty: '1', reorderQty: '20', maxQty: '50' }),
      ]);
    });

    it('scopes to one location when requested', async () => {
      const db = createInventoryDb();
      await buildInventoryReportsService(db).lowStockSummary({ locationId: 2 });
      expect(db.itemStockLevel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: 2 } }));
    });
  });

  // I4 (build plan §5.4/§16 resume step 7).
  describe('expiryReport (I4)', () => {
    it('excludes an undated batch (no expiryDate) entirely', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'NO_DATE', onHand: 5 });
      await expect(buildInventoryReportsService(db).expiryReport({}, ASOF)).resolves.toEqual([]);
    });

    it('excludes a batch with zero stock everywhere (ON_HAND and QC both zero)', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'EMPTY', expiryDate: new Date('2026-11-01T00:00:00.000Z'), onHand: 0, qc: 0 });
      await expect(buildInventoryReportsService(db).expiryReport({}, ASOF)).resolves.toEqual([]);
    });

    it('counts QC stock, not just ON_HAND', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'QC_ONLY', expiryDate: new Date('2026-10-20T00:00:00.000Z'), onHand: 0, qc: 2 });
      const result = await buildInventoryReportsService(db).expiryReport({}, ASOF);
      expect(result).toEqual([expect.objectContaining({ batchNumber: 'QC_ONLY', onHand: '0', qc: '2', isExpired: false })]);
    });

    it('excludes an already-expired batch by default; includeExpired brings it back', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'EXPIRED', expiryDate: new Date('2026-10-01T00:00:00.000Z'), onHand: 3 });
      await expect(buildInventoryReportsService(db).expiryReport({}, ASOF)).resolves.toEqual([]);

      const result = await buildInventoryReportsService(db).expiryReport({ includeExpired: true }, ASOF);
      expect(result).toEqual([expect.objectContaining({ batchNumber: 'EXPIRED', isExpired: true, daysUntilExpiry: -9 })]);
    });

    it('withinDays excludes a batch expiring further out, but an already-expired one always passes', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 1, batchNumber: 'SOON', expiryDate: new Date('2026-10-15T00:00:00.000Z'), onHand: 2 }); // 5 days out
      seedBatch(db, { itemId: 1, batchNumber: 'LATER', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 2 }); // far out
      seedBatch(db, { itemId: 1, batchNumber: 'EXPIRED', expiryDate: new Date('2026-09-01T00:00:00.000Z'), onHand: 2 });

      const result = await buildInventoryReportsService(db).expiryReport({ withinDays: 7, includeExpired: true }, ASOF);
      expect(result.map((row) => row.batchNumber)).toEqual(['EXPIRED', 'SOON']);
    });

    it('sorts by expiry date ascending, and attaches the item’s display info', async () => {
      const db = createInventoryDb();
      seedBatch(db, { itemId: 7, batchNumber: 'LATE', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 1 });
      seedBatch(db, { itemId: 7, batchNumber: 'EARLY', expiryDate: new Date('2026-10-20T00:00:00.000Z'), onHand: 1 });

      const result = await buildInventoryReportsService(db).expiryReport({}, ASOF);
      expect(result.map((row) => row.batchNumber)).toEqual(['EARLY', 'LATE']);
      expect(result[0].item).toEqual(expect.objectContaining({ id: 7, name: 'کالا 7' }));
    });
  });
});
