import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { createStockAdjustmentSchema, updateStockAdjustmentSchema } from './dto/inventory.dto';
import { ADJ_DATE, balanceOf, buildStockAdjustmentsService, createInventoryDb, draftAdjustment, seedStock, VERSION, type InventoryDb } from './inventory.spec-helpers';

// StockAdjustmentsService — DRAFT CRUD and DRAFT → POSTED. Posting is checked
// against the in-memory fake (real rollback semantics), so "a failed post
// writes no movement and burns no number" is asserted on state.

// The draft is returned by findUnique on every read (the post lock read and
// the final get()); after posting, reflect the update so get() sees POSTED.
function mockDraft(db: InventoryDb, draft = draftAdjustment()) {
  let current: any = draft;
  db.stockAdjustment.findUnique.mockImplementation(async () => current);
  db.stockAdjustment.update.mockImplementation(async ({ data }: any) => {
    current = { ...current, ...data };
    return current;
  });
}

const createDto = {
  kind: 'RECEIPT' as const,
  adjustmentDate: ADJ_DATE,
  reason: 'رسید اولیه',
  items: [{ itemId: 1, quantity: 10 }],
};

describe('StockAdjustmentsService', () => {
  describe('create', () => {
    it('creates a DRAFT with no number on the default warehouse and audits it in the same transaction', async () => {
      const db = createInventoryDb();
      db.stockAdjustment.create.mockResolvedValue({ id: 7, kind: 'RECEIPT' });

      await buildStockAdjustmentsService(db).create(createDto as never, 3, '127.0.0.1');

      const data = db.stockAdjustment.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'DRAFT', locationId: 1, createdByUserId: 3, kind: 'RECEIPT' }));
      expect(data.adjustmentNumber).toBeUndefined();
      expect(data.items.create).toEqual([{ itemId: 1, quantity: 10, note: undefined }]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_CREATED', entityType: 'StockAdjustment', entityId: '7' }) });
      // Creating a draft never touches stock.
      expect(db.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('rejects an inactive or unknown item and an inactive location', async () => {
      const db = createInventoryDb();
      const service = buildStockAdjustmentsService(db);

      db.item.findMany.mockResolvedValueOnce([{ id: 1, status: 'inactive', name: 'شیر' }]);
      await expect(service.create(createDto as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.item.findMany.mockResolvedValueOnce([]);
      await expect(service.create(createDto as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.inventoryLocation.findUnique.mockResolvedValueOnce({ isActive: false });
      await expect(service.create({ ...createDto, locationId: 2 } as never, 3)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.stockAdjustment.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('replaces the lines of a DRAFT with a compare-and-set on updatedAt + status', async () => {
      const db = createInventoryDb();
      mockDraft(db);

      await buildStockAdjustmentsService(db).update(7, { ...createDto, updatedAt: VERSION } as never, 3);

      expect(db.stockAdjustment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.stockAdjustmentItem.deleteMany).toHaveBeenCalledWith({ where: { stockAdjustmentId: 7 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_UPDATED' }) });
    });

    it('refuses to edit a POSTED adjustment', async () => {
      const db = createInventoryDb();
      mockDraft(db, draftAdjustment({ status: 'POSTED', adjustmentNumber: 'ADJ-1405-000001' }));
      await expect(buildStockAdjustmentsService(db).update(7, { ...createDto, updatedAt: VERSION } as never, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.stockAdjustmentItem.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses a stale version (RECORD_MODIFIED), up front and when lost inside the transaction', async () => {
      const db = createInventoryDb();
      mockDraft(db);
      const service = buildStockAdjustmentsService(db);
      await expect(service.update(7, { ...createDto, updatedAt: new Date('2020-01-01') } as never, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });

      db.stockAdjustment.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.update(7, { ...createDto, updatedAt: VERSION } as never, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.stockAdjustmentItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('locks the draft, claims ADJ-<jalali year>-000001, writes one movement per line, marks POSTED and audits', async () => {
      const db = createInventoryDb();
      mockDraft(db);

      const result = await buildStockAdjustmentsService(db).post(7, VERSION, 3, '127.0.0.1');

      const [lockSql] = db.$queryRaw.mock.calls[0];
      expect((lockSql as string[]).join('?')).toContain('FROM stock_adjustments WHERE id = ? FOR UPDATE');
      expect(db.stockAdjustment.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ status: 'POSTED', adjustmentNumber: 'ADJ-1405-000001', postedByUserId: 3, postedAt: expect.any(Date) }),
      });
      expect(result).toEqual(expect.objectContaining({ status: 'POSTED', adjustmentNumber: 'ADJ-1405-000001' }));
      expect(balanceOf(db, 1)?.onHand).toBe('10');
      expect(balanceOf(db, 2)?.onHand).toBe('5');
      expect(db.state.movements).toEqual([
        expect.objectContaining({ itemId: 1, movementType: 'MANUAL_RECEIPT', referenceType: 'STOCK_ADJUSTMENT', referenceId: 7, referenceLineId: 71, referenceNumber: 'ADJ-1405-000001', createdByUserId: 3, movementDate: ADJ_DATE }),
        expect.objectContaining({ itemId: 2, movementType: 'MANUAL_RECEIPT', referenceLineId: 72 }),
      ]);
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_POSTED', entityId: '7', details: expect.stringContaining('ADJ-1405-000001') }),
      });
    });

    it('maps OPENING → OPENING_BALANCE and signed CORRECTION lines → ADJUSTMENT_IN / ADJUSTMENT_OUT', async () => {
      const db = createInventoryDb();
      seedStock(db, 2, 5);
      mockDraft(
        db,
        draftAdjustment({
          kind: 'CORRECTION',
          items: [
            { id: 81, itemId: 1, quantity: new Prisma.Decimal(4), note: null },
            { id: 82, itemId: 2, quantity: new Prisma.Decimal(-1.5), note: 'شکستگی' },
          ],
        }),
      );
      await buildStockAdjustmentsService(db).post(7, VERSION, 3);
      const posted = db.state.movements.slice(1);
      expect(posted.map((m: any) => m.movementType)).toEqual(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT']);
      expect(posted[1].quantity.toString()).toBe('-1.5');
      expect(balanceOf(db, 2)?.onHand).toBe('3.5');

      const db2 = createInventoryDb();
      mockDraft(db2, draftAdjustment({ kind: 'OPENING' }));
      await buildStockAdjustmentsService(db2).post(7, VERSION, 3);
      expect(db2.state.movements.every((m: any) => m.movementType === 'OPENING_BALANCE')).toBe(true);
    });

    it('a post that would take stock negative fails as a whole: no movement, no balance change, no status change, and NO number burned', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 2);
      mockDraft(db, draftAdjustment({ kind: 'CORRECTION', items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(-3), note: null }] }));
      const service = buildStockAdjustmentsService(db);

      await expect(service.post(7, VERSION, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
      expect(balanceOf(db, 1)?.onHand).toBe('2');
      expect(db.state.movements).toHaveLength(1);
      expect(db.stockAdjustment.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
      // The sequence increment was rolled back with the transaction (gap-free).
      expect(db.state.sequences.get('ADJ:1405')).toBeUndefined();

      // The next successful post therefore still gets 000001.
      mockDraft(db, draftAdjustment({ id: 8 }));
      await expect(service.post(8, VERSION, 3)).resolves.toEqual(expect.objectContaining({ adjustmentNumber: 'ADJ-1405-000001' }));
    });

    it('two posts get consecutive, distinct numbers (the counter row lock serializes them)', async () => {
      const db = createInventoryDb();
      const service = buildStockAdjustmentsService(db);
      mockDraft(db, draftAdjustment({ id: 7 }));
      const first = await service.post(7, VERSION, 3);
      mockDraft(db, draftAdjustment({ id: 8 }));
      const second = await service.post(8, VERSION, 3);
      expect([first.adjustmentNumber, second.adjustmentNumber]).toEqual(['ADJ-1405-000001', 'ADJ-1405-000002']);
    });

    it('refuses to post twice, a stale version, or a missing adjustment — without claiming a number', async () => {
      const db = createInventoryDb();
      const service = buildStockAdjustmentsService(db);

      mockDraft(db, draftAdjustment({ status: 'POSTED', adjustmentNumber: 'ADJ-1405-000001' }));
      await expect(service.post(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException);

      mockDraft(db);
      await expect(service.post(7, new Date('2020-01-01'), 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });

      db.stockAdjustment.findUnique.mockResolvedValue(null);
      await expect(service.post(7, VERSION, 3)).rejects.toBeInstanceOf(NotFoundException);

      expect(db.state.sequences.size).toBe(0);
      expect(db.state.movements).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (lines cascade) and audits', async () => {
      const db = createInventoryDb();
      mockDraft(db);
      await expect(buildStockAdjustmentsService(db).remove(7, 3)).resolves.toEqual({ success: true });
      expect(db.stockAdjustment.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_DELETED' }) });
    });

    it('never deletes a POSTED adjustment', async () => {
      const db = createInventoryDb();
      mockDraft(db, draftAdjustment({ status: 'POSTED', adjustmentNumber: 'ADJ-1405-000001' }));
      await expect(buildStockAdjustmentsService(db).remove(7, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.stockAdjustment.delete).not.toHaveBeenCalled();
    });
  });
});

describe('stock adjustment DTOs', () => {
  const base = { kind: 'RECEIPT', adjustmentDate: '2026-10-06', reason: 'رسید', items: [{ itemId: 1, quantity: '10' }] };

  it('accepts a valid receipt and coerces numeric strings', () => {
    const result = createStockAdjustmentSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0].quantity).toBe(10);
  });

  it('OPENING / RECEIPT lines must be positive; CORRECTION lines may be negative', () => {
    expect(createStockAdjustmentSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: -1 }] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'OPENING', items: [{ itemId: 1, quantity: -1 }] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'CORRECTION', items: [{ itemId: 1, quantity: -1.25 }] }).success).toBe(true);
  });

  it('rejects zero, more than two decimals, missing reason, no lines, and an unknown kind', () => {
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'CORRECTION', items: [{ itemId: 1, quantity: 0 }] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: 1.005 }] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, reason: '  ' }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'SALE' }).success).toBe(false);
  });

  it('never accepts a client-supplied adjustment number or status', () => {
    const result = createStockAdjustmentSchema.safeParse({ ...base, adjustmentNumber: 'ADJ-1405-999999', status: 'POSTED' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('adjustmentNumber');
      expect(result.data).not.toHaveProperty('status');
    }
  });

  it('update requires the loaded version', () => {
    expect(updateStockAdjustmentSchema.safeParse(base).success).toBe(false);
    expect(updateStockAdjustmentSchema.safeParse({ ...base, updatedAt: VERSION.toISOString() }).success).toBe(true);
  });
});
