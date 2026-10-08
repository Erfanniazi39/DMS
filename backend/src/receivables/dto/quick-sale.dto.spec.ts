import { createQuickSaleSchema } from './quick-sale.dto';

const base = { customerId: 9, paymentMethod: 'CASH', items: [{ itemId: 1, quantity: 2, unitPrice: 5000 }] };

describe('quick-sale DTO', () => {
  it('accepts a minimal body; saleDate/referenceNumber are optional', () => {
    expect(createQuickSaleSchema.safeParse(base).success).toBe(true);
  });

  it('refuses CHECK as a payment method (an uncleared cheque would not settle immediately)', () => {
    expect(createQuickSaleSchema.safeParse({ ...base, paymentMethod: 'CHECK' }).success).toBe(false);
  });

  it('refuses an empty item list and a zero/negative quantity or price', () => {
    expect(createQuickSaleSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(createQuickSaleSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: 0, unitPrice: 1000 }] }).success).toBe(false);
    expect(createQuickSaleSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: 1, unitPrice: -1 }] }).success).toBe(false);
  });
});
