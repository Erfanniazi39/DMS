import { Prisma, type SalesDeliveryStatus, type SalesInvoicingStatus, type SalesOrderStatus, type SalesPaymentStatus } from '@prisma/client';
import { ensureSalesOrderTransition } from './sales-rules';

// The Sales module's ONE place for an order's progress: the per-line
// counters (deliveredQty / reservedQty, invoicedQty; returnedQty from
// Batch 6) and the order's derived status axes (deliveryStatus /
// invoicingStatus / paymentStatus, and CONFIRMED → COMPLETED), plus the
// invoice-level payment-status derivation used by
// SalesInvoicesService.applySettlement().
//
// Derived statuses are never set by hand and have no endpoint (build plan
// §5): every event that moves a counter calls recomputeOrderProgress() in
// the same transaction. Batches 4–6 reuse this file instead of each writing
// their own recompute logic.
//
// DI-free plain functions taking the caller's transaction client (same
// convention as inventory/stock-ledger.ts). The caller must already hold
// the order's row lock (SELECT … FROM sales_orders … FOR UPDATE) so the
// read-modify-write of the counters can't race another posting.

type Qty = Prisma.Decimal | number | string;

export type ProgressLine = {
  quantity: Qty;
  deliveredQty: Qty;
  invoicedQty: Qty;
};

const dec = (value: Qty) => new Prisma.Decimal(value);

// NOT_DELIVERED: nothing delivered on any line. DELIVERED: every line
// delivered in full. Anything in between: PARTIALLY_DELIVERED.
export function deriveDeliveryStatus(lines: Pick<ProgressLine, 'quantity' | 'deliveredQty'>[]): SalesDeliveryStatus {
  if (lines.length === 0 || lines.every((line) => dec(line.deliveredQty).lessThanOrEqualTo(0))) return 'NOT_DELIVERED';
  if (lines.every((line) => dec(line.deliveredQty).greaterThanOrEqualTo(dec(line.quantity)))) return 'DELIVERED';
  return 'PARTIALLY_DELIVERED';
}

// Same shape against the ordered quantity (invoicedQty is written when an
// invoice is posted — applyInvoicedQuantities()).
export function deriveInvoicingStatus(lines: Pick<ProgressLine, 'quantity' | 'invoicedQty'>[]): SalesInvoicingStatus {
  if (lines.length === 0 || lines.every((line) => dec(line.invoicedQty).lessThanOrEqualTo(0))) return 'NOT_INVOICED';
  if (lines.every((line) => dec(line.invoicedQty).greaterThanOrEqualTo(dec(line.quantity)))) return 'INVOICED';
  return 'PARTIALLY_INVOICED';
}

// Build plan §5 row 3: COMPLETED (system-only) needs every line delivered in
// full AND invoiced = delivered.
export function isOrderFulfilled(lines: ProgressLine[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((line) => dec(line.deliveredQty).equals(dec(line.quantity)) && dec(line.invoicedQty).equals(dec(line.deliveredQty)))
  );
}

// Counter update for a posted delivery: deliveredQty += quantity and
// reservedQty −= reservedConsumed, in ONE update per line (the DB CHECK
// reserved_qty <= quantity − delivered_qty is evaluated per statement).
// `current` is the line as read under the order lock.
export async function applyDeliveredQuantities(
  tx: Prisma.TransactionClient,
  lines: { salesOrderItemId: number; current: { deliveredQty: Qty; reservedQty: Qty }; quantity: Qty; reservedConsumed: Qty }[],
) {
  for (const line of lines) {
    await tx.salesOrderItem.update({
      where: { id: line.salesOrderItemId },
      data: {
        deliveredQty: dec(line.current.deliveredQty).plus(dec(line.quantity)),
        reservedQty: dec(line.current.reservedQty).minus(dec(line.reservedConsumed)),
      },
    });
  }
}

// Counter update for a posted invoice: DeliveryItem.invoicedQty and
// SalesOrderItem.invoicedQty += the invoiced quantity. `current` values are
// as read under the order lock (the caller re-checked that each line fits).
// Several invoice lines on one order line (a consolidated invoice — B7's
// schema allows it) are summed into one update.
export async function applyInvoicedQuantities(
  tx: Prisma.TransactionClient,
  lines: {
    deliveryItemId: number;
    deliveryItemInvoicedQty: Qty;
    salesOrderItemId: number;
    salesOrderItemInvoicedQty: Qty;
    quantity: Qty;
  }[],
) {
  const byOrderLine = new Map<number, { current: Prisma.Decimal; add: Prisma.Decimal }>();
  for (const line of lines) {
    await tx.deliveryItem.update({
      where: { id: line.deliveryItemId },
      data: { invoicedQty: dec(line.deliveryItemInvoicedQty).plus(dec(line.quantity)) },
    });
    const entry = byOrderLine.get(line.salesOrderItemId) ?? { current: dec(line.salesOrderItemInvoicedQty), add: new Prisma.Decimal(0) };
    entry.add = entry.add.plus(dec(line.quantity));
    byOrderLine.set(line.salesOrderItemId, entry);
  }
  for (const [salesOrderItemId, entry] of byOrderLine) {
    await tx.salesOrderItem.update({ where: { id: salesOrderItemId }, data: { invoicedQty: entry.current.plus(entry.add) } });
  }
}

