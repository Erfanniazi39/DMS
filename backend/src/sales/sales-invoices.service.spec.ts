import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { SALES_INVOICE_DRAFT_EXISTS } from './sales-rules';
import { buildSalesInvoicesService, createSalesDb, draftOrder, ORDER_DATE, orderLine, VERSION, type SalesDb } from './sales.spec-helpers';

// SalesInvoicesService — DRAFT creation (from a delivery / opening balance),
// posting, draft deletion and the settlement hook. The document sequence
// runs on the Inventory in-memory fake (real rollback), so gap-free INV
// numbering is asserted on state. Order / delivery / invoice rows are a
// small mutable world (the update mocks write into it), so the counters and
// the derived order statuses are asserted on the resulting rows.

const ACTOR = { userId: 6, ipAddress: '127.0.0.1' };
const actions = (db: SalesDb) => db.auditLog.create.mock.calls.map((call: any) => call[0].data.action);
const dec = (value: number) => new Prisma.Decimal(value);
const rawSql = (db: SalesDb) => db.$queryRaw.mock.calls.map((call: any) => (call[0] as string[]).join('?'));

// Order: line 1 = 5 × 1000 with 10 % discount and 9 % tax, line 2 = 4 × 500
// with a fixed 400 discount. Line 1 fully delivered, line 2 half delivered.
function confirmedOrder(overrides: Record<string, unknown> = {}) {
  return draftOrder({
    status: 'CONFIRMED',
    orderNumber: 'SO-1405-000001',
    deliveryStatus: 'PARTIALLY_DELIVERED',
    invoicingStatus: 'NOT_INVOICED',
    paymentTermName: '۳۰ روزه',
    paymentDueDays: 30,
    items: [
      orderLine({ id: 101, lineNo: 1, itemId: 1, quantity: dec(5), deliveredQty: dec(5), discountPercent: dec(10), discountAmount: dec(500), taxRate: dec(9) }),
      orderLine({ id: 102, lineNo: 2, itemId: 2, itemCode: 'ITM-2', itemName: 'ماست', quantity: dec(4), unitPrice: dec(500), deliveredQty: dec(2), discountAmount: dec(400) }),
    ],
    ...overrides,
  });
}

function deliveryLine(orderItem: any, overrides: Record<string, unknown> = {}) {
  return { id: 300 + orderItem.lineNo, itemId: orderItem.itemId, quantity: orderItem.deliveredQty, invoicedQty: dec(0), salesOrderItem: orderItem, invoiceItems: [], ...overrides };
}

function postedDelivery(order: any, overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    deliveryNumber: 'DN-1405-000001',
    deliveryDate: ORDER_DATE,
    status: 'POSTED',
    customerId: 9,
    salesOrder: { id: order.id, orderNumber: order.orderNumber, paymentTermName: order.paymentTermName, paymentDueDays: order.paymentDueDays },
    items: order.items.map((line: any) => deliveryLine(line)),
    ...overrides,
  };
}

// A DRAFT invoice for the delivery above: every delivered quantity.
function draftInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 51,
    invoiceNumber: null,
    sourceType: 'OPERATIONAL',
    customerId: 9,
    salesOrderId: 11,
    invoiceDate: ORDER_DATE,
    status: 'DRAFT',
    customerName: 'فروشگاه نمونه',
    paymentDueDays: 30,
    totalAmount: dec(5705),
    paidAmount: dec(0),
    creditedAmount: dec(0),
    paymentStatus: 'UNPAID',
    updatedAt: VERSION,
    items: [
      { id: 501, lineNo: 1, deliveryItemId: 301, salesOrderItemId: 101, itemName: 'شیر', quantity: dec(5) },
      { id: 502, lineNo: 2, deliveryItemId: 302, salesOrderItemId: 102, itemName: 'ماست', quantity: dec(2) },
    ],
    ...overrides,
  };
}

