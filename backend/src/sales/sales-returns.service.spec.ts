import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { balanceOf, damagedOf, seedBatch, seedStock, setBucket, trackItem } from '../inventory/inventory.spec-helpers';
import { buildSalesReturnsService, createSalesDb, VERSION, type SalesDb } from './sales.spec-helpers';

// Seeds a posted DELIVERY_ISSUE movement directly into the Inventory fake's
// movement log, as if issueForDelivery() had already drawn deliveryItemId's
// stock from this batch — the shape listIssuedBatches() (inventory-queries.ts)
// reads back (I4, §5.4a R7).
function seedIssuedBatch(db: SalesDb, args: { itemId: number; locationId?: number; deliveryId: number; deliveryItemId: number; batchId: number; quantity: number }) {
  db.state.movements.push({
    itemId: args.itemId,
    locationId: args.locationId ?? 1,
    bucket: 'ON_HAND',
    movementType: 'DELIVERY_ISSUE',
    quantity: new Prisma.Decimal(-args.quantity),
    referenceType: 'DELIVERY',
    referenceId: args.deliveryId,
    referenceLineId: args.deliveryItemId,
    batchId: args.batchId,
  } as never);
}

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

  // I4 (§5.4a R7): the receive form's batch picker.
  describe('receiveOptions', () => {
    it('lists the issued batch(es) for a tracked item’s line, and an empty list for an untracked one', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', onHand: 3 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batch.id, quantity: 3 });
      world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });

      const result = await buildSalesReturnsService(db).receiveOptions(81);
      expect(result.lines).toEqual([
        expect.objectContaining({
          salesReturnItemId: 801,
          batchTracked: true,
          batches: [expect.objectContaining({ batchId: batch.id, batchNumber: 'LOT-1', quantity: '3' })],
        }),
      ]);
    });

    it('an untracked item’s line reports batchTracked: false and no batch choices', async () => {
      const db = createSalesDb();
      world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });
      const result = await buildSalesReturnsService(db).receiveOptions(81);
      expect(result.lines).toEqual([expect.objectContaining({ salesReturnItemId: 801, batchTracked: false, batches: [] })]);
    });

    it('404s for an unknown return', async () => {
      const db = createSalesDb();
      db.salesReturn.findUnique.mockResolvedValue(null);
      await expect(buildSalesReturnsService(db).receiveOptions(999)).rejects.toBeInstanceOf(NotFoundException);
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

  // I4 (§5.4a R7/B22/B24, build plan §16 resume step 6): batch selection at
  // receive() for a tracked item — never reads stock_movements/stock_batches
  // directly, only via Inventory's exported listIssuedBatches()/resolveBatches().
  describe('receive — batch-tracked items (I4)', () => {
    it('auto-selects the single batch the delivery line issued from, with no batchId given', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', onHand: 2 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batch.id, quantity: 3 });
      const state = world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });

      await buildSalesReturnsService(db).receive(81, { updatedAt: VERSION } as never, ACTOR);

      expect(state.salesReturn.items[0].batchId).toBe(batch.id);
      const receipt = db.state.movements.find((m: any) => m.movementType === 'RETURN_RECEIPT');
      expect(receipt).toEqual(expect.objectContaining({ batchId: batch.id }));
    });

    it('refuses a client-given batchId that does not match the single issued batch', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', onHand: 2 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batch.id, quantity: 3 });
      world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });

      await expect(
        buildSalesReturnsService(db).receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, batchId: batch.id + 999 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires an explicit batchId when the delivery line issued from more than one batch, and refuses one not among them', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batchA = seedBatch(db, { itemId: 1, batchNumber: 'A', onHand: 1 });
      const batchB = seedBatch(db, { itemId: 1, batchNumber: 'B', onHand: 2 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batchA.id, quantity: 1 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batchB.id, quantity: 2 });
      const state = world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });
      const service = buildSalesReturnsService(db);

      await expect(service.receive(81, { updatedAt: VERSION } as never, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, batchId: 999999 }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, receivedQty: 2, batchId: batchB.id }] } as never, ACTOR);
      expect(state.salesReturn.items[0].batchId).toBe(batchB.id);
    });

    it('B22: no batch was issued (a pre-cutover delivery) — requires a typed lot number, which resolves/creates the batch', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      world(db, { salesReturn: requestedReturn({ status: 'APPROVED', returnNumber: 'RMA-1405-000001' }) });
      const service = buildSalesReturnsService(db);

      await expect(service.receive(81, { updatedAt: VERSION } as never, ACTOR)).rejects.toBeInstanceOf(BadRequestException);

      await service.receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, batchNumber: 'OLD-LOT' }] } as never, ACTOR);
      const created = db.state.batches.find((b: any) => b.batchNumber === 'OLD-LOT');
      expect(created).toBeDefined();
      const receipt = db.state.movements.find((m: any) => m.movementType === 'RETURN_RECEIPT');
      expect(receipt).toEqual(expect.objectContaining({ batchId: created!.id }));
    });

    it('per-batch cap (B24): refuses receiving more than this batch’s issued quantity minus what other return lines already received from it', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', onHand: 2 });
      seedIssuedBatch(db, { itemId: 1, deliveryId: 41, deliveryItemId: 401, batchId: batch.id, quantity: 2 });
      // Another return's line already received 1 of this batch's 2 issued units.
      db.salesReturnItem.findMany = jest.fn().mockResolvedValue([{ receivedQty: dec(1) }]);
      world(db, {
        salesReturn: requestedReturn({
          status: 'APPROVED',
          returnNumber: 'RMA-1405-000001',
          items: [{ id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(0), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0) }],
        }),
      });

      // Only 1 remains from this batch (2 issued − 1 already received elsewhere); requesting 2 is refused.
      await expect(
        buildSalesReturnsService(db).receive(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, receivedQty: 2, batchId: batch.id }] } as never, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
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

    // I8 (build plan §5.8, B9): a third disposition alongside restock/write-off.
    it('splits a line’s receivedQty three ways — restock, write-off and "to damaged" (RETURN_TO_DAMAGED: QC −d, DAMAGED +d)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      const state = world(db, { salesReturn: receivedReturn() });

      await buildSalesReturnsService(db).inspect(
        81,
        { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 1, writeOffQty: 1, damagedQty: 1 }] } as never,
        ACTOR,
      );

      expect(balanceOf(db, 1)).toEqual({ onHand: '11', reserved: '0', qc: '0' });
      expect(damagedOf(db, 1)).toBe('1');
      expect(state.salesReturn.items[0]).toEqual(expect.objectContaining({ restockQty: dec(1), writeOffQty: dec(1), damagedQty: dec(1) }));
      expect(actions(db)).toEqual(['SALES_RETURN_INSPECTED']);
    });

    it('omitting damagedQty entirely behaves exactly as before I8 (restock + write-off only)', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      world(db, { salesReturn: receivedReturn() });

      await buildSalesReturnsService(db).inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 2, writeOffQty: 1 }] } as never, ACTOR);

      expect(damagedOf(db, 1)).toBe('0');
    });

    it('refuses a disposition that does not sum to receivedQty, including damagedQty in the total', async () => {
      const db = createSalesDb();
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      world(db, { salesReturn: receivedReturn() });
      await expect(
        buildSalesReturnsService(db).inspect(
          81,
          { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 1, writeOffQty: 1, damagedQty: 2 }] } as never,
          ACTOR,
        ),
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

    it('I4 (§5.4a R7): disposes of the SAME batch the line received into (the batchId receive() stored on the line)', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', qc: 3 });
      world(db, { salesReturn: receivedReturn({ items: [{ id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0), batchId: batch.id }] }) });

      await buildSalesReturnsService(db).inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 2, writeOffQty: 1 }] } as never, ACTOR);

      const forBatch = db.state.movements.filter((m: any) => m.batchId === batch.id);
      expect(forBatch.map((m: any) => [m.movementType, m.bucket, m.quantity.toString()])).toEqual([
        ['RETURN_RESTOCK', 'QC', '-2'],
        ['RETURN_RESTOCK', 'ON_HAND', '2'],
        ['RETURN_WRITE_OFF', 'QC', '-1'],
      ]);
    });

    it('I4/I8: RETURN_TO_DAMAGED disposes of the same batch too (QC out, DAMAGED in, at the batch level)', async () => {
      const db = createSalesDb();
      trackItem(db, 1);
      seedStock(db, 1, 10);
      setBucket(db, 1, 'QC', 3);
      const batch = seedBatch(db, { itemId: 1, batchNumber: 'LOT-1', qc: 3 });
      world(db, { salesReturn: receivedReturn({ items: [{ id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(0), writeOffQty: dec(0), creditedQty: dec(0), batchId: batch.id }] }) });

      await buildSalesReturnsService(db).inspect(81, { updatedAt: VERSION, items: [{ salesReturnItemId: 801, restockQty: 1, writeOffQty: 1, damagedQty: 1 }] } as never, ACTOR);

      const forBatch = db.state.movements.filter((m: any) => m.batchId === batch.id && m.movementType === 'RETURN_TO_DAMAGED');
      expect(forBatch.map((m: any) => [m.bucket, m.quantity.toString()]).sort()).toEqual([
        ['DAMAGED', '1'],
        ['QC', '-1'],
      ]);
      const batchBalance = db.state.batchBalances.find((b: any) => b.batchId === batch.id);
      expect(batchBalance.damaged.toString()).toBe('1');
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
