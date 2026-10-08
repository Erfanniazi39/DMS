import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { balanceOf, seedStock, setBucket } from '../inventory/inventory.spec-helpers';
import { STOCK_RESERVED_FOR_OTHERS } from '../inventory/stock-ledger';
import { CUSTOMER_CREDIT_HOLD } from './sales-rules';
import { buildDeliveriesService, createSalesDb, draftOrder, ORDER_DATE, orderLine, setCreditPolicy, VERSION, type SalesDb } from './sales.spec-helpers';

// DeliveriesService — DRAFT CRUD and posting. Stock and the document
// sequence run on the Inventory in-memory fake (real rollback), so the
// DELIVERY_ISSUE effect, the negative-stock block and "no number burned" are
// asserted on state. The order and delivery rows are a small mutable world
// (salesOrderItem.update / salesOrder.update write into it), so the counter
// and derived-status recompute is asserted on the resulting order.

const ACTOR = { userId: 4, ipAddress: '127.0.0.1' };
const actions = (db: SalesDb) => db.auditLog.create.mock.calls.map((call: any) => call[0].data.action);
const dec = (value: number) => new Prisma.Decimal(value);

function confirmedOrder(overrides: Record<string, unknown> = {}) {
  return draftOrder({
    status: 'CONFIRMED',
    orderNumber: 'SO-1405-000001',
    deliveryStatus: 'NOT_DELIVERED',
    invoicingStatus: 'NOT_INVOICED',
    deliveryAddressText: 'تهران، خیابان نمونه',
    items: [
      orderLine({ id: 101, lineNo: 1, itemId: 1, quantity: dec(5), reservedQty: dec(5) }),
      orderLine({ id: 102, lineNo: 2, itemId: 2, itemName: 'ماست', quantity: dec(3), reservedQty: dec(0) }),
    ],
    ...overrides,
  });
}

function draftDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    deliveryNumber: null,
    salesOrderId: 11,
    customerId: 9,
    locationId: 1,
    location: { isActive: true },
    deliveryDate: ORDER_DATE,
    status: 'DRAFT',
    updatedAt: VERSION,
    items: [{ id: 301, salesOrderItemId: 101, itemId: 1, quantity: dec(3) }],
    ...overrides,
  };
}

function world(db: SalesDb, init: { order?: any; delivery?: any } = {}) {
  const state = { order: init.order ?? confirmedOrder(), delivery: init.delivery ?? draftDelivery() };
  db.salesOrder.findUnique.mockImplementation(async () => state.order);
  db.salesOrder.update.mockImplementation(async ({ data }: any) => Object.assign(state.order, data));
  db.salesOrderItem.update.mockImplementation(async ({ where, data }: any) => {
    const line = state.order.items.find((entry: any) => entry.id === where.id);
    return Object.assign(line, data);
  });
  db.delivery.findUnique.mockImplementation(async () => state.delivery);
  db.delivery.update.mockImplementation(async ({ data }: any) => Object.assign(state.delivery, data));
  return state;
}

const rawSql = (db: SalesDb) => db.$queryRaw.mock.calls.map((call: any) => (call[0] as string[]).join('?'));

