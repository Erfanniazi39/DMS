import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { balanceOf, seedStock, setBucket } from '../inventory/inventory.spec-helpers';
import { CREDIT_LIMIT_EXCEEDED, SALES_ORDER_APPROVAL_REQUIRED } from './sales-rules';
import {
  buildSalesOrdersService,
  createSalesDb,
  draftOrder,
  MANAGER,
  mockOrder,
  ORDER_DATE,
  orderLine,
  SALESPERSON,
  setCreditPolicy,
  validCreateDto,
  VERSION,
  type SalesDb,
} from './sales.spec-helpers';

// SalesOrdersService — DRAFT CRUD and every status action. Stock and the
// document sequence run on the Inventory in-memory fake (real rollback), so
// reservation, release and "no number burned" are asserted on state.

const actions = (db: SalesDb) => db.auditLog.create.mock.calls.map((call: any) => call[0].data.action);

describe('SalesOrdersService', () => {
  describe('create (DRAFT)', () => {
    it('creates a DRAFT with no number and no stock effect; snapshots customer, item, list price and the payment term from the customer policy', async () => {
      const db = createSalesDb();
      await buildSalesOrdersService(db).create(validCreateDto as never, SALESPERSON);

      const data = db.salesOrder.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          status: 'DRAFT',
          customerName: 'فروشگاه نمونه',
          customerEconomicCode: '411',
          paymentTermId: 4,
          paymentTermName: '۳۰ روزه',
          paymentDueDays: 30,
          locationId: 1,
          createdByUserId: 5,
        }),
      );
      expect(data.orderNumber).toBeUndefined();
      expect(data.totalAmount.toString()).toBe('5000');
      expect(data.items.create[0]).toEqual(
        expect.objectContaining({ lineNo: 1, itemId: 1, itemCode: 'ITM-1', itemName: 'شیر', unitId: 1, unitName: 'عدد', unitPrice: 1000, priceOverrideReason: null }),
      );
      expect(data.items.create[0].listUnitPrice.toString()).toBe('1000');
      expect(actions(db)).toEqual(['SALES_ORDER_CREATED']);
      // Numbering happens only at CONFIRMED (build plan §9: never at draft creation).
      expect(db.state.sequences.size).toBe(0);
      expect(db.state.movements).toHaveLength(0);
    });

    it('refuses a customer that is not transactable (inactive / credit hold)', async () => {
      const db = createSalesDb();
      db.customer.findUnique.mockResolvedValue({ id: 9, status: 'ACTIVE', name: 'x', financialProfile: { creditHold: true } });
      await expect(buildSalesOrdersService(db).create(validCreateDto as never, MANAGER)).rejects.toThrow('توقف اعتباری');
      expect(db.salesOrder.create).not.toHaveBeenCalled();
    });

    it('refuses an inactive item and a delivery address of another customer', async () => {
      const db = createSalesDb();
      const service = buildSalesOrdersService(db);
      await expect(service.create({ ...validCreateDto, items: [{ itemId: 3, quantity: 1, unitPrice: 500 }] } as never, SALESPERSON)).rejects.toThrow('غیرفعال');
      db.customerAddress.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...validCreateDto, deliveryAddressId: 77 } as never, SALESPERSON)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.salesOrder.create).not.toHaveBeenCalled();
    });

    describe('B2 — price override', () => {
      it('below the list price requires a reason', async () => {
        const db = createSalesDb();
        const dto = { ...validCreateDto, items: [{ itemId: 1, quantity: 1, unitPrice: 900 }] };
        await expect(buildSalesOrdersService(db).create(dto as never, SALESPERSON)).rejects.toThrow('علت کاهش قیمت');
        expect(db.salesOrder.create).not.toHaveBeenCalled();
      });

      it('below list WITH a reason is allowed for a plain sales.manage user and the reason is stored', async () => {
        const db = createSalesDb();
        const dto = { ...validCreateDto, items: [{ itemId: 1, quantity: 1, unitPrice: 900, priceOverrideReason: 'مشتری عمده' }] };
        await buildSalesOrdersService(db).create(dto as never, SALESPERSON);
        expect(db.salesOrder.create.mock.calls[0][0].data.items.create[0]).toEqual(expect.objectContaining({ unitPrice: 900, priceOverrideReason: 'مشتری عمده' }));
      });

      it('above list needs no reason (and a stray reason is not stored); no list price = free pricing', async () => {
        const db = createSalesDb();
        const dto = {
          ...validCreateDto,
          items: [
            { itemId: 1, quantity: 1, unitPrice: 1200, priceOverrideReason: 'بی‌ربط' },
            { itemId: 2, quantity: 1, unitPrice: 1 },
          ],
        };
        await buildSalesOrdersService(db).create(dto as never, SALESPERSON);
        const lines = db.salesOrder.create.mock.calls[0][0].data.items.create;
        expect(lines[0].priceOverrideReason).toBeNull();
        expect(lines[1].listUnitPrice).toBeNull();
      });
    });

    describe('B3 — discount is sales.approve-only', () => {
      it.each([{ discountPercent: 10 }, { discountAmount: 100 }])('refuses %o from a user without sales.approve (403)', async (discount) => {
        const db = createSalesDb();
        const dto = { ...validCreateDto, items: [{ itemId: 1, quantity: 5, unitPrice: 1000, ...discount }] };
        await expect(buildSalesOrdersService(db).create(dto as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
        expect(db.salesOrder.create).not.toHaveBeenCalled();
      });

      it('accepts a discount from a sales.approve holder and derives the money server-side', async () => {
        const db = createSalesDb();
        const dto = { ...validCreateDto, items: [{ itemId: 1, quantity: 5, unitPrice: 1000, discountPercent: 10 }] };
        await buildSalesOrdersService(db).create(dto as never, MANAGER);
        const data = db.salesOrder.create.mock.calls[0][0].data;
        expect([data.items.create[0].discountAmount.toString(), data.discountTotal.toString(), data.totalAmount.toString()]).toEqual(['500', '500', '4500']);
      });
    });
  });

  describe('update (DRAFT)', () => {
    const updateDto = { ...validCreateDto, updatedAt: VERSION };

    it('replaces the lines of a DRAFT with a compare-and-set on updatedAt + status', async () => {
      const db = createSalesDb();
      mockOrder(db);
      await buildSalesOrdersService(db).update(11, updateDto as never, SALESPERSON);
      expect(db.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.salesOrderItem.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: 11 } });
      expect(actions(db)).toEqual(['SALES_ORDER_UPDATED']);
    });

    it('refuses a non-DRAFT order and a stale version', async () => {
      const db = createSalesDb();
      const service = buildSalesOrdersService(db);
      mockOrder(db, draftOrder({ status: 'PENDING_APPROVAL' }));
      await expect(service.update(11, updateDto as never, MANAGER)).rejects.toThrow('پیش‌نویس');

      mockOrder(db);
      await expect(service.update(11, { ...updateDto, updatedAt: new Date('2020-01-01') } as never, MANAGER)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      db.salesOrder.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.update(11, updateDto as never, MANAGER)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });
      expect(db.salesOrderItem.deleteMany).not.toHaveBeenCalled();
    });

    it('a user without sales.approve cannot save a draft that already carries a manager discount', async () => {
      const db = createSalesDb();
      mockOrder(db, draftOrder({ items: [orderLine({ discountAmount: new Prisma.Decimal(500) })] }));
      await expect(buildSalesOrdersService(db).update(11, updateDto as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.salesOrderItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (lines cascade) and audits — no number exists, so no gap', async () => {
      const db = createSalesDb();
      mockOrder(db);
      await expect(buildSalesOrdersService(db).remove(11, SALESPERSON)).resolves.toEqual({ success: true });
      expect(db.salesOrder.delete).toHaveBeenCalledWith({ where: { id: 11 } });
      expect(actions(db)).toEqual(['SALES_ORDER_DELETED']);
    });

    it.each(['PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED', 'CLOSED'])('refuses to delete a %s order', async (status) => {
      const db = createSalesDb();
      mockOrder(db, draftOrder({ status, orderNumber: status === 'PENDING_APPROVAL' ? null : 'SO-1405-000001' }));
      await expect(buildSalesOrdersService(db).remove(11, MANAGER)).rejects.toBeInstanceOf(ConflictException);
      expect(db.salesOrder.delete).not.toHaveBeenCalled();
    });

    it('404s for an unknown order', async () => {
      const db = createSalesDb();
      db.salesOrder.findUnique.mockResolvedValue(null);
      await expect(buildSalesOrdersService(db).remove(11, MANAGER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirm', () => {
    const confirmDto = { updatedAt: VERSION, submitForApproval: false };

    it('within credit, no discount: CONFIRMED, numbered SO-<jalali year>-000001, stock reserved through the ledger, audited', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      const current = mockOrder(db);

      const result = await buildSalesOrdersService(db).confirm(11, confirmDto as never, SALESPERSON);

      const lockSql = (db.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(lockSql).toContain('FROM sales_orders WHERE id = ? FOR UPDATE');
      expect(current()).toEqual(expect.objectContaining({ status: 'CONFIRMED', orderNumber: 'SO-1405-000001', confirmedByUserId: 5 }));
      expect(current().approvedByUserId).toBeUndefined();
      expect(result.backorders).toEqual([]);
      expect(balanceOf(db, 1)).toEqual({ onHand: '20', reserved: '5', qc: '0' });
      expect(db.state.movements[1]).toEqual(
        expect.objectContaining({
          itemId: 1,
          bucket: 'RESERVED',
          movementType: 'RESERVE',
          referenceType: 'SALES_ORDER',
          referenceId: 11,
          referenceLineId: 101,
          referenceNumber: 'SO-1405-000001',
          movementDate: ORDER_DATE,
        }),
      );
      expect(db.salesOrderItem.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { reservedQty: new Prisma.Decimal(5) } });
      expect(actions(db)).toEqual(['SALES_ORDER_CONFIRMED']);
    });

    it('a stock shortfall is a backorder WARNING, not a block: reserves what is available and confirms', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 3);
      const current = mockOrder(db);

      const result = await buildSalesOrdersService(db).confirm(11, confirmDto as never, SALESPERSON);

      expect(current().status).toBe('CONFIRMED');
      expect(result.backorders).toEqual([{ lineNo: 1, itemId: 1, itemName: 'شیر', quantity: '5', reserved: '3', shortfall: '2' }]);
      expect(balanceOf(db, 1)?.reserved).toBe('3');
      expect(db.auditLog.create.mock.calls[0][0].data.details).toContain('کسری موجودی');
    });

    it('stock already reserved by other orders is not available; no stock at all reserves nothing (no movement) and still confirms', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'RESERVED', 8);
      mockOrder(db, draftOrder({ items: [orderLine(), orderLine({ id: 102, lineNo: 2, itemId: 2, itemName: 'ماست', quantity: new Prisma.Decimal(4) })] }));

      const result = await buildSalesOrdersService(db).confirm(11, confirmDto as never, SALESPERSON);

      expect(balanceOf(db, 1)?.reserved).toBe('10'); // 8 + min(5, 10 − 8)
      expect(result.backorders.map((b) => [b.lineNo, b.reserved, b.shortfall])).toEqual([
        [1, '2', '3'],
        [2, '0', '4'],
      ]);
      expect(db.state.movements.filter((m: any) => m.movementType === 'RESERVE')).toHaveLength(1);
    });

    it('B4: creditLimit = null (cash-only) — a salesperson gets 409 SALES_ORDER_APPROVAL_REQUIRED without credit figures; nothing is numbered or reserved', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setCreditPolicy(db, { creditLimit: null });
      const current = mockOrder(db);

      await expect(buildSalesOrdersService(db).confirm(11, confirmDto as never, SALESPERSON)).rejects.toMatchObject({
        response: expect.objectContaining({ code: SALES_ORDER_APPROVAL_REQUIRED, details: { reasons: ['CREDIT_LIMIT'] } }),
      });
      expect(current().status).toBe('DRAFT');
      expect(db.state.sequences.size).toBe(0);
      expect(balanceOf(db, 1)?.reserved).toBe('0');
    });

    it('submitForApproval moves it to PENDING_APPROVAL — still no number, no reservation', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setCreditPolicy(db, { creditLimit: 1000 });
      const current = mockOrder(db);

      const result = await buildSalesOrdersService(db).confirm(11, { ...confirmDto, submitForApproval: true } as never, SALESPERSON);

      expect(current().status).toBe('PENDING_APPROVAL');
      expect(current().orderNumber).toBeNull();
      expect(result.backorders).toEqual([]);
      expect(db.state.sequences.size).toBe(0);
      expect(balanceOf(db, 1)?.reserved).toBe('0');
      expect(actions(db)).toEqual(['SALES_ORDER_SUBMITTED_FOR_APPROVAL']);
    });

    it('B4: a manager over the limit without a reason gets 409 CREDIT_LIMIT_EXCEEDED with figures — and no number is burned', async () => {
      const db = createSalesDb();
      setCreditPolicy(db, { creditLimit: 4000 });
      mockOrder(db);

      await expect(buildSalesOrdersService(db).confirm(11, confirmDto as never, MANAGER)).rejects.toMatchObject({
        response: expect.objectContaining({ code: CREDIT_LIMIT_EXCEEDED, details: expect.objectContaining({ creditLimit: '4000', excess: '1000' }) }),
      });
      expect(db.state.sequences.size).toBe(0);
    });

    it('B4: a manager WITH an override reason confirms; the override is stamped and separately audited', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setCreditPolicy(db, { creditLimit: null });
      const current = mockOrder(db);

      await buildSalesOrdersService(db).confirm(11, { ...confirmDto, creditOverrideReason: 'ضمانت شفاهی مدیر' } as never, MANAGER);

      expect(current()).toEqual(
        expect.objectContaining({
          status: 'CONFIRMED',
          orderNumber: 'SO-1405-000001',
          creditOverrideByUserId: 2,
          creditOverrideReason: 'ضمانت شفاهی مدیر',
          approvedByUserId: 2,
        }),
      );
      expect(actions(db)).toEqual(['SALES_ORDER_CONFIRMED', 'SALES_ORDER_CREDIT_OVERRIDE']);
    });

    it('a user without sales.approve cannot send a credit override reason (403)', async () => {
      const db = createSalesDb();
      mockOrder(db);
      await expect(buildSalesOrdersService(db).confirm(11, { ...confirmDto, creditOverrideReason: 'x' } as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('credit hold blocks everyone — even a manager with an override reason', async () => {
      const db = createSalesDb();
      db.customer.findUnique.mockResolvedValue({ id: 9, status: 'ACTIVE', financialProfile: { creditHold: true } });
      mockOrder(db);
      await expect(buildSalesOrdersService(db).confirm(11, { ...confirmDto, creditOverrideReason: 'x' } as never, MANAGER)).rejects.toThrow('توقف اعتباری');
      expect(db.state.sequences.size).toBe(0);
    });

    it('a discounted order needs sales.approve to confirm: salesperson → APPROVAL_REQUIRED (DISCOUNT); manager confirms directly with approval stamped', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      const discounted = () => draftOrder({ items: [orderLine({ discountPercent: new Prisma.Decimal(10), discountAmount: new Prisma.Decimal(500) })], totalAmount: new Prisma.Decimal(4500) });
      mockOrder(db, discounted());
      await expect(buildSalesOrdersService(db).confirm(11, confirmDto as never, SALESPERSON)).rejects.toMatchObject({
        response: expect.objectContaining({ code: SALES_ORDER_APPROVAL_REQUIRED, details: { reasons: ['DISCOUNT'] } }),
      });

      const current = mockOrder(db, discounted());
      await buildSalesOrdersService(db).confirm(11, confirmDto as never, MANAGER);
      expect(current()).toEqual(expect.objectContaining({ status: 'CONFIRMED', approvedByUserId: 2 }));
      expect(current().creditOverrideByUserId).toBeUndefined();
    });

    it('gap-free numbering: a refused confirm burns nothing; successful confirms get consecutive numbers', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 100);
      const service = buildSalesOrdersService(db);

      setCreditPolicy(db, { creditLimit: 100 });
      mockOrder(db, draftOrder({ id: 11 }));
      await expect(service.confirm(11, confirmDto as never, MANAGER)).rejects.toMatchObject({ response: expect.objectContaining({ code: CREDIT_LIMIT_EXCEEDED }) });

      setCreditPolicy(db, { creditLimit: 1_000_000 });
      const first = mockOrder(db, draftOrder({ id: 12 }));
      await service.confirm(12, confirmDto as never, MANAGER);
      const second = mockOrder(db, draftOrder({ id: 13 }));
      await service.confirm(13, confirmDto as never, MANAGER);
      expect([first().orderNumber, second().orderNumber]).toEqual(['SO-1405-000001', 'SO-1405-000002']);
    });

    it('refuses a non-DRAFT order and a stale version, without claiming a number', async () => {
      const db = createSalesDb();
      const service = buildSalesOrdersService(db);
      mockOrder(db, draftOrder({ status: 'CONFIRMED', orderNumber: 'SO-1405-000001' }));
      await expect(service.confirm(11, confirmDto as never, MANAGER)).rejects.toBeInstanceOf(ConflictException);
      mockOrder(db, draftOrder({ status: 'PENDING_APPROVAL' }));
      await expect(service.confirm(11, confirmDto as never, MANAGER)).rejects.toBeInstanceOf(ConflictException);
      mockOrder(db);
      await expect(service.confirm(11, { ...confirmDto, updatedAt: new Date('2020-01-01') } as never, MANAGER)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.state.sequences.size).toBe(0);
    });
  });

  describe('approve / reject', () => {
    it('approve: PENDING_APPROVAL → CONFIRMED, numbered and reserved, audited as APPROVED (override reason required if still over the limit)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setCreditPolicy(db, { creditLimit: null });
      const service = buildSalesOrdersService(db);

      mockOrder(db, draftOrder({ status: 'PENDING_APPROVAL' }));
      await expect(service.approve(11, { updatedAt: VERSION } as never, MANAGER)).rejects.toMatchObject({ response: expect.objectContaining({ code: CREDIT_LIMIT_EXCEEDED }) });

      const current = mockOrder(db, draftOrder({ status: 'PENDING_APPROVAL' }));
      await service.approve(11, { updatedAt: VERSION, creditOverrideReason: 'پیش‌پرداخت نقدی', note: 'ok' } as never, MANAGER);
      expect(current()).toEqual(expect.objectContaining({ status: 'CONFIRMED', orderNumber: 'SO-1405-000001', approvedByUserId: 2, approvalReason: 'ok' }));
      expect(balanceOf(db, 1)?.reserved).toBe('5');
      expect(actions(db)).toEqual(['SALES_ORDER_APPROVED', 'SALES_ORDER_CREDIT_OVERRIDE']);
    });

    it('approve refuses an order that is not PENDING_APPROVAL', async () => {
      const db = createSalesDb();
      mockOrder(db);
      await expect(buildSalesOrdersService(db).approve(11, { updatedAt: VERSION } as never, MANAGER)).rejects.toThrow('در انتظار تأیید');
    });

    it('reject: PENDING_APPROVAL → DRAFT (editable again), no number', async () => {
      const db = createSalesDb();
      const current = mockOrder(db, draftOrder({ status: 'PENDING_APPROVAL' }));
      await buildSalesOrdersService(db).reject(11, { updatedAt: VERSION, reason: 'تخفیف زیاد است' } as never, MANAGER);
      expect(current()).toEqual(expect.objectContaining({ status: 'DRAFT', orderNumber: null }));
      expect(db.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ action: 'SALES_ORDER_REJECTED', details: 'علت: تخفیف زیاد است' }));
    });
  });

  describe('cancel / close', () => {
    function confirmedWithReservation(db: SalesDb, overrides: Record<string, unknown> = {}) {
      seedStock(db, 1, 20);
      setBucket(db, 1, 'RESERVED', 5);
      return mockOrder(db, draftOrder({ status: 'CONFIRMED', orderNumber: 'SO-1405-000001', items: [orderLine({ reservedQty: new Prisma.Decimal(5) })], ...overrides }));
    }

    it('cancel releases the reservation (RELEASE movement), zeroes reservedQty, stamps the reason', async () => {
      const db = createSalesDb();
      const current = confirmedWithReservation(db);

      await buildSalesOrdersService(db).cancel(11, { updatedAt: VERSION, reason: 'انصراف مشتری' } as never, SALESPERSON);

      expect(balanceOf(db, 1)?.reserved).toBe('0');
      expect(db.state.movements.at(-1)).toEqual(
        expect.objectContaining({ movementType: 'RELEASE', bucket: 'RESERVED', referenceType: 'SALES_ORDER', referenceId: 11, referenceLineId: 101, referenceNumber: 'SO-1405-000001' }),
      );
      expect(db.state.movements.at(-1).quantity.toString()).toBe('-5');
      expect(db.salesOrderItem.updateMany).toHaveBeenCalledWith({ where: { salesOrderId: 11 }, data: { reservedQty: 0 } });
      expect(current()).toEqual(expect.objectContaining({ status: 'CANCELLED', cancelReason: 'انصراف مشتری', cancelledByUserId: 5, orderNumber: 'SO-1405-000001' }));
      expect(actions(db)).toEqual(['SALES_ORDER_CANCELLED']);
    });

    it('cancel is refused once anything has been delivered (close instead)', async () => {
      const db = createSalesDb();
      confirmedWithReservation(db, { items: [orderLine({ reservedQty: new Prisma.Decimal(2), deliveredQty: new Prisma.Decimal(3) })] });
      await expect(buildSalesOrdersService(db).cancel(11, { updatedAt: VERSION, reason: 'x' } as never, MANAGER)).rejects.toThrow('تحویل شده');
      expect(balanceOf(db, 1)?.reserved).toBe('5');
    });

    it('close (short-close) releases what is still reserved, also after a partial delivery', async () => {
      const db = createSalesDb();
      const current = confirmedWithReservation(db, { items: [orderLine({ reservedQty: new Prisma.Decimal(2), deliveredQty: new Prisma.Decimal(3) })] });
      setBucket(db, 1, 'RESERVED', 2);

      await buildSalesOrdersService(db).close(11, { updatedAt: VERSION, reason: 'باقی‌مانده لازم نیست' } as never, MANAGER);

      expect(balanceOf(db, 1)?.reserved).toBe('0');
      expect(current()).toEqual(expect.objectContaining({ status: 'CLOSED', closeReason: 'باقی‌مانده لازم نیست', closedByUserId: 2 }));
    });

    it.each(['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'CLOSED'])('cancel/close are refused from %s', async (status) => {
      const db = createSalesDb();
      const service = buildSalesOrdersService(db);
      mockOrder(db, draftOrder({ status }));
      await expect(service.cancel(11, { updatedAt: VERSION, reason: 'x' } as never, MANAGER)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.close(11, { updatedAt: VERSION, reason: 'x' } as never, MANAGER)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.movements).toHaveLength(0);
    });
  });
});
