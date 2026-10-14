import { BadRequestException } from '@nestjs/common';
import { HistoricalSalesService } from './historical-sales.service';
import { QuickSaleService } from './quick-sale.service';
import { historicalSaleRowSchema } from './dto/historical-sales.dto';

// Orchestration only (same approach as quick-sale.service.spec.ts): plain
// jest.fn() collaborators; each collaborator's own rules have their own specs.

const ACTOR = { userId: 4, ipAddress: '127.0.0.1', canApprove: false, canViewCredit: false };
const UPDATED = new Date('2026-09-01T00:00:00.000Z');

function buildChain() {
  const salesOrders = {
    create: jest.fn().mockResolvedValue({ id: 11, updatedAt: UPDATED }),
    confirm: jest.fn().mockResolvedValue({ id: 11, orderNumber: 'SO-1405-000001', updatedAt: UPDATED }),
  };
  const deliveries = {
    createFromOrder: jest.fn().mockResolvedValue({ id: 31, updatedAt: UPDATED }),
    post: jest.fn().mockResolvedValue({ id: 31, deliveryNumber: 'DN-1405-000001', updatedAt: UPDATED }),
  };
  const salesInvoices = {
    create: jest.fn().mockResolvedValue({ id: 51, updatedAt: UPDATED }),
    post: jest.fn().mockResolvedValue({ id: 51, invoiceNumber: 'INV-1405-000001', totalAmount: { toNumber: () => 11_000 } }),
  };
  const customerPayments = { recordReceipt: jest.fn().mockResolvedValue({ id: 101, paymentNumber: 'RCP-1405-000001' }) };
  const paymentAllocations = { allocate: jest.fn().mockResolvedValue({}) };
  const quickSale = new QuickSaleService(salesOrders as never, deliveries as never, salesInvoices as never, customerPayments as never, paymentAllocations as never);
  return { service: new HistoricalSalesService(quickSale), salesOrders, customerPayments, paymentAllocations };
}

const row = (extra: Record<string, unknown> = {}) => ({
  customerId: 9,
  saleDate: '2026-09-01',
  items: [{ itemId: 1, quantity: 2, unitPrice: 5_000, taxRate: 10 }],
  paymentMode: 'FULL',
  paymentMethod: 'CASH',
  ...extra,
});

