import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { balanceOf, seedStock, setBucket } from '../inventory/inventory.spec-helpers';
import { buildSalesReturnsService, createSalesDb, VERSION, type SalesDb } from './sales.spec-helpers';

// SalesReturnsService — the full RMA lifecycle. Stock and the document
// sequence run on the Inventory in-memory fake (real rollback), so the
// RETURN_RECEIPT/RETURN_RESTOCK/RETURN_WRITE_OFF effects, QC/ON_HAND bucket
// math and "no number burned on failure" are asserted on state. The
// delivery/order-item/return rows are a small mutable world (matching
// deliveries.service.spec.ts's own convention).

const ACTOR = { userId: 4, ipAddress: '127.0.0.1' };
const dec = (value: number) => new Prisma.Decimal(value);
const actions = (db: SalesDb) => db.auditLog.create.mock.calls.map((call: any) => call[0].data.action);

const REQUEST_DATE = new Date('2026-10-07T00:00:00.000Z'); // 1405/07/15

function postedDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    deliveryNumber: 'DN-1405-000001',
    deliveryDate: REQUEST_DATE,
    status: 'POSTED',
    customerId: 9,
    salesOrderId: 11,
    locationId: 1,
    items: [
      {
        id: 401,
        itemId: 1,
        quantity: dec(5),
        returnedQty: dec(0),
        salesOrderItemId: 101,
        salesOrderItem: { id: 101, lineNo: 1, itemCode: 'ITM-1', itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000) },
      },
    ],
    ...overrides,
  };
}

function requestedReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 81,
    returnNumber: null,
    customerId: 9,
    salesOrderId: 11,
    deliveryId: 41,
    locationId: 1,
    requestDate: REQUEST_DATE,
    reason: 'DAMAGED',
    status: 'REQUESTED',
    updatedAt: VERSION,
    items: [
      { id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(0), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) },
    ],
    ...overrides,
  };
}

// Mutable world: delivery (with its lines + order-line snapshot), a
// separate order-items store (so returnedQty updates on the order line are
// visible independently of the delivery line's own returnedQty), and the
// return itself.
function world(db: SalesDb, init: { delivery?: any; salesReturn?: any; orderItems?: Record<number, any> } = {}) {
  const state = {
    delivery: init.delivery ?? postedDelivery(),
    salesReturn: init.salesReturn ?? null,
    orderItems: init.orderItems ?? { 101: { id: 101, returnedQty: dec(0) } },
  };
  db.delivery.findUnique.mockImplementation(async () => state.delivery);
  db.deliveryItem.findMany.mockImplementation(async ({ where }: any) => state.delivery.items.filter((item: any) => where.id.in.includes(item.id)));
  db.deliveryItem.update.mockImplementation(async ({ where, data }: any) => {
    const item = state.delivery.items.find((entry: any) => entry.id === where.id);
    return Object.assign(item, data);
  });
  db.salesOrderItem.findMany.mockImplementation(async ({ where }: any) => (where.id.in as number[]).map((id) => state.orderItems[id]).filter(Boolean));
  db.salesOrderItem.update.mockImplementation(async ({ where, data }: any) => Object.assign(state.orderItems[where.id], data));
  db.salesReturn.findUnique.mockImplementation(async () => state.salesReturn);
  db.salesReturn.update.mockImplementation(async ({ data }: any) => Object.assign(state.salesReturn, data));
  db.salesReturnItem.update.mockImplementation(async ({ where, data }: any) => {
    const item = state.salesReturn.items.find((entry: any) => entry.id === where.id);
    return Object.assign(item, data);
  });
  return state;
}

