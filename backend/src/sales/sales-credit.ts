import { Prisma } from '@prisma/client';
import { getCustomerCreditPolicy } from '../customers/customer-rules';
import { listOpenInvoices } from './sales-invoices.service';
import { CREDIT_EXPOSURE_ORDER_WHERE } from './sales-rules';

// The Sales module's credit rule (business decision B4). DI-free, takes the
// caller's transaction client.
//
// Exposure = open invoices + the not-yet-invoiced remainder of confirmed
// orders (Batch 4 filled in the invoice side without changing the
// signature):
//   openInvoices      Σ open amount (total − paid − credited) of the
//                     customer's POSTED invoices — operational AND opening
//                     balance (both are money owed). Via listOpenInvoices(),
//                     the same query Receivables will allocate against.
//   uninvoicedOrders  for each CONFIRMED, not fully INVOICED order:
//                     max(0, order total − Σ its POSTED invoices' totals).
//                     Once an invoice posts, its amount moves from this side
//                     to openInvoices — never counted twice.
//
// B4: creditLimit = null means NO credit is allowed (cash-only) — i.e. an
// effective limit of 0. creditHold is not handled here: it blocks every new
// order outright, via customers/customer-rules.ts ensureTransactableCustomer()
// (no override), before this check ever runs.

export type CreditExposure = {
  openInvoices: Prisma.Decimal;
  uninvoicedOrders: Prisma.Decimal;
  total: Prisma.Decimal;
};

export async function computeExposure(
  tx: Prisma.TransactionClient,
  customerId: number,
  options: { excludeSalesOrderId?: number } = {},
): Promise<CreditExposure> {
  const zero = new Prisma.Decimal(0);
  const orders = await tx.salesOrder.findMany({
    where: {
      ...CREDIT_EXPOSURE_ORDER_WHERE,
      customerId,
      ...(options.excludeSalesOrderId ? { id: { not: options.excludeSalesOrderId } } : {}),
    },
    select: { totalAmount: true, invoices: { where: { status: 'POSTED' }, select: { totalAmount: true } } },
  });
  const uninvoicedOrders = orders.reduce((sum, order) => {
    const invoiced = order.invoices.reduce((acc, invoice) => acc.plus(invoice.totalAmount), zero);
    const remainder = new Prisma.Decimal(order.totalAmount).minus(invoiced);
    return remainder.greaterThan(0) ? sum.plus(remainder) : sum;
  }, zero);
  const open = await listOpenInvoices(tx, customerId);
  const openInvoices = open.reduce((sum, invoice) => sum.plus(invoice.openAmount), zero);
  return { openInvoices, uninvoicedOrders, total: openInvoices.plus(uninvoicedOrders) };
}

export type CreditCheck = {
  // As stored on the customer's financial profile (null = none set).
  creditLimit: Prisma.Decimal | null;
  // What the check actually used (null → 0, per B4).
  effectiveLimit: Prisma.Decimal;
  exposure: CreditExposure;
  orderAmount: Prisma.Decimal;
  // exposure + this order.
  projected: Prisma.Decimal;
  exceeded: boolean;
  // How far over the limit the order would take the customer (0 if within).
  excess: Prisma.Decimal;
};

// Would confirming an order of `orderAmount` take the customer over their
// credit limit? Row-locks the customer's financial profile first (via
// getCustomerCreditPolicy forUpdate), so two orders for the same customer
// confirmed at the same moment are checked one after the other — the second
// sees the first as CONFIRMED exposure — and a limit change can't interleave.
export async function evaluateCredit(
  tx: Prisma.TransactionClient,
  customerId: number,
  orderAmount: Prisma.Decimal | number | string,
  options: { excludeSalesOrderId?: number } = {},
): Promise<CreditCheck> {
  const policy = await getCustomerCreditPolicy(tx, customerId, { forUpdate: true });
  const exposure = await computeExposure(tx, customerId, options);
  const amount = new Prisma.Decimal(orderAmount);
  const effectiveLimit = policy.creditLimit ?? new Prisma.Decimal(0);
  const projected = exposure.total.plus(amount);
  const exceeded = projected.greaterThan(effectiveLimit);
  return {
    creditLimit: policy.creditLimit,
    effectiveLimit,
    exposure,
    orderAmount: amount,
    projected,
    exceeded,
    excess: exceeded ? projected.minus(effectiveLimit) : new Prisma.Decimal(0),
  };
}
