import { Prisma } from '@prisma/client';
import { purchasesSummaryQuerySchema } from '../dashboard/dto/purchases-summary.dto';
import { SalesReportsService } from './sales-reports.service';

// Read-only Sales reports (Batch 7) — hand-rolled Prisma mock, same style as
// dashboard/dashboard.service.spec.ts (the direct precedent this file
// mirrors).

function createPrismaMock() {
  return {
    salesOrder: { findMany: jest.fn(), groupBy: jest.fn() },
    salesInvoice: { groupBy: jest.fn(), findMany: jest.fn() },
    salesInvoiceItem: { groupBy: jest.fn() },
    customerPayment: { groupBy: jest.fn() },
    item: { findMany: jest.fn() },
    customer: { findMany: jest.fn() },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createService(prisma: PrismaMock) {
  return new SalesReportsService(prisma as never);
}

function parse(query: Record<string, string>) {
  return purchasesSummaryQuerySchema.parse(query);
}

// Wednesday 30 Sep 2026, midday in Tehran — Jalali 8 Mehr 1405. Same fixed
// "now" dashboard.service.spec.ts uses, so the period-resolution assertions
// below (week = 26–30 Sep) line up with that spec's own expectations.
const NOW = new Date('2026-09-30T08:00:00Z');

describe('SalesReportsService.getBacklog', () => {
  it('returns only the undelivered lines of CONFIRMED-not-fully-delivered orders, with remaining value matching invoice math', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesOrder.findMany.mockResolvedValue([
      {
        id: 1,
        orderNumber: 'SO-1405-000001',
        orderDate: new Date('2026-09-20T00:00:00Z'),
        customer: { id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' },
        items: [
          {
            id: 101,
            lineNo: 1,
            itemId: 1,
            itemName: 'شیر',
            unitName: 'عدد',
            quantity: new Prisma.Decimal(10),
            deliveredQty: new Prisma.Decimal(4),
            unitPrice: new Prisma.Decimal(1000),
            discountPercent: null,
            discountAmount: new Prisma.Decimal(0),
            taxRate: new Prisma.Decimal(0),
          },
          {
            // Fully delivered — excluded from the backlog's own lines even
            // though the header still qualifies (another line is open).
            id: 102,
            lineNo: 2,
            itemId: 2,
            itemName: 'ماست',
            unitName: 'عدد',
            quantity: new Prisma.Decimal(5),
            deliveredQty: new Prisma.Decimal(5),
            unitPrice: new Prisma.Decimal(500),
            discountPercent: null,
            discountAmount: new Prisma.Decimal(0),
            taxRate: new Prisma.Decimal(0),
          },
        ],
      },
    ]);

    const result = await service.getBacklog();

    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'CONFIRMED', deliveryStatus: { not: 'DELIVERED' } },
        orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].customer).toEqual({ id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' });
    expect(result[0].lines).toEqual([
      { id: 101, lineNo: 1, itemId: 1, itemName: 'شیر', unitName: 'عدد', remainingQty: '6', remainingValue: '6000' },
    ]);
    expect(result[0].totalRemainingValue).toBe('6000');
  });

  it('drops an order with no undelivered line left (defensive — deliveryStatus should already exclude it)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesOrder.findMany.mockResolvedValue([
      {
        id: 2,
        orderNumber: 'SO-1405-000002',
        orderDate: new Date('2026-09-21T00:00:00Z'),
        customer: { id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' },
        items: [
          {
            id: 201,
            lineNo: 1,
            itemId: 1,
            itemName: 'شیر',
            unitName: 'عدد',
            quantity: new Prisma.Decimal(3),
            deliveredQty: new Prisma.Decimal(3),
            unitPrice: new Prisma.Decimal(1000),
            discountPercent: null,
            discountAmount: new Prisma.Decimal(0),
            taxRate: new Prisma.Decimal(0),
          },
        ],
      },
    ]);

    await expect(service.getBacklog()).resolves.toEqual([]);
  });

  it('prorates a fixed discount by the remaining quantity, same as SalesInvoicesService.createFromDelivery() would', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesOrder.findMany.mockResolvedValue([
      {
        id: 3,
        orderNumber: 'SO-1405-000003',
        orderDate: new Date('2026-09-22T00:00:00Z'),
        customer: { id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' },
        items: [
          {
            id: 301,
            lineNo: 1,
            itemId: 1,
            itemName: 'شیر',
            unitName: 'عدد',
            quantity: new Prisma.Decimal(10),
            deliveredQty: new Prisma.Decimal(0),
            unitPrice: new Prisma.Decimal(1000),
            discountPercent: null,
            discountAmount: new Prisma.Decimal(1000),
            taxRate: new Prisma.Decimal(0),
          },
        ],
      },
    ]);

    const result = await service.getBacklog();
    // gross 10×1000=10000; the full order quantity is still undelivered, so
    // the whole 1000 discount prorates onto it; lineTotal 9000.
    expect(result[0].lines[0]).toEqual(expect.objectContaining({ remainingQty: '10', remainingValue: '9000' }));
  });
});