describe('SalesReturnsService', () => {
  describe('deliveryContext', () => {
    it('returns each line’s returnable quantity (quantity − returnedQty) and its order-line price snapshot', async () => {
      const db = createSalesDb();
      world(db, { delivery: postedDelivery({ items: [{ ...postedDelivery().items[0], returnedQty: dec(2) }] }) });
      const context = await buildSalesReturnsService(db).deliveryContext(41);
      expect(context.returnable).toBe(true);
      expect(context.items).toEqual([
        expect.objectContaining({ id: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: '1000', quantity: '5', returnedQty: '2', returnableQty: '3' }),
      ]);
    });

    it('404s for an unknown delivery', async () => {
      const db = createSalesDb();
      world(db);
      db.delivery.findUnique.mockResolvedValue(null);
      await expect(buildSalesReturnsService(db).deliveryContext(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('request (REQUESTED)', () => {
    it('creates a REQUESTED return against a POSTED delivery, snapshotting price/name from the order line — no number, no stock effect', async () => {
      const db = createSalesDb();
      world(db);
      await buildSalesReturnsService(db).request(
        { deliveryId: 41, requestDate: REQUEST_DATE, reason: 'DAMAGED', items: [{ deliveryItemId: 401, quantity: 3 }] } as never,
        ACTOR,
      );
      const data = db.salesReturn.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({ customerId: 9, salesOrderId: 11, deliveryId: 41, locationId: 1, status: 'REQUESTED', requestedByUserId: 4 }),
      );
      expect(data.returnNumber).toBeUndefined();
      expect(data.items.create).toEqual([{ deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: 3, conditionNote: null }]);
      expect(actions(db)).toEqual(['SALES_RETURN_REQUESTED']);
      expect(db.state.sequences.size).toBe(0);
      expect(db.state.movements).toHaveLength(0);
    });

    it('caps a line at quantity − returnedQty and refuses more (400)', async () => {
      const db = createSalesDb();
      world(db, { delivery: postedDelivery({ items: [{ ...postedDelivery().items[0], returnedQty: dec(3) }] }) }); // 2 left
      const service = buildSalesReturnsService(db);
      await expect(
        service.request({ deliveryId: 41, requestDate: REQUEST_DATE, reason: 'DAMAGED', items: [{ deliveryItemId: 401, quantity: 2.5 }] } as never, ACTOR),
      ).rejects.toThrow('قابل مرجوع');
      await service.request({ deliveryId: 41, requestDate: REQUEST_DATE, reason: 'DAMAGED', items: [{ deliveryItemId: 401, quantity: 2 }] } as never, ACTOR);
      expect(db.salesReturn.create).toHaveBeenCalledTimes(1);
    });

    it('refuses a DRAFT delivery (409) and an unknown delivery item (400)', async () => {
      const db = createSalesDb();
      const state = world(db);
      const service = buildSalesReturnsService(db);
      state.delivery = postedDelivery({ status: 'DRAFT' });
      await expect(
        service.request({ deliveryId: 41, requestDate: REQUEST_DATE, reason: 'DAMAGED', items: [{ deliveryItemId: 401, quantity: 1 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);

      state.delivery = postedDelivery();
      await expect(
        service.request({ deliveryId: 41, requestDate: REQUEST_DATE, reason: 'DAMAGED', items: [{ deliveryItemId: 999, quantity: 1 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('approve / reject / cancel', () => {
    it('approve: REQUESTED → APPROVED, assigns the gap-free RMA number', async () => {
      const db = createSalesDb();
      const state = world(db, { salesReturn: requestedReturn() });
      await buildSalesReturnsService(db).approve(81, { updatedAt: VERSION } as never, ACTOR);
      expect(state.salesReturn).toEqual(expect.objectContaining({ status: 'APPROVED', returnNumber: 'RMA-1405-000001', approvedByUserId: 4 }));
      expect(actions(db)).toEqual(['SALES_RETURN_APPROVED']);
    });

    it('approve refuses a non-REQUESTED return and a stale version', async () => {
      const db = createSalesDb();
      const state = world(db, { salesReturn: requestedReturn({ status: 'APPROVED' }) });
      const service = buildSalesReturnsService(db);
      await expect(service.approve(81, { updatedAt: VERSION } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      state.salesReturn = requestedReturn();
      await expect(service.approve(81, { updatedAt: new Date('2020-01-01') } as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
    });

    it('reject: REQUESTED → REJECTED, stores the reason on rejectReason', async () => {
      const db = createSalesDb();
      const state = world(db, { salesReturn: requestedReturn() });
      await buildSalesReturnsService(db).reject(81, { updatedAt: VERSION, reason: 'مشتری منصرف شد' } as never, ACTOR);
      expect(state.salesReturn).toEqual(expect.objectContaining({ status: 'REJECTED', rejectReason: 'مشتری منصرف شد' }));
      expect(actions(db)).toEqual(['SALES_RETURN_REJECTED']);
    });

    it('cancel: REQUESTED or APPROVED → CANCELLED (reason logged, no column)', async () => {
      const db = createSalesDb();
      const state = world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });
      await buildSalesReturnsService(db).cancel(81, { updatedAt: VERSION, reason: 'موجود نبود' } as never, ACTOR);
      expect(state.salesReturn.status).toBe('CANCELLED');
      expect(actions(db)).toEqual(['SALES_RETURN_CANCELLED']);

      state.salesReturn = requestedReturn();
      await buildSalesReturnsService(db).cancel(81, { updatedAt: VERSION, reason: 'اشتباه ثبت شد' } as never, ACTOR);
      expect(state.salesReturn.status).toBe('CANCELLED');
    });

    it('refuses to cancel an INSPECTED/COMPLETED/CANCELLED/REJECTED return', async () => {
      const db = createSalesDb();
      world(db, { salesReturn: requestedReturn({ status: 'COMPLETED' }) });
      await expect(buildSalesReturnsService(db).cancel(81, { updatedAt: VERSION, reason: 'x' } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('receive (APPROVED → RECEIVED)', () => {
    it('defaults receivedQty to requestedQty when items are omitted: RETURN_RECEIPT (QC +q) + delivery/order returnedQty', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });

      await buildSalesReturnsService(db).receive(81, { updatedAt: VERSION } as never, ACTOR);

      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '3' });
      const receipts = db.state.movements.filter((m: any) => m.movementType === 'RETURN_RECEIPT');
      expect(receipts.map((m: any) => [m.bucket, m.quantity.toString(), m.referenceType, m.referenceId, m.referenceLineId])).toEqual([
        ['QC', '3', 'SALES_RETURN', 81, 801],
      ]);
      expect(actions(db)).toEqual(['SALES_RETURN_RECEIVED']);
    });

    it('accepts a per-line receivedQty below requestedQty (partial physical return) and refuses receiving more than requested', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      const state = world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });
      await buildSalesReturnsService(db).receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, receivedQty: 2 }] } as never, ACTOR);
      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '2' });

      state.salesReturn = requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' });
      await expect(
        buildSalesReturnsService(db).receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, receivedQty: 4 }] } as never, ACTOR),
      ).rejects.toThrow('درخواستی');
    });

    it('re-checks the delivery item’s CURRENT capacity under lock — refuses if another return already consumed it', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      // Only 1 unit of capacity left on the delivery line (another return
      // already received 4 of the 5 delivered).
      world(db, {
        delivery: postedDelivery({ items: [{ ...postedDelivery().items[0], returnedQty: dec(4) }] }),
        salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }), // requests 3
      });
      await expect(buildSalesReturnsService(db).receive(81, { updatedAt: VERSION } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '0' }); // nothing written
    });

    it('requires every line to be listed when items is given, refuses a non-APPROVED return, and a stale version', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      const state = world(db, {
        salesReturn: requestedReturn({
          status: 'APPROVED',
          returnNumber: 'RMA-1405-000001',
          items: [
            { id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(0), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) },
            { id: 802, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(1), receivedQty: dec(0), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) },
          ],
        }),
      });
      const service = buildSalesReturnsService(db);
      await expect(service.receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, receivedQty: 3 }] } as never, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      state.salesReturn.status = 'REQUESTED';
      await expect(service.receive(81, { updatedAt: VERSION } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);

      state.salesReturn.status = 'APPROVED';
      await expect(service.receive(81, { updatedAt: new Date('2020-01-01') } as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
    });
  });

  describe('inspect (RECEIVED → INSPECTED)', () => {
    function receivedReturn(overrides: Record<string, unknown> = {}) {
      return requestedReturn({
        status: 'RECEIVED',
        returnNumber: 'RMA-1405-000001',
        items: [{ id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) }],
        ...overrides,
      });
    }

    it('splits a line’s receivedQty into restock (QC −r, ON_HAND +r) and write-off (QC −w)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      const state = world(db, { salesReturn: receivedReturn() });

      await buildSalesReturnsService(db).inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 2, writeOffQty: 1 }] } as never, ACTOR);

      expect(balanceOf(db, 1)).toEqual({ onHand: '12', reserved: '0', qc: '0' });
      expect(state.salesReturn).toEqual(expect.objectContaining({ status: 'INSPECTED', inspectedByUserId: 4 }));
      expect(state.salesReturn.items[0]).toEqual(expect.objectContaining({ restockQty: dec(2), writeOffQty: dec(1) }));
      expect(actions(db)).toEqual(['SALES_RETURN_INSPECTED']);
    });

    it('refuses a disposition that does not sum to receivedQty', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      world(db, { salesReturn: receivedReturn() });
      await expect(
        buildSalesReturnsService(db).inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 1, writeOffQty: 1 }] } as never, ACTOR),
      ).rejects.toThrow('باید برابر');
    });

    it('refuses to inspect without listing every received line, and a non-RECEIVED return', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      const state = world(db, {
        salesReturn: receivedReturn({
          items: [
            { id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) },
            { id: 802, deliveryItemId: 401, itemId: 1, itemName: 'ماست', unitName: 'عدد', unitPrice: dec(500), requestedQty: dec(1), receivedQty: dec(0), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) },
          ],
        }),
      });
      const service = buildSalesReturnsService(db);
      await expect(
        service.inspect(81, { updatedAt: VERSION, items: [] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);

      state.salesReturn.status = 'APPROVED';
      await expect(
        service.inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 3, writeOffQty: 0 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('completeWithoutCredit (INSPECTED → COMPLETED)', () => {
    it('completes an INSPECTED return with a reason, no credit note', async () => {
      const db = createSalesDb();
      const state = world(db, { salesReturn: requestedReturn({ status: 'INSPECTED', returnNumber: 'RMA-1405-000001' }) });
      await buildSalesReturnsService(db).completeWithoutCredit(81, { updatedAt: VERSION, reason: 'مشتری اعتبار نمی‌خواهد' } as never, ACTOR);
      expect(state.salesReturn.status).toBe('COMPLETED');
      expect(actions(db)).toEqual(['SALES_RETURN_COMPLETED_NO_CREDIT']);
    });

    it('refuses to complete a non-INSPECTED return', async () => {
      const db = createSalesDb();
      world(db, { salesReturn: requestedReturn({ status: 'RECEIVED', returnNumber: 'RMA-1405-000001' }) });
      await expect(
        buildSalesReturnsService(db).completeWithoutCredit(81, { updatedAt: VERSION, reason: 'x' } as never, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('markCredited (called by CreditNotesService.post())', () => {
    it('INSPECTED → COMPLETED, adds to each line’s creditedQty', async () => {
      const db = createSalesDb();
      const state = world(db, {
        salesReturn: requestedReturn({
          status: 'INSPECTED',
          returnNumber: 'RMA-1405-000001',
          items: [{ id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(2), writeOffQty: dec(1), creditedQty: dec(0) }],
        }),
      });
      await buildSalesReturnsService(db).markCredited(db as never, 81, [{ salesReturnItemId: 801, quantity: dec(3) }], ACTOR);
      expect(state.salesReturn.status).toBe('COMPLETED');
      expect(state.salesReturn.items[0].creditedQty.toString()).toBe('3');
      expect(actions(db)).toEqual(['SALES_RETURN_CREDITED']);
    });

    it('refuses a return that is not INSPECTED', async () => {
      const db = createSalesDb();
      world(db, { salesReturn: requestedReturn({ status: 'RECEIVED', returnNumber: 'RMA-1405-000001' }) });
      await expect(buildSalesReturnsService(db).markCredited(db as never, 81, [{ salesReturnItemId: 801, quantity: dec(3) }], ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
