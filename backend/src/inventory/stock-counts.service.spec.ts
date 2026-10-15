import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { createStockCountSchema } from './dto/stock-count.dto';
import { StockCountsController } from './stock-counts.controller';
import {
  ADJ_DATE,
  balanceOf,
  buildStockCountsService,
  createInventoryDb,
  seedMovementAt,
  seedStock,
  VERSION,
  type InventoryDb,
} from './inventory.spec-helpers';

// StockCountsService (Inventory batch I6, build plan §5.6/§6, B13 — the
// architect's documented default adopted, not yet confirmed by the business
// owner): DRAFT → COUNTING (start, systemQty snapshot) → REVIEW (submit) →
// POSTED (approve, COUNT_GAIN/COUNT_LOSS) or CANCELLED. Blind entry,
// no-self-approval, stale-line detection + recount.

const APPROVER = { canSeeSystemQty: true };
const COUNTER = { canSeeSystemQty: false };

function countItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 201,
    stockCountId: 50,
    itemId: 1,
    batchId: null,
    systemQty: null,
    countedQty: null,
    varianceQty: null,
    reasonCode: null,
    recountCount: 0,
    countedByUserId: null,
    note: null,
    ...overrides,
  };
}

function draftCount(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    countNumber: null,
    locationId: 1,
    location: { isActive: true },
    countDate: ADJ_DATE,
    scope: 'PARTIAL',
    isBlind: true,
    status: 'DRAFT',
    startedAt: null,
    startedByUserId: null,
    submittedAt: null,
    submittedByUserId: null,
    postedAt: null,
    postedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    note: null,
    updatedAt: VERSION,
    items: [countItem({ id: 201, itemId: 1 }), countItem({ id: 202, itemId: 2 })],
    ...overrides,
  };
}

// findUnique always answers the current document; update/stockCountItem
// .update/.createMany mutate it so a later get() sees the latest state —
// same convention as goods-receipts.service.spec.ts's mockReceipt().
function mockCount(db: InventoryDb, count: any = draftCount()) {
  let current: any = count;
  db.stockCount.findUnique.mockImplementation(async () => current);
  db.stockCount.update.mockImplementation(async ({ data }: any) => {
    const { items: _nested, ...scalars } = data;
    current = { ...current, ...scalars };
    return current;
  });
  db.stockCountItem.update.mockImplementation(async ({ where, data }: any) => {
    current = {
      ...current,
      items: current.items.map((row: any) => {
        if (row.id !== where.id) return row;
        const next = { ...row, ...data };
        if (data.recountCount?.increment !== undefined) next.recountCount = row.recountCount + data.recountCount.increment;
        return next;
      }),
    };
    return current.items.find((row: any) => row.id === where.id);
  });
  db.stockCountItem.createMany.mockImplementation(async ({ data }: any) => {
    const created = data.map((row: any, index: number) => ({
      id: 900 + index,
      stockCountId: current.id,
      batchId: null,
      countedQty: null,
      varianceQty: null,
      reasonCode: null,
      recountCount: 0,
      countedByUserId: null,
      note: null,
      ...row,
    }));
    current = { ...current, items: [...current.items, ...created] };
    return { count: created.length };
  });
  return () => current;
}

const createDto = {
  countDate: ADJ_DATE,
  scope: 'PARTIAL' as const,
  isBlind: true,
  items: [{ itemId: 1 }, { itemId: 2 }],
};

