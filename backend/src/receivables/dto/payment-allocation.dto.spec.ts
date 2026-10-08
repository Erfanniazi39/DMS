import { allocatePaymentSchema, reverseAllocationSchema, suggestAllocationQuerySchema } from './payment-allocation.dto';

describe('payment-allocation DTOs', () => {
  it('accepts a single-invoice allocation', () => {
    const parsed = allocatePaymentSchema.parse({ sourcePaymentId: 101, items: [{ invoiceId: 51, amount: 5000 }] });
    expect(parsed.items).toHaveLength(1);
  });

  it('accepts a multi-invoice allocation split from one receipt', () => {
    const parsed = allocatePaymentSchema.parse({ sourcePaymentId: 101, items: [{ invoiceId: 51, amount: 3000 }, { invoiceId: 52, amount: 2000 }] });
    expect(parsed.items).toHaveLength(2);
  });

  it('refuses an empty item list, a missing source payment, and a zero/negative amount', () => {
    expect(allocatePaymentSchema.safeParse({ sourcePaymentId: 101, items: [] }).success).toBe(false);
    expect(allocatePaymentSchema.safeParse({ items: [{ invoiceId: 51, amount: 1000 }] }).success).toBe(false);
    expect(allocatePaymentSchema.safeParse({ sourcePaymentId: 101, items: [{ invoiceId: 51, amount: 0 }] }).success).toBe(false);
  });

  it('reverse allocation reason is optional', () => {
    expect(reverseAllocationSchema.parse({}).reason).toBeUndefined();
    expect(reverseAllocationSchema.parse({ reason: 'اشتباه' }).reason).toBe('اشتباه');
  });

  it('suggest-allocation query coerces numeric strings', () => {
    const parsed = suggestAllocationQuerySchema.parse({ customerId: '9', amount: '15000' });
    expect(parsed.customerId).toBe(9);
    expect(parsed.amount).toBe(15_000);
  });
});