describe('DeliveriesService', () => {
  describe('createFromOrder (DRAFT)', () => {
    it('prefills every line with its undelivered quantity (quantity − deliveredQty), skips fully delivered lines; no number, no stock effect', async () => {
      const db = createSalesDb();
      world(db, {
        order: confirmedOrder({
          items: [
            orderLine({ id: 101, lineNo: 1, itemId: 1, quantity: dec(5), deliveredQty: dec(2), reservedQty: dec(3) }),
            orderLine({ id: 102, lineNo: 2, itemId: 2, quantity: dec(3), deliveredQty: dec(3) }),
          ],
        }),
      });

      await buildDeliveriesService(db).createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE } as never, ACTOR);

      const data = db.delivery.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({ salesOrderId: 11, customerId: 9, locationId: 1, deliveryAddressText: 'تهران، خیابان نمونه', status: 'DRAFT', createdByUserId: 4 }),
      );
      expect(data.deliveryNumber).toBeUndefined();
      expect(data.items.create).toEqual([{ salesOrderItemId: 101, itemId: 1, quantity: 3 }]);
      expect(actions(db)).toEqual(['DELIVERY_CREATED']);
      expect(db.state.sequences.size).toBe(0);
      expect(db.state.movements).toHaveLength(0);
    });

    it('accepts explicit lines up to the undelivered quantity and refuses more (400)', async () => {
      const db = createSalesDb();
      world(db);
      const service = buildDeliveriesService(db);
      await service.createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE, items: [{ salesOrderItemId: 102, quantity: 3 }] } as never, ACTOR);
      expect(db.delivery.create.mock.calls[0][0].data.items.create).toEqual([{ salesOrderItemId: 102, itemId: 2, quantity: 3 }]);

      await expect(
        service.createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE, items: [{ salesOrderItemId: 102, quantity: 3.5 }] } as never, ACTOR),
      ).rejects.toThrow('تحویل‌نشده');
      await expect(
        service.createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE, items: [{ salesOrderItemId: 999, quantity: 1 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.delivery.create).toHaveBeenCalledTimes(1);
    });

    it.each(['DRAFT', 'PENDING_APPROVAL', 'CLOSED', 'CANCELLED', 'COMPLETED'])('refuses a %s order (409)', async (status) => {
      const db = createSalesDb();
      world(db, { order: confirmedOrder({ status }) });
      await expect(buildDeliveriesService(db).createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE } as never, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.delivery.create).not.toHaveBeenCalled();
    });

    it('refuses a fully delivered order, a delivery date before the order date, and an unknown order', async () => {
      const db = createSalesDb();
      const state = world(db, {
        order: confirmedOrder({ items: [orderLine({ id: 101, quantity: dec(5), deliveredQty: dec(5) })] }),
      });
      const service = buildDeliveriesService(db);
      await expect(service.createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE } as never, ACTOR)).rejects.toThrow('تحویل شده است');

      state.order = confirmedOrder();
      await expect(service.createFromOrder({ salesOrderId: 11, deliveryDate: new Date('2026-10-05T00:00:00.000Z') } as never, ACTOR)).rejects.toThrow(
        'پیش از تاریخ سفارش',
      );

      db.salesOrder.findUnique.mockResolvedValue(null);
      await expect(service.createFromOrder({ salesOrderId: 11, deliveryDate: ORDER_DATE } as never, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.delivery.create).not.toHaveBeenCalled();
    });
  });

  describe('update (DRAFT)', () => {
    const updateDto = { updatedAt: VERSION, deliveryDate: ORDER_DATE, receivedByName: 'آقای نمونه', items: [{ salesOrderItemId: 101, quantity: 2 }] };

    it('replaces the lines of a DRAFT with a compare-and-set on updatedAt + status', async () => {
      const db = createSalesDb();
      world(db);
      await buildDeliveriesService(db).update(31, updateDto as never, ACTOR);
      expect(db.delivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.deliveryItem.deleteMany).toHaveBeenCalledWith({ where: { deliveryId: 31 } });
      expect(db.delivery.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ receivedByName: 'آقای نمونه', items: { create: [{ salesOrderItemId: 101, itemId: 1, quantity: 2 }] } }),
      );
      expect(actions(db)).toEqual(['DELIVERY_UPDATED']);
    });

    it('refuses a POSTED delivery, a stale version, a lost compare-and-set, and an order that is no longer CONFIRMED', async () => {
      const db = createSalesDb();
      const state = world(db, { delivery: draftDelivery({ status: 'POSTED', deliveryNumber: 'DN-1405-000001' }) });
      const service = buildDeliveriesService(db);
      await expect(service.update(31, updateDto as never, ACTOR)).rejects.toThrow('پیش‌نویس');

      state.delivery = draftDelivery();
      await expect(service.update(31, { ...updateDto, updatedAt: new Date('2020-01-01') } as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      db.delivery.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.update(31, updateDto as never, ACTOR)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });

      state.order.status = 'CLOSED';
      await expect(service.update(31, updateDto as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(db.deliveryItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT (lines cascade) and audits — no number exists, so no gap', async () => {
      const db = createSalesDb();
      world(db, { delivery: { ...draftDelivery(), salesOrder: { id: 11, orderNumber: 'SO-1405-000001' } } });
      await expect(buildDeliveriesService(db).remove(31, ACTOR)).resolves.toEqual({ success: true });
      expect(rawSql(db)[0]).toContain('FROM deliveries WHERE id = ? FOR UPDATE');
      expect(db.delivery.delete).toHaveBeenCalledWith({ where: { id: 31 } });
      expect(actions(db)).toEqual(['DELIVERY_DELETED']);
    });

    it('refuses to delete a POSTED delivery (it is immutable) and 404s for an unknown one', async () => {
      const db = createSalesDb();
      const state = world(db, { delivery: { ...draftDelivery({ status: 'POSTED' }), salesOrder: { id: 11, orderNumber: 'SO-1405-000001' } } });
      const service = buildDeliveriesService(db);
      await expect(service.remove(31, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      state.delivery = null;
      await expect(service.remove(31, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.delivery.delete).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    const postDto = { updatedAt: VERSION };

    it('POSTED + DN number + DELIVERY_ISSUE (ON_HAND −q, RESERVED −min(q, reserved)) + counters + PARTIALLY_DELIVERED, in one transaction', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setBucket(db, 1, 'RESERVED', 5); // the order's reservation
      const state = world(db);

      await buildDeliveriesService(db).post(31, postDto as never, ACTOR);

      expect(state.delivery).toEqual(expect.objectContaining({ status: 'POSTED', deliveryNumber: 'DN-1405-000001', postedByUserId: 4 }));
      expect(balanceOf(db, 1)).toEqual({ onHand: '17', reserved: '2', qc: '0' });
      const issues = db.state.movements.filter((m: any) => m.movementType === 'DELIVERY_ISSUE');
      expect(issues.map((m: any) => [m.bucket, m.quantity.toString(), m.referenceType, m.referenceId, m.referenceLineId, m.referenceNumber])).toEqual([
        ['ON_HAND', '-3', 'DELIVERY', 31, 301, 'DN-1405-000001'],
        ['RESERVED', '-3', 'DELIVERY', 31, 301, 'DN-1405-000001'],
      ]);
      // One update per order line, delivered and reserved together.
      expect(db.salesOrderItem.update).toHaveBeenCalledTimes(1);
      const line = state.order.items[0];
      expect([line.deliveredQty.toString(), line.reservedQty.toString()]).toEqual(['3', '2']);
      expect(state.order.deliveryStatus).toBe('PARTIALLY_DELIVERED');
      expect(state.order.status).toBe('CONFIRMED');
      expect(actions(db)).toEqual(['DELIVERY_POSTED', 'SALES_ORDER_DELIVERY_POSTED']);
    });

    it('locks delivery → sales order → stock balances, the balances in (itemId, locationId) order', async () => {
      const db = createSalesDb();
      seedStock(db, 2, 10);
      seedStock(db, 1, 10);
      setBucket(db, 1, 'RESERVED', 5);
      world(db, {
        delivery: draftDelivery({
          items: [
            { id: 302, salesOrderItemId: 102, itemId: 2, quantity: dec(1) },
            { id: 301, salesOrderItemId: 101, itemId: 1, quantity: dec(1) },
          ],
        }),
      });

      await buildDeliveriesService(db).post(31, postDto as never, ACTOR);

      const sql = rawSql(db);
      const deliveryLock = sql.findIndex((text: string) => text.includes('FROM deliveries'));
      const orderLock = sql.findIndex((text: string) => text.includes('FROM sales_orders'));
      const firstStockLock = sql.findIndex((text: string) => text.includes('FROM stock_balances'));
      expect(deliveryLock).toBe(0);
      expect(orderLock).toBeGreaterThan(deliveryLock);
      expect(firstStockLock).toBeGreaterThan(orderLock);
      expect(db.lockOrder.slice(0, 2)).toEqual([
        [1, 1],
        [2, 1],
      ]);
    });

    it('delivering everything → DELIVERED, but NOT COMPLETED while nothing is invoiced (COMPLETED needs invoiced = delivered — Batch 4)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'RESERVED', 5);
      seedStock(db, 2, 10);
      const state = world(db, {
        delivery: draftDelivery({
          items: [
            { id: 301, salesOrderItemId: 101, itemId: 1, quantity: dec(5) },
            { id: 302, salesOrderItemId: 102, itemId: 2, quantity: dec(3) },
          ],
        }),
      });

      await buildDeliveriesService(db).post(31, postDto as never, ACTOR);

      expect(state.order.deliveryStatus).toBe('DELIVERED');
      expect(state.order.status).toBe('CONFIRMED');
      // Line 2 had nothing reserved (backorder) — served from free stock.
      expect(balanceOf(db, 1)).toEqual({ onHand: '5', reserved: '0', qc: '0' });
      expect(balanceOf(db, 2)).toEqual({ onHand: '7', reserved: '0', qc: '0' });
      expect(actions(db)).not.toContain('SALES_ORDER_COMPLETED');
    });

    it('moves the order CONFIRMED → COMPLETED once every line is delivered and invoiced = delivered (wired for Batch 4)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      // Line 2 already delivered and invoiced; line 1 invoiced ahead of this
      // delivery is impossible in practice — here invoicedQty is simply set
      // to what the line will have delivered, to exercise the rule.
      const state = world(db, {
        order: confirmedOrder({
          items: [
            orderLine({ id: 101, lineNo: 1, itemId: 1, quantity: dec(5), deliveredQty: dec(2), invoicedQty: dec(5) }),
            orderLine({ id: 102, lineNo: 2, itemId: 2, quantity: dec(3), deliveredQty: dec(3), invoicedQty: dec(3) }),
          ],
        }),
      });

      await buildDeliveriesService(db).post(31, postDto as never, ACTOR);

      expect(state.order.status).toBe('COMPLETED');
      expect(state.order.deliveryStatus).toBe('DELIVERED');
      expect(actions(db)).toEqual(['DELIVERY_POSTED', 'SALES_ORDER_DELIVERY_POSTED', 'SALES_ORDER_COMPLETED']);
    });

    it('is blocked when ON_HAND would go negative (409 NEGATIVE_STOCK): nothing written, no DN number burned', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 2);
      setBucket(db, 1, 'RESERVED', 2);
      const state = world(db);

      await expect(buildDeliveriesService(db).post(31, postDto as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }),
      });
      expect(balanceOf(db, 1)).toEqual({ onHand: '2', reserved: '2', qc: '0' });
      expect(db.state.sequences.size).toBe(0);
      expect(state.delivery.status).toBe('DRAFT');
      expect(db.salesOrderItem.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('never takes stock reserved for another order (409 STOCK_RESERVED_FOR_OTHERS)', async () => {
      const db = createSalesDb();
      seedStock(db, 2, 5);
      setBucket(db, 2, 'RESERVED', 4); // reserved by some other order; this line holds 0
      world(db, { delivery: draftDelivery({ items: [{ id: 302, salesOrderItemId: 102, itemId: 2, quantity: dec(2) }] }) });

      await expect(buildDeliveriesService(db).post(31, postDto as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: STOCK_RESERVED_FOR_OTHERS }),
      });
      expect(balanceOf(db, 2)).toEqual({ onHand: '5', reserved: '4', qc: '0' });
      expect(db.state.sequences.size).toBe(0);
    });

    it('numbering is gap-free and assigned at posting: a failed post burns nothing, the next successful one is DN-1405-000001', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 1);
      const state = world(db);
      const service = buildDeliveriesService(db);

      await expect(service.post(31, postDto as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.sequences.size).toBe(0);

      // Stock arrives (free — the order's own reservation stays 5 on the line,
      // but the bucket only holds what was seeded); post again.
      db.state.balances[0].onHand = dec(10);
      db.state.balances[0].reserved = dec(5);
      await service.post(31, postDto as never, ACTOR);
      expect(state.delivery.deliveryNumber).toBe('DN-1405-000001');
      expect(db.state.sequences.get('DN:1405')).toBe(1);
    });

    it('re-checks the order line under the lock: if another delivery was posted meanwhile and this one no longer fits, 409 and nothing written', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setBucket(db, 1, 'RESERVED', 5);
      const state = world(db);
      // Simulates a concurrent post that committed first: 4 of 5 delivered.
      state.order.items[0].deliveredQty = dec(4);
      state.order.items[0].reservedQty = dec(1);

      await expect(buildDeliveriesService(db).post(31, postDto as never, ACTOR)).rejects.toThrow('تحویل‌نشدهٔ سفارش');
      expect(db.state.sequences.size).toBe(0);
      expect(db.salesOrderItem.update).not.toHaveBeenCalled();
      expect(balanceOf(db, 1)).toEqual({ onHand: '20', reserved: '5', qc: '0' });
    });

    it('is blocked when the customer is on credit hold (409 CUSTOMER_CREDIT_HOLD, no override): nothing written, no DN number burned', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      setBucket(db, 1, 'RESERVED', 5);
      setCreditPolicy(db, { creditLimit: 10_000_000, creditHold: true });
      const state = world(db);

      await expect(buildDeliveriesService(db).post(31, postDto as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: CUSTOMER_CREDIT_HOLD }),
      });
      expect(state.delivery.status).toBe('DRAFT');
      expect(db.state.sequences.size).toBe(0);
      expect(balanceOf(db, 1)).toEqual({ onHand: '20', reserved: '5', qc: '0' });
      expect(db.salesOrderItem.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('refuses an already POSTED delivery, a stale version, an empty draft, and an order that is no longer CONFIRMED', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 20);
      const state = world(db, { delivery: draftDelivery({ status: 'POSTED', deliveryNumber: 'DN-1405-000001' }) });
      const service = buildDeliveriesService(db);
      await expect(service.post(31, postDto as never, ACTOR)).rejects.toThrow('قبلاً ثبت شده');

      state.delivery = draftDelivery();
      await expect(service.post(31, { updatedAt: new Date('2020-01-01') } as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });

      state.delivery = draftDelivery({ items: [] });
      await expect(service.post(31, postDto as never, ACTOR)).rejects.toBeInstanceOf(BadRequestException);

      state.delivery = draftDelivery();
      state.order.status = 'CLOSED';
      await expect(service.post(31, postDto as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.sequences.size).toBe(0);
      expect(db.state.movements.filter((m: any) => m.movementType === 'DELIVERY_ISSUE')).toHaveLength(0);
    });
  });

  describe('queue', () => {
    it('lists CONFIRMED orders not fully delivered, with open-line and draft-delivery counts', async () => {
      const db = createSalesDb();
      db.salesOrder.findMany.mockResolvedValue([
        {
          id: 11,
          orderNumber: 'SO-1405-000001',
          deliveryStatus: 'PARTIALLY_DELIVERED',
          items: [
            { quantity: dec(5), deliveredQty: dec(5) },
            { quantity: dec(3), deliveredQty: dec(1) },
          ],
          _count: { deliveries: 1 },
        },
      ]);
      const rows = (await buildDeliveriesService(db).queue()) as any[];
      expect(db.salesOrder.findMany.mock.calls[0][0].where).toEqual({ status: { in: ['CONFIRMED'] }, deliveryStatus: { not: 'DELIVERED' } });
      expect(rows[0]).toEqual(expect.objectContaining({ id: 11, lineCount: 2, openLineCount: 1, draftDeliveryCount: 1 }));
      expect(rows[0].items).toBeUndefined();
    });
  });
});