function world(db: SalesDb, init: { order?: any; delivery?: any; invoice?: any } = {}) {
  const order = init.order ?? confirmedOrder();
  const state: any = { order, delivery: init.delivery ?? postedDelivery(order), invoice: init.invoice ?? draftInvoice() };
  state.deliveryItems = state.delivery.items.map((line: any) => ({
    id: line.id,
    salesOrderItemId: line.salesOrderItem.id,
    quantity: line.quantity,
    invoicedQty: line.invoicedQty,
    delivery: { id: state.delivery.id, status: state.delivery.status, deliveryNumber: state.delivery.deliveryNumber },
  }));
  db.salesOrder.findUnique.mockImplementation(async () => state.order);
  db.salesOrder.update.mockImplementation(async ({ data }: any) => Object.assign(state.order, data));
  db.salesOrderItem.update.mockImplementation(async ({ where, data }: any) => Object.assign(state.order.items.find((line: any) => line.id === where.id), data));
  db.delivery.findUnique.mockImplementation(async () => state.delivery);
  db.deliveryItem.findMany.mockImplementation(async () => state.deliveryItems);
  db.deliveryItem.update.mockImplementation(async ({ where, data }: any) => Object.assign(state.deliveryItems.find((line: any) => line.id === where.id), data));
  db.salesInvoice.findUnique.mockImplementation(async () => state.invoice);
  db.salesInvoice.update.mockImplementation(async ({ data }: any) => Object.assign(state.invoice, data));
  return state;
}

