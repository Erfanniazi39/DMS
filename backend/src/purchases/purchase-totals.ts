import { BadRequestException } from '@nestjs/common';
import type { Prisma, PurchasePaymentStatus } from '@prisma/client';
import { MAX_MONEY } from '../common/zod-fields';

// The Purchases module's ONLY definitions of how the derived money fields on
// a Purchase are computed — CLAUDE.md hard rule 6: `totalAmount`,
// `paidAmount` and `paymentStatus` are never written from client input or
// re-derived anywhere else. Shared by:
//   - PurchasesService.create()/update()   → sumItemTotals() for totalAmount,
//     and (update) derivePaymentStatus() against the existing paidAmount;
//   - PurchasePaymentsService              → recomputePaymentTotals() after
//     every payment add/edit/remove, which writes paidAmount + paymentStatus.
// Returns (PurchaseReturnsService) deliberately never touch any of the three.
// Plain functions (no DI), so any Purchases service can use them without a
// provider dependency between those services.

// Every line is already a whole-Rial amount within Decimal(15,0) (see
// purchase.dto.ts); the sum can still exceed the column, which used to
// surface as a raw 500 from Postgres. A purchase must also be worth
// something: a 0 total is refused (business decision 2026-10-05 — free/gift
// items are out of scope).
export function sumItemTotals(items: { totalPrice: number }[]): number {
  const total = items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (total > MAX_MONEY) throw new BadRequestException('جمع مبلغ اقلام خرید بیش از حد مجاز است');
  if (total <= 0) throw new BadRequestException('جمع مبلغ اقلام خرید باید بیشتر از صفر باشد');
  return total;
}

// UNPAID / PARTIAL / PAID is always derived from totalAmount vs. paidAmount
// — never set directly by the client. See PurchasesService.update() and
// recomputePaymentTotals() below for where this gets (re)applied.
export function derivePaymentStatus(totalAmount: number, paidAmount: number): PurchasePaymentStatus {
  if (paidAmount <= 0) return 'UNPAID';
  if (paidAmount >= totalAmount) return 'PAID';
  return 'PARTIAL';
}

// Re-derives and persists paidAmount/paymentStatus from the purchase's
// COMPLETED payments. Must run inside the caller's transaction, after the
// parent Purchase row has been locked (see
// PurchasePaymentsService.lockPurchaseForPayment()), so concurrent payment
// writes on the same purchase can't each recompute from a stale sum.
export async function recomputePaymentTotals(tx: Prisma.TransactionClient, purchaseId: number, totalAmount: number) {
  const payments = await tx.purchasePayment.findMany({ where: { purchaseId } });
  const paidAmount = payments
    .filter((payment) => payment.status === 'COMPLETED')
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (paidAmount > MAX_MONEY) throw new BadRequestException('مجموع پرداخت‌های این خرید بیش از حد مجاز است');
  const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);
  await tx.purchase.update({ where: { id: purchaseId }, data: { paidAmount, paymentStatus } });
}
