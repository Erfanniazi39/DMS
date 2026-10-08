import {
  bounceChequeSchema,
  cancelCustomerPaymentSchema,
  clearChequeSchema,
  createCustomerReceiptSchema,
  customerPaymentListQuerySchema,
} from './customer-payment.dto';

const base = { customerId: 9, paymentDate: '2026-10-06', amount: 10_000, method: 'CASH' };

describe('customer-payment DTOs', () => {
  it('accepts a plain cash receipt; chequeDueDate is not required', () => {
    const parsed = createCustomerReceiptSchema.parse(base);
    expect(parsed.amount).toBe(10_000);
    expect(parsed.chequeDueDate).toBeUndefined();
  });

  it('requires chequeDueDate when method is CHECK (B9)', () => {
    expect(createCustomerReceiptSchema.safeParse({ ...base, method: 'CHECK' }).success).toBe(false);
    expect(createCustomerReceiptSchema.safeParse({ ...base, method: 'CHECK', chequeDueDate: '2026-11-06' }).success).toBe(true);
  });

  it('refuses a zero/negative amount and a missing customer', () => {
    expect(createCustomerReceiptSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(createCustomerReceiptSchema.safeParse({ ...base, amount: -500 }).success).toBe(false);
    expect(createCustomerReceiptSchema.safeParse({ ...base, customerId: undefined }).success).toBe(false);
  });

  it('cancel / bounce require a reason and a version; clear only requires a version', () => {
    expect(cancelCustomerPaymentSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(false);
    expect(cancelCustomerPaymentSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', reason: 'اشتباه ثبت شد' }).success).toBe(true);
    expect(bounceChequeSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(false);
    expect(clearChequeSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(true);
  });

  it('list query: blank filters become undefined, bad enum values are refused', () => {
    expect(customerPaymentListQuerySchema.parse({ status: '' }).status).toBeUndefined();
    expect(customerPaymentListQuerySchema.safeParse({ status: 'NOT_A_STATUS' }).success).toBe(false);
    expect(customerPaymentListQuerySchema.safeParse({ direction: 'NOT_A_DIRECTION' }).success).toBe(false);
  });
});