describe('SalesReportsService.getSalesByItem', () => {
  it('filters to POSTED operational invoices in the period and ranks by revenue', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesInvoiceItem.groupBy.mockResolvedValue([
      { itemId: 1, _sum: { quantity: new Prisma.Decimal(20), lineTotal: new Prisma.Decimal(20000) }, _count: { _all: 4 } },
      { itemId: 2, _sum: { quantity: new Prisma.Decimal(5), lineTotal: new Prisma.Decimal(2500) }, _count: { _all: 1 } },
    ]);
    prisma.item.findMany.mockResolvedValue([
      { id: 1, code: 'ITM-1', name: 'شیر', unit: { nameFa: 'عدد' } },
      { id: 2, code: 'ITM-2', name: 'ماست', unit: { nameFa: 'عدد' } },
    ]);

    const result = await service.getSalesByItem(parse({ period: 'month' }), NOW);

    expect(prisma.salesInvoiceItem.groupBy.mock.calls[0][0].where).toEqual({
      itemId: { not: null },
      salesInvoice: {
        status: 'POSTED',
        sourceType: 'OPERATIONAL',
        invoiceDate: { gte: new Date('2026-09-23T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
      },
    });
    expect(result.rows).toEqual([
      { item: { id: 1, code: 'ITM-1', name: 'شیر', unit: { nameFa: 'عدد' } }, quantity: '20', revenue: '20000', invoiceLineCount: 4 },
      { item: { id: 2, code: 'ITM-2', name: 'ماست', unit: { nameFa: 'عدد' } }, quantity: '5', revenue: '2500', invoiceLineCount: 1 },
    ]);
  });

  it('returns an empty list and skips the item lookup when nothing sold', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesInvoiceItem.groupBy.mockResolvedValue([]);

    const result = await service.getSalesByItem(parse({ period: 'today' }), NOW);
    expect(result.rows).toEqual([]);
    expect(prisma.item.findMany).not.toHaveBeenCalled();
  });
});

