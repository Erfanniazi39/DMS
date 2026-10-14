import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { createStockAdjustmentSchema, rejectStockAdjustmentSchema, updateStockAdjustmentSchema } from './dto/inventory.dto';
import {
  ADJ_DATE,
  balanceOf,
  buildStockAdjustmentsService,
  createInventoryDb,
  damagedOf,
  draftAdjustment,
  seedBatch,
  seedStock,
  setBucket,
  trackItem,
  VERSION,
  type InventoryDb,
} from './inventory.spec-helpers';

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
      expect(data.items.create).toEqual([{ itemId: 1, quantity: 10, note: undefined, batchId: null, batchNumber: null, productionDate: null, expiryDate: null }]);
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
      // Net quantity is +47 (positive), so this CORRECTION does NOT need
      // approval (B10) and post() is the right endpoint — but item 1's own
      // line alone still takes it negative (2 − 3 = −1), which must fail the
      // whole batch regardless of the document's net sign.
      mockDraft(
        db,
        draftAdjustment({
          kind: 'CORRECTION',
          items: [
            { id: 91, itemId: 1, quantity: new Prisma.Decimal(-3), note: null },
            { id: 92, itemId: 2, quantity: new Prisma.Decimal(50), note: null },
          ],
        }),
      );
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

  describe('submit / approve / reject (I2, B10)', () => {
    function writeOffDraft(overrides: Record<string, unknown> = {}) {
      return draftAdjustment({
        kind: 'WRITE_OFF',
        reasonCode: 'DAMAGED',
        items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(-3), note: null }],
        ...overrides,
      });
    }

    it('submit → approve (by a different user): PENDING_APPROVAL, then POSTED with a WRITE_OFF movement', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      const service = buildStockAdjustmentsService(db);

      const submitted = await service.submit(7, VERSION, 3);
      expect(submitted.status).toBe('PENDING_APPROVAL');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_SUBMITTED' }) });
      // Submitting never touches stock.
      expect(db.state.movements).toHaveLength(1); // only the seedStock OPENING_BALANCE

      const approved = await service.approve(7, VERSION, 9); // 9 ≠ 3: a different approver
      expect(approved.status).toBe('POSTED');
      expect(approved.adjustmentNumber).toBe('ADJ-1405-000001');
      expect(db.state.movements).toEqual([
        expect.objectContaining({ movementType: 'OPENING_BALANCE' }),
        expect.objectContaining({ itemId: 1, movementType: 'WRITE_OFF', referenceType: 'STOCK_ADJUSTMENT', createdByUserId: 9 }),
      ]);
      expect(db.state.movements[1].quantity.toString()).toBe('-3');
      expect(balanceOf(db, 1)?.onHand).toBe('7');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_APPROVED', entityId: '7' }) });
    });

    it('submit → reject → resubmit → approve: rejection sends it back to an editable DRAFT', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      const rejected = await service.reject(7, VERSION, 'مدارک کافی نیست', 9);
      expect(rejected.status).toBe('DRAFT');
      expect(rejected.rejectReason).toBe('مدارک کافی نیست');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_REJECTED' }) });
      // Nothing was posted to stock by a rejected submission.
      expect(db.state.movements).toHaveLength(1);

      // The draft is editable again (ensureEditable(status) passes for DRAFT)
      // and can be resubmitted without further changes.
      const resubmitted = await service.submit(7, VERSION, 3);
      expect(resubmitted.status).toBe('PENDING_APPROVAL');
      const approved = await service.approve(7, VERSION, 9);
      expect(approved.status).toBe('POSTED');
    });

    it('rejects an empty reject reason at the DTO level', () => {
      expect(rejectStockAdjustmentSchema.safeParse({ updatedAt: VERSION.toISOString() }).success).toBe(false);
      expect(rejectStockAdjustmentSchema.safeParse({ updatedAt: VERSION.toISOString(), rejectReason: '  ' }).success).toBe(false);
      expect(rejectStockAdjustmentSchema.safeParse({ updatedAt: VERSION.toISOString(), rejectReason: 'مدارک ناقص' }).success).toBe(true);
    });

    it('refuses self-approval: the submitter cannot approve their own document', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException);
      // No movement was written and the document is still PENDING_APPROVAL.
      expect(db.state.movements).toHaveLength(1);
      const current = await service.get(7);
      expect(current.status).toBe('PENDING_APPROVAL');
    });

    it('post() refuses a PENDING_APPROVAL document — only approve() may move it (the Sales Batch 2 class of bug)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.post(7, VERSION, 9)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.movements).toHaveLength(1);
      expect(db.state.sequences.size).toBe(0);
    });

    it('post() also refuses a DRAFT document whose kind/net quantity needs approval (must submit() first) — workflow flag on', async () => {
      process.env.DMS_FEATURE_APPROVAL_WORKFLOW = 'true';
      try {
        const db = createInventoryDb();
        mockDraft(db, writeOffDraft());
        const service = buildStockAdjustmentsService(db);
        await expect(service.post(7, VERSION, 3, undefined, { canApprove: true })).rejects.toBeInstanceOf(ConflictException);
        expect(db.state.movements).toHaveLength(0);
      } finally {
        delete process.env.DMS_FEATURE_APPROVAL_WORKFLOW;
      }
    });

    it('v1 (workflow flag off): an inventory.approve holder posts a WRITE_OFF directly, and the audit says so', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      const posted = await buildStockAdjustmentsService(db).post(7, VERSION, 3, undefined, { canApprove: true });
      expect(posted.status).toBe('POSTED');
      expect(db.state.movements.filter((m: any) => m.movementType === 'WRITE_OFF')).toHaveLength(1);
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_POSTED', details: expect.stringContaining('ثبت مستقیم با مجوز تأیید') }),
      });
    });

    it('v1 (workflow flag off): without inventory.approve a WRITE_OFF is refused (403), nothing written, no number burned', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, writeOffDraft());
      await expect(buildStockAdjustmentsService(db).post(7, VERSION, 3)).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.state.movements).toHaveLength(1);
      expect(db.state.sequences.size).toBe(0);
    });

    it('submit() refuses a DRAFT document that does NOT need approval (a plain RECEIPT)', async () => {
      const db = createInventoryDb();
      mockDraft(db); // RECEIPT, positive quantities
      const service = buildStockAdjustmentsService(db);
      await expect(service.submit(7, VERSION, 3)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('approve()/reject() refuse a document that is not PENDING_APPROVAL', async () => {
      const db = createInventoryDb();
      mockDraft(db); // DRAFT
      const service = buildStockAdjustmentsService(db);
      await expect(service.approve(7, VERSION, 9)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.reject(7, VERSION, 'دلیلی', 9)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // I8 (build plan §5.8, B9): found-damaged-on-the-shelf stock — ON_HAND out,
  // DAMAGED in, two rows per line, posted by its own dedicated builder
  // (buildMarkDamagedMovementRows()), never the generic single-row path.
  // Same approval tier as WRITE_OFF (needs approval, no self-approval,
  // reasonCode required) — exercised via submit() → approve(), never post().
  describe('MARK_DAMAGED (I8, B9)', () => {
    function markDamagedDraft(overrides: Record<string, unknown> = {}) {
      return draftAdjustment({
        kind: 'MARK_DAMAGED',
        reasonCode: 'DAMAGED',
        items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(-3), note: null, batchId: null, batchNumber: null, productionDate: null, expiryDate: null }],
        ...overrides,
      });
    }

    it('submit → approve (by a different user): two movements per line (ON_HAND out, DAMAGED in), same reference', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, markDamagedDraft());
      const service = buildStockAdjustmentsService(db);

      const submitted = await service.submit(7, VERSION, 3);
      expect(submitted.status).toBe('PENDING_APPROVAL');
      // Submitting never touches stock.
      expect(db.state.movements).toHaveLength(1); // only the seedStock OPENING_BALANCE

      const approved = await service.approve(7, VERSION, 9); // 9 ≠ 3: a different approver
      expect(approved.status).toBe('POSTED');
      expect(approved.adjustmentNumber).toBe('ADJ-1405-000001');
      expect(balanceOf(db, 1)).toEqual({ onHand: '7', reserved: '0', qc: '0' });
      expect(damagedOf(db, 1)).toBe('3');

      const marked = db.state.movements.filter((m: any) => m.movementType === 'MARK_DAMAGED');
      expect(marked.map((m: any) => [m.bucket, m.quantity.toString(), m.referenceLineId])).toEqual([
        ['ON_HAND', '-3', 91],
        ['DAMAGED', '3', 91],
      ]);
      expect(marked.every((m: any) => m.referenceType === 'STOCK_ADJUSTMENT' && m.referenceId === 7)).toBe(true);
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'STOCK_ADJUSTMENT_APPROVED', entityId: '7', details: expect.stringContaining('ADJ-1405-000001') }),
      });
    });

    it('needs approval and a reasonCode, refuses self-approval, and post() refuses it directly', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      const service = buildStockAdjustmentsService(db);

      mockDraft(db, markDamagedDraft());
      await expect(service.post(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.movements).toHaveLength(1);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException); // same submitter
      expect(db.state.movements).toHaveLength(1);

      const approved = await service.approve(7, VERSION, 9);
      expect(approved.status).toBe('POSTED');
    });

    it('a batch-tracked item’s line requires an existing batchId (never a new batchNumber); batch balances move too', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'B1', onHand: 10 });
      mockDraft(
        db,
        markDamagedDraft({ items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(-3), note: null, batchId: batch.id, batchNumber: null, productionDate: null, expiryDate: null }] }),
      );
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await service.approve(7, VERSION, 9);

      const batchBalance = db.state.batchBalances.find((b: any) => b.batchId === batch.id);
      expect(batchBalance.onHand.toString()).toBe('7');
      expect(batchBalance.damaged.toString()).toBe('3');
    });

    it('a MARK_DAMAGED that would take ON_HAND negative fails as a whole: no movement, no DAMAGED change, no number burned', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 2);
      mockDraft(db, markDamagedDraft({ items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(-5), note: null, batchId: null, batchNumber: null, productionDate: null, expiryDate: null }] }));
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 9)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
      expect(balanceOf(db, 1)).toEqual({ onHand: '2', reserved: '0', qc: '0' });
      expect(damagedOf(db, 1)).toBe('0');
      expect(db.state.sequences.get('ADJ:1405')).toBeUndefined();
    });
  });

  // I4 (B23/§6/§5.4a R2/R3, build plan §16 resume step 4 — the highest
  // priority gap: postBatchCutover() had zero coverage). Converts item 1
  // from unbatched to batch-tracked: ADJUSTMENT_OUT of the whole unbatched
  // on-hand, batchTracked flips, then ADJUSTMENT_IN per batch line.
  describe('BATCH_CUTOVER (I4)', () => {
    function cutoverDraft(overrides: Record<string, unknown> = {}) {
      return draftAdjustment({
        kind: 'BATCH_CUTOVER',
        items: [
          { id: 91, itemId: 1, quantity: new Prisma.Decimal(6), note: null, batchId: null, batchNumber: 'LOT-1', productionDate: null, expiryDate: null },
          { id: 92, itemId: 1, quantity: new Prisma.Decimal(4), note: null, batchId: null, batchNumber: 'LOT-2', productionDate: null, expiryDate: null },
        ],
        ...overrides,
      });
    }

    it('happy path: ADJUSTMENT_OUT of the unbatched total, batchTracked flips, ADJUSTMENT_IN per batch line, two audit entries', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, cutoverDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      const approved = await service.approve(7, VERSION, 9);

      expect(approved.status).toBe('POSTED');
      expect(approved.adjustmentNumber).toBe('ADJ-1405-000001');
      // Nets to zero — the item's own on-hand is unchanged.
      expect(balanceOf(db, 1)?.onHand).toBe('10');

      const setting = db.state.itemSettings.find((row) => row.itemId === 1);
      expect(setting).toEqual(expect.objectContaining({ batchTracked: true }));
      expect(setting?.batchTrackedSince).toBeInstanceOf(Date);

      const batches = db.state.batches.filter((batch) => batch.itemId === 1);
      expect(batches.map((batch) => batch.batchNumber).sort()).toEqual(['LOT-1', 'LOT-2']);

      const outMovement = db.state.movements.find((movement: any) => movement.movementType === 'ADJUSTMENT_OUT');
      expect(outMovement).toEqual(expect.objectContaining({ itemId: 1, bucket: 'ON_HAND', referenceLineId: null }));
      expect((outMovement as any).quantity.toString()).toBe('-10');

      const inMovements = db.state.movements.filter((movement: any) => movement.movementType === 'ADJUSTMENT_IN');
      expect(inMovements).toHaveLength(2);
      expect(inMovements.every((movement: any) => Boolean(movement.batchId))).toBe(true);
      expect(inMovements.map((movement: any) => movement.quantity.toString()).sort()).toEqual(['4', '6']);

      expect(db.auditLog.create.mock.calls.map((call: any) => call[0].data.action)).toEqual(
        expect.arrayContaining(['STOCK_ADJUSTMENT_APPROVED', 'INVENTORY_ITEM_SETTING_BATCH_CUTOVER']),
      );
    });

    it('refuses when the batch lines do not sum to the item’s current on-hand (409 BATCH_CUTOVER_QUANTITY_MISMATCH), nothing written', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(
        db,
        cutoverDraft({
          items: [{ id: 91, itemId: 1, quantity: new Prisma.Decimal(9), note: null, batchId: null, batchNumber: 'LOT-1', productionDate: null, expiryDate: null }],
        }),
      );
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 9)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BATCH_CUTOVER_QUANTITY_MISMATCH' }) });
      expect(balanceOf(db, 1)?.onHand).toBe('10');
      expect(db.state.movements).toHaveLength(1); // only the seeded opening movement
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
    });

    it('refuses when the item has QC stock anywhere (must be cleared first)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 2);
      mockDraft(db, cutoverDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 9)).rejects.toThrow('کنترل کیفیت');
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
    });

    it('refuses when the item has stock at another location (409 BATCH_CUTOVER_STOCK_ELSEWHERE)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10); // location 1 — the cutover document's own location
      seedStock(db, 1, 5, 2); // location 2 — stock elsewhere
      mockDraft(db, cutoverDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 9)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BATCH_CUTOVER_STOCK_ELSEWHERE' }) });
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
    });

    it('refuses an item that is already batch-tracked (cutover is one-way, never repeated)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      trackItem(db, 1);
      mockDraft(db, cutoverDraft());
      const service = buildStockAdjustmentsService(db);

      await service.submit(7, VERSION, 3);
      await expect(service.approve(7, VERSION, 9)).rejects.toThrow('قبلاً به ردیابی بچ تبدیل شده');
    });

    it('needs approval (submit() accepts it) but never a reasonCode — and self-approval is still refused (B23)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, cutoverDraft({ reasonCode: null }));
      const service = buildStockAdjustmentsService(db);

      const submitted = await service.submit(7, VERSION, 3);
      expect(submitted.status).toBe('PENDING_APPROVAL');

      await expect(service.approve(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException); // same submitter
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();

      const approved = await service.approve(7, VERSION, 9); // different approver
      expect(approved.status).toBe('POSTED');
    });

    it('post() refuses BATCH_CUTOVER directly — it always needs submit() → approve()', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, cutoverDraft());
      await expect(buildStockAdjustmentsService(db).post(7, VERSION, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
    });

    it('v1: even an inventory.approve holder cannot post BATCH_CUTOVER directly', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockDraft(db, cutoverDraft());
      await expect(buildStockAdjustmentsService(db).post(7, VERSION, 3, undefined, { canApprove: true })).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.itemSettings.find((row) => row.itemId === 1)).toBeUndefined();
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

  it('OPENING / RECEIPT lines must be positive; CORRECTION lines may be negative (with a reasonCode, since a negative net quantity needs approval)', () => {
    expect(createStockAdjustmentSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: -1 }] }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'OPENING', items: [{ itemId: 1, quantity: -1 }] }).success).toBe(false);
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'CORRECTION', reasonCode: 'COUNT_ERROR', items: [{ itemId: 1, quantity: -1.25 }] })
        .success,
    ).toBe(true);
  });

  it('reasonCode (B10/B11): required for WRITE_OFF and a net-negative CORRECTION; optional otherwise', () => {
    // WRITE_OFF without a reasonCode is refused.
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'WRITE_OFF', items: [{ itemId: 1, quantity: -2 }] }).success).toBe(false);
    // WRITE_OFF with a reasonCode and a negative quantity succeeds.
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'WRITE_OFF', reasonCode: 'DAMAGED', items: [{ itemId: 1, quantity: -2 }] }).success,
    ).toBe(true);
    // A positive-net CORRECTION never needs a reasonCode.
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'CORRECTION', items: [{ itemId: 1, quantity: 4 }] }).success).toBe(true);
    // A net-negative CORRECTION (two lines summing negative) without a reasonCode is refused.
    expect(
      createStockAdjustmentSchema.safeParse({
        ...base,
        kind: 'CORRECTION',
        items: [
          { itemId: 1, quantity: 2 },
          { itemId: 2, quantity: -5 },
        ],
      }).success,
    ).toBe(false);
    // An unknown reasonCode is rejected.
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'WRITE_OFF', reasonCode: 'STOLEN', items: [{ itemId: 1, quantity: -2 }] }).success,
    ).toBe(false);
  });

  it('WRITE_OFF lines must be negative (the mirror of OPENING/RECEIPT)', () => {
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'WRITE_OFF', reasonCode: 'DAMAGED', items: [{ itemId: 1, quantity: 2 }] }).success,
    ).toBe(false);
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'WRITE_OFF', reasonCode: 'DAMAGED', items: [{ itemId: 1, quantity: -2 }] }).success,
    ).toBe(true);
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

  it('BATCH_CUTOVER (I4, §5.4a R6/B23): never requires a reasonCode even though it needs approval, every line needs a NEW batchNumber (never an existing batchId), and lines must be positive', () => {
    const cutover = { ...base, kind: 'BATCH_CUTOVER', items: [{ itemId: 1, quantity: 6, batchNumber: 'LOT-1' }] };
    expect(createStockAdjustmentSchema.safeParse(cutover).success).toBe(true); // no reasonCode, still valid
    expect(createStockAdjustmentSchema.safeParse({ ...cutover, items: [{ itemId: 1, quantity: 6, batchNumber: '' }] }).success).toBe(false); // batchNumber required
    expect(createStockAdjustmentSchema.safeParse({ ...cutover, items: [{ itemId: 1, quantity: 6, batchId: 5, batchNumber: 'LOT-1' }] }).success).toBe(false); // existing batchId forbidden
    expect(createStockAdjustmentSchema.safeParse({ ...cutover, items: [{ itemId: 1, quantity: -6, batchNumber: 'LOT-1' }] }).success).toBe(false); // inbound-only
  });

  it('MARK_DAMAGED (I8, B9): lines must be negative and a reasonCode is required, same as WRITE_OFF', () => {
    expect(createStockAdjustmentSchema.safeParse({ ...base, kind: 'MARK_DAMAGED', items: [{ itemId: 1, quantity: -2 }] }).success).toBe(false); // reasonCode required
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'MARK_DAMAGED', reasonCode: 'DAMAGED', items: [{ itemId: 1, quantity: 2 }] }).success,
    ).toBe(false); // must be negative
    expect(
      createStockAdjustmentSchema.safeParse({ ...base, kind: 'MARK_DAMAGED', reasonCode: 'DAMAGED', items: [{ itemId: 1, quantity: -2 }] }).success,
    ).toBe(true);
  });
});