describe('HistoricalSalesService.createBatch', () => {
  it('FULL: runs the chain on the sale date and pays the whole invoice', async () => {
    const { service, salesOrders, customerPayments, paymentAllocations } = buildChain();
    const { results } = await service.createBatch({ rows: [row()] }, ACTOR);

    expect(results[0]).toEqual(expect.objectContaining({ index: 0, ok: true, invoice: { id: 51, invoiceNumber: 'INV-1405-000001' }, payment: { id: 101, paymentNumber: 'RCP-1405-000001' } }));
    expect(salesOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderDate: new Date('2026-09-01T00:00:00.000Z'), items: [expect.objectContaining({ itemId: 1, taxRate: 10, priceOverrideReason: 'ثبت فروش تاریخی' })] }),
      ACTOR,
    );
    expect(customerPayments.recordReceipt).toHaveBeenCalledWith(expect.objectContaining({ amount: 11_000, method: 'CASH', paymentDate: new Date('2026-09-01T00:00:00.000Z') }), ACTOR);
    expect(paymentAllocations.allocate).toHaveBeenCalledWith({ sourcePaymentId: 101, items: [{ invoiceId: 51, amount: 11_000 }] }, ACTOR);
  });

  it('passes the transfer-receipt info through to the receipt', async () => {
    const { service, customerPayments } = buildChain();
    await service.createBatch({ rows: [row({ paymentMethod: 'BANK_TRANSFER', transactionType: 'پایا', transactionTime: '14:30', depositId: 'D-1', sourceAccount: '6037-1' })] }, ACTOR);
    expect(customerPayments.recordReceipt).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'پایا', transactionTime: '14:30', depositId: 'D-1', sourceAccount: '6037-1' }), ACTOR);
  });

  it('passes discounts to the order, and a partial payment is capped by the DISCOUNTED total', async () => {
    const { service, salesOrders, customerPayments } = buildChain();
    // 2 × 5000 = 10000, 10% discount → 9000, +10% tax → 9900
    const discounted = { items: [{ itemId: 1, quantity: 2, unitPrice: 5_000, discountPercent: 10, taxRate: 10 }] };
    await service.createBatch({ rows: [row({ ...discounted, paymentMode: 'PARTIAL', paymentAmount: 9_900 })] }, ACTOR);
    expect(salesOrders.create).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ discountPercent: 10 })] }), ACTOR);
    expect(customerPayments.recordReceipt).toHaveBeenCalledTimes(1);

    const tooMuch = await service.createBatch({ rows: [row({ ...discounted, paymentMode: 'PARTIAL', paymentAmount: 9_901 })] }, ACTOR);
    expect(tooMuch.results[0].ok).toBe(false);
    const both = await service.createBatch({ rows: [row({ items: [{ itemId: 1, quantity: 1, unitPrice: 100, discountPercent: 5, discountAmount: 5 }] })] }, ACTOR);
    expect(both.results[0].ok).toBe(false);
  });

  it('NONE: leaves the invoice unpaid (no receipt, no allocation)', async () => {
    const { service, customerPayments, paymentAllocations } = buildChain();
    const { results } = await service.createBatch({ rows: [row({ paymentMode: 'NONE', paymentMethod: undefined })] }, ACTOR);

    expect(results[0]).toEqual(expect.objectContaining({ ok: true, payment: null }));
    expect(customerPayments.recordReceipt).not.toHaveBeenCalled();
    expect(paymentAllocations.allocate).not.toHaveBeenCalled();
  });

  it('PARTIAL: pays the given amount; an amount above the invoice total is refused before anything is created', async () => {
    const { service, salesOrders, customerPayments } = buildChain();
    const ok = await service.createBatch({ rows: [row({ paymentMode: 'PARTIAL', paymentAmount: 4_000 })] }, ACTOR);
    expect(customerPayments.recordReceipt).toHaveBeenCalledWith(expect.objectContaining({ amount: 4_000 }), ACTOR);
    expect(ok.results[0].ok).toBe(true);

    salesOrders.create.mockClear();
    const tooMuch = await service.createBatch({ rows: [row({ paymentMode: 'PARTIAL', paymentAmount: 11_001 })] }, ACTOR);
    expect(tooMuch.results[0]).toEqual({ index: 0, ok: false, errors: ['مبلغ دریافت نمی‌تواند از جمع فاکتور بیشتر باشد'] });
    expect(salesOrders.create).not.toHaveBeenCalled();
  });

  it('rows are independent: an invalid row and a row whose chain throws are reported while the others still run', async () => {
    const { service, salesOrders } = buildChain();
    salesOrders.create.mockResolvedValueOnce({ id: 11, updatedAt: UPDATED }).mockRejectedValueOnce(new BadRequestException('مشتری غیرفعال است'));

    const { results } = await service.createBatch({ rows: [row(), row({ customerId: 10 }), row({ saleDate: '2999-01-01' }), row({ customerId: 11 })] }, ACTOR);

    expect(results.map((result) => result.ok)).toEqual([true, false, false, true]);
    expect(results[1]).toEqual({ index: 1, ok: false, errors: ['مشتری غیرفعال است'] });
    expect(results[2]).toEqual({ index: 2, ok: false, errors: expect.arrayContaining(['تاریخ فروش تاریخی نمی‌تواند در آینده باشد']) });
  });
});

describe('historicalSaleRowSchema', () => {
  it('needs a payment method unless unpaid, an amount for PARTIAL, and a payment date within [sale date, today]', () => {
    expect(historicalSaleRowSchema.safeParse(row({ paymentMethod: undefined })).success).toBe(false);
    expect(historicalSaleRowSchema.safeParse(row({ paymentMode: 'NONE', paymentMethod: undefined })).success).toBe(true);
    expect(historicalSaleRowSchema.safeParse(row({ paymentMode: 'PARTIAL' })).success).toBe(false);
    expect(historicalSaleRowSchema.safeParse(row({ paymentDate: '2026-08-31' })).success).toBe(false);
    expect(historicalSaleRowSchema.safeParse(row({ paymentDate: '2026-09-02' })).success).toBe(true);
    expect(historicalSaleRowSchema.safeParse(row({ paymentMethod: 'CHECK' })).success).toBe(false);
  });
});
