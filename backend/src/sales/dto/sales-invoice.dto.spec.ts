import { createOpeningBalanceInvoiceSchema, createSalesInvoiceSchema, postSalesInvoiceSchema, salesInvoiceListQuerySchema } from './sales-invoice.dto';

describe('sales-invoice DTOs', () => {
  it('create-from-delivery takes only the delivery, an optional date and a note; client-only fields are stripped', () => {
    const parsed = createSalesInvoiceSchema.parse({
      deliveryId: 31,
      invoiceNumber: 'INV-1',
      status: 'POSTED',
      dueDate: '2026-12-01',
      paidAmount: 100,
      paymentStatus: 'PAID',
      totalAmount: 1,
      items: [{ quantity: 1 }],
    });
    expect(parsed).toEqual({ deliveryId: 31 });
    expect(createSalesInvoiceSchema.parse({ deliveryId: 31, invoiceDate: '' }).invoiceDate).toBeUndefined();
    expect(createSalesInvoiceSchema.safeParse({}).success).toBe(false);
  });

  it('opening balance: customer, date and at least one line; quantity > 0, whole-Rial price ≥ 0, tax 0–100', () => {
    const base = { customerId: 9, invoiceDate: '2026-10-06' };
    expect(createOpeningBalanceInvoiceSchema.safeParse({ ...base, items: [{ quantity: 1, unitPrice: 1000 }] }).success).toBe(true);
    expect(createOpeningBalanceInvoiceSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(createOpeningBalanceInvoiceSchema.safeParse({ ...base, items: [{ quantity: 0, unitPrice: 1000 }] }).success).toBe(false);
    expect(createOpeningBalanceInvoiceSchema.safeParse({ ...base, items: [{ quantity: 1, unitPrice: 10.5 }] }).success).toBe(false);
    expect(createOpeningBalanceInvoiceSchema.safeParse({ ...base, items: [{ quantity: 1, unitPrice: 1, taxRate: 101 }] }).success).toBe(false);
    expect(createOpeningBalanceInvoiceSchema.safeParse({ invoiceDate: '2026-10-06', items: [{ quantity: 1, unitPrice: 1 }] }).success).toBe(false);
    const parsed = createOpeningBalanceInvoiceSchema.parse({ ...base, sourceType: 'OPERATIONAL', salesOrderId: 3, items: [{ quantity: 1, unitPrice: 1, deliveryItemId: 4 }] });
    expect(parsed).not.toHaveProperty('sourceType');
    expect(parsed).not.toHaveProperty('salesOrderId');
    expect(parsed.items[0]).not.toHaveProperty('deliveryItemId');
  });

  it('post requires the version; list filters are validated', () => {
    expect(postSalesInvoiceSchema.safeParse({}).success).toBe(false);
    expect(salesInvoiceListQuerySchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(salesInvoiceListQuerySchema.safeParse({ sourceType: 'X' }).success).toBe(false);
    expect(salesInvoiceListQuerySchema.parse({ status: '', overdue: '' })).toEqual({});
    expect(salesInvoiceListQuerySchema.parse({ overdue: 'true', paymentStatus: 'UNPAID' })).toEqual({ overdue: 'true', paymentStatus: 'UNPAID' });
  });
});
