import { Prisma } from '@prisma/client';
import { computeExposure, evaluateCredit } from './sales-credit';
import { createSalesDb, setCreditPolicy } from './sales.spec-helpers';

const dec = (value: number) => new Prisma.Decimal(value);

describe('sales-credit', () => {
  it('computeExposure: the uninvoiced remainder of CONFIRMED, not-fully-invoiced orders (excluding the given order) + open POSTED invoices', async () => {
    const db = createSalesDb();
    db.salesOrder.findMany.mockResolvedValue([
      { totalAmount: dec(7000), invoices: [] },
      // 10 000 ordered, 6 000 already invoiced → 4 000 still uninvoiced.
      { totalAmount: dec(10_000), invoices: [{ totalAmount: dec(6000) }] },
      // Rounding can make invoices exceed the order by a Rial — never negative.
      { totalAmount: dec(3000), invoices: [{ totalAmount: dec(3001) }] },
    ]);
    db.salesInvoice.findMany.mockResolvedValue([
      { id: 1, totalAmount: dec(6000), paidAmount: dec(1000), creditedAmount: dec(500), paymentStatus: 'PARTIALLY_PAID' },
      { id: 2, totalAmount: dec(2000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' },
    ]);

    const exposure = await computeExposure(db as never, 9, { excludeSalesOrderId: 11 });

    expect(db.salesOrder.findMany).toHaveBeenCalledWith({
      where: { status: 'CONFIRMED', invoicingStatus: { not: 'INVOICED' }, customerId: 9, id: { not: 11 } },
      select: { totalAmount: true, invoices: { where: { status: 'POSTED' }, select: { totalAmount: true } } },
    });
    expect(db.salesInvoice.findMany.mock.calls[0][0].where).toEqual({ status: 'POSTED', paymentStatus: { not: 'PAID' }, customerId: 9 });
    expect([exposure.uninvoicedOrders.toString(), exposure.openInvoices.toString(), exposure.total.toString()]).toEqual(['11000', '6500', '17500']);
  });

  it('a posted invoice moves its amount from the order side to the invoice side — never counted twice', async () => {
    const db = createSalesDb();
    db.salesOrder.findMany.mockResolvedValue([{ totalAmount: dec(5000), invoices: [{ totalAmount: dec(5000) }] }]);
    db.salesInvoice.findMany.mockResolvedValue([{ id: 1, totalAmount: dec(5000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' }]);
    const exposure = await computeExposure(db as never, 9);
    expect(exposure.total.toString()).toBe('5000');
  });

  it('B4: creditLimit = null means no credit — any positive order exceeds it', async () => {
    const db = createSalesDb();
    setCreditPolicy(db, { creditLimit: null });
    const check = await evaluateCredit(db as never, 9, 1);
    expect(check.creditLimit).toBeNull();
    expect(check.effectiveLimit.toString()).toBe('0');
    expect(check.exceeded).toBe(true);
    expect(check.excess.toString()).toBe('1');
  });

  it('within the limit (exposure + order ≤ limit) passes; one Rial over fails', async () => {
    const db = createSalesDb();
    setCreditPolicy(db, { creditLimit: 10_000 });
    db.salesOrder.findMany.mockResolvedValue([{ totalAmount: dec(3000), invoices: [] }]);
    db.salesInvoice.findMany.mockResolvedValue([{ id: 1, totalAmount: dec(1000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' }]);
    expect((await evaluateCredit(db as never, 9, 6000)).exceeded).toBe(false);
    const over = await evaluateCredit(db as never, 9, 6001);
    expect([over.exceeded, over.projected.toString(), over.excess.toString()]).toEqual([true, '10001', '1']);
  });

  it('locks the customer financial profile row FOR UPDATE before reading exposure', async () => {
    const db = createSalesDb();
    await evaluateCredit(db as never, 9, 1);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FROM customer_financial_profiles WHERE customer_id = ? FOR UPDATE');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.salesOrder.findMany.mock.invocationCallOrder[0]);
  });
});
