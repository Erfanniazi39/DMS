import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { createGoodsReceiptSchema, releaseGoodsReceiptQcSchema } from './dto/goods-receipt.dto';
import { GoodsReceiptsController } from './goods-receipts.controller';
import {
  ADJ_DATE,
  balanceOf,
  buildGoodsReceiptsService,
  createInventoryDb,
  setItemKind,
  trackItem,
  VERSION,
  type InventoryDb,
} from './inventory.spec-helpers';

// GoodsReceiptsService (Inventory batch I5, build plan §5.5/§6) — DRAFT CRUD,
// DRAFT → POSTED (GOODS_RECEIPT into ON_HAND or QC), QC release, cost
// masking (B15). Stock effects are asserted on the in-memory fake (real
// rollback semantics: a failed post writes nothing and burns no number).

const COST = { canViewCost: true };
const NO_COST = { canViewCost: false };

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    lineNo: 1,
    itemId: 1,
    quantity: new Prisma.Decimal(10),
    unitCost: new Prisma.Decimal(25000),
    batchNumber: null,
    productionDate: null,
    expiryDate: null,
    batchId: null,
    releasedQty: new Prisma.Decimal(0),
    rejectedQty: new Prisma.Decimal(0),
    returnedQty: new Prisma.Decimal(0),
    note: null,
    ...overrides,
  };
}

function draftReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 40,
    receiptNumber: null,
    locationId: 1,
    location: { isActive: true },
    receiptDate: ADJ_DATE,
    supplierId: 5,
    supplierName: 'تأمین‌کننده نمونه',
    supplierDocumentNumber: null,
    purchaseId: null,
    purchaseNumber: null,
    inspectionRequired: false,
    status: 'DRAFT',
    note: null,
    postedByUserId: null,
    postedAt: null,
    updatedAt: VERSION,
    items: [line(), line({ id: 102, lineNo: 2, itemId: 2, quantity: new Prisma.Decimal(4), unitCost: null })],
    ...overrides,
  };
}

// findUnique always answers the current document; update/goodsReceiptItem
// .update mutate it so the final get() sees the posted/released state.
function mockReceipt(db: InventoryDb, receipt: any = draftReceipt()) {
  let current: any = receipt;
  db.goodsReceipt.findUnique.mockImplementation(async () => current);
  db.goodsReceipt.update.mockImplementation(async ({ data }: any) => {
    // A nested `items: { create }` (draft edit) isn't a scalar to merge.
    const { items: _nested, ...scalars } = data;
    current = { ...current, ...scalars };
    return current;
  });
  db.goodsReceiptItem.update.mockImplementation(async ({ where, data }: any) => {
    current = {
      ...current,
      items: current.items.map((row: any) => {
        if (row.id !== where.id) return row;
        const next = { ...row, ...data };
        if (data.releasedQty?.increment !== undefined) next.releasedQty = new Prisma.Decimal(row.releasedQty).plus(data.releasedQty.increment);
        return next;
      }),
    };
    return current.items.find((row: any) => row.id === where.id);
  });
  return () => current;
}

function rawMaterials(db: InventoryDb, ...ids: number[]) {
  for (const id of ids) setItemKind(db, id, 'RAW_MATERIAL');
}

const createDto = {
  receiptDate: ADJ_DATE,
  supplierId: 5,
  inspectionRequired: false,
  items: [{ itemId: 1, quantity: 10 }],
};

