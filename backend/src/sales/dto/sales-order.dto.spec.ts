import { cancelSalesOrderSchema, confirmSalesOrderSchema, createSalesOrderSchema } from './sales-order.dto';

const base = { orderDate: '2026-10-06', customerId: 9, items: [{ itemId: 1, quantity: 5, unitPrice: 1000 }] };

describe('sales-order DTOs', () => {
  it('accepts a minimal draft; client-only fields are stripped (no orderNumber/status/totals from the client)', () => {
    const parsed = createSalesOrderSchema.parse({ ...base, orderNumber: 'SO-1', status: 'CONFIRMED', totalAmount: 1 });
    expect(parsed).not.toHaveProperty('orderNumber');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('totalAmount');
  });

  it('refuses a discount given both as percent and amount, a percent over 100, and an empty item list', () => {
    expect(createSalesOrderSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: 1, unitPrice: 1, discountPercent: 5, discountAmount: 5 }] }).success).toBe(false);
    expect(createSalesOrderSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: 1, unitPrice: 1, taxRate: 101 }] }).success).toBe(false);
    expect(createSalesOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });

  it('refuses null / blank required fields instead of coercing them', () => {
    expect(createSalesOrderSchema.safeParse({ ...base, customerId: null }).success).toBe(false);
    expect(createSalesOrderSchema.safeParse({ ...base, items: [{ itemId: 1, quantity: '', unitPrice: 1 }] }).success).toBe(false);
  });

  it('cancel requires a reason; confirm defaults submitForApproval to false', () => {
    expect(cancelSalesOrderSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', reason: '  ' }).success).toBe(false);
    expect(confirmSalesOrderSchema.parse({ updatedAt: '2026-10-01T10:00:00.000Z' }).submitForApproval).toBe(false);
  });
});
