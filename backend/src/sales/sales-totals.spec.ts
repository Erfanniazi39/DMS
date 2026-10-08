import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeLineAmounts, hasAnyDiscount, invoiceLineDiscount, sumDocumentTotals, sumOrderTotals } from './sales-totals';

const str = (value: Prisma.Decimal | null) => (value === null ? null : value.toString());

describe('sales-totals', () => {
  describe('computeLineAmounts', () => {
    it('gross = qty × price, no discount, no tax by default (B14: tax defaults to 0)', () => {
      const line = computeLineAmounts({ quantity: 3, unitPrice: 1000 });
      expect([str(line.gross), str(line.discountAmount), str(line.taxRate), str(line.taxAmount), str(line.lineTotal)]).toEqual(['3000', '0', '0', '0', '3000']);
      expect(line.discountPercent).toBeNull();
    });

    it('rounds fractional quantities half-up to a whole Rial', () => {
      expect(str(computeLineAmounts({ quantity: 1.5, unitPrice: 1001 }).gross)).toBe('1502'); // 1501.5 → 1502
      expect(str(computeLineAmounts({ quantity: 0.33, unitPrice: 100 }).gross)).toBe('33');
    });

    it('a percent discount is derived from gross; tax applies after the discount', () => {
      const line = computeLineAmounts({ quantity: 10, unitPrice: 1000, discountPercent: 12.5, taxRate: 9 });
      // gross 10000, discount 1250, taxable 8750, tax 787.5 → 788
      expect([str(line.discountPercent), str(line.discountAmount), str(line.taxAmount), str(line.lineTotal)]).toEqual(['12.5', '1250', '788', '9538']);
    });

    it('a fixed discount amount is used as-is', () => {
      const line = computeLineAmounts({ quantity: 2, unitPrice: 1000, discountAmount: 300 });
      expect([str(line.discountAmount), str(line.lineTotal)]).toEqual(['300', '1700']);
    });

    it('refuses a discount larger than the line', () => {
      expect(() => computeLineAmounts({ quantity: 1, unitPrice: 100, discountAmount: 101 }, 'ردیف ۲')).toThrow(BadRequestException);
      expect(() => computeLineAmounts({ quantity: 1, unitPrice: 100, discountAmount: 101 }, 'ردیف ۲')).toThrow('ردیف ۲');
    });

    it('refuses a line over the Decimal(15,0) column', () => {
      expect(() => computeLineAmounts({ quantity: 9_999_999_999, unitPrice: 999_999_999 })).toThrow('بیش از حد مجاز');
    });
  });

  describe('sumOrderTotals', () => {
    it('header totals are plain sums of the rounded line values', () => {
      const lines = [
        computeLineAmounts({ quantity: 10, unitPrice: 1000, discountPercent: 12.5, taxRate: 9 }),
        computeLineAmounts({ quantity: 1.5, unitPrice: 1001 }),
      ];
      const totals = sumOrderTotals(lines);
      expect([str(totals.subtotal), str(totals.discountTotal), str(totals.taxTotal), str(totals.totalAmount)]).toEqual(['11502', '1250', '788', '11040']);
    });

    it('refuses a zero total (same rule as Purchases)', () => {
      expect(() => sumOrderTotals([computeLineAmounts({ quantity: 1, unitPrice: 0 })])).toThrow('بیشتر از صفر');
    });
  });

  it('hasAnyDiscount', () => {
    expect(hasAnyDiscount([{ discountAmount: 0, discountPercent: null }])).toBe(false);
    expect(hasAnyDiscount([{ discountAmount: 0, discountPercent: 0 }])).toBe(false);
    expect(hasAnyDiscount([{ discountAmount: 0 }, { discountAmount: new Prisma.Decimal(1) }])).toBe(true);
  });

  describe('invoice lines (batch 4)', () => {
    it('invoiceLineDiscount: a percent is re-applied; a fixed amount is prorated by quantity and rounded half-up', () => {
      expect(invoiceLineDiscount({ quantity: 4, discountPercent: new Prisma.Decimal(10), discountAmount: 400 }, 1)).toEqual({ discountPercent: new Prisma.Decimal(10) });
      expect(str(invoiceLineDiscount({ quantity: 4, discountPercent: null, discountAmount: 400 }, 1).discountAmount as Prisma.Decimal)).toBe('100');
      expect(str(invoiceLineDiscount({ quantity: 3, discountPercent: null, discountAmount: 100 }, 1).discountAmount as Prisma.Decimal)).toBe('33');
      expect(str(invoiceLineDiscount({ quantity: 3, discountPercent: null, discountAmount: 101 }, 1.5).discountAmount as Prisma.Decimal)).toBe('51');
      expect(invoiceLineDiscount({ quantity: 3, discountPercent: null, discountAmount: 0 }, 1)).toEqual({ discountAmount: 0 });
    });

    it('sumDocumentTotals: a zero total is allowed only when the caller says so', () => {
      const free = computeLineAmounts({ quantity: 2, unitPrice: 0 });
      expect(str(sumDocumentTotals([free], { documentLabel: 'فاکتور', requirePositive: false }).totalAmount)).toBe('0');
      expect(() => sumDocumentTotals([free], { documentLabel: 'فاکتور', requirePositive: true })).toThrow('جمع مبلغ فاکتور باید بیشتر از صفر باشد');
    });
  });
});
