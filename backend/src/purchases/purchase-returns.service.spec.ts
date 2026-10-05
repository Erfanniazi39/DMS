import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CreatePurchaseReturnDto } from './dto/purchase.dto';
import { buildReturnsService, createPrismaMock, type PrismaMock } from './purchases.spec-helpers';

// PurchaseReturnsService — Return-to-Vendor records. Returns never touch the
// Purchase's derived money fields. Moved verbatim from
// purchases.service.spec.ts when the service was split.

describe('PurchaseReturnsService', () => {
  // --- Return to Vendor (RTV) ----------------------------------------------

  const returnDto = (items: CreatePurchaseReturnDto['items']): CreatePurchaseReturnDto =>
    ({ returnDate: new Date('2026-09-30'), reason: 'کالای معیوب', note: undefined, items }) as never;

  function setUpReturnablePurchase(prisma: ReturnType<typeof createPrismaMock>, alreadyReturned: number | null) {
    // A RECEIVED purchase dated before the return — the only kind that can
    // take a return (business rules 2026-10-05). Line 21: 10 units, 10000 Rial.
    prisma.$queryRaw.mockResolvedValue([{ id: 8, status: 'RECEIVED', purchase_date: new Date('2026-01-01') }]);
    prisma.purchaseItem.findMany.mockResolvedValue([{ id: 21, name: 'روغن موتور', quantity: 10, totalPrice: 10000 }]);
    prisma.purchaseReturnItem.groupBy.mockResolvedValue(
      alreadyReturned === null ? [] : [{ purchaseItemId: 21, _sum: { quantity: alreadyReturned } }],
    );
  }

  it('creates a valid return against a purchase item, generating an RTN- number and logging PURCHASE_RETURN_CREATED', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    setUpReturnablePurchase(prisma, 3);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 12 });
    prisma.purchaseReturn.update.mockImplementation(({ data }: { data: { returnNumber: string } }) =>
      Promise.resolve({ id: 12, purchaseId: 8, returnNumber: data.returnNumber, items: [] }),
    );

    const result = await service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 4, creditAmount: 4000 } as never]), 9, '127.0.0.1');

    // Only items belonging to *this* purchase are considered.
    expect(prisma.purchaseItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [21] }, purchaseId: 8 } }));
    const createData = prisma.purchaseReturn.create.mock.calls[0][0].data;
    expect(createData.returnNumber).toMatch(/^PENDING-/);
    expect(createData.purchaseId).toBe(8);
    expect(createData.createdByUserId).toBe(9);
    expect(createData.items.create).toEqual([{ purchaseItemId: 21, quantity: 4, creditAmount: 4000 }]);
    expect(result.returnNumber).toBe('RTN-000012');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PURCHASE_RETURN_CREATED', entityType: 'Purchase', entityId: '8', details: 'RTN-000012' }),
      }),
    );
  });

  it('generates the return number from the new row id, zero-padded to six digits (RTN-000123)', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    setUpReturnablePurchase(prisma, null);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 123 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 123, returnNumber: 'RTN-000123' });

    await service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 0 } as never]), 9, undefined);

    expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 123 }, data: { returnNumber: 'RTN-000123' } }),
    );
  });

  it('allows returning exactly the remaining returnable quantity', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    setUpReturnablePurchase(prisma, 7);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 13 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 13, returnNumber: 'RTN-000013' });

    await expect(
      service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 3, creditAmount: 3000 } as never]), 9, undefined),
    ).resolves.toEqual(expect.objectContaining({ returnNumber: 'RTN-000013' }));
  });

  it('rejects a return whose quantity exceeds the original quantity minus what was already returned', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    // 10 bought, 7 already returned → only 3 left; asking for 4.
    setUpReturnablePurchase(prisma, 7);

    await expect(
      service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 4, creditAmount: 4000 } as never]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseReturnItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['purchaseItemId'], where: { purchaseItemId: { in: [21] } } }),
    );
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('sums several lines for the same purchase item within one return before checking the limit', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    setUpReturnablePurchase(prisma, null);

    await expect(
      service.createReturn(
        8,
        returnDto([
          { purchaseItemId: 21, quantity: 6, creditAmount: 6000 } as never,
          { purchaseItemId: 21, quantity: 5, creditAmount: 5000 } as never,
        ]),
        9,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('rejects a return against a purchase item that does not exist on this purchase', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    prisma.$queryRaw.mockResolvedValue([{ id: 8, status: 'RECEIVED', purchase_date: new Date('2026-01-01') }]);
    prisma.purchaseItem.findMany.mockResolvedValue([]);

    await expect(
      service.createReturn(8, returnDto([{ purchaseItemId: 999, quantity: 1, creditAmount: 100 } as never]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseReturnItem.groupBy).not.toHaveBeenCalled();
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('rejects a return against a purchase that does not exist', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.createReturn(404, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), 9, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('never changes Purchase.totalAmount, paidAmount or paymentStatus when a return is created or deleted', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    setUpReturnablePurchase(prisma, null);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 14 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 14, returnNumber: 'RTN-000014' });

    await service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 10, creditAmount: 10000 } as never]), 9, undefined);

    prisma.purchaseReturn.findFirst.mockResolvedValue({ id: 14, purchaseId: 8, returnNumber: 'RTN-000014' });
    await service.removeReturn(8, 14, 9, undefined);

    // No write to the Purchase row at all — its derived money fields keep
    // meaning "what was originally billed / paid".
    expect(prisma.purchase.update).not.toHaveBeenCalled();
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
    expect(prisma.purchasePayment.findMany).not.toHaveBeenCalled();
    // And nothing the return itself wrote smuggles those fields in.
    for (const call of [...prisma.purchaseReturn.create.mock.calls, ...prisma.purchaseReturn.update.mock.calls]) {
      expect(call[0].data).not.toHaveProperty('totalAmount');
      expect(call[0].data).not.toHaveProperty('paidAmount');
      expect(call[0].data).not.toHaveProperty('paymentStatus');
    }
  });

  it('deletes a return and logs PURCHASE_RETURN_DELETED; an unknown return id is a 404', async () => {
    const prisma = createPrismaMock();
    const service = buildReturnsService(prisma);
    prisma.purchaseReturn.findFirst.mockResolvedValueOnce({ id: 14, purchaseId: 8, returnNumber: 'RTN-000014' });

    await expect(service.removeReturn(8, 14, 9, '127.0.0.1')).resolves.toEqual({ success: true });
    expect(prisma.purchaseReturn.findFirst).toHaveBeenCalledWith({ where: { id: 14, purchaseId: 8 } });
    expect(prisma.purchaseReturn.delete).toHaveBeenCalledWith({ where: { id: 14 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_RETURN_DELETED', entityId: '8', details: 'RTN-000014' }) }),
    );

    prisma.purchaseReturn.findFirst.mockResolvedValueOnce(null);
    await expect(service.removeReturn(8, 99, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- Business-owner decisions of 2026-10-05 -------------------------------

  const svc = (prisma: PrismaMock) => buildReturnsService(prisma);

  it.each(['DRAFT', 'CONFIRMED', 'CANCELLED'])('#2 refuses a return on a %s purchase (goods must have been received)', async (status) => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);
    prisma.$queryRaw.mockResolvedValue([{ id: 8, status, purchase_date: new Date('2026-01-01') }]);

    await expect(svc(prisma).createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('#2 accepts a return on a CLOSED purchase', async () => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);
    prisma.$queryRaw.mockResolvedValue([{ id: 8, status: 'CLOSED', purchase_date: new Date('2026-01-01') }]);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 30 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 30, returnNumber: 'RTN-000030' });

    await expect(svc(prisma).createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), 9, undefined)).resolves.toBeDefined();
  });

  // #3 Credit cap
  it('#3 refuses a return whose credit exceeds the line\'s remaining value (totalPrice − credit already returned)', async () => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);
    // 10 units / 10000 Rial; 2 units already returned for 7000 credit → 3000 left.
    prisma.purchaseReturnItem.groupBy.mockResolvedValue([{ purchaseItemId: 21, _sum: { quantity: 2, creditAmount: 7000 } }]);

    await expect(svc(prisma).createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 3001 } as never]), 9, undefined)).rejects.toThrow(/ارزش باقی‌ماندهٔ قابل برگشت \(3000 ریال\)/);
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();

    prisma.purchaseReturn.create.mockResolvedValue({ id: 31 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 31, returnNumber: 'RTN-000031' });
    await expect(svc(prisma).createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 3000 } as never]), 9, undefined)).resolves.toBeDefined();
  });

  it('#3 sums the credit of several lines for the same item before checking the cap', async () => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);

    await expect(
      svc(prisma).createReturn(8, returnDto([
        { purchaseItemId: 21, quantity: 1, creditAmount: 6000 } as never,
        { purchaseItemId: 21, quantity: 1, creditAmount: 4001 } as never,
      ]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('#4 refuses a return dated before the purchase', async () => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);

    await expect(
      svc(prisma).createReturn(8, { ...returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), returnDate: new Date('2025-12-31') } as never, 9, undefined),
    ).rejects.toThrow('تاریخ برگشت نمی‌تواند قبل از تاریخ خرید باشد');
  });
});
