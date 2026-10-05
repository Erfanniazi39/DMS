import { BadRequestException } from '@nestjs/common';
import { MAX_MONEY } from '../common/zod-fields';
import { derivePaymentStatus, recomputePaymentTotals, sumItemTotals } from './purchase-totals';

// The shared derived-money-field logic (CLAUDE.md rule 6) used by both
// PurchasesService and PurchasePaymentsService. Their own specs cover it
// end-to-end; these pin the functions themselves.

describe('purchase-totals', () => {
  it.each([
    [10000, 0, 'UNPAID'],
    [10000, 1, 'PARTIAL'],
    [10000, 9999, 'PARTIAL'],
    [10000, 10000, 'PAID'],
    [10000, 12000, 'PAID'],
  ])('derivePaymentStatus(total %d, paid %d) → %s', (total, paid, expected) => {
    expect(derivePaymentStatus(total, paid)).toBe(expected);
  });

  it('sumItemTotals() sums line totalPrice values and refuses a zero or over-limit total with a 400', () => {
    expect(sumItemTotals([{ totalPrice: 7500 }, { totalPrice: 2500 }])).toBe(10000);
    expect(() => sumItemTotals([{ totalPrice: 0 }])).toThrow(BadRequestException);
    expect(() => sumItemTotals([{ totalPrice: MAX_MONEY }, { totalPrice: 1 }])).toThrow(BadRequestException);
  });

  it('recomputePaymentTotals() counts only COMPLETED payments and writes exactly paidAmount + paymentStatus', async () => {
    const tx = {
      purchasePayment: {
        findMany: jest.fn().mockResolvedValue([
          { status: 'COMPLETED', amount: 4000 },
          { status: 'PENDING', amount: 5000 },
          { status: 'CANCELLED', amount: 6000 },
        ]),
      },
      purchase: { update: jest.fn() },
    };

    await recomputePaymentTotals(tx as never, 8, 10000);

    expect(tx.purchasePayment.findMany).toHaveBeenCalledWith({ where: { purchaseId: 8 } });
    expect(tx.purchase.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { paidAmount: 4000, paymentStatus: 'PARTIAL' } });
  });
});
