import { Prisma } from '@prisma/client';
import { buildCustomerBalancesService, createReceivablesDb, type ReceivablesDb } from './receivables.spec-helpers';

const dec = (value: number) => new Prisma.Decimal(value);

describe('CustomerBalancesService', () => {
  let db: ReceivablesDb;

  beforeEach(() => {
    db = createReceivablesDb();
  });

  describe('getBalance', () => {
    it('= Σ posted invoices − Σ completed receipts − Σ posted credit notes + Σ completed refunds', async () => {
      db.salesInvoice.findMany.mockResolvedValue([{ totalAmount: dec(10_000) }, { totalAmount: dec(5_000) }]);
      db.state.payments.push(
        { id: 1, customerId: 9, direction: 'RECEIPT', status: 'COMPLETED', amount: dec(6_000) },
        { id: 2, customerId: 9, direction: 'RECEIPT', status: 'PENDING', amount: dec(9_000) }, // an uncleared cheque: excluded
        { id: 3, customerId: 9, direction: 'RECEIPT', status: 'CANCELLED', amount: dec(4_000) }, // cancelled: excluded
        { id: 4, customerId: 9, direction: 'REFUND', status: 'COMPLETED', amount: dec(1_000) },
      );
      db.state.creditNotes.push(
        { id: 301, customerId: 9, status: 'POSTED', totalAmount: dec(2_000) },
        { id: 302, customerId: 9, status: 'DRAFT', totalAmount: dec(9_000) }, // a DRAFT: excluded
      );
      const service = buildCustomerBalancesService(db);

      const balance = await service.getBalance(9);

      // 10,000 + 5,000 − 6,000 − 2,000 + 1,000 = 8,000 (PENDING/CANCELLED/DRAFT rows ignored).
      expect(balance).toBe('8000');
    });

    it('is 0 for a customer with no invoices or payments', async () => {
      db.salesInvoice.findMany.mockResolvedValue([]);
      const service = buildCustomerBalancesService(db);
      expect(await service.getBalance(9)).toBe('0');
    });
  });

  describe('getCustomerAging / getAgingReport', () => {
    it('buckets a customer open invoice by days overdue relative to today', async () => {
      const dueDate40DaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      db.salesInvoice.findMany.mockResolvedValue([
        { id: 1, invoiceNumber: 'INV-1', sourceType: 'OPERATIONAL', salesOrderId: null, invoiceDate: dueDate40DaysAgo, dueDate: dueDate40DaysAgo, totalAmount: dec(7_000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' },
      ]);
      const service = buildCustomerBalancesService(db);

      const aging = await service.getCustomerAging(9);

      expect(aging.D31_60).toBe('7000');
      expect(aging.CURRENT).toBe('0');
      expect(aging.total).toBe('7000');
    });

    it('excludes customers with no open invoices from the full aging report', async () => {
      db.customer.findMany.mockResolvedValue([{ id: 9, customerNumber: 'CUS-0009', name: 'فروشگاه نمونه' }]);
      db.salesInvoice.findMany.mockResolvedValue([]);
      const service = buildCustomerBalancesService(db);

      const report = await service.getAgingReport();

      expect(report).toHaveLength(0);
    });

    it('includes a customer with an open invoice in the full aging report', async () => {
      db.customer.findMany.mockResolvedValue([{ id: 9, customerNumber: 'CUS-0009', name: 'فروشگاه نمونه' }]);
      db.salesInvoice.findMany.mockResolvedValue([
        { id: 1, invoiceNumber: 'INV-1', sourceType: 'OPERATIONAL', salesOrderId: null, invoiceDate: new Date(), dueDate: new Date(), totalAmount: dec(3_000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' },
      ]);
      const service = buildCustomerBalancesService(db);

      const report = await service.getAgingReport();

      expect(report).toHaveLength(1);
      expect(report[0].customerId).toBe(9);
      expect(report[0].aging.CURRENT).toBe('3000');
    });
  });

  describe('getStatement', () => {
    it('only moves the running balance for settled rows (POSTED invoices, COMPLETED payments)', async () => {
      const day1 = new Date('2026-10-01T00:00:00.000Z');
      const day2 = new Date('2026-10-05T00:00:00.000Z');
      const day3 = new Date('2026-10-10T00:00:00.000Z');
      db.salesInvoice.findMany.mockResolvedValue([{ id: 1, invoiceNumber: 'INV-1', invoiceDate: day1, totalAmount: dec(10_000) }]);
      db.state.payments.push(
        { id: 1, customerId: 9, direction: 'RECEIPT', status: 'COMPLETED', amount: dec(4_000), paymentDate: day2, paymentNumber: 'RCP-1' },
        { id: 2, customerId: 9, direction: 'RECEIPT', status: 'PENDING', amount: dec(9_000), paymentDate: day3, paymentNumber: 'RCP-2' },
      );
      const service = buildCustomerBalancesService(db);

      const statement = await service.getStatement(9);

      expect(statement).toHaveLength(3);
      expect(statement[0]).toMatchObject({ kind: 'INVOICE', settled: true, runningBalance: '10000' });
      expect(statement[1]).toMatchObject({ kind: 'RECEIPT', settled: true, runningBalance: '6000' });
      expect(statement[2]).toMatchObject({ kind: 'RECEIPT', settled: false, runningBalance: null });
    });
  });
});
