import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { STOCK_RESERVED_FOR_OTHERS } from './stock-ledger';
import { createGoodsReturnSchema } from './dto/goods-return.dto';
import { GoodsReturnsController } from './goods-returns.controller';
import {
  ADJ_DATE,
  balanceOf,
  buildGoodsReturnsService,
  createInventoryDb,
  damagedOf,
  seedBatch,
  seedGoodsReceiptItem,
  seedStock,
  setBucket,
  trackItem,
  VERSION,
  type InventoryDb,
} from './inventory.spec-helpers';

// GoodsReturnsService (Inventory batch I8, build plan §5.8/§6, B9) — DRAFT
// CRUD, DRAFT → POSTED (SUPPLIER_RETURN out of ON_HAND/QC/DAMAGED), the
// goods-receipt-item cap (returnedQty/rejectedQty), and the ON_HAND
// free-stock guard. Stock effects are asserted on the in-memory fake (real
// rollback semantics: a failed post writes nothing and burns no number).

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 201,
    itemId: 1,
    goodsReceiptItemId: null,
    batchId: null,
    fromBucket: 'ON_HAND',
    quantity: new Prisma.Decimal(3),
    note: null,
    ...overrides,
  };
}

function draftReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 60,
    returnNumber: null,
    locationId: 1,
    location: { isActive: true },
    supplierId: 5,
    supplierName: 'تأمین‌کننده نمونه',
    goodsReceiptId: null,
    purchaseReturnId: null,
    purchaseReturnNumber: null,
    returnDate: ADJ_DATE,
    reason: 'آسیب‌دیدگی در انبار',
    status: 'DRAFT',
    note: null,
    postedByUserId: null,
    postedAt: null,
    updatedAt: VERSION,
    items: [line()],
    ...overrides,
  };
}

// findUnique always answers the current document; update mutates it so the
// final get() sees the posted state — same convention as
// goods-receipts.service.spec.ts's mockReceipt().
function mockReturn(db: InventoryDb, goodsReturn: any = draftReturn()) {
  let current: any = goodsReturn;
  db.goodsReturn.findUnique.mockImplementation(async () => current);
  db.goodsReturn.update.mockImplementation(async ({ data }: any) => {
    const { items: _nested, ...scalars } = data;
    current = { ...current, ...scalars };
    return current;
  });
  return () => current;
}

const createDto = {
  supplierId: 5,
  returnDate: ADJ_DATE,
  reason: 'آسیب‌دیدگی در انبار',
  items: [{ itemId: 1, fromBucket: 'ON_HAND' as const, quantity: 3 }],
};

