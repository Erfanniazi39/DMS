import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACTOR, buildCustomerPaymentsService, createReceivablesDb, postedInvoiceWorld, type ReceivablesDb } from './receivables.spec-helpers';

const dec = (value: number) => new Prisma.Decimal(value);
const PAYMENT_DATE = new Date('2026-10-06T00:00:00.000Z');

describe('CustomerPaymentsService', () => {
  let db: ReceivablesDb;

  beforeEach(() => {
    db = createReceivablesDb();
  });

  describe('recordReceipt', () => {
    it('cash/bank/card receipts are COMPLETED immediately and numbered', async () => {
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt({ customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CASH' } as any, ACTOR);
      expect(payment.status).toBe('COMPLETED');
      expect(payment.paymentNumber).toBe('RCP-1405-000001');
      expect(payment.direction).toBe('RECEIPT');
      expect(payment.chequeDueDate).toBeNull();
    });

    it('a cheque receipt starts PENDING, with its due date stored', async () => {
      const service = buildCustomerPaymentsService(db);
      const chequeDueDate = new Date('2026-11-06T00:00:00.000Z');
      const payment = await service.recordReceipt(
        { customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CHECK', chequeDueDate } as any,
        ACTOR,
      );
      expect(payment.status).toBe('PENDING');
      expect(payment.chequeDueDate).toEqual(chequeDueDate);
      expect(payment.paymentNumber).toBe('RCP-1405-000001');
    });

    it('refuses a non-existent customer', async () => {
      db.customer.findUnique.mockResolvedValueOnce(null);
      const service = buildCustomerPaymentsService(db);
      await expect(service.recordReceipt({ customerId: 999, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CASH' } as any, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('refund', () => {
    it('numbers refunds separately from receipts (RFD, not RCP)', async () => {
      const service = buildCustomerPaymentsService(db);
      const payment = await service.refund({ customerId: 9, paymentDate: PAYMENT_DATE, amount: 2000, method: 'BANK_TRANSFER' } as any, ACTOR);
      expect(payment.direction).toBe('REFUND');
      expect(payment.paymentNumber).toBe('RFD-1405-000001');
      expect(payment.status).toBe('COMPLETED');
    });
  });

  describe('cancel', () => {
    it('cancels a COMPLETED payment and reverses its active allocations, recomputing the invoice', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt({ customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CASH' } as any, ACTOR);
      db.paymentAllocation.create({ data: { customerId: 9, sourcePaymentId: payment.id, targetInvoiceId: invoice.id, amount: dec(10_000), allocatedByUserId: 6 } });
      invoice.paidAmount = dec(10_000);
      invoice.paymentStatus = 'PAID';

      await service.cancel(payment.id, { reason: 'اشتباه ثبت شد', updatedAt: payment.updatedAt } as any, ACTOR);

      const cancelled = await service.get(payment.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelReason).toBe('اشتباه ثبت شد');
      expect(invoice.paidAmount.toString()).toBe('0');
      expect(invoice.paymentStatus).toBe('UNPAID');
    });

    it('refuses to cancel a PENDING cheque directly (must use bounce)', async () => {
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt(
        { customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CHECK', chequeDueDate: PAYMENT_DATE } as any,
        ACTOR,
      );
      await expect(service.cancel(payment.id, { reason: 'x', updatedAt: payment.updatedAt } as any, ACTOR)).rejects.toThrow(ConflictException);
    });
  });

  describe('clearCheque', () => {
    it('moves a cheque PENDING -> COMPLETED and makes its existing allocation start counting', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt(
        { customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CHECK', chequeDueDate: PAYMENT_DATE } as any,
        ACTOR,
      );
      db.paymentAllocation.create({ data: { customerId: 9, sourcePaymentId: payment.id, targetInvoiceId: invoice.id, amount: dec(10_000), allocatedByUserId: 6 } });

      // While PENDING, the allocation does not settle the invoice (B9).
      expect(invoice.paidAmount.toString()).toBe('0');

      await service.clearCheque(payment.id, { updatedAt: payment.updatedAt } as any, ACTOR);

      const cleared = await service.get(payment.id);
      expect(cleared.status).toBe('COMPLETED');
      expect(invoice.paidAmount.toString()).toBe('10000');
      expect(invoice.paymentStatus).toBe('PAID');
    });

    it('refuses to clear a non-cheque payment', async () => {
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt({ customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CASH' } as any, ACTOR);
      await expect(service.clearCheque(payment.id, { updatedAt: payment.updatedAt } as any, ACTOR)).rejects.toThrow(BadRequestException);
    });
  });

  describe('bounceCheque', () => {
    it('moves a cheque PENDING -> CANCELLED and reverses its allocation', async () => {
      const { invoice } = postedInvoiceWorld(db);
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt(
        { customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CHECK', chequeDueDate: PAYMENT_DATE } as any,
        ACTOR,
      );
      const allocation = db.paymentAllocation.create({
        data: { customerId: 9, sourcePaymentId: payment.id, targetInvoiceId: invoice.id, amount: dec(10_000), allocatedByUserId: 6 },
      });

      await service.bounceCheque(payment.id, { reason: 'عدم موجودی', updatedAt: payment.updatedAt } as any, ACTOR);

      const bounced = await service.get(payment.id);
      expect(bounced.status).toBe('CANCELLED');
      expect(bounced.cancelReason).toBe('عدم موجودی');
      const stored = await db.paymentAllocation.findUnique({ where: { id: (await allocation).id } });
      expect(stored.reversedAt).not.toBeNull();
      // Was never counted (PENDING), so the invoice stays exactly as it was.
      expect(invoice.paidAmount.toString()).toBe('0');
    });

    it('refuses to bounce a non-cheque payment', async () => {
      const service = buildCustomerPaymentsService(db);
      const payment = await service.recordReceipt({ customerId: 9, paymentDate: PAYMENT_DATE, amount: 10_000, method: 'CASH' } as any, ACTOR);
      await expect(service.bounceCheque(payment.id, { reason: 'x', updatedAt: payment.updatedAt } as any, ACTOR)).rejects.toThrow(BadRequestException);
    });
  });
});