describe('SalesInvoicesService', () => {
  describe('createFromDelivery (DRAFT)', () => {
    it('one line per delivery line with its uninvoiced quantity, priced from the order line; snapshots; no number', async () => {
      const db = createSalesDb();
      const order = confirmedOrder();
      world(db, {
        order,
        delivery: postedDelivery(order, {
          items: [deliveryLine(order.items[0], { invoicedQty: dec(0) }), deliveryLine(order.items[1])],
        }),
      });
      db.customerAddress.findFirst.mockResolvedValue({ province: 'تهران', city: 'تهران', addressLine: 'خیابان نمونه', postalCode: '1234567890' });

      const id = await db.$transaction((tx: any) => buildSalesInvoicesService(db).createFromDelivery(tx, 31, { invoiceDate: ORDER_DATE }, ACTOR));

      expect(id).toBe(51);
      expect(rawSql(db)[0]).toContain('FROM deliveries WHERE id = ? FOR UPDATE');
      const data = db.salesInvoice.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          sourceType: 'OPERATIONAL',
          customerId: 9,
          salesOrderId: 11,
          invoiceDate: ORDER_DATE,
          status: 'DRAFT',
          customerName: 'فروشگاه نمونه',
          customerEconomicCode: '411',
          billingAddressText: 'تهران، تهران، خیابان نمونه، کد پستی 1234567890',
          paymentTermName: '۳۰ روزه',
          paymentDueDays: 30,
          createdByUserId: 6,
        }),
      );
      expect(data.invoiceNumber).toBeUndefined();
      expect(data.dueDate).toBeUndefined();
      const lines = data.items.create.map((line: any) => ({
        ...line,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        taxRate: line.taxRate.toString(),
        taxAmount: line.taxAmount.toString(),
        lineTotal: line.lineTotal.toString(),
      }));
      // Line 1: 5 × 1000 = 5000, 10 % → 500, tax 9 % of 4500 = 405 → 4905.
      // Line 2: 2 × 500 = 1000, fixed 400 prorated 2/4 → 200 → 800.
      expect(lines).toEqual([
        { lineNo: 1, deliveryItemId: 301, salesOrderItemId: 101, itemId: 1, itemCode: 'ITM-1', itemName: 'شیر', unitName: 'عدد', quantity: '5', unitPrice: '1000', discountAmount: '500', taxRate: '9', taxAmount: '405', lineTotal: '4905' },
        { lineNo: 2, deliveryItemId: 302, salesOrderItemId: 102, itemId: 2, itemCode: 'ITM-2', itemName: 'ماست', unitName: 'عدد', quantity: '2', unitPrice: '500', discountAmount: '200', taxRate: '0', taxAmount: '0', lineTotal: '800' },
      ]);
      expect([data.subtotal, data.discountTotal, data.taxTotal, data.totalAmount].map(String)).toEqual(['6000', '700', '405', '5705']);
      expect(actions(db)).toEqual(['SALES_INVOICE_CREATED']);
      expect(db.state.sequences.size).toBe(0);
    });

    it('skips delivery lines already fully invoiced and invoices only the remainder of a partly invoiced one', async () => {
      const db = createSalesDb();
      const order = confirmedOrder();
      world(db, {
        order,
        delivery: postedDelivery(order, {
          items: [deliveryLine(order.items[0], { invoicedQty: dec(3) }), deliveryLine(order.items[1], { invoicedQty: dec(2) })],
        }),
      });
      await db.$transaction((tx: any) => buildSalesInvoicesService(db).createFromDelivery(tx, 31, {}, ACTOR));
      const lines = db.salesInvoice.create.mock.calls[0][0].data.items.create;
      expect(lines.map((line: any) => [line.deliveryItemId, line.quantity.toString()])).toEqual([[301, '2']]);
    });

    it('defaults invoiceDate to today, or to the delivery date when that is later; refuses a date before the delivery', async () => {
      const db = createSalesDb();
      const state = world(db);
      const service = buildSalesInvoicesService(db);
      await db.$transaction((tx: any) => service.createFromDelivery(tx, 31, {}, ACTOR));
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      expect(db.salesInvoice.create.mock.calls[0][0].data.invoiceDate).toEqual(today);

      const future = new Date(today.getTime() + 5 * 86_400_000);
      state.delivery.deliveryDate = future;
      await db.$transaction((tx: any) => service.createFromDelivery(tx, 31, {}, ACTOR));
      expect(db.salesInvoice.create.mock.calls[1][0].data.invoiceDate).toEqual(future);

      await expect(db.$transaction((tx: any) => service.createFromDelivery(tx, 31, { invoiceDate: today }, ACTOR))).rejects.toThrow('پیش از تاریخ تحویل');
    });

    it('B7 one invoice per delivery: refuses when a DRAFT invoice already exists (409 SALES_INVOICE_DRAFT_EXISTS with its id)', async () => {
      const db = createSalesDb();
      const order = confirmedOrder();
      world(db, { order, delivery: postedDelivery(order, { items: [deliveryLine(order.items[0], { invoiceItems: [{ salesInvoiceId: 77 }] })] }) });
      await expect(db.$transaction((tx: any) => buildSalesInvoicesService(db).createFromDelivery(tx, 31, {}, ACTOR))).rejects.toMatchObject({
        response: expect.objectContaining({ code: SALES_INVOICE_DRAFT_EXISTS, details: { salesInvoiceId: 77 } }),
      });
      expect(db.salesInvoice.create).not.toHaveBeenCalled();
    });

    it('refuses a DRAFT delivery, a fully invoiced delivery and an unknown one', async () => {
      const db = createSalesDb();
      const order = confirmedOrder();
      const state = world(db, { order, delivery: postedDelivery(order, { status: 'DRAFT' }) });
      const service = buildSalesInvoicesService(db);
      const create = () => db.$transaction((tx: any) => service.createFromDelivery(tx, 31, {}, ACTOR));
      await expect(create()).rejects.toThrow('ثبت‌شده');

      state.delivery = postedDelivery(order, { items: order.items.map((line: any) => deliveryLine(line, { invoicedQty: line.deliveredQty })) });
      await expect(create()).rejects.toThrow('فاکتور شده است');

      state.delivery = null;
      await expect(create()).rejects.toBeInstanceOf(NotFoundException);
      expect(db.salesInvoice.create).not.toHaveBeenCalled();
    });

    it('create() (HTTP) wraps it in a transaction and returns the detail', async () => {
      const db = createSalesDb();
      world(db);
      const result = await buildSalesInvoicesService(db).create({ deliveryId: 31, invoiceDate: ORDER_DATE }, ACTOR);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({ id: 51 }));
    });
  });

  describe('createOpeningBalance (DRAFT)', () => {
    it('OPENING_BALANCE, no order, lines without delivery / order refs, default item name "مانده افتتاحیه", payment term from the customer profile', async () => {
      const db = createSalesDb();
      world(db);
      await buildSalesInvoicesService(db).createOpeningBalance(
        { customerId: 9, invoiceDate: ORDER_DATE, items: [{ quantity: 1, unitPrice: 2_500_000 }, { itemName: 'فاکتور دستی ۱۴۰۳/۱۲', quantity: 2, unitPrice: 1000, taxRate: 10 }] },
        ACTOR,
      );
      const data = db.salesInvoice.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({ sourceType: 'OPENING_BALANCE', salesOrderId: null, customerId: 9, status: 'DRAFT', paymentTermName: '۳۰ روزه', paymentDueDays: 30 }),
      );
      expect(data.items.create.map((line: any) => [line.lineNo, line.itemName, line.lineTotal.toString(), line.deliveryItemId, line.salesOrderItemId])).toEqual([
        [1, 'مانده افتتاحیه', '2500000', undefined, undefined],
        [2, 'فاکتور دستی ۱۴۰۳/۱۲', '2200', undefined, undefined],
      ]);
      expect(data.totalAmount.toString()).toBe('2502200');
      expect(actions(db)).toEqual(['SALES_INVOICE_CREATED']);
    });

    it('refuses a zero total and an unknown customer', async () => {
      const db = createSalesDb();
      const service = buildSalesInvoicesService(db);
      await expect(service.createOpeningBalance({ customerId: 9, invoiceDate: ORDER_DATE, items: [{ quantity: 1, unitPrice: 0 }] }, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      db.customer.findUnique.mockResolvedValue(null);
      await expect(service.createOpeningBalance({ customerId: 99, invoiceDate: ORDER_DATE, items: [{ quantity: 1, unitPrice: 10 }] }, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.salesInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    const postDto = { updatedAt: VERSION };

    it('POSTED + INV number + dueDate = invoiceDate + paymentDueDays + invoicedQty on delivery and order lines + PARTIALLY_INVOICED, in one transaction', async () => {
      const db = createSalesDb();
      const state = world(db);

      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);

      expect(state.invoice).toEqual(
        expect.objectContaining({
          status: 'POSTED',
          invoiceNumber: 'INV-1405-000001',
          dueDate: new Date('2026-11-05T00:00:00.000Z'),
          paymentStatus: 'UNPAID',
          postedByUserId: 6,
        }),
      );
      expect(state.deliveryItems.map((line: any) => line.invoicedQty.toString())).toEqual(['5', '2']);
      expect(state.order.items.map((line: any) => line.invoicedQty.toString())).toEqual(['5', '2']);
      // Line 2 is invoiced = delivered but only 2 of 4 delivered.
      expect(state.order.invoicingStatus).toBe('PARTIALLY_INVOICED');
      expect(state.order.status).toBe('CONFIRMED');
      expect(actions(db)).toEqual(['SALES_INVOICE_POSTED', 'SALES_ORDER_INVOICE_POSTED', 'DELIVERY_INVOICE_POSTED']);
    });

    it('locks invoice → sales order', async () => {
      const db = createSalesDb();
      world(db);
      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);
      const sql = rawSql(db);
      expect(sql[0]).toContain('FROM sales_invoices WHERE id = ? FOR UPDATE');
      expect(sql.findIndex((text: string) => text.includes('FROM sales_orders'))).toBeGreaterThan(0);
    });

    it('COMPLETED is now reachable: the invoice that makes every line invoiced = delivered = ordered moves the order CONFIRMED → COMPLETED', async () => {
      const db = createSalesDb();
      const order = confirmedOrder({
        deliveryStatus: 'DELIVERED',
        items: [
          orderLine({ id: 101, lineNo: 1, itemId: 1, quantity: dec(5), deliveredQty: dec(5) }),
          orderLine({ id: 102, lineNo: 2, itemId: 2, quantity: dec(4), deliveredQty: dec(4), invoicedQty: dec(2) }),
        ],
      });
      const delivery = postedDelivery(order, {
        items: [deliveryLine(order.items[0]), deliveryLine(order.items[1], { quantity: dec(4), invoicedQty: dec(2) })],
      });
      const state = world(db, { order, delivery });

      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);

      expect(state.order.items.map((line: any) => line.invoicedQty.toString())).toEqual(['5', '4']);
      expect(state.order.invoicingStatus).toBe('INVOICED');
      expect(state.order.status).toBe('COMPLETED');
      expect(actions(db)).toEqual(['SALES_INVOICE_POSTED', 'SALES_ORDER_INVOICE_POSTED', 'DELIVERY_INVOICE_POSTED', 'SALES_ORDER_COMPLETED']);
    });

    it('a delivered-but-not-fully-ordered line keeps the order CONFIRMED even when everything delivered is invoiced', async () => {
      const db = createSalesDb();
      const state = world(db);
      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);
      expect(state.order.status).toBe('CONFIRMED');
      expect(actions(db)).not.toContain('SALES_ORDER_COMPLETED');
    });

    it('an opening-balance invoice posts with a number and due date and touches no order / delivery', async () => {
      const db = createSalesDb();
      const state = world(db, {
        invoice: draftInvoice({
          sourceType: 'OPENING_BALANCE',
          salesOrderId: null,
          paymentDueDays: 0,
          items: [{ id: 501, lineNo: 1, deliveryItemId: null, salesOrderItemId: null, itemName: 'مانده افتتاحیه', quantity: dec(1) }],
        }),
      });
      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);
      expect(state.invoice).toEqual(expect.objectContaining({ status: 'POSTED', invoiceNumber: 'INV-1405-000001', dueDate: ORDER_DATE }));
      expect(db.deliveryItem.update).not.toHaveBeenCalled();
      expect(db.salesOrderItem.update).not.toHaveBeenCalled();
      expect(db.salesOrder.update).not.toHaveBeenCalled();
      expect(actions(db)).toEqual(['SALES_INVOICE_POSTED']);
    });

    it('a zero-total invoice is PAID from the moment it posts', async () => {
      const db = createSalesDb();
      const state = world(db, { invoice: draftInvoice({ totalAmount: dec(0) }) });
      await buildSalesInvoicesService(db).post(51, postDto, ACTOR);
      expect(state.invoice.paymentStatus).toBe('PAID');
    });

    it('re-checks each line under the lock: if the delivery line was invoiced meanwhile, 409 and nothing written, no number burned', async () => {
      const db = createSalesDb();
      const state = world(db);
      state.deliveryItems[1].invoicedQty = dec(1); // a concurrent invoice took 1 of 2

      await expect(buildSalesInvoicesService(db).post(51, postDto, ACTOR)).rejects.toThrow('فاکتورنشدهٔ حواله');
      expect(db.state.sequences.size).toBe(0);
      expect(state.invoice.status).toBe('DRAFT');
      expect(db.salesOrder.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('gap-free INV numbering assigned at posting, not at draft: drafts and failed posts burn nothing; successive posts are 000001, 000002', async () => {
      const db = createSalesDb();
      const state = world(db);
      const service = buildSalesInvoicesService(db);

      await db.$transaction((tx: any) => service.createFromDelivery(tx, 31, { invoiceDate: ORDER_DATE }, ACTOR));
      expect(db.state.sequences.size).toBe(0);

      state.invoice = draftInvoice({ items: [] });
      await expect(service.post(51, postDto, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.state.sequences.size).toBe(0);

      state.invoice = draftInvoice({ items: [draftInvoice().items[0]] });
      await service.post(51, postDto, ACTOR);
      expect(state.invoice.invoiceNumber).toBe('INV-1405-000001');

      state.invoice = draftInvoice({ id: 52, items: [draftInvoice().items[1]] });
      await service.post(52, postDto, ACTOR);
      expect(state.invoice.invoiceNumber).toBe('INV-1405-000002');
      expect(db.state.sequences.get('INV:1405')).toBe(2);
    });

    it('refuses an already POSTED invoice and a stale version', async () => {
      const db = createSalesDb();
      const state = world(db, { invoice: draftInvoice({ status: 'POSTED', invoiceNumber: 'INV-1405-000001' }) });
      const service = buildSalesInvoicesService(db);
      await expect(service.post(51, postDto, ACTOR)).rejects.toThrow('قبلاً ثبت شده');

      state.invoice = draftInvoice();
      await expect(service.post(51, { updatedAt: new Date('2020-01-01') }, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
      });
      expect(db.state.sequences.size).toBe(0);
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT and audits; refuses a POSTED invoice (immutable) and 404s an unknown one', async () => {
      const db = createSalesDb();
      const state = world(db);
      const service = buildSalesInvoicesService(db);
      await expect(service.remove(51, ACTOR)).resolves.toEqual({ success: true });
      expect(rawSql(db)[0]).toContain('FROM sales_invoices WHERE id = ? FOR UPDATE');
      expect(db.salesInvoice.delete).toHaveBeenCalledWith({ where: { id: 51 } });
      expect(actions(db)).toEqual(['SALES_INVOICE_DELETED']);

      state.invoice = draftInvoice({ status: 'POSTED' });
      await expect(service.remove(51, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      state.invoice = null;
      await expect(service.remove(51, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.salesInvoice.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('applySettlement (the only writer of paid / credited / paymentStatus)', () => {
    function posted(overrides: Record<string, unknown> = {}) {
      return draftInvoice({ status: 'POSTED', invoiceNumber: 'INV-1405-000001', totalAmount: dec(10_000), ...overrides });
    }

    it.each([
      [0, 0, 'UNPAID', '10000'],
      [4000, 0, 'PARTIALLY_PAID', '6000'],
      [0, 2500, 'PARTIALLY_PAID', '7500'],
      [7000, 3000, 'PAID', '0'],
    ])('paid %d + credited %d → %s (open %s)', async (paid, credited, status, open) => {
      const db = createSalesDb();
      const state = world(db, { invoice: posted() });
      const result = await db.$transaction((tx: any) => buildSalesInvoicesService(db).applySettlement(tx, 51, { paidAmount: paid, creditedAmount: credited }));
      expect(result.paymentStatus).toBe(status);
      expect(result.openAmount.toString()).toBe(open);
      expect(state.invoice.paymentStatus).toBe(status);
      expect(rawSql(db)[0]).toContain('FROM sales_invoices WHERE id = ? FOR UPDATE');
    });

    it('a reversal (lower sums) moves PAID back to PARTIALLY_PAID / UNPAID', async () => {
      const db = createSalesDb();
      const state = world(db, { invoice: posted({ paidAmount: dec(10_000), paymentStatus: 'PAID' }) });
      await db.$transaction((tx: any) => buildSalesInvoicesService(db).applySettlement(tx, 51, { paidAmount: 0, creditedAmount: 0 }));
      expect([state.invoice.paidAmount.toString(), state.invoice.paymentStatus]).toEqual(['0', 'UNPAID']);
    });

    it('recomputes the order paymentStatus: PAID only once everything ordered is delivered, invoiced and settled', async () => {
      const db = createSalesDb();
      const order = confirmedOrder({
        status: 'COMPLETED',
        items: [orderLine({ id: 101, quantity: dec(5), deliveredQty: dec(5), invoicedQty: dec(5) })],
        invoices: [{ totalAmount: dec(10_000), paidAmount: dec(10_000), creditedAmount: dec(0) }],
      });
      const state = world(db, { order, invoice: posted() });
      await db.$transaction((tx: any) => buildSalesInvoicesService(db).applySettlement(tx, 51, { paidAmount: 10_000, creditedAmount: 0 }));
      expect(state.order.paymentStatus).toBe('PAID');
      const sql = rawSql(db);
      expect(sql.findIndex((text: string) => text.includes('FROM sales_orders'))).toBeGreaterThan(0);
    });

    it('refuses a DRAFT invoice, negative sums and settlement beyond the total — nothing written', async () => {
      const db = createSalesDb();
      const state = world(db, { invoice: draftInvoice() });
      const service = buildSalesInvoicesService(db);
      const apply = (paid: number, credited: number) => db.$transaction((tx: any) => service.applySettlement(tx, 51, { paidAmount: paid, creditedAmount: credited }));
      await expect(apply(1, 0)).rejects.toThrow('ثبت‌شده');
      state.invoice = posted();
      await expect(apply(-1, 0)).rejects.toBeInstanceOf(BadRequestException);
      await expect(apply(8000, 2001)).rejects.toBeInstanceOf(ConflictException);
      expect(db.salesInvoice.update).not.toHaveBeenCalled();
    });
  });

  describe('listOpenForCustomer', () => {
    it('POSTED, not PAID, open amount > 0, oldest due first', async () => {
      const db = createSalesDb();
      db.salesInvoice.findMany.mockResolvedValue([
        { id: 1, totalAmount: dec(1000), paidAmount: dec(400), creditedAmount: dec(0), paymentStatus: 'PARTIALLY_PAID' },
        { id: 2, totalAmount: dec(500), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' },
      ]);
      const rows = await buildSalesInvoicesService(db).listOpenForCustomer(db as never, 9);
      const args = db.salesInvoice.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'POSTED', paymentStatus: { not: 'PAID' }, customerId: 9 });
      expect(args.orderBy[0]).toEqual({ dueDate: { sort: 'asc', nulls: 'last' } });
      expect(rows.map((row) => [row.id, row.openAmount.toString()])).toEqual([
        [1, '600'],
        [2, '500'],
      ]);
    });
  });

  describe('queue', () => {
    it('POSTED deliveries with a line no POSTED invoice covers, with open-line count and any draft invoice id', async () => {
      const db = createSalesDb();
      db.delivery.findMany.mockResolvedValue([
        {
          id: 31,
          deliveryNumber: 'DN-1405-000001',
          items: [
            { quantity: dec(5), invoicedQty: dec(0), invoiceItems: [{ salesInvoiceId: 51 }] },
            { quantity: dec(2), invoicedQty: dec(2), invoiceItems: [] },
          ],
        },
      ]);
      const rows = (await buildSalesInvoicesService(db).queue()) as any[];
      expect(db.delivery.findMany.mock.calls[0][0].where).toEqual({
        status: 'POSTED',
        items: { some: { invoiceItems: { none: { salesInvoice: { status: 'POSTED' } } } } },
      });
      expect(rows[0]).toEqual(expect.objectContaining({ id: 31, lineCount: 2, openLineCount: 1, draftInvoiceId: 51 }));
      expect(rows[0].items).toBeUndefined();
    });
  });
});