// Counter update for a received return (Sales batch 6): DeliveryItem.returnedQty
// and SalesOrderItem.returnedQty += the received quantity. `current` values
// are as read under the return's/delivery's lock. Does NOT recompute
// deliveryStatus/invoicingStatus/paymentStatus — build plan §5 gives no rule
// for how a return changes those axes, so this intentionally leaves them
// alone (deliveredQty/invoicedQty, which they're derived from, are
// historical facts a return doesn't rewrite).
export async function applyReturnedQuantities(
  tx: Prisma.TransactionClient,
  lines: {
    deliveryItemId: number;
    deliveryItemReturnedQty: Qty;
    salesOrderItemId: number;
    salesOrderItemReturnedQty: Qty;
    quantity: Qty;
  }[],
) {
  const byOrderLine = new Map<number, { current: Prisma.Decimal; add: Prisma.Decimal }>();
  for (const line of lines) {
    await tx.deliveryItem.update({
      where: { id: line.deliveryItemId },
      data: { returnedQty: dec(line.deliveryItemReturnedQty).plus(dec(line.quantity)) },
    });
    const entry = byOrderLine.get(line.salesOrderItemId) ?? { current: dec(line.salesOrderItemReturnedQty), add: new Prisma.Decimal(0) };
    entry.add = entry.add.plus(dec(line.quantity));
    byOrderLine.set(line.salesOrderItemId, entry);
  }
  for (const [salesOrderItemId, entry] of byOrderLine) {
    await tx.salesOrderItem.update({ where: { id: salesOrderItemId }, data: { returnedQty: entry.current.plus(entry.add) } });
  }
}

// --- Payment status -----------------------------------------------------------

// An invoice's open amount: total − paid − credited (build plan §4.3).
export function invoiceOpenAmount(invoice: { totalAmount: Qty; paidAmount: Qty; creditedAmount: Qty }): Prisma.Decimal {
  return dec(invoice.totalAmount).minus(dec(invoice.paidAmount)).minus(dec(invoice.creditedAmount));
}

// UNPAID: nothing settled; PAID: nothing open (a zero-total invoice is PAID
// from the start); otherwise PARTIALLY_PAID. "Overdue" is not a status — it
// is computed at query time from dueDate (build plan §4.2).
export function deriveInvoicePaymentStatus(invoice: { totalAmount: Qty; paidAmount: Qty; creditedAmount: Qty }): SalesPaymentStatus {
  if (!invoiceOpenAmount(invoice).greaterThan(0)) return 'PAID';
  if (dec(invoice.paidAmount).plus(dec(invoice.creditedAmount)).greaterThan(0)) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

// The order's payment axis, from its POSTED invoices:
//   PAID            every posted invoice is settled AND nothing delivered is
//                   left to invoice AND nothing is left to deliver (or the
//                   order was short-CLOSED) — i.e. the customer owes nothing
//                   more on this order;
//   PARTIALLY_PAID  anything settled on any invoice otherwise;
//   UNPAID          nothing settled.
export function deriveOrderPaymentStatus(
  status: SalesOrderStatus,
  lines: ProgressLine[],
  invoices: { totalAmount: Qty; paidAmount: Qty; creditedAmount: Qty }[],
): SalesPaymentStatus {
  const settled = invoices.reduce((sum, invoice) => sum.plus(dec(invoice.paidAmount)).plus(dec(invoice.creditedAmount)), new Prisma.Decimal(0));
  const allSettled = invoices.length > 0 && invoices.every((invoice) => deriveInvoicePaymentStatus(invoice) === 'PAID');
  const nothingLeftToBill =
    lines.length > 0 &&
    lines.every(
      (line) =>
        dec(line.invoicedQty).greaterThanOrEqualTo(dec(line.deliveredQty)) &&
        (status === 'CLOSED' || dec(line.deliveredQty).greaterThanOrEqualTo(dec(line.quantity))),
    );
  if (allSettled && nothingLeftToBill) return 'PAID';
  return settled.greaterThan(0) ? 'PARTIALLY_PAID' : 'UNPAID';
}

export type OrderProgress = {
  deliveryStatus: SalesDeliveryStatus;
  invoicingStatus: SalesInvoicingStatus;
  paymentStatus: SalesPaymentStatus;
  status: SalesOrderStatus;
  // true when THIS call moved the order CONFIRMED → COMPLETED (the caller
  // audits it).
  completed: boolean;
};

// Re-reads the order's lines (after the caller's counter writes) and writes
// whichever derived fields changed. COMPLETED is reached only from
// CONFIRMED — never from CLOSED / CANCELLED.
export async function recomputeOrderProgress(tx: Prisma.TransactionClient, salesOrderId: number): Promise<OrderProgress> {
  const order = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      status: true,
      deliveryStatus: true,
      invoicingStatus: true,
      paymentStatus: true,
      items: { select: { quantity: true, deliveredQty: true, invoicedQty: true } },
      invoices: { where: { status: 'POSTED' }, select: { totalAmount: true, paidAmount: true, creditedAmount: true } },
    },
  });
  if (!order) throw new Error(`Sales order ${salesOrderId} not found during progress recompute`);

  const deliveryStatus = deriveDeliveryStatus(order.items);
  const invoicingStatus = deriveInvoicingStatus(order.items);
  const completed = order.status === 'CONFIRMED' && isOrderFulfilled(order.items);
  if (completed) ensureSalesOrderTransition(order.status, 'COMPLETED');
  const status: SalesOrderStatus = completed ? 'COMPLETED' : order.status;
  const paymentStatus = deriveOrderPaymentStatus(status, order.items, order.invoices);

  const data: Prisma.SalesOrderUpdateInput = {};
  if (deliveryStatus !== order.deliveryStatus) data.deliveryStatus = deliveryStatus;
  if (invoicingStatus !== order.invoicingStatus) data.invoicingStatus = invoicingStatus;
  if (paymentStatus !== order.paymentStatus) data.paymentStatus = paymentStatus;
  if (completed) data.status = 'COMPLETED';
  if (Object.keys(data).length > 0) await tx.salesOrder.update({ where: { id: salesOrderId }, data });

  return { deliveryStatus, invoicingStatus, paymentStatus, status, completed };
}
