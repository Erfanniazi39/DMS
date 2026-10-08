import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTOR,
  buildCustomerPaymentsService,
  buildPaymentAllocationsService,
  createReceivablesDb,
  postedInvoiceWorld,
  type ReceivablesDb,
} from './receivables.spec-helpers';

const dec = (value: number) => new Prisma.Decimal(value);
const PAYMENT_DATE = new Date('2026-10-06T00:00:00.000Z');

async function completedReceipt(db: ReceivablesDb, amount: number) {
  const payments = buildCustomerPaymentsService(db);
  return payments.recordReceipt({ customerId: 9, paymentDate: PAYMENT_DATE, amount, method: 'CASH' } as any, ACTOR);
}

describe('PaymentAllocationsService', () => {
  let db: ReceivablesDb;

  beforeEach(() => {
    db = createReceivablesDb();
  });

  describe('allocate', () => {
    it('allocates a full receipt to one invoice and settles it (PAID)', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 10_000 }] } as any, ACTOR);

      expect(db.state.allocations).toHaveLength(1);
      expect(invoice.paidAmount.toString()).toBe('10000');
      expect(invoice.paymentStatus).toBe('PAID');
    });

    it('a partial allocation leaves the invoice PARTIALLY_PAID and the rest of the receipt unapplied', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 4_000 }] } as any, ACTOR);

      expect(invoice.paidAmount.toString()).toBe('4000');
      expect(invoice.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('refuses to allocate more than the receipt has left unapplied', async () => {
      const { invoice } = postedInvoiceWorld(db, { totalAmount: dec(50_000) });
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);
      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 6_000 }] } as any, ACTOR);

      await expect(allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 5_000 }] } as any, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses to allocate more than the invoice has open — the surplus stays unapplied, never forced', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payment = await completedReceipt(db, 50_000);
      const allocations = buildPaymentAllocationsService(db);

      await expect(allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 20_000 }] } as any, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(invoice.paidAmount.toString()).toBe('0');
    });

    it('refuses an invoice belonging to a different customer', async () => {
      const { invoice } = postedInvoiceWorld(db, { customerId: 42 });
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);
      await expect(allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 5_000 }] } as any, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a non-existent invoice', async () => {
      await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);
      await expect(allocations.allocate({ sourcePaymentId: 101, items: [{ invoiceId: 9999, amount: 1_000 }] } as any, ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('a PENDING cheque can be allocated but does not settle the invoice until cleared (B9)', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payments = buildCustomerPaymentsService(db);
      const payment = await payments.recordReceipt(
        { customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CHECK', chequeDueDate: PAYMENT_DATE } as any,
        ACTOR,
      );
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 10_000 }] } as any, ACTOR);

      expect(invoice.paidAmount.toString()).toBe('0');
      expect(invoice.paymentStatus).toBe('UNPAID');
    });

    it('splits one receipt across two invoices in a single call', async () => {
      const { invoice: invoiceA } = postedInvoiceWorld(db, { id: 51 });
      const invoiceB = { ...invoiceA, id: 52, paidAmount: dec(0), paymentStatus: 'UNPAID', totalAmount: dec(3_000) };
      db.salesInvoice.findUnique.mockImplementation(async ({ where }: any) => (where.id === 52 ? invoiceB : invoiceA));
      db.salesInvoice.update.mockImplementation(async ({ where, data }: any) => Object.assign(where.id === 52 ? invoiceB : invoiceA, data));
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocate(
        { sourcePaymentId: payment.id, items: [{ invoiceId: 51, amount: 6_000 }, { invoiceId: 52, amount: 3_000 }] } as any,
        ACTOR,
      );

      expect(invoiceA.paidAmount.toString()).toBe('6000');
      expect(invoiceB.paidAmount.toString()).toBe('3000');
    });
  });

  describe('reverse', () => {
    it('reverses an allocation (stamped, never deleted) and recomputes the invoice back down', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);
      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 10_000 }] } as any, ACTOR);
      expect(invoice.paymentStatus).toBe('PAID');

      const allocationId = db.state.allocations[0].id;
      await allocations.reverse(allocationId, { reason: 'اشتباه بود' } as any, ACTOR);

      const stored = await db.paymentAllocation.findUnique({ where: { id: allocationId } });
      expect(stored.reversedAt).not.toBeNull();
      expect(invoice.paidAmount.toString()).toBe('0');
      expect(invoice.paymentStatus).toBe('UNPAID');
    });

    it('refuses to reverse an allocation twice', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const payment = await completedReceipt(db, 10_000);
      const allocations = buildPaymentAllocationsService(db);
      await allocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: 10_000 }] } as any, ACTOR);
      const allocationId = db.state.allocations[0].id;
      await allocations.reverse(allocationId, {} as any, ACTOR);
      await expect(allocations.reverse(allocationId, {} as any, ACTOR)).rejects.toThrow(ConflictException);
    });
  });

  // The credit-note branch (Sales batch 6, build plan §6/§12): called
  // directly by CreditNotesService.post() with a tx, not via the REST
  // allocate() endpoint — see credit-notes.service.spec.ts for the
  // full create→post flow through this method. These are focused checks on
  // the method itself.
  describe('allocateCreditNoteToInvoice', () => {
    // settlement.ts's recomputeInvoiceSettlement() only counts a
    // sourceCreditNoteId allocation once that CreditNote is POSTED — in
    // production this is always true by the time CreditNotesService.post()
    // calls this method (same transaction, credit note written POSTED
    // first), so every test here seeds a matching POSTED row.
    function postedCreditNoteFixture(db: ReceivablesDb, overrides: Record<string, unknown> = {}) {
      const row = { id: 301, customerId: 9, status: 'POSTED', totalAmount: dec(5_000), ...overrides };
      db.state.creditNotes.push(row);
      return row;
    }

    it('creates a sourceCreditNoteId-sourced allocation and settles the invoice', async () => {
      const { invoice } = postedInvoiceWorld(db);
      postedCreditNoteFixture(db);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocateCreditNoteToInvoice(db as never, { creditNoteId: 301, customerId: 9, invoiceId: invoice.id, amount: dec(4_000), actor: ACTOR });

      expect(db.state.allocations).toEqual([expect.objectContaining({ sourceCreditNoteId: 301, targetInvoiceId: invoice.id, amount: dec(4_000) })]);
      expect(db.state.allocations[0].sourcePaymentId).toBeUndefined();
      expect(invoice.creditedAmount.toString()).toBe('4000');
      expect(invoice.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('caps at the invoice’s open amount instead of rejecting the excess', async () => {
      const { invoice } = postedInvoiceWorld(db, { totalAmount: dec(3_000) });
      postedCreditNoteFixture(db);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocateCreditNoteToInvoice(db as never, { creditNoteId: 301, customerId: 9, invoiceId: invoice.id, amount: dec(10_000), actor: ACTOR });

      expect(db.state.allocations[0].amount.toString()).toBe('3000');
      expect(invoice.paymentStatus).toBe('PAID');
    });

    it('is a no-op for a zero/already-settled amount — no allocation row, no error', async () => {
      const { invoice } = postedInvoiceWorld(db, { paidAmount: dec(10_000), paymentStatus: 'PAID' });
      postedCreditNoteFixture(db);
      const allocations = buildPaymentAllocationsService(db);

      await allocations.allocateCreditNoteToInvoice(db as never, { creditNoteId: 301, customerId: 9, invoiceId: invoice.id, amount: dec(5_000), actor: ACTOR });

      expect(db.state.allocations).toHaveLength(0);
    });

    it('refuses an invoice belonging to a different customer', async () => {
      const { invoice } = postedInvoiceWorld(db, { customerId: 42 });
      postedCreditNoteFixture(db);
      const allocations = buildPaymentAllocationsService(db);
      await expect(
        allocations.allocateCreditNoteToInvoice(db as never, { creditNoteId: 301, customerId: 9, invoiceId: invoice.id, amount: dec(1_000), actor: ACTOR }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a non-existent invoice', async () => {
      postedCreditNoteFixture(db);
      const allocations = buildPaymentAllocationsService(db);
      await expect(
        allocations.allocateCreditNoteToInvoice(db as never, { creditNoteId: 301, customerId: 9, invoiceId: 9999, amount: dec(1_000), actor: ACTOR }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('suggestAllocation', () => {
    it('fills open invoices oldest-first up to the given amount, leaving the rest unallocated', async () => {
      const older = { id: 61, invoiceNumber: 'INV-1', dueDate: new Date('2026-09-01'), invoiceDate: new Date('2026-08-01'), totalAmount: dec(4000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' };
      const newer = { id: 62, invoiceNumber: 'INV-2', dueDate: new Date('2026-10-01'), invoiceDate: new Date('2026-09-01'), totalAmount: dec(9000), paidAmount: dec(0), creditedAmount: dec(0), paymentStatus: 'UNPAID' };
      db.salesInvoice.findMany.mockResolvedValue([older, newer]);
      const allocations = buildPaymentAllocationsService(db);

      const suggestion = await allocations.suggestAllocation(9, 10_000);

      expect(suggestion.items).toEqual([
        { invoiceId: 61, invoiceNumber: 'INV-1', dueDate: older.dueDate, amount: '4000' },
        { invoiceId: 62, invoiceNumber: 'INV-2', dueDate: newer.dueDate, amount: '6000' },
      ]);
      expect(suggestion.unallocated).toBe('0');
    });
  });
});
