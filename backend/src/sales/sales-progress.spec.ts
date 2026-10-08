import { Prisma } from '@prisma/client';
import {
  applyInvoicedQuantities,
  deriveDeliveryStatus,
  deriveInvoicePaymentStatus,
  deriveInvoicingStatus,
  deriveOrderPaymentStatus,
  isOrderFulfilled,
  recomputeOrderProgress,
} from './sales-progress';

// sales-progress.ts — derived order statuses (never set by hand) and the
// system-only CONFIRMED → COMPLETED rule (build plan §5 row 3).

const line = (quantity: number, deliveredQty = 0, invoicedQty = 0) => ({
  quantity: new Prisma.Decimal(quantity),
  deliveredQty: new Prisma.Decimal(deliveredQty),
  invoicedQty: new Prisma.Decimal(invoicedQty),
});

describe('sales-progress', () => {
  it('deriveDeliveryStatus: NOT_DELIVERED / PARTIALLY_DELIVERED / DELIVERED', () => {
    expect(deriveDeliveryStatus([line(5), line(3)])).toBe('NOT_DELIVERED');
    expect(deriveDeliveryStatus([line(5, 2), line(3)])).toBe('PARTIALLY_DELIVERED');
    expect(deriveDeliveryStatus([line(5, 5), line(3, 2.5)])).toBe('PARTIALLY_DELIVERED');
    expect(deriveDeliveryStatus([line(5, 5), line(3, 3)])).toBe('DELIVERED');
    expect(deriveDeliveryStatus([])).toBe('NOT_DELIVERED');
  });

  it('deriveInvoicingStatus: same shape on invoicedQty', () => {
    expect(deriveInvoicingStatus([line(5, 5), line(3, 3)])).toBe('NOT_INVOICED');
    expect(deriveInvoicingStatus([line(5, 5, 5), line(3, 3)])).toBe('PARTIALLY_INVOICED');
    expect(deriveInvoicingStatus([line(5, 5, 5), line(3, 3, 3)])).toBe('INVOICED');
  });

  it('isOrderFulfilled: every line delivered = qty AND invoiced = delivered', () => {
    expect(isOrderFulfilled([line(5, 5, 5), line(3, 3, 3)])).toBe(true);
    expect(isOrderFulfilled([line(5, 5, 0), line(3, 3, 3)])).toBe(false); // delivered, not invoiced
    expect(isOrderFulfilled([line(5, 4, 4)])).toBe(false); // not fully delivered
    expect(isOrderFulfilled([])).toBe(false);
  });

  describe('recomputeOrderProgress', () => {
    function txWith(order: Record<string, unknown>) {
      return { salesOrder: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn() } };
    }

    it('writes only the fields that changed, and nothing when nothing changed', async () => {
      const tx = txWith({ status: 'CONFIRMED', deliveryStatus: 'NOT_DELIVERED', invoicingStatus: 'NOT_INVOICED', paymentStatus: 'UNPAID', invoices: [], items: [line(5, 2)] });
      const result = await recomputeOrderProgress(tx as never, 11);
      expect(result).toEqual({ deliveryStatus: 'PARTIALLY_DELIVERED', invoicingStatus: 'NOT_INVOICED', paymentStatus: 'UNPAID', status: 'CONFIRMED', completed: false });
      expect(tx.salesOrder.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { deliveryStatus: 'PARTIALLY_DELIVERED' } });

      const unchanged = txWith({ status: 'CONFIRMED', deliveryStatus: 'PARTIALLY_DELIVERED', invoicingStatus: 'NOT_INVOICED', paymentStatus: 'UNPAID', invoices: [], items: [line(5, 2)] });
      await recomputeOrderProgress(unchanged as never, 11);
      expect(unchanged.salesOrder.update).not.toHaveBeenCalled();
    });

    it('CONFIRMED → COMPLETED when fulfilled', async () => {
      const tx = txWith({ status: 'CONFIRMED', deliveryStatus: 'PARTIALLY_DELIVERED', invoicingStatus: 'PARTIALLY_INVOICED', paymentStatus: 'UNPAID', invoices: [], items: [line(5, 5, 5)] });
      const result = await recomputeOrderProgress(tx as never, 11);
      expect(result.completed).toBe(true);
      expect(tx.salesOrder.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { deliveryStatus: 'DELIVERED', invoicingStatus: 'INVOICED', status: 'COMPLETED' },
      });
    });

    it.each(['CLOSED', 'CANCELLED', 'COMPLETED'])('never moves a %s order to COMPLETED', async (status) => {
      const tx = txWith({ status, deliveryStatus: 'DELIVERED', invoicingStatus: 'INVOICED', paymentStatus: 'UNPAID', invoices: [], items: [line(5, 5, 5)] });
      const result = await recomputeOrderProgress(tx as never, 11);
      expect(result).toEqual(expect.objectContaining({ status, completed: false }));
      expect(tx.salesOrder.update).not.toHaveBeenCalled();
    });
  });

  it('deriveInvoicePaymentStatus: UNPAID / PARTIALLY_PAID / PAID from total vs paid + credited; a zero-total invoice is PAID', () => {
    const inv = (total: number, paid: number, credited = 0) => ({ totalAmount: total, paidAmount: paid, creditedAmount: credited });
    expect(deriveInvoicePaymentStatus(inv(1000, 0))).toBe('UNPAID');
    expect(deriveInvoicePaymentStatus(inv(1000, 1))).toBe('PARTIALLY_PAID');
    expect(deriveInvoicePaymentStatus(inv(1000, 0, 999))).toBe('PARTIALLY_PAID');
    expect(deriveInvoicePaymentStatus(inv(1000, 600, 400))).toBe('PAID');
    expect(deriveInvoicePaymentStatus(inv(0, 0))).toBe('PAID');
  });

  it('deriveOrderPaymentStatus: PAID only when all invoices are settled and nothing is left to deliver (unless CLOSED) or to invoice', () => {
    const paid = { totalAmount: 1000, paidAmount: 1000, creditedAmount: 0 };
    const half = { totalAmount: 1000, paidAmount: 500, creditedAmount: 0 };
    const none = { totalAmount: 1000, paidAmount: 0, creditedAmount: 0 };
    expect(deriveOrderPaymentStatus('CONFIRMED', [line(5)], [])).toBe('UNPAID');
    expect(deriveOrderPaymentStatus('CONFIRMED', [line(5, 5, 5)], [none])).toBe('UNPAID');
    expect(deriveOrderPaymentStatus('CONFIRMED', [line(5, 5, 5)], [half])).toBe('PARTIALLY_PAID');
    expect(deriveOrderPaymentStatus('COMPLETED', [line(5, 5, 5)], [paid])).toBe('PAID');
    // Paid what was invoiced so far, but more is still to be delivered / invoiced.
    expect(deriveOrderPaymentStatus('CONFIRMED', [line(5, 2, 2)], [paid])).toBe('PARTIALLY_PAID');
    expect(deriveOrderPaymentStatus('CONFIRMED', [line(5, 5, 2)], [paid])).toBe('PARTIALLY_PAID');
    // Short-closed after delivering 2: nothing more will come.
    expect(deriveOrderPaymentStatus('CLOSED', [line(5, 2, 2)], [paid])).toBe('PAID');
  });

  it('applyInvoicedQuantities: adds to each delivery line and, summed, to each order line', async () => {
    const tx = { deliveryItem: { update: jest.fn() }, salesOrderItem: { update: jest.fn() } };
    await applyInvoicedQuantities(tx as never, [
      { deliveryItemId: 301, deliveryItemInvoicedQty: 1, salesOrderItemId: 101, salesOrderItemInvoicedQty: 3, quantity: 2 },
      { deliveryItemId: 302, deliveryItemInvoicedQty: 0, salesOrderItemId: 101, salesOrderItemInvoicedQty: 3, quantity: 1.5 },
    ]);
    expect(tx.deliveryItem.update.mock.calls.map((call: any) => [call[0].where.id, call[0].data.invoicedQty.toString()])).toEqual([
      [301, '3'],
      [302, '1.5'],
    ]);
    expect(tx.salesOrderItem.update).toHaveBeenCalledTimes(1);
    expect(tx.salesOrderItem.update.mock.calls[0][0].data.invoicedQty.toString()).toBe('6.5');
  });
});