describe('GoodsReceiptsService', () => {
  describe('create', () => {
    it('creates a DRAFT with no number, snapshots the supplier, numbers lines, audits, and never touches stock', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      db.goodsReceipt.create.mockResolvedValue({ id: 40, items: [] });

      await buildGoodsReceiptsService(db).create(createDto as never, NO_COST, 3, '127.0.0.1');

      const data = db.goodsReceipt.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'DRAFT', locationId: 1, supplierId: 5, supplierName: 'تأمین‌کننده نمونه', createdByUserId: 3 }));
      expect(data.receiptNumber).toBeUndefined();
      expect(data.items.create).toEqual([expect.objectContaining({ lineNo: 1, itemId: 1, quantity: 10, unitCost: null, batchNumber: null })]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RECEIPT_CREATED', entityType: 'GoodsReceipt', entityId: '40' }) });
      expect(db.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('accepts RAW_MATERIAL and PACKAGING but rejects a FINISHED_GOOD line (B3 reframed — finished goods come from production)', async () => {
      const db = createInventoryDb();
      setItemKind(db, 1, 'RAW_MATERIAL');
      setItemKind(db, 2, 'PACKAGING');
      db.goodsReceipt.create.mockResolvedValue({ id: 40, items: [] });
      const service = buildGoodsReceiptsService(db);
      await service.create({ ...createDto, items: [{ itemId: 1, quantity: 1 }, { itemId: 2, quantity: 1 }] } as never, NO_COST, 3);

      // item 3 defaults to FINISHED_GOOD
      await expect(service.create({ ...createDto, items: [{ itemId: 3, quantity: 1 }] } as never, NO_COST, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ITEM_KIND_NOT_ALLOWED' }),
      });
      expect(db.goodsReceipt.create).toHaveBeenCalledTimes(1);
    });

    it('refuses a unitCost from a caller without inventory.cost (403) and stores it for one who has it', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      db.goodsReceipt.create.mockResolvedValue({ id: 40, items: [] });
      const service = buildGoodsReceiptsService(db);
      const withCost = { ...createDto, items: [{ itemId: 1, quantity: 10, unitCost: 25000 }] };

      await expect(service.create(withCost as never, NO_COST, 3)).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.goodsReceipt.create).not.toHaveBeenCalled();

      await service.create(withCost as never, COST, 3);
      expect(db.goodsReceipt.create.mock.calls[0][0].data.items.create[0].unitCost).toBe(25000);
    });

    it('requires a batchNumber for a batch-tracked item and forbids one for an untracked item', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2);
      trackItem(db, 2);
      const service = buildGoodsReceiptsService(db);

      await expect(service.create({ ...createDto, items: [{ itemId: 1, quantity: 1, batchNumber: 'L1' }] } as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ ...createDto, items: [{ itemId: 2, quantity: 1 }] } as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.goodsReceipt.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive supplier and an unknown purchase; snapshots a known purchase number (no FK)', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      db.goodsReceipt.create.mockResolvedValue({ id: 40, items: [] });
      const service = buildGoodsReceiptsService(db);

      db.supplier.findUnique.mockResolvedValueOnce({ id: 5, name: 'بلاک', status: 'blacklisted' });
      await expect(service.create(createDto as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);

      await expect(service.create({ ...createDto, purchaseId: 77 } as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.purchase.findUnique.mockResolvedValueOnce({ id: 77, purchaseNumber: 'PUR-000077' });
      await service.create({ ...createDto, purchaseId: 77 } as never, NO_COST, 3);
      expect(db.goodsReceipt.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ purchaseId: 77, purchaseNumber: 'PUR-000077' }));
    });

    it('DTO: dates without a lot number, and expiry before production, are rejected', () => {
      expect(createGoodsReceiptSchema.safeParse({ ...createDto, items: [{ itemId: 1, quantity: 1, expiryDate: '2027-01-01' }] }).success).toBe(false);
      expect(
        createGoodsReceiptSchema.safeParse({ ...createDto, items: [{ itemId: 1, quantity: 1, batchNumber: 'L', productionDate: '2026-10-01', expiryDate: '2026-09-01' }] }).success,
      ).toBe(false);
      expect(createGoodsReceiptSchema.safeParse({ ...createDto, items: [{ itemId: 1, quantity: 1, unitCost: 12.5 }] }).success).toBe(false);
    });
  });

  describe('get / cost masking (B15)', () => {
    it('strips unitCost from every line unless the caller holds inventory.cost', async () => {
      const db = createInventoryDb();
      mockReceipt(db);
      const service = buildGoodsReceiptsService(db);

      const masked: any = await service.get(40, NO_COST);
      expect(masked.items.every((row: any) => !('unitCost' in row))).toBe(true);
      const full: any = await service.get(40, COST);
      expect(full.items[0].unitCost.toString()).toBe('25000');
    });

    it('404s an unknown receipt', async () => {
      const db = createInventoryDb();
      db.goodsReceipt.findUnique.mockResolvedValue(null);
      await expect(buildGoodsReceiptsService(db).get(1, COST)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('replaces lines with a compare-and-set on updatedAt + DRAFT', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      mockReceipt(db);
      await buildGoodsReceiptsService(db).update(40, { ...createDto, updatedAt: VERSION } as never, COST, 3);
      expect(db.goodsReceipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 40, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.goodsReceiptItem.deleteMany).toHaveBeenCalledWith({ where: { goodsReceiptId: 40 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RECEIPT_UPDATED' }) });
    });

    it('a caller without inventory.cost keeps the previous cost of the same item at the same line position', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2, 3);
      mockReceipt(db);
      await buildGoodsReceiptsService(db).update(
        40,
        { ...createDto, updatedAt: VERSION, items: [{ itemId: 1, quantity: 12 }, { itemId: 3, quantity: 1 }] } as never,
        NO_COST,
        3,
      );
      const created = db.goodsReceipt.update.mock.calls[0][0].data.items.create;
      expect(created[0]).toEqual(expect.objectContaining({ itemId: 1, quantity: 12, unitCost: 25000 }));
      // line 2 changed item (2 → 3): no cost carried over.
      expect(created[1]).toEqual(expect.objectContaining({ itemId: 3, unitCost: null }));
    });

    it('refuses to edit a POSTED receipt and a stale version', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      mockReceipt(db, draftReceipt({ status: 'POSTED', receiptNumber: 'GRN-1405-000001' }));
      const service = buildGoodsReceiptsService(db);
      await expect(service.update(40, { ...createDto, updatedAt: VERSION } as never, COST, 3)).rejects.toBeInstanceOf(ConflictException);

      mockReceipt(db);
      await expect(service.update(40, { ...createDto, updatedAt: new Date('2020-01-01') } as never, COST, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.goodsReceiptItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('locks the draft, claims GRN-1405-000001, writes GOODS_RECEIPT ON_HAND rows with unitCost stamped, marks POSTED, audits', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2);
      mockReceipt(db);

      const result: any = await buildGoodsReceiptsService(db).post(40, VERSION, COST, 3, '127.0.0.1');

      expect((db.$queryRaw.mock.calls[0][0] as string[]).join('?')).toContain('FROM goods_receipts WHERE id = ? FOR UPDATE');
      expect(result).toEqual(expect.objectContaining({ status: 'POSTED', receiptNumber: 'GRN-1405-000001', postedByUserId: 3 }));
      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '0' });
      expect(balanceOf(db, 2)?.onHand).toBe('4');
      expect(db.state.movements).toEqual([
        expect.objectContaining({ itemId: 1, bucket: 'ON_HAND', movementType: 'GOODS_RECEIPT', referenceType: 'GOODS_RECEIPT', referenceId: 40, referenceLineId: 101, referenceNumber: 'GRN-1405-000001', movementDate: ADJ_DATE }),
        expect.objectContaining({ itemId: 2, bucket: 'ON_HAND', referenceLineId: 102, unitCost: null }),
      ]);
      expect(db.state.movements[0].unitCost.toString()).toBe('25000');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RECEIPT_POSTED', details: expect.stringContaining('GRN-1405-000001') }) });
    });

    it('inspectionRequired (B19): lines land in QC, not ON_HAND', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2);
      mockReceipt(db, draftReceipt({ inspectionRequired: true }));
      await buildGoodsReceiptsService(db).post(40, VERSION, COST, 3);
      expect(balanceOf(db, 1)).toEqual({ onHand: '0', reserved: '0', qc: '10' });
      expect(db.state.movements.map((m: any) => m.bucket)).toEqual(['QC', 'QC']);
    });

    it('batch-tracked line: resolves/creates the batch (normalized lot number), stamps it on the line and the movement', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      trackItem(db, 1);
      const current = mockReceipt(db, draftReceipt({ items: [line({ batchNumber: ' LOT-۱۲ ', expiryDate: new Date('2027-01-01T00:00:00Z') })] }));

      await buildGoodsReceiptsService(db).post(40, VERSION, COST, 3);

      expect(db.state.batches).toEqual([expect.objectContaining({ id: 1, itemId: 1, batchNumber: 'LOT-12' })]);
      expect(db.state.movements[0]).toEqual(expect.objectContaining({ batchId: 1, bucket: 'ON_HAND' }));
      expect(db.state.batchBalances[0].onHand.toString()).toBe('10');
      expect(current().items[0]).toEqual(expect.objectContaining({ batchId: 1, batchNumber: 'LOT-12' }));
    });

    it('refuses an already-POSTED receipt and a stale version, writing nothing', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2);
      mockReceipt(db, draftReceipt({ status: 'POSTED', receiptNumber: 'GRN-1405-000001' }));
      const service = buildGoodsReceiptsService(db);
      await expect(service.post(40, VERSION, COST, 3)).rejects.toBeInstanceOf(ConflictException);

      mockReceipt(db);
      await expect(service.post(40, new Date('2020-01-01'), COST, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });

    it('re-checks the item kind at posting: an item changed to FINISHED_GOOD since the draft fails and burns no number', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1); // item 2 stays FINISHED_GOOD
      mockReceipt(db);
      await expect(buildGoodsReceiptsService(db).post(40, VERSION, COST, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ITEM_KIND_NOT_ALLOWED' }),
      });
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });

    it('a tracked item whose expiryRequired is unmet fails atomically (EXPIRY_REQUIRED) — no batch, no movement, no number', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      trackItem(db, 1, { expiryRequired: true });
      mockReceipt(db, draftReceipt({ items: [line({ batchNumber: 'L9' })] }));
      await expect(buildGoodsReceiptsService(db).post(40, VERSION, COST, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EXPIRY_REQUIRED' }) });
      expect(db.state.batches).toHaveLength(0);
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });
  });

  describe('releaseFromQc (B19)', () => {
    async function postedQcReceipt(db: InventoryDb, receipt: any = draftReceipt({ inspectionRequired: true })) {
      rawMaterials(db, 1, 2);
      const current = mockReceipt(db, receipt);
      await buildGoodsReceiptsService(db).post(40, VERSION, COST, 3);
      db.auditLog.create.mockClear();
      return current;
    }

    it('moves a partial quantity QC → ON_HAND (two QC_RELEASE rows), increments releasedQty and audits', async () => {
      const db = createInventoryDb();
      const current = await postedQcReceipt(db);
      const service = buildGoodsReceiptsService(db);

      await service.releaseFromQc(40, { updatedAt: current().updatedAt, lines: [{ goodsReceiptItemId: 101, quantity: 6 }] }, COST, 4);

      expect(balanceOf(db, 1)).toEqual({ onHand: '6', reserved: '0', qc: '4' });
      const released = db.state.movements.filter((m: any) => m.movementType === 'QC_RELEASE');
      expect(released).toEqual([
        expect.objectContaining({ bucket: 'QC', referenceType: 'GOODS_RECEIPT', referenceId: 40, referenceLineId: 101, referenceNumber: 'GRN-1405-000001', createdByUserId: 4 }),
        expect.objectContaining({ bucket: 'ON_HAND', referenceLineId: 101 }),
      ]);
      expect(released.map((m: any) => m.quantity.toString())).toEqual(['-6', '6']);
      expect(current().items[0].releasedQty.toString()).toBe('6');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RECEIPT_QC_RELEASED', entityId: '40' }) });

      // The rest, in a second release; then nothing is left.
      await service.releaseFromQc(40, { updatedAt: current().updatedAt, lines: [{ goodsReceiptItemId: 101, quantity: 4 }] }, COST, 4);
      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '0' });
      expect(current().items[0].releasedQty.toString()).toBe('10');
    });

    it('refuses more than what is still in QC for the line (409 QC_RELEASE_EXCEEDS_REMAINING), writing nothing', async () => {
      const db = createInventoryDb();
      const current = await postedQcReceipt(db);
      const before = db.state.movements.length;
      await expect(
        buildGoodsReceiptsService(db).releaseFromQc(40, { updatedAt: current().updatedAt, lines: [{ goodsReceiptItemId: 102, quantity: 4.01 }] }, COST, 4),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'QC_RELEASE_EXCEEDS_REMAINING' }) });
      expect(db.state.movements).toHaveLength(before);
      expect(balanceOf(db, 2)?.qc).toBe('4');
    });

    it('refuses a DRAFT receipt, a receipt received without inspection, a foreign line and a stale version', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1, 2);
      const service = buildGoodsReceiptsService(db);
      const body = { updatedAt: VERSION, lines: [{ goodsReceiptItemId: 101, quantity: 1 }] };

      mockReceipt(db, draftReceipt({ inspectionRequired: true }));
      await expect(service.releaseFromQc(40, body, COST, 4)).rejects.toBeInstanceOf(ConflictException);

      mockReceipt(db, draftReceipt({ status: 'POSTED', receiptNumber: 'GRN-1405-000001', inspectionRequired: false }));
      await expect(service.releaseFromQc(40, body, COST, 4)).rejects.toBeInstanceOf(ConflictException);

      mockReceipt(db, draftReceipt({ status: 'POSTED', receiptNumber: 'GRN-1405-000001', inspectionRequired: true }));
      await expect(service.releaseFromQc(40, { ...body, lines: [{ goodsReceiptItemId: 999, quantity: 1 }] }, COST, 4)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.releaseFromQc(40, { ...body, updatedAt: new Date('2020-01-01') }, COST, 4)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.state.movements).toHaveLength(0);
    });

    it('a batch-tracked line is released within its own batch (QC −r / ON_HAND +r on the same batchId)', async () => {
      const db = createInventoryDb();
      rawMaterials(db, 1);
      trackItem(db, 1);
      const current = await postedQcReceipt(db, draftReceipt({ inspectionRequired: true, items: [line({ batchNumber: 'B-1' })] }));
      expect(db.state.batchBalances[0].qc.toString()).toBe('10');

      await buildGoodsReceiptsService(db).releaseFromQc(40, { updatedAt: current().updatedAt, lines: [{ goodsReceiptItemId: 101, quantity: 3 }] }, COST, 4);
      expect(db.state.batchBalances[0].qc.toString()).toBe('7');
      expect(db.state.batchBalances[0].onHand.toString()).toBe('3');
      expect(db.state.movements.filter((m: any) => m.movementType === 'QC_RELEASE').every((m: any) => m.batchId === 1)).toBe(true);
    });

    it('DTO: the same receipt line twice in one request is rejected', () => {
      const parsed = releaseGoodsReceiptQcSchema.safeParse({
        updatedAt: VERSION.toISOString(),
        lines: [
          { goodsReceiptItemId: 101, quantity: 1 },
          { goodsReceiptItemId: 101, quantity: 2 },
        ],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (audited) and refuses a POSTED receipt', async () => {
      const db = createInventoryDb();
      const service = buildGoodsReceiptsService(db);
      db.goodsReceipt.findUnique.mockResolvedValueOnce({ id: 40, status: 'DRAFT', supplierName: 'x' });
      await service.remove(40, 3);
      expect(db.goodsReceipt.delete).toHaveBeenCalledWith({ where: { id: 40 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RECEIPT_DELETED' }) });

      db.goodsReceipt.findUnique.mockResolvedValueOnce({ id: 40, status: 'POSTED', supplierName: 'x' });
      await expect(service.remove(40, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.goodsReceipt.delete).toHaveBeenCalledTimes(1);
    });
  });
});

describe('GoodsReceiptsController — permission gates (I5)', () => {
  const proto = GoodsReceiptsController.prototype;
  it('deleting a draft needs its own delete permission (inventory.delete)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.remove)).toEqual(['inventory.delete']);
  });

  it('reads need inventory.view', () => {
    for (const method of [proto.list, proto.get]) expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.view']);
  });
  it('every write, the QC release and the form pickers need inventory.receive', () => {
    for (const method of [proto.create, proto.update, proto.post, proto.releaseQc, proto.formOptions, proto.purchaseOptions]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.receive']);
    }
  });
});
