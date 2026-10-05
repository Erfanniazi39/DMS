import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildPaymentsService, createPrismaMock, fullGet, PAY_DATE, PAYABLE, type PrismaMock } from './purchases.spec-helpers';

// PurchasePaymentsService — payment add/edit/remove, and the paidAmount /
// paymentStatus recompute they trigger (always via purchase-totals.ts's
// recomputePaymentTotals(), CLAUDE.md rule 6). Moved verbatim from
// purchases.service.spec.ts when the service was split.

describe('PurchasePaymentsService', () => {
  // --- 8, 9 & 10. Payments and payment-status derivation ------------------

  it('marks a historical Purchase as already paid when its first payment is recorded as COMPLETED', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    const purchase = { id: 8, totalAmount: 10000, paymentStatus: 'UNPAID', ...PAYABLE };
    prisma.purchase.findUnique.mockResolvedValue({ ...purchase, purchaseRequest: null, purchaseType: {}, requesterDepartment: null, buyerEmployee: null, supplier: {}, items: [], payments: [], documents: [] });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, purchaseId: 8, amount: 10000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 10000 }]);

    await service.addPayment(8, { amount: 10000, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, '127.0.0.1');

    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 }, data: { paidAmount: 10000, paymentStatus: 'PAID' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_COMPLETED' }) }),
    );
  });

  it('accumulates multiple payments toward one Purchase and derives PARTIAL, then PAID', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    const baseGet = { purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...baseGet, ...PAYABLE });

    prisma.purchasePayment.create.mockResolvedValueOnce({ id: 1, purchaseId: 8, amount: 4000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValueOnce([{ status: 'COMPLETED', amount: 4000 }]);
    await service.addPayment(8, { amount: 4000, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined);
    expect(prisma.purchase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { paidAmount: 4000, paymentStatus: 'PARTIAL' } }),
    );

    prisma.purchasePayment.create.mockResolvedValueOnce({ id: 2, purchaseId: 8, amount: 6000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValueOnce([
      { status: 'COMPLETED', amount: 4000 },
      { status: 'COMPLETED', amount: 6000 },
    ]);
    await service.addPayment(8, { amount: 6000, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined);
    expect(prisma.purchase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { paidAmount: 10000, paymentStatus: 'PAID' } }),
    );
  });

  it('recomputes payment status back to UNPAID when a payment is removed, without erasing the removed row from history first', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    const baseGet = { purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...baseGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue({ id: 1, amount: 10000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([]);

    await service.removePayment(8, 1, 9, '127.0.0.1');

    expect(prisma.purchasePayment.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidAmount: 0, paymentStatus: 'UNPAID' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_REMOVED' }) }),
    );
  });

  it('counts only COMPLETED payments toward paidAmount — PENDING and CANCELLED payments never make a purchase PARTIAL/PAID', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 3, purchaseId: 8, amount: 10000, status: 'PENDING' });
    prisma.purchasePayment.findMany.mockResolvedValue([
      { status: 'PENDING', amount: 10000 },
      { status: 'CANCELLED', amount: 10000 },
    ]);

    await service.addPayment(8, { amount: 10000, status: 'PENDING', paymentDate: PAY_DATE } as never, 9, undefined);

    expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { paidAmount: 0, paymentStatus: 'UNPAID' } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_ADDED', entityType: 'Purchase', entityId: '8' }) }),
    );
  });

  it('refuses to remove a payment that belongs to a different purchase', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue(null);

    await expect(service.removePayment(8, 3, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchasePayment.findFirst).toHaveBeenCalledWith({ where: { id: 3, purchaseId: 8 } });
    expect(prisma.purchasePayment.delete).not.toHaveBeenCalled();
  });

  // --- Regression tests for bugs found in QA 2026-10-05 --------------------
  // Originally `it.failing` (reproducing the bug); converted to plain `it`
  // once fixed so they stay in the suite permanently.

  it('KNOWN BUG: adding a payment and recomputing paidAmount happen in one transaction (no orphan payment on a failed recompute)', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, purchaseId: 8, amount: 5, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 5 }]);

    await service.addPayment(8, { amount: 5, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined);

    expect((prisma as any).$transaction).toHaveBeenCalled();
  });

  it('removing a payment runs in one transaction with the parent purchase locked', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue({ id: 1, amount: 4000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([]);

    await service.removePayment(8, 1, 9, undefined);

    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('a payment that would push paidAmount past Decimal(15,0) is refused with a 400 inside the transaction (no orphan row, no raw 500)', async () => {
    const prisma = createPrismaMock();
    const service = buildPaymentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 2, amount: 999_999_999_999_999, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([
      { status: 'COMPLETED', amount: 999_999_999_999_999 },
      { status: 'COMPLETED', amount: 5 },
    ]);
    // The real $transaction rolls back when its callback throws; here we
    // just assert the throw happens inside it, before any purchase/audit write.
    await expect(service.addPayment(8, { amount: 999_999_999_999_999, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // --- Business-owner decisions of 2026-10-05 -------------------------------

  const svc = (prisma: PrismaMock) => buildPaymentsService(prisma);

  // #1 Overpayment: allowed (no blocking), derived as PAID; the response
  // (get()) carries both totalAmount and paidAmount for the UI to flag it.
  it('#1 allows a payment that pushes paidAmount above totalAmount (overpayment is surfaced by the UI, not blocked)', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, paidAmount: 12000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 3, amount: 12000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 12000 }]);

    const result = await svc(prisma).addPayment(8, { amount: 12000, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined);

    expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { paidAmount: 12000, paymentStatus: 'PAID' } }));
    expect(result).toMatchObject({ totalAmount: 10000, paidAmount: 12000 });
  });

  // #2 Status gates
  it.each(['DRAFT', 'CANCELLED'])('#2 refuses a payment on a %s purchase, before writing anything', async (status) => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE, status });

    await expect(svc(prisma).addPayment(8, { amount: 100, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['CONFIRMED', 'RECEIVED', 'CLOSED'])('#2 accepts a payment on a %s purchase', async (status) => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE, status });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, amount: 100, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 100 }]);

    await expect(svc(prisma).addPayment(8, { amount: 100, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined)).resolves.toBeDefined();
  });

  // #4 Date bounds (cross-field, needs the purchase)
  it('#4 refuses a payment dated before the purchase, but accepts a post-dated (future) one', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, amount: 100, status: 'PENDING' });
    prisma.purchasePayment.findMany.mockResolvedValue([]);

    await expect(svc(prisma).addPayment(8, { amount: 100, status: 'PENDING', paymentDate: new Date('2025-12-31') } as never, 9, undefined)).rejects.toThrow('تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد');
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();

    await expect(svc(prisma).addPayment(8, { amount: 100, status: 'PENDING', paymentDate: new Date('2027-06-01') } as never, 9, undefined)).resolves.toBeDefined();
    // Same calendar day as the purchase is fine.
    await expect(svc(prisma).addPayment(8, { amount: 100, status: 'PENDING', paymentDate: new Date('2026-01-01') } as never, 9, undefined)).resolves.toBeDefined();
  });

  // #7 Editable payments
  it('#7 updatePayment() edits in place inside one locked transaction, recomputes paidAmount and logs PAYMENT_UPDATED', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue({ id: 4, purchaseId: 8, amount: 2000, status: 'PENDING' });
    prisma.purchasePayment.update.mockResolvedValue({ id: 4, amount: 10000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 10000 }]);

    await svc(prisma).updatePayment(8, 4, { amount: 10000, status: 'COMPLETED', paymentDate: PAY_DATE, method: 'CASH' } as never, 9, '127.0.0.1');

    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.purchasePayment.findFirst).toHaveBeenCalledWith({ where: { id: 4, purchaseId: 8 } });
    expect(prisma.purchasePayment.update).toHaveBeenCalledWith({ where: { id: 4 }, data: expect.objectContaining({ amount: 10000, status: 'COMPLETED' }) });
    expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { paidAmount: 10000, paymentStatus: 'PAID' } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_UPDATED', entityId: '8', details: expect.stringContaining('2000') }) }),
    );
  });

  it('#7 updatePayment(): 404 for a payment of another purchase; status/date rules apply to edits too', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue(null);
    await expect(svc(prisma).updatePayment(8, 99, { amount: 1, status: 'COMPLETED', paymentDate: PAY_DATE, method: 'CASH' } as never, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);

    prisma.purchasePayment.findFirst.mockResolvedValue({ id: 4, amount: 1, status: 'PENDING' });
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE, status: 'CANCELLED' });
    await expect(svc(prisma).updatePayment(8, 4, { amount: 1, status: 'COMPLETED', paymentDate: PAY_DATE, method: 'CASH' } as never, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchasePayment.update).not.toHaveBeenCalled();
  });
});