describe('SalesReportsService.getSalesByCustomer', () => {
  it('folds per-invoice quantity onto each customer via the id lookup, and ranks by revenue', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesInvoice.groupBy.mockResolvedValue([{ customerId: 9, _sum: { totalAmount: new Prisma.Decimal(15000) }, _count: { _all: 2 } }]);
    prisma.salesInvoice.findMany.mockResolvedValue([
      { id: 101, customerId: 9 },
      { id: 102, customerId: 9 },
    ]);
    prisma.salesInvoiceItem.groupBy.mockResolvedValue([
      { salesInvoiceId: 101, _sum: { quantity: new Prisma.Decimal(10) } },
      { salesInvoiceId: 102, _sum: { quantity: new Prisma.Decimal(4) } },
    ]);
    prisma.customer.findMany.mockResolvedValue([{ id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' }]);

    const result = await service.getSalesByCustomer(parse({ period: 'month' }), NOW);

    expect(result.rows).toEqual([
      { customer: { id: 9, customerNumber: 'CUS-000009', name: 'فروشگاه نمونه' }, quantity: '14', revenue: '15000', invoiceCount: 2 },
    ]);
  });

  it('returns an empty list and skips every follow-up lookup when nothing sold', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesInvoice.groupBy.mockResolvedValue([]);
    prisma.salesInvoice.findMany.mockResolvedValue([]);

    const result = await service.getSalesByCustomer(parse({ period: 'today' }), NOW);
    expect(result.rows).toEqual([]);
    expect(prisma.salesInvoiceItem.groupBy).not.toHaveBeenCalled();
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
});

describe('SalesReportsService.getDailySummary', () => {
  it('buckets confirmed-order amount, invoiced revenue, and received payments independently per day', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesOrder.groupBy.mockResolvedValue([
      { confirmedAt: new Date('2026-09-26T10:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(5000) }, _count: { _all: 1 } },
    ]);
    prisma.salesInvoice.groupBy.mockResolvedValue([
      { invoiceDate: new Date('2026-09-27T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(3000) }, _count: { _all: 1 } },
    ]);
    prisma.customerPayment.groupBy.mockResolvedValue([
      { paymentDate: new Date('2026-09-30T00:00:00Z'), _sum: { amount: new Prisma.Decimal(2000) }, _count: { _all: 1 } },
    ]);

    const result = await service.getDailySummary(parse({ period: 'week' }), NOW);

    // CANCELLED excluded, confirmedAt within the half-open range (sales-rules.ts CONFIRMED_SALES_ORDER_WHERE).
    expect(prisma.salesOrder.groupBy.mock.calls[0][0].where).toEqual({
      confirmedAt: { gte: new Date('2026-09-26T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
      status: { not: 'CANCELLED' },
    });
    // POSTED + OPERATIONAL only (SALES_STATISTICS_INVOICE_WHERE).
    expect(prisma.salesInvoice.groupBy.mock.calls[0][0].where).toEqual({
      status: 'POSTED',
      sourceType: 'OPERATIONAL',
      invoiceDate: { gte: new Date('2026-09-26T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
    });
    // Only a cleared RECEIPT counts as "received" (COMPLETED_RECEIPT_PAYMENT_WHERE, B9).
    expect(prisma.customerPayment.groupBy.mock.calls[0][0].where).toEqual({
      direction: 'RECEIPT',
      status: 'COMPLETED',
      paymentDate: { gte: new Date('2026-09-26T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
    });

    expect(result.period).toEqual({ key: 'week', from: '2026-09-26', to: '2026-09-30', bucket: 'day' });
    expect(result.trend).toEqual([
      { date: '2026-09-26', confirmedOrderAmount: '5000', confirmedOrderCount: 1, invoicedAmount: '0', invoicedCount: 0, paymentAmount: '0', paymentCount: 0 },
      { date: '2026-09-27', confirmedOrderAmount: '0', confirmedOrderCount: 0, invoicedAmount: '3000', invoicedCount: 1, paymentAmount: '0', paymentCount: 0 },
      { date: '2026-09-28', confirmedOrderAmount: '0', confirmedOrderCount: 0, invoicedAmount: '0', invoicedCount: 0, paymentAmount: '0', paymentCount: 0 },
      { date: '2026-09-29', confirmedOrderAmount: '0', confirmedOrderCount: 0, invoicedAmount: '0', invoicedCount: 0, paymentAmount: '0', paymentCount: 0 },
      { date: '2026-09-30', confirmedOrderAmount: '0', confirmedOrderCount: 0, invoicedAmount: '0', invoicedCount: 0, paymentAmount: '2000', paymentCount: 1 },
    ]);
  });

  it('ignores a confirmed-then-cancelled order (CONFIRMED_SALES_ORDER_WHERE excludes CANCELLED)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.salesOrder.groupBy.mockResolvedValue([]);
    prisma.salesInvoice.groupBy.mockResolvedValue([]);
    prisma.customerPayment.groupBy.mockResolvedValue([]);

    const result = await service.getDailySummary(parse({ period: 'today' }), NOW);
    expect(result.trend).toEqual([
      { date: '2026-09-30', confirmedOrderAmount: '0', confirmedOrderCount: 0, invoicedAmount: '0', invoicedCount: 0, paymentAmount: '0', paymentCount: 0 },
    ]);
  });
});
