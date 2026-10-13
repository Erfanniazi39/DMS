import { ConflictException, NotFoundException } from '@nestjs/common';
import { upsertInventoryItemSettingSchema } from './dto/item-setting.dto';
import { buildInventoryItemSettingsService, createInventoryDb, seedStock, setBucket, trackItem } from './inventory.spec-helpers';

// InventoryItemSettingsService (I4, build plan §5.4/§5.4a, §16 resume step 5):
// per-item batch/expiry configuration. batchTracked false→true is a plain
// field edit ONLY when the item has zero stock (onHand AND qc) everywhere —
// otherwise it must go through BATCH_CUTOVER (StockAdjustmentsService).
// batchTracked true→false is always refused; cutover is one-way in I4.

const ACTOR = { userId: 4, ipAddress: '127.0.0.1' };

describe('InventoryItemSettingsService', () => {
  describe('get', () => {
    it('defaults to untracked, expiry not required, no shelf life, for an item with no settings row', async () => {
      const db = createInventoryDb();
      const result = await buildInventoryItemSettingsService(db).get(1);
      expect(result).toEqual(
        expect.objectContaining({ batchTracked: false, expiryRequired: false, shelfLifeDays: null, batchTrackedSince: null }),
      );
    });

    it('throws when the item does not exist', async () => {
      const db = createInventoryDb();
      db.item.findUnique = jest.fn().mockResolvedValue(null);
      await expect(buildInventoryItemSettingsService(db).get(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('upsert — turning batchTracked on', () => {
    it('allowed when the item has zero stock everywhere (ON_HAND and QC both zero)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 0);
      const service = buildInventoryItemSettingsService(db);

      const result = await service.upsert(1, { expiryRequired: true, shelfLifeDays: 30, batchTracked: true }, ACTOR.userId, ACTOR.ipAddress);

      expect(result).toEqual(expect.objectContaining({ batchTracked: true, expiryRequired: true, shelfLifeDays: 30 }));
      expect(result.batchTrackedSince).toBeInstanceOf(Date);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'INVENTORY_ITEM_SETTING_CREATED' }) });
    });

    it('allowed when the item has no balance row at all (never had stock)', async () => {
      const db = createInventoryDb();
      const result = await buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: true }, ACTOR.userId);
      expect(result.batchTracked).toBe(true);
    });

    it('refused (409 STOCK_NONZERO) when the item has ON_HAND stock — points at BATCH_CUTOVER', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      await expect(
        buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: true }, ACTOR.userId),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STOCK_NONZERO' }) });
      // Nothing was written.
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
    });

    it('refused (409 STOCK_NONZERO) when the item has QC stock, even with zero ON_HAND', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 0);
      setBucket(db, 1, 'QC', 3);
      await expect(
        buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: true }, ACTOR.userId),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STOCK_NONZERO' }) });
    });

    it('sums stock across every location before deciding (zero at location 1, stock at location 2 still blocks it)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 0, 1);
      seedStock(db, 1, 5, 2);
      await expect(
        buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: true }, ACTOR.userId),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STOCK_NONZERO' }) });
    });
  });

  describe('upsert — turning batchTracked off', () => {
    it('always refused once an item is tracked — cutover is one-way in I4', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      await expect(
        buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: false }, ACTOR.userId),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: false, shelfLifeDays: null, batchTracked: false }, ACTOR.userId),
      ).rejects.toThrow('یک‌طرفه');
    });

    it('omitting batchTracked leaves the current tracked state untouched (no accidental turn-off)', async () => {
      const db = createInventoryDb();
      trackItem(db, 1, { expiryRequired: false });
      const result = await buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: true, shelfLifeDays: null }, ACTOR.userId);
      expect(result.batchTracked).toBe(true);
      expect(result.expiryRequired).toBe(true);
    });
  });

  describe('upsert — plain config edits (expiryRequired / shelfLifeDays), editable anytime', () => {
    it('edits expiryRequired/shelfLifeDays on an untracked item without touching batchTracked', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10); // stock present — would block turning tracking ON, but no such request is made here
      const result = await buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: true, shelfLifeDays: 14 }, ACTOR.userId);
      expect(result).toEqual(expect.objectContaining({ batchTracked: false, expiryRequired: true, shelfLifeDays: 14 }));
    });

    it('edits expiryRequired/shelfLifeDays on an already-tracked item, keeping it tracked', async () => {
      const db = createInventoryDb();
      trackItem(db, 1, { expiryRequired: false, shelfLifeDays: null });
      const result = await buildInventoryItemSettingsService(db).upsert(1, { expiryRequired: true, shelfLifeDays: 60, batchTracked: true }, ACTOR.userId);
      expect(result).toEqual(expect.objectContaining({ batchTracked: true, expiryRequired: true, shelfLifeDays: 60 }));
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'INVENTORY_ITEM_SETTING_UPDATED' }) });
    });
  });
});

describe('upsertInventoryItemSettingSchema (DTO)', () => {
  it('accepts expiryRequired alone, batchTracked optional', () => {
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false }).success).toBe(true);
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: true, batchTracked: true }).success).toBe(true);
  });

  it('shelfLifeDays must be a positive integer or null/empty', () => {
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false, shelfLifeDays: 30 }).success).toBe(true);
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false, shelfLifeDays: null }).success).toBe(true);
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false, shelfLifeDays: 0 }).success).toBe(false);
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false, shelfLifeDays: -5 }).success).toBe(false);
    expect(upsertInventoryItemSettingSchema.safeParse({ expiryRequired: false, shelfLifeDays: 1.5 }).success).toBe(false);
  });
});
