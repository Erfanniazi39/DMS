import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_MONEY } from '../common/zod-fields';

// The Sales module's ONLY definitions of how a sales order's money fields are
// computed (mirrors purchases/purchase-totals.ts). SalesOrder.subtotal /
// discountTotal / taxTotal / totalAmount and each line's discountAmount /
// taxAmount / lineTotal are never taken from client input — the client sends
// quantity, unitPrice, the discount (percent OR amount) and taxRate; the rest
// is derived here. Plain functions (no DI).
//
// Money is whole Rial (Decimal(15,0)); every derived amount is rounded half-up
// to a whole Rial at the line level, and header totals are plain sums of the
// rounded line values — so the header always equals the sum of what's printed
// on the lines.
//
// Per line:
//   gross     = round(quantity × unitPrice)
//   discount  = round(gross × discountPercent / 100)  if a percent is given,
//               otherwise discountAmount (default 0); must be ≤ gross
//   taxAmount = round((gross − discount) × taxRate / 100)
//   lineTotal = gross − discount + taxAmount

export type SalesLineInput = {
  quantity: Prisma.Decimal | number | string;
  unitPrice: Prisma.Decimal | number | string;
  discountPercent?: Prisma.Decimal | number | string | null;
  discountAmount?: Prisma.Decimal | number | string | null;
  taxRate?: Prisma.Decimal | number | string | null;
};

export type SalesLineAmounts = {
  gross: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

export type SalesOrderTotals = {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

function toRial(value: Prisma.Decimal) {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

function decimalOrNull(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

// `lineLabel` (e.g. "ردیف ۲") prefixes the Persian errors so the user knows
// which line to fix.
export function computeLineAmounts(input: SalesLineInput, lineLabel = 'ردیف'): SalesLineAmounts {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const gross = toRial(quantity.times(unitPrice));

  const discountPercent = decimalOrNull(input.discountPercent);
  const discountAmount = discountPercent !== null ? toRial(gross.times(discountPercent).dividedBy(100)) : (decimalOrNull(input.discountAmount) ?? new Prisma.Decimal(0));
  if (discountAmount.isNegative()) throw new BadRequestException(`${lineLabel}: مبلغ تخفیف نمی‌تواند منفی باشد`);
  if (discountAmount.greaterThan(gross)) throw new BadRequestException(`${lineLabel}: مبلغ تخفیف نمی‌تواند از مبلغ ردیف بیشتر باشد`);

  const taxRate = decimalOrNull(input.taxRate) ?? new Prisma.Decimal(0);
  const taxable = gross.minus(discountAmount);
  const taxAmount = toRial(taxable.times(taxRate).dividedBy(100));
  const lineTotal = taxable.plus(taxAmount);
  if (gross.greaterThan(MAX_MONEY) || lineTotal.greaterThan(MAX_MONEY)) {
    throw new BadRequestException(`${lineLabel}: مبلغ ردیف بیش از حد مجاز است`);
  }
  return { gross, discountPercent, discountAmount, taxRate, taxAmount, lineTotal };
}

// Same guard as purchase-totals.ts sumItemTotals(): the sum can exceed the
// column even when every line fits, and an order must be worth something.
export function sumOrderTotals(lines: SalesLineAmounts[]): SalesOrderTotals {
  return sumDocumentTotals(lines, { documentLabel: 'سفارش فروش', requirePositive: true });
}

// Header totals for any sales document (order, invoice). An invoice built
// from a delivery may legitimately total 0 (e.g. free goods on a zero-price
// order line) — it must still be posted so invoiced = delivered — so
// `requirePositive` is the caller's choice.
export function sumDocumentTotals(lines: SalesLineAmounts[], options: { documentLabel: string; requirePositive: boolean }): SalesOrderTotals {
  const zero = new Prisma.Decimal(0);
  const totals = lines.reduce(
    (sum, line) => ({
      subtotal: sum.subtotal.plus(line.gross),
      discountTotal: sum.discountTotal.plus(line.discountAmount),
      taxTotal: sum.taxTotal.plus(line.taxAmount),
      totalAmount: sum.totalAmount.plus(line.lineTotal),
    }),
    { subtotal: zero, discountTotal: zero, taxTotal: zero, totalAmount: zero },
  );
  if (totals.subtotal.greaterThan(MAX_MONEY) || totals.totalAmount.greaterThan(MAX_MONEY)) {
    throw new BadRequestException(`جمع مبلغ ${options.documentLabel} بیش از حد مجاز است`);
  }
  if (options.requirePositive && !totals.totalAmount.greaterThan(0)) {
    throw new BadRequestException(`جمع مبلغ ${options.documentLabel} باید بیشتر از صفر باشد`);
  }
  return totals;
}

// An order line's discount, carried onto an invoice for part of its
// quantity. A percent discount is simply re-applied to the invoiced gross
// (computeLineAmounts); a fixed-amount discount is prorated by quantity and
// rounded half-up to a whole Rial — so partial invoices of one line may
// differ from the order's discount by a Rial of rounding in total.
export function invoiceLineDiscount(orderLine: {
  quantity: Prisma.Decimal | number | string;
  discountPercent: Prisma.Decimal | number | string | null;
  discountAmount: Prisma.Decimal | number | string;
}, invoicedQuantity: Prisma.Decimal | number | string): Pick<SalesLineInput, 'discountPercent' | 'discountAmount'> {
  if (orderLine.discountPercent !== null && new Prisma.Decimal(orderLine.discountPercent).greaterThan(0)) {
    return { discountPercent: orderLine.discountPercent };
  }
  const amount = new Prisma.Decimal(orderLine.discountAmount);
  if (!amount.greaterThan(0)) return { discountAmount: 0 };
  return {
    discountAmount: toRial(amount.times(new Prisma.Decimal(invoicedQuantity)).dividedBy(new Prisma.Decimal(orderLine.quantity))),
  };
}

// True when any line carries a discount — such an order needs a sales.approve
// holder to confirm it (build plan §5 row 1).
export function hasAnyDiscount(lines: { discountAmount: Prisma.Decimal | number | string; discountPercent?: Prisma.Decimal | number | string | null }[]) {
  return lines.some((line) => new Prisma.Decimal(line.discountAmount).greaterThan(0) || (line.discountPercent != null && new Prisma.Decimal(line.discountPercent).greaterThan(0)));
}