describe('GoodsReturnsService', () => {
  describe('create', () => {
    it('creates a DRAFT with no number, snapshots the supplier, audits, and never touches stock', async () => {
      const db = createInventoryDb();
      db.goodsReturn.create.mockResolvedValue({ id: 60, items: [] });

      await buildGoodsReturnsService(db).create(createDto as never, 3, '127.0.0.1');

      const data = db.goodsReturn.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'DRAFT', locationId: 1, supplierId: 5, supplierName: 'تأمین‌کننده نمونه', createdByUserId: 3 }));
      expect(data.returnNumber).toBeUndefined();
      expect(data.items.create).toEqual([expect.objectContaining({ itemId: 1, fromBucket: 'ON_HAND', quantity: 3 })]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RETURN_CREATED', entityType: 'GoodsReturn', entityId: '60' }) });
      expect(db.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('rejects an inactive or unknown item, an inactive supplier, and an unknown goods receipt / purchase return', async () => {
      const db = createInventoryDb();
      const service = buildGoodsReturnsService(db);

      db.item.findMany.mockResolvedValueOnce([{ id: 1, status: 'inactive', name: 'شیر' }]);
      await expect(service.create(createDto as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.supplier.findUnique.mockResolvedValueOnce({ id: 5, name: 'بلاک', status: 'blacklisted' });
      await expect(service.create(createDto as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.goodsReceipt.findUnique.mockResolvedValueOnce(null);
      await expect(service.create({ ...createDto, goodsReceiptId: 77 } as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      db.purchaseReturn.findUnique.mockResolvedValueOnce(null);
      await expect(service.create({ ...createDto, purchaseReturnId: 88 } as never, 3)).rejects.toBeInstanceOf(BadRequestException);

      expect(db.goodsReturn.create).not.toHaveBeenCalled();
    });

    it('snapshots a known goods receipt and purchase return (no FK)', async () => {
      const db = createInventoryDb();
      db.goodsReturn.create.mockResolvedValue({ id: 60, items: [] });
      db.goodsReceipt.findUnique.mockResolvedValueOnce({ id: 40 });
      db.purchaseReturn.findUnique.mockResolvedValueOnce({ id: 88, returnNumber: 'RTN-000088' });

      await buildGoodsReturnsService(db).create({ ...createDto, goodsReceiptId: 40, purchaseReturnId: 88 } as never, 3);

      expect(db.goodsReturn.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ goodsReceiptId: 40, purchaseReturnId: 88, purchaseReturnNumber: 'RTN-000088' }),
      );
    });

    it('requires an existing batchId for a batch-tracked item and forbids one for an untracked item', async () => {
      const db = createInventoryDb();
      trackItem(db, 2);
      const service = buildGoodsReturnsService(db);

      await expect(service.create({ ...createDto, items: [{ itemId: 2, fromBucket: 'ON_HAND', quantity: 1 }] } as never, 3)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ ...createDto, items: [{ itemId: 1, fromBucket: 'ON_HAND', quantity: 1, batchId: 9 }] } as never, 3)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.goodsReturn.create).not.toHaveBeenCalled();
    });

    it('caps a goods-receipt-item-linked line by quantity − returnedQty (overall, any bucket)', async () => {
      const db = createInventoryDb();
      seedGoodsReceiptItem(db, { id: 101, itemId: 1, quantity: 10, returnedQty: 8 });
      const service = buildGoodsReturnsService(db);

      await expect(
        service.create({ ...createDto, items: [{ itemId: 1, fromBucket: 'ON_HAND', quantity: 3, goodsReceiptItemId: 101 }] } as never, 3),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'GOODS_RETURN_EXCEEDS_RECEIPT_LINE' }) });

      db.goodsReturn.create.mockResolvedValue({ id: 60, items: [] });
      await service.create({ ...createDto, items: [{ itemId: 1, fromBucket: 'ON_HAND', quantity: 2, goodsReceiptItemId: 101 }] } as never, 3);
      expect(db.goodsReturn.create).toHaveBeenCalledTimes(1);
    });

    it('caps a QC line by quantity − releasedQty − rejectedQty (the still-in-QC amount), separately from the overall cap', async () => {
      const db = createInventoryDb();
      seedGoodsReceiptItem(db, { id: 101, itemId: 1, quantity: 10, releasedQty: 9, returnedQty: 0 });
      const service = buildGoodsReturnsService(db);

      // Overall cap allows up to 10, but only 1 unit is still physically in QC.
      await expect(
        service.create({ ...createDto, items: [{ itemId: 1, fromBucket: 'QC', quantity: 2, goodsReceiptItemId: 101 }] } as never, 3),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'GOODS_RETURN_EXCEEDS_QC_REMAINING' }) });
    });

    it('DTO: fromBucket must be one of ON_HAND/QC/DAMAGED', () => {
      expect(createGoodsReturnSchema.safeParse({ ...createDto, items: [{ itemId: 1, fromBucket: 'RESERVED', quantity: 1 }] }).success).toBe(false);
      expect(createGoodsReturnSchema.safeParse({ ...createDto, items: [{ itemId: 1, fromBucket: 'DAMAGED', quantity: 1 }] }).success).toBe(true);
    });
  });

  describe('get', () => {
    it('404s an unknown return', async () => {
      const db = createInventoryDb();
      db.goodsReturn.findUnique.mockResolvedValue(null);
      await expect(buildGoodsReturnsService(db).get(1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('replaces lines with a compare-and-set on updatedAt + DRAFT', async () => {
      const db = createInventoryDb();
      mockReturn(db);
      await buildGoodsReturnsService(db).update(60, { ...createDto, updatedAt: VERSION } as never, 3);
      expect(db.goodsReturn.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 60, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.goodsReturnItem.deleteMany).toHaveBeenCalledWith({ where: { goodsReturnId: 60 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RETURN_UPDATED' }) });
    });

    it('refuses to edit a POSTED return and a stale version', async () => {
      const db = createInventoryDb();
      mockReturn(db, draftReturn({ status: 'POSTED', returnNumber: 'GRT-1405-000001' }));
      const service = buildGoodsReturnsService(db);
      await expect(service.update(60, { ...createDto, updatedAt: VERSION } as never, 3)).rejects.toBeInstanceOf(ConflictException);

      mockReturn(db);
      await expect(service.update(60, { ...createDto, updatedAt: new Date('2020-01-01') } as never, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.goodsReturnItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('locks the draft, claims GRT-1405-000001, writes SUPPLIER_RETURN out of ON_HAND, marks POSTED, audits', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      mockReturn(db);

      const result: any = await buildGoodsReturnsService(db).post(60, VERSION, 3, '127.0.0.1');

      expect((db.$queryRaw.mock.calls[0][0] as string[]).join('?')).toContain('FROM goods_returns WHERE id = ? FOR UPDATE');
      expect(result).toEqual(expect.objectContaining({ status: 'POSTED', returnNumber: 'GRT-1405-000001', postedByUserId: 3 }));
      expect(balanceOf(db, 1)).toEqual({ onHand: '7', reserved: '0', qc: '0' });
      expect(db.state.movements).toEqual([
        expect.objectContaining({ movementType: 'OPENING_BALANCE' }),
        expect.objectContaining({ itemId: 1, bucket: 'ON_HAND', movementType: 'SUPPLIER_RETURN', referenceType: 'GOODS_RETURN', referenceId: 60, referenceLineId: 201, referenceNumber: 'GRT-1405-000001' }),
      ]);
      expect(db.state.movements[1].quantity.toString()).toBe('-3');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RETURN_POSTED', details: expect.stringContaining('GRT-1405-000001') }) });
    });

    it('posts from QC and from DAMAGED too, each only out of its own bucket', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 4);
      setBucket(db, 1, 'DAMAGED', 2);
      mockReturn(
        db,
        draftReturn({
          items: [
            line({ id: 201, fromBucket: 'QC', quantity: new Prisma.Decimal(4) }),
            line({ id: 202, fromBucket: 'DAMAGED', quantity: new Prisma.Decimal(2) }),
          ],
        }),
      );

      await buildGoodsReturnsService(db).post(60, VERSION, 3);

      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '0' });
      expect(damagedOf(db, 1)).toBe('0');
      const posted = db.state.movements.filter((m: any) => m.movementType === 'SUPPLIER_RETURN');
      expect(posted.map((m: any) => [m.bucket, m.quantity.toString()]).sort()).toEqual([
        ['DAMAGED', '-2'],
        ['QC', '-4'],
      ]);
    });

    it('refuses an ON_HAND line that would eat another order’s reservation (409 STOCK_RESERVED_FOR_OTHERS), writing nothing', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'RESERVED', 8); // only 2 free
      mockReturn(db, draftReturn({ items: [line({ quantity: new Prisma.Decimal(3) })] }));

      await expect(buildGoodsReturnsService(db).post(60, VERSION, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: STOCK_RESERVED_FOR_OTHERS }),
      });
      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '8', qc: '0' });
      expect(db.state.sequences.size).toBe(0);
    });

    it('a line that would take its bucket negative fails as a whole (409 NEGATIVE_STOCK), burning no number', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 2);
      mockReturn(db, draftReturn({ items: [line({ quantity: new Prisma.Decimal(5) })] }));

      await expect(buildGoodsReturnsService(db).post(60, VERSION, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
      expect(balanceOf(db, 1)).toEqual({ onHand: '2', reserved: '0', qc: '0' });
      expect(db.state.sequences.size).toBe(0);
    });

    it('caps and increments the referenced GoodsReceiptItem’s returnedQty (and rejectedQty when fromBucket is QC)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 4);
      seedGoodsReceiptItem(db, { id: 101, itemId: 1, quantity: 10, releasedQty: 6, returnedQty: 2 });
      mockReturn(db, draftReturn({ items: [line({ fromBucket: 'QC', quantity: new Prisma.Decimal(4), goodsReceiptItemId: 101 })] }));

      await buildGoodsReturnsService(db).post(60, VERSION, 3);

      const receiptItem = db.state.goodsReceiptItems.find((r: any) => r.id === 101);
      expect(receiptItem.returnedQty.toString()).toBe('6'); // 2 + 4
      expect(receiptItem.rejectedQty.toString()).toBe('4'); // 0 + 4 (QC-sourced)
    });

    it('refuses to exceed the receipt-item cap at posting even if it was within it at create time (re-checked, locked)', async () => {
      const db = createInventoryDb();
      seedStock(db, 1, 10);
      seedGoodsReceiptItem(db, { id: 101, itemId: 1, quantity: 10, returnedQty: 8 });
      mockReturn(db, draftReturn({ items: [line({ fromBucket: 'ON_HAND', quantity: new Prisma.Decimal(3), goodsReceiptItemId: 101 })] }));

      await expect(buildGoodsReturnsService(db).post(60, VERSION, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'GOODS_RETURN_EXCEEDS_RECEIPT_LINE' }),
      });
      expect(db.state.sequences.size).toBe(0);
      expect(db.state.goodsReceiptItems.find((r: any) => r.id === 101).returnedQty.toString()).toBe('8');
    });

    it('a batch-tracked line posts out of its own batch balance', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'B1', onHand: 10 });
      mockReturn(db, draftReturn({ items: [line({ batchId: batch.id, quantity: new Prisma.Decimal(4) })] }));

      await buildGoodsReturnsService(db).post(60, VERSION, 3);

      const batchBalance = db.state.batchBalances.find((b: any) => b.batchId === batch.id);
      expect(batchBalance.onHand.toString()).toBe('6');
    });

    it('refuses an already-POSTED return and a stale version, writing nothing', async () => {
      const db = createInventoryDb();
      mockReturn(db, draftReturn({ status: 'POSTED', returnNumber: 'GRT-1405-000001' }));
      const service = buildGoodsReturnsService(db);
      await expect(service.post(60, VERSION, 3)).rejects.toBeInstanceOf(ConflictException);

      mockReturn(db);
      await expect(service.post(60, new Date('2020-01-01'), 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (audited) and refuses a POSTED return', async () => {
      const db = createInventoryDb();
      const service = buildGoodsReturnsService(db);
      db.goodsReturn.findUnique.mockResolvedValueOnce({ id: 60, status: 'DRAFT', supplierName: 'x' });
      await service.remove(60, 3);
      expect(db.goodsReturn.delete).toHaveBeenCalledWith({ where: { id: 60 } });
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOODS_RETURN_DELETED' }) });

      db.goodsReturn.findUnique.mockResolvedValueOnce({ id: 60, status: 'POSTED', supplierName: 'x' });
      await expect(service.remove(60, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.goodsReturn.delete).toHaveBeenCalledTimes(1);
    });
  });
});

describe('GoodsReturnsController — permission gates (I8)', () => {
  const proto = GoodsReturnsController.prototype;
  it('deleting a draft needs its own delete permission (inventory.delete)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.remove)).toEqual(['inventory.delete']);
  });

  it('reads need inventory.view', () => {
    for (const method of [proto.list, proto.get]) expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.view']);
  });
  it('every write and the form pickers need inventory.receive — the same permission as goods receipts', () => {
    for (const method of [proto.create, proto.update, proto.post, proto.formOptions, proto.goodsReceiptOptions]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.receive']);
    }
  });
});
