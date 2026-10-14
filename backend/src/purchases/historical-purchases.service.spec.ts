import { ConflictException } from '@nestjs/common';
import { HistoricalPurchasesService } from './historical-purchases.service';

// Orchestration only: PurchasesService / PurchasePaymentsService have their own specs.
const created = { id: 41, purchaseNumber: 'PUR-000041' };

function build() {
  const purchases = { create: jest.fn().mockResolvedValue(created) };
  const payments = { addPayment: jest.fn().mockResolvedValue(undefined) };
  return { service: new HistoricalPurchasesService(purchases as never, payments as never), purchases, payments };
}

const row = (extra: Record<string, unknown> = {}) => ({
  purchaseDate: '2026-08-01',
  supplierId: 3,
  purchaseTypeId: 2,
  items: [
    { name: 'شیر خام', quantity: 10, unitId: 1, unitPrice: 1_000, totalPrice: 10_000 },
    { name: 'بسته‌بندی', quantity: 1, unitId: 1, totalPrice: 2_000 },
  ],
  paymentMode: 'FULL',
  paymentMethod: 'BANK_TRANSFER',
  ...extra,
});

describe('HistoricalPurchasesService.createBatch', () => {
  it('creates a CONFIRMED HISTORICAL_IMPORT purchase and pays the whole total on the purchase date', async () => {
    const { service, purchases, payments } = build();
    const { results } = await service.createBatch({ rows: [row()] }, 4, '127.0.0.1');

    expect(results[0]).toEqual({ index: 0, ok: true, purchase: { id: 41, purchaseNumber: 'PUR-000041' }, paymentRecorded: true });
    expect(purchases.create).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'HISTORICAL_IMPORT', status: 'CONFIRMED', supplierId: 3, purchaseDate: new Date('2026-08-01T00:00:00.000Z') }), 4, '127.0.0.1');
    expect(payments.addPayment).toHaveBeenCalledWith(41, expect.objectContaining({ amount: 12_000, status: 'COMPLETED', method: 'BANK_TRANSFER', paymentDate: new Date('2026-08-01T00:00:00.000Z') }), 4, '127.0.0.1');
  });

  it('NONE skips the payment; PARTIAL pays the given amount and refuses one above the total before creating anything', async () => {
    const { service, purchases, payments } = build();
    const none = await service.createBatch({ rows: [row({ paymentMode: 'NONE', paymentMethod: undefined })] }, 4);
    expect(none.results[0]).toEqual(expect.objectContaining({ ok: true, paymentRecorded: false }));
    expect(payments.addPayment).not.toHaveBeenCalled();

    await service.createBatch({ rows: [row({ paymentMode: 'PARTIAL', paymentAmount: 5_000, paymentDate: '2026-08-05' })] }, 4);
    expect(payments.addPayment).toHaveBeenCalledWith(41, expect.objectContaining({ amount: 5_000, paymentDate: new Date('2026-08-05T00:00:00.000Z') }), 4, undefined);

    purchases.create.mockClear();
    const tooMuch = await service.createBatch({ rows: [row({ paymentMode: 'PARTIAL', paymentAmount: 12_001 })] }, 4);
    expect(tooMuch.results[0]).toEqual({ index: 0, ok: false, errors: ['مبلغ پرداخت نمی‌تواند از جمع خرید بیشتر باشد'] });
    expect(purchases.create).not.toHaveBeenCalled();
  });

  it('rows are independent; a payment failure keeps the saved purchase and reports the payment error', async () => {
    const { service, purchases, payments } = build();
    payments.addPayment.mockRejectedValueOnce(new ConflictException('تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد'));
    purchases.create.mockResolvedValueOnce(created).mockResolvedValueOnce(created).mockResolvedValueOnce(created);

    const { results } = await service.createBatch({ rows: [row(), row({ purchaseDate: '2999-01-01' }), row({ supplierId: 9 })] }, 4);

    expect(results[0]).toEqual(expect.objectContaining({ ok: true, paymentRecorded: false, paymentErrors: ['تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد'] }));
    expect(results[1]).toEqual({ index: 1, ok: false, errors: expect.arrayContaining(['تاریخ خرید تاریخی نمی‌تواند در آینده باشد']) });
    expect(results[2]).toEqual(expect.objectContaining({ ok: true, paymentRecorded: true }));
  });

  it('validates rows: a method is needed unless unpaid, and the payment date must lie within [purchase date, today]', async () => {
    const { service } = build();
    const { results } = await service.createBatch({ rows: [row({ paymentMethod: undefined }), row({ paymentDate: '2026-07-31' }), row({ items: [] })] }, 4);
    expect(results.map((result) => result.ok)).toEqual([false, false, false]);
  });
});