describe('StockCountsService', () => {
  describe('create', () => {
    it('creates a DRAFT with no number, PARTIAL lines, and audits', async () => {
      const db = createInventoryDb();
      db.stockCount.create.mockResolvedValue({ id: 50, items: [] });

      await buildStockCountsService(db).create(createDto as never, 3, '127.0.0.1');

      const data = db.stockCount.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'DRAFT', locationId: 1, scope: 'PARTIAL', isBlind: true, createdByUserId: 3 }));
      expect(data.items.create).toEqual([{ itemId: 1, batchId: null, note: null }, { itemId: 2, batchId: null, note: null }]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_CREATED', entityType: 'StockCount', entityId: '50' }) });
    });

    it('DTO: PARTIAL requires at least one item, FULL rejects any item, and a duplicate (item, batch) pair is rejected', () => {
      expect(createStockCountSchema.safeParse({ ...createDto, items: [] }).success).toBe(false);
      expect(createStockCountSchema.safeParse({ countDate: ADJ_DATE, scope: 'FULL', items: [{ itemId: 1 }] }).success).toBe(false);
      expect(createStockCountSchema.safeParse({ countDate: ADJ_DATE, scope: 'FULL', items: [] }).success).toBe(true);
      expect(createStockCountSchema.safeParse({ ...createDto, items: [{ itemId: 1 }, { itemId: 1 }] }).success).toBe(false);
    });

    it('rejects an inactive item and a batch that belongs to a different item', async () => {
      const db = createInventoryDb();
      const service = buildStockCountsService(db);
      db.item.findMany.mockResolvedValueOnce([{ id: 1, status: 'inactive', name: 'کالای غیرفعال', itemKind: 'FINISHED_GOOD' }]);
      await expect(service.create({ ...createDto, items: [{ itemId: 1 }] } as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.stockBatch.findMany.mockResolvedValueOnce([{ id: 9, itemId: 2 }]);
      await expect(service.create({ ...createDto, items: [{ itemId: 1, batchId: 9 }] } as never, 3)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('start', () => {
    it('FULL scope: enumerates every item with a balance row at the location and snapshots systemQty', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      seedStock(db, 2, 4);
      mockCount(db, draftCount({ scope: 'FULL', items: [] }));
      const service = buildStockCountsService(db);

      const result: any = await service.start(50, { updatedAt: VERSION }, APPROVER, 3);

      expect(result.status).toBe('COUNTING');
      expect(result.startedByUserId).toBe(3);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i: any) => [i.itemId, i.systemQty.toString()]).sort()).toEqual([[1, '10'], [2, '4']]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_STARTED' }) });
    });

    it('PARTIAL scope: snapshots the current ON_HAND of each existing line (item-level, or a named batch)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      db.state.batches.push({ id: 5, itemId: 2, batchNumber: 'B-1', productionDate: null, expiryDate: null, note: null, createdByUserId: null, createdAt: new Date(), updatedAt: new Date() });
      db.state.batchBalances.push({ id: 1, batchId: 5, itemId: 2, locationId: 1, onHand: new Prisma.Decimal(7), qc: new Prisma.Decimal(0) });
      mockCount(db, draftCount({ items: [countItem({ id: 201, itemId: 1 }), countItem({ id: 202, itemId: 2, batchId: 5 })] }));

      const result: any = await buildStockCountsService(db).start(50, { updatedAt: VERSION }, APPROVER, 3);
      const byId = new Map(result.items.map((i: any) => [i.id, i]));
      expect(byId.get(201).systemQty.toString()).toBe('10');
      expect(byId.get(202).systemQty.toString()).toBe('7');
    });

    it('refuses a non-DRAFT document and a stale version', async () => {
      const db = createInventoryDb();
      mockCount(db, draftCount({ status: 'COUNTING' }));
      const service = buildStockCountsService(db);
      await expect(service.start(50, { updatedAt: VERSION }, APPROVER, 3)).rejects.toBeInstanceOf(ConflictException);

      mockCount(db);
      await expect(service.start(50, { updatedAt: new Date('2020-01-01') }, APPROVER, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
    });
  });

  describe('blind entry (B13)', () => {
    function countingDoc() {
      return draftCount({
        status: 'COUNTING',
        startedAt: new Date('2026-10-01T00:00:00Z'),
        items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10) })],
      });
    }

    it('omits systemQty/varianceQty for a caller without inventory.approve while COUNTING, and reveals them to an approver', async () => {
      const db = createInventoryDb();
      mockCount(db, countingDoc());
      const service = buildStockCountsService(db);

      const blind: any = await service.get(50, COUNTER);
      expect('systemQty' in blind.items[0]).toBe(false);
      expect('varianceQty' in blind.items[0]).toBe(false);

      const full: any = await service.get(50, APPROVER);
      expect(full.items[0].systemQty.toString()).toBe('10');
    });

    it('reveals systemQty once the document reaches REVIEW, even to a non-approver', async () => {
      const db = createInventoryDb();
      mockCount(db, draftCount({ status: 'REVIEW', items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: new Prisma.Decimal(10), varianceQty: new Prisma.Decimal(0) })] }));
      const result: any = await buildStockCountsService(db).get(50, COUNTER);
      expect(result.items[0].systemQty.toString()).toBe('10');
    });

    it('isBlind = false never masks, even while COUNTING', async () => {
      const db = createInventoryDb();
      mockCount(db, draftCount({ status: 'COUNTING', isBlind: false, items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10) })] }));
      const result: any = await buildStockCountsService(db).get(50, COUNTER);
      expect(result.items[0].systemQty.toString()).toBe('10');
    });
  });

  describe('enterCount', () => {
    it('records countedQty + countedByUserId per line, any subset, overwriting a previous entry', async () => {
      const db = createInventoryDb();
      const current = mockCount(db, draftCount({ status: 'COUNTING', items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10) })] }));
      const service = buildStockCountsService(db);

      await service.enterCount(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 201, countedQty: 8 }] } as never, COUNTER, 4);
      expect(current().items[0]).toEqual(expect.objectContaining({ countedQty: 8, countedByUserId: 4 }));

      await service.enterCount(50, { updatedAt: current().updatedAt, lines: [{ stockCountItemId: 201, countedQty: 9 }] } as never, COUNTER, 5);
      expect(current().items[0]).toEqual(expect.objectContaining({ countedQty: 9, countedByUserId: 5 }));
    });

    it('allows a zero count (an empty shelf is a real count), and refuses a foreign line id and a non-COUNTING status', async () => {
      const db = createInventoryDb();
      const current = mockCount(db, draftCount({ status: 'COUNTING' }));
      const service = buildStockCountsService(db);
      await service.enterCount(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 201, countedQty: 0 }] } as never, COUNTER, 4);
      expect(current().items[0].countedQty.toString()).toBe('0');

      mockCount(db, draftCount({ status: 'COUNTING' }));
      await expect(service.enterCount(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 999, countedQty: 1 }] } as never, COUNTER, 4)).rejects.toBeInstanceOf(BadRequestException);

      mockCount(db, draftCount({ status: 'DRAFT' }));
      await expect(service.enterCount(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 201, countedQty: 1 }] } as never, COUNTER, 4)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('submit', () => {
    it('requires every line to have a countedQty, then computes varianceQty and moves to REVIEW', async () => {
      const db = createInventoryDb();
      const current = mockCount(
        db,
        draftCount({
          status: 'COUNTING',
          items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: null })],
        }),
      );
      const service = buildStockCountsService(db);
      await expect(service.submit(50, { updatedAt: VERSION }, APPROVER, 3)).rejects.toBeInstanceOf(BadRequestException);

      current().items[0].countedQty = new Prisma.Decimal(8);
      const result: any = await service.submit(50, { updatedAt: VERSION }, APPROVER, 3);
      expect(result.status).toBe('REVIEW');
      expect(result.items[0].varianceQty.toString()).toBe('-2');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_SUBMITTED' }) });
    });
  });

  describe('approve', () => {
    function reviewDoc(overrides: Record<string, unknown> = {}) {
      return draftCount({
        status: 'REVIEW',
        startedAt: new Date('2026-10-01T00:00:00Z'),
        submittedByUserId: 4,
        items: [
          countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: new Prisma.Decimal(8), varianceQty: new Prisma.Decimal(-2) }), // loss
          countItem({ id: 202, itemId: 2, systemQty: new Prisma.Decimal(4), countedQty: new Prisma.Decimal(6), varianceQty: new Prisma.Decimal(2) }), // gain
          countItem({ id: 203, itemId: 3, systemQty: new Prisma.Decimal(5), countedQty: new Prisma.Decimal(5), varianceQty: new Prisma.Decimal(0) }), // no variance
        ],
        ...overrides,
      });
    }

    // Every balance below is seeded with a timestamp BEFORE reviewDoc()'s
    // startedAt (2026-10-01) — otherwise the seed's own OPENING_BALANCE
    // movement (createdAt defaults to "now") would itself look like a
    // post-start movement and trip the stale check.
    const BEFORE_START = new Date('2026-09-01T00:00:00Z');

    it('posts COUNT_LOSS/COUNT_GAIN for variance lines only, claims CNT-1405-000001, stamps reasonCode, audits, and skips the zero-variance line', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10, 1, BEFORE_START);
      seedStock(db, 2, 4, 1, BEFORE_START);
      seedStock(db, 3, 5, 1, BEFORE_START);
      mockCount(db, reviewDoc());
      const service = buildStockCountsService(db);

      const result: any = await service.approve(
        50,
        { updatedAt: VERSION, lines: [{ stockCountItemId: 201, reasonCode: 'COUNT_ERROR' }, { stockCountItemId: 202, reasonCode: 'FOUND' }] } as never,
        APPROVER,
        9,
      );

      expect(result.status).toBe('POSTED');
      expect(result.countNumber).toBe('CNT-1405-000001');
      expect(balanceOf(db, 1)?.onHand).toBe('8');
      expect(balanceOf(db, 2)?.onHand).toBe('6');
      expect(balanceOf(db, 3)?.onHand).toBe('5');
      const countMovements = db.state.movements.filter((m: any) => m.movementType === 'COUNT_LOSS' || m.movementType === 'COUNT_GAIN');
      expect(countMovements).toEqual([
        expect.objectContaining({ itemId: 1, movementType: 'COUNT_LOSS', bucket: 'ON_HAND', referenceType: 'STOCK_COUNT', referenceId: 50, referenceLineId: 201, referenceNumber: 'CNT-1405-000001' }),
        expect.objectContaining({ itemId: 2, movementType: 'COUNT_GAIN', bucket: 'ON_HAND', referenceLineId: 202 }),
      ]);
      expect(countMovements[0].quantity.toString()).toBe('-2');
      expect(countMovements[1].quantity.toString()).toBe('2');
      expect(result.items.find((i: any) => i.id === 201).reasonCode).toBe('COUNT_ERROR');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_APPROVED', details: expect.stringContaining('CNT-1405-000001') }) });
    });

    it('refuses self-approval: the submitter cannot approve their own count', async () => {
      const db = createInventoryDb();
      mockCount(db, reviewDoc({ submittedByUserId: 9 }));
      await expect(buildStockCountsService(db).approve(50, { updatedAt: VERSION, lines: [] } as never, APPROVER, 9)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.movements).toHaveLength(0);
    });

    it('refuses to post when a variance line has no reasonCode (from either enterCount or this call), burning no number', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10, 1, BEFORE_START);
      mockCount(db, reviewDoc({ items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: new Prisma.Decimal(8), varianceQty: new Prisma.Decimal(-2) })] }));
      const movementCountBefore = db.state.movements.length;
      await expect(buildStockCountsService(db).approve(50, { updatedAt: VERSION, lines: [] } as never, APPROVER, 9)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.state.movements).toHaveLength(movementCountBefore);
      expect(db.state.sequences.size).toBe(0);
    });

    it('a loss that leaves stock over-committed still posts, with a warning (B12)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10, 1, BEFORE_START);
      db.state.balances[0].reserved = new Prisma.Decimal(9); // 10 on hand reserved 9, about to drop onHand to 8
      mockCount(db, reviewDoc({ items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: new Prisma.Decimal(8), varianceQty: new Prisma.Decimal(-2) })] }));
      const result: any = await buildStockCountsService(db).approve(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 201, reasonCode: 'LOST' }] } as never, APPROVER, 9);
      expect(result.status).toBe('POSTED');
      expect(result.warnings).toEqual([{ itemId: 1, available: '-1' }]);
    });

    it('refuses a non-REVIEW status and a stale version', async () => {
      const db = createInventoryDb();
      mockCount(db, reviewDoc({ status: 'COUNTING' }));
      const service = buildStockCountsService(db);
      await expect(service.approve(50, { updatedAt: VERSION, lines: [] } as never, APPROVER, 9)).rejects.toBeInstanceOf(ConflictException);

      mockCount(db, reviewDoc());
      await expect(service.approve(50, { updatedAt: new Date('2020-01-01'), lines: [] } as never, APPROVER, 9)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
    });

    describe('stale-line detection + recount', () => {
      it('refuses to post (409 COUNT_STALE) when an ON_HAND movement happened for a counted item after startedAt, then clears after requestRecount', async () => {
        const db = createInventoryDb();
        const startedAt = new Date('2026-10-01T00:00:00Z');
        seedStock(db, 1, 10, 1, new Date('2026-09-01T00:00:00Z'));
        const current = mockCount(
          db,
          reviewDoc({ startedAt, items: [countItem({ id: 201, itemId: 1, systemQty: new Prisma.Decimal(10), countedQty: new Prisma.Decimal(8), varianceQty: new Prisma.Decimal(-2) })] }),
        );
        const service = buildStockCountsService(db);
        // A movement for item 1 happened AFTER the count started (e.g. a delivery) — the snapshot is now stale.
        seedMovementAt(db, 1, 1, new Date('2026-10-02T00:00:00Z'));

        await expect(service.approve(50, { updatedAt: VERSION, lines: [{ stockCountItemId: 201, reasonCode: 'COUNT_ERROR' }] } as never, APPROVER, 9)).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'COUNT_STALE' }),
        });
        expect(db.state.sequences.size).toBe(0);

        // requestRecount() un-stales the line: refreshes systemQty, resets countedQty/varianceQty/reasonCode, bumps startedAt, back to COUNTING.
        db.state.balances[0].onHand = new Prisma.Decimal(11); // the stale movement changed real stock to 11
        const recounted: any = await service.requestRecount(50, { updatedAt: VERSION, lineIds: [201] } as never, APPROVER, 9);
        expect(recounted.status).toBe('COUNTING');
        const line = current().items.find((i: any) => i.id === 201);
        expect(line.systemQty.toString()).toBe('11');
        expect(line.countedQty).toBeNull();
        expect(line.recountCount).toBe(1);

        // Re-enter, submit, approve now succeeds.
        await service.enterCount(50, { updatedAt: current().updatedAt, lines: [{ stockCountItemId: 201, countedQty: 11 }] } as never, COUNTER, 4);
        await service.submit(50, { updatedAt: current().updatedAt }, APPROVER, 4);
        const movementCountBeforeApprove = db.state.movements.length;
        const posted: any = await service.approve(50, { updatedAt: current().updatedAt, lines: [] } as never, APPROVER, 9);
        expect(posted.status).toBe('POSTED');
        // Variance is now zero (systemQty refreshed to 11, recounted to 11) — no COUNT_GAIN/COUNT_LOSS posted.
        expect(db.state.movements).toHaveLength(movementCountBeforeApprove);
      });
    });
  });

  describe('cancel', () => {
    it('cancels a COUNTING document with a reason, and refuses a POSTED one', async () => {
      const db = createInventoryDb();
      mockCount(db, draftCount({ status: 'COUNTING' }));
      const service = buildStockCountsService(db);
      const result: any = await service.cancel(50, { updatedAt: VERSION, cancelReason: 'انبار بسته شد' } as never, APPROVER, 3);
      expect(result.status).toBe('CANCELLED');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_CANCELLED', details: 'انبار بسته شد' }) });

      mockCount(db, draftCount({ status: 'POSTED' }));
      await expect(service.cancel(50, { updatedAt: VERSION, cancelReason: 'x' } as never, APPROVER, 3)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (audited) and refuses a non-DRAFT document', async () => {
      const db = createInventoryDb();
      const service = buildStockCountsService(db);
      db.stockCount.findUnique.mockResolvedValueOnce({ id: 50, status: 'DRAFT', scope: 'PARTIAL' });
      await service.remove(50, 3);
      expect(db.stockCount.delete).toHaveBeenCalledWith({ where: { id: 50 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_COUNT_DELETED' }) });

      db.stockCount.findUnique.mockResolvedValueOnce({ id: 50, status: 'COUNTING', scope: 'PARTIAL' });
      await expect(service.remove(50, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.stockCount.delete).toHaveBeenCalledTimes(1);
    });

    it('404s an unknown document', async () => {
      const db = createInventoryDb();
      db.stockCount.findUnique.mockResolvedValue(null);
      await expect(buildStockCountsService(db).get(1, APPROVER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('StockCountsController — permission gates (I6)', () => {
  const proto = StockCountsController.prototype;
  it('deleting a draft needs its own delete permission (inventory.delete)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.remove)).toEqual(['inventory.delete']);
  });

  it('reads need inventory.view', () => {
    for (const method of [proto.list, proto.get]) expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.view']);
  });
  it('create/edit/delete/start/enter/submit/cancel and the form picker need inventory.count', () => {
    for (const method of [proto.create, proto.update, proto.start, proto.enterCount, proto.submit, proto.cancel, proto.formOptions]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.count']);
    }
  });
  it('approve and requestRecount need inventory.approve, never the submitter', () => {
    for (const method of [proto.approve, proto.requestRecount]) expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.approve']);
  });
});
