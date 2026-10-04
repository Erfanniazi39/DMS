import { ConflictException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PurchaseQuantitiesService } from '../purchases/purchase-quantities.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import type { CreatePurchaseRequestDto, UpdatePurchaseRequestDto } from './dto/purchase-request.dto';

// Scenario 3 of the Purchase module architecture task ("Create Purchase
// Request") plus its own request-number generation, status-change audit
// logging, and validation — PurchaseRequest is a small optional module of
// its own, tested the same way as PurchasesService.

function createPrismaMock() {
  const mock = {
    purchaseRequest: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    purchaseRequestItem: { deleteMany: jest.fn() },
    purchaseItem: { groupBy: jest.fn() },
    department: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    unit: { count: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  // create()/update() run inside a $transaction — same convention as
  // PurchasesService's own spec.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

// The real Purchases-owned quantity provider over the same Prisma mock, so
// the CANCELLED-exclusion query it owns is exercised (and asserted) here too.
function createService(prisma: ReturnType<typeof createPrismaMock>) {
  return new PurchaseRequestsService(
    prisma as never,
    new PurchaseQuantitiesService(prisma as never),
    new AuditService(prisma as never),
  );
}

const baseItems: CreatePurchaseRequestDto['items'] = [
  { name: 'روغن موتور', quantity: 10 as never, unitId: 1 } as never,
];

describe('PurchaseRequestsService', () => {
  it('creates a Purchase Request and generates its request number (REQ-000001) after the row exists', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseRequest.create.mockResolvedValue({ id: 1 });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 1, requestNumber: 'REQ-000001', status: 'DRAFT' });

    const dto: CreatePurchaseRequestDto = {
      requestDate: new Date('2026-01-01') as never,
      requesterDepartmentId: 2,
      requestedByEmployeeId: undefined,
      priority: 'NORMAL' as never,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result).toEqual({ id: 1, requestNumber: 'REQ-000001', status: 'DRAFT' });
    // Two-step, same reasoning as PurchasesService.create(): a throwaway
    // placeholder is inserted first, then corrected once the id is known.
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data.requestNumber).toMatch(/^PENDING-/);
    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { requestNumber: 'REQ-000001' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_REQUEST_CREATED', entityId: '1' }) }),
    );
  });

  it('accepts a Purchase Request with no named requester employee — only the requesting department is mandatory', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseRequest.create.mockResolvedValue({ id: 2 });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 2, requestNumber: 'REQ-000002' });

    await service.create(
      {
        requestDate: new Date('2026-01-01') as never,
        requesterDepartmentId: 2,
        requestedByEmployeeId: undefined,
        priority: 'NORMAL' as never,
        note: undefined,
        items: baseItems,
      } as never,
      null,
      undefined,
    );

    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a Purchase Request from an inactive department', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'inactive' });

    await expect(
      service.create(
        {
          requestDate: new Date('2026-01-01') as never,
          requesterDepartmentId: 2,
          requestedByEmployeeId: undefined,
          priority: 'NORMAL' as never,
          note: undefined,
          items: baseItems,
        } as never,
        9,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('logs PURCHASE_REQUEST_STATUS_CHANGED only when the status actually changes on update', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const existing = {
      id: 1,
      status: 'DRAFT',
      requesterDepartment: { id: 2 },
      requestedByEmployee: null,
      createdByUser: null,
      items: [],
      purchases: [],
    };
    prisma.purchaseRequest.findUnique.mockResolvedValue(existing);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseRequest.update.mockResolvedValue({ id: 1, status: 'SUBMITTED', items: [] });

    const dto: UpdatePurchaseRequestDto = {
      requestDate: new Date('2026-01-01') as never,
      requesterDepartmentId: 2,
      requestedByEmployeeId: undefined,
      priority: 'NORMAL' as never,
      status: 'SUBMITTED' as never,
      note: undefined,
      items: baseItems,
    } as never;

    await service.update(1, dto, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_REQUEST_STATUS_CHANGED' }) }),
    );

    prisma.auditLog.create.mockClear();
    prisma.purchaseRequest.findUnique.mockResolvedValue({ ...existing, status: 'SUBMITTED' });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 1, status: 'SUBMITTED', items: [] });
    await service.update(1, dto, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_REQUEST_UPDATED' }) }),
    );
  });

  // --- Purchase Request → Purchase integration ----------------------------
  // Requested 500 kg; Purchase #1 delivers 300 kg, Purchase #2 (a second,
  // separate Purchase against the same request item) delivers 200 kg —
  // matches the worked example in the architecture spec exactly.

  it('computes purchasedQuantity/remainingQuantity per item from every linked Purchase, excluding CANCELLED ones', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      id: 1,
      requestNumber: 'REQ-000001',
      status: 'PARTIALLY_PURCHASED',
      requesterDepartment: { id: 2 },
      requestedByEmployee: null,
      createdByUser: null,
      items: [
        { id: 501, name: 'شیر خشک', quantity: 500 },
        { id: 502, name: 'شکر', quantity: 200 },
      ],
      purchases: [],
    });
    // Item 501: two non-cancelled Purchases (300 + 200 = 500, fully
    // purchased). Item 502: no groupBy row at all — a CANCELLED purchase's
    // quantity is excluded by the query's own where clause, so an item with
    // only cancelled purchases behaves exactly like one with none.
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 500 } }]);

    const result = await service.get(1);

    expect(prisma.purchaseItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['purchaseRequestItemId'],
        where: { purchaseRequestItemId: { in: [501, 502] }, purchase: { status: { not: 'CANCELLED' } } },
      }),
    );
    expect(result.items[0]).toMatchObject({ id: 501, purchasedQuantity: 500, remainingQuantity: 0 });
    expect(result.items[1]).toMatchObject({ id: 502, purchasedQuantity: 0, remainingQuantity: 200 });
  });

  it('recomputeStatus(): APPROVED → PARTIALLY_PURCHASED → COMPLETED as multiple Purchases fulfill one request item (500kg in two purchases)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    // Purchase #1: 300 of 500 kg.
    prisma.purchaseRequest.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'APPROVED',
      items: [{ id: 501, quantity: 500 }],
    });
    prisma.purchaseItem.groupBy.mockResolvedValueOnce([{ purchaseRequestItemId: 501, _sum: { quantity: 300 } }]);
    await service.recomputeStatus(1, 9, '127.0.0.1');
    expect(prisma.purchaseRequest.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { status: 'PARTIALLY_PURCHASED' } });
    expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_REQUEST_STATUS_CHANGED', entityId: '1' }) }),
    );

    // Purchase #2: another 200 kg — now fully purchased (300 + 200 = 500).
    prisma.purchaseRequest.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'PARTIALLY_PURCHASED',
      items: [{ id: 501, quantity: 500 }],
    });
    prisma.purchaseItem.groupBy.mockResolvedValueOnce([{ purchaseRequestItemId: 501, _sum: { quantity: 500 } }]);
    await service.recomputeStatus(1, 9, '127.0.0.1');
    expect(prisma.purchaseRequest.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { status: 'COMPLETED' } });
  });

  it('recomputeStatus(): a request with no purchased quantity yet stays/returns to APPROVED, never COMPLETED merely because a Purchase was created', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      id: 1,
      status: 'APPROVED',
      items: [{ id: 501, quantity: 500 }],
    });
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    await service.recomputeStatus(1, 9, '127.0.0.1');

    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED'])(
    'recomputeStatus() never touches a request that is still %s, even if a linked Purchase exists',
    async (status) => {
      const prisma = createPrismaMock();
      const service = createService(prisma);
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        id: 1,
        status,
        items: [{ id: 501, quantity: 500 }],
      });
      prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 500 } }]);

      await service.recomputeStatus(1, 9, '127.0.0.1');

      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('filters the request list by status, priority, and requesting department', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findMany.mockResolvedValue([]);

    await service.list({ status: 'SUBMITTED', priority: 'URGENT', requesterDepartmentId: 2 });

    const whereArg = prisma.purchaseRequest.findMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('SUBMITTED');
    expect(whereArg.priority).toBe('URGENT');
    expect(whereArg.requesterDepartmentId).toBe(2);
  });
});
