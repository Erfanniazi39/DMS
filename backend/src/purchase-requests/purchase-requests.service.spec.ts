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
    // updateMany: the optimistic-lock compare-and-set in update() (count 1 = version matched).
    purchaseRequest: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseRequestItem: { deleteMany: jest.fn() },
    purchaseItem: { groupBy: jest.fn(), findMany: jest.fn() },
    // Active by default; individual tests override it to exercise the
    // shared ensureActivePurchaseType() rule.
    purchaseType: { findUnique: jest.fn().mockResolvedValue({ id: 1, isActive: true }) },
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

// The version (updatedAt) the client loaded; existing-row mocks carry the
// same value, i.e. nobody saved in between.
const VERSION = new Date('2026-01-01T10:00:00.000Z');

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
    // items: [] — create() now returns the same shape as get() (bug #16,
    // QA 2026-10-05), so the mocked row carries its (empty) item list.
    prisma.purchaseRequest.update.mockResolvedValue({ id: 1, requestNumber: 'REQ-000001', status: 'DRAFT', items: [] });

    const dto: CreatePurchaseRequestDto = {
      requestDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1, requesterDepartmentId: 2,
      requestedByEmployeeId: undefined,
      priority: 'NORMAL' as never,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result).toEqual({ id: 1, requestNumber: 'REQ-000001', status: 'DRAFT', items: [] });
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
    prisma.purchaseRequest.update.mockResolvedValue({ id: 2, requestNumber: 'REQ-000002', items: [] });

    await service.create(
      {
        requestDate: new Date('2026-01-01') as never,
        purchaseTypeId: 1, requesterDepartmentId: 2,
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
          purchaseTypeId: 1, requesterDepartmentId: 2,
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

  it('create(): stores the chosen purchaseTypeId after checking it is an active PurchaseType', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.purchaseRequest.create.mockResolvedValue({ id: 4 });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 4, requestNumber: 'REQ-000004', items: [] });

    await service.create(
      { requestDate: new Date('2026-01-01') as never, purchaseTypeId: 3, requesterDepartmentId: 2, priority: 'NORMAL' as never, items: baseItems } as never,
      9,
      undefined,
    );

    expect(prisma.purchaseType.findUnique).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data.purchaseTypeId).toBe(3);
  });

  it.each([
    ['inactive', { id: 3, isActive: false }],
    ['missing', null],
  ])('create(): rejects a %s purchase type with a Persian 409 and writes nothing', async (_label, purchaseType) => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseType.findUnique.mockResolvedValue(purchaseType);

    await expect(
      service.create(
        { requestDate: new Date('2026-01-01') as never, purchaseTypeId: 3, requesterDepartmentId: 2, priority: 'NORMAL' as never, items: baseItems } as never,
        9,
        undefined,
      ),
    ).rejects.toThrow('نوع خرید انتخاب‌شده معتبر نیست');
    expect(prisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('update(): re-checks the purchase type only when it changes — an already-assigned, since-deactivated type stays saveable', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const existing = {
      id: 1,
      status: 'DRAFT',
      updatedAt: VERSION,
      purchaseTypeId: 1,
      requesterDepartmentId: 2,
      requesterDepartment: { id: 2 },
      requestedByEmployee: null,
      createdByUser: null,
      items: [],
      purchases: [],
    };
    prisma.purchaseRequest.findUnique.mockResolvedValue(existing);
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: false });
    const dto = (purchaseTypeId: number) =>
      ({ requestDate: new Date('2026-01-01'), purchaseTypeId, requesterDepartmentId: 2, priority: 'NORMAL', status: 'DRAFT', updatedAt: VERSION, items: baseItems }) as never;

    await service.update(1, dto(1), 9, undefined);
    expect(prisma.purchaseType.findUnique).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.update.mock.calls[0][0].data.purchaseTypeId).toBe(1);

    prisma.purchaseType.findUnique.mockResolvedValue({ id: 5, isActive: false });
    await expect(service.update(1, dto(5), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseType.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('logs PURCHASE_REQUEST_STATUS_CHANGED only when the status actually changes on update', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const existing = {
      id: 1,
      status: 'DRAFT',
      updatedAt: VERSION,
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
      purchaseTypeId: 1, requesterDepartmentId: 2,
      requestedByEmployeeId: undefined,
      priority: 'NORMAL' as never,
      status: 'SUBMITTED' as never, updatedAt: VERSION,
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
      updatedAt: VERSION,
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

    await service.list({ status: 'SUBMITTED', priority: 'URGENT', purchaseTypeId: 1, requesterDepartmentId: 2 });

    const whereArg = prisma.purchaseRequest.findMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('SUBMITTED');
    expect(whereArg.priority).toBe('URGENT');
    expect(whereArg.requesterDepartmentId).toBe(2);
  });

  // --- QA pass 2026-10-05: coverage gaps ------------------------------------

  it('recomputeStatus(): multi-item request — one line fully bought, another untouched → PARTIALLY_PURCHASED, not COMPLETED', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      id: 1,
      status: 'APPROVED',
      items: [
        { id: 501, quantity: 1000 },
        { id: 502, quantity: 500 },
      ],
    });
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 1000 } }]);

    await service.recomputeStatus(1, 9, undefined);

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'PARTIALLY_PURCHASED' } });
  });

  it('recomputeStatus(): COMPLETED returns to APPROVED once every linked purchase is cancelled (nothing countable left)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 1, status: 'COMPLETED', items: [{ id: 501, quantity: 100 }] });
    // CANCELLED purchases are excluded by the query itself → no rows.
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    await service.recomputeStatus(1, 9, undefined);

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'APPROVED' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PURCHASE_REQUEST_STATUS_CHANGED', entityType: 'PurchaseRequest', entityId: '1', userId: 9 }),
      }),
    );
  });

  it('recomputeStatus(): over-purchasing beyond the requested quantity still counts as COMPLETED', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 1, status: 'PARTIALLY_PURCHASED', items: [{ id: 501, quantity: 100 }] });
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 150 } }]);

    await service.recomputeStatus(1, 9, undefined);

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'COMPLETED' } });
  });

  it('recomputeStatus(): a request id that no longer exists is a silent no-op', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(null);

    await expect(service.recomputeStatus(404, 9, undefined)).resolves.toBeUndefined();
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('create() always starts DRAFT and records the logged-in user as createdByUser (never a client-supplied value)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseRequest.create.mockResolvedValue({ id: 3 });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 3, items: [] });

    await service.create(
      { requestDate: new Date('2026-01-01') as never, purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'NORMAL' as never, items: baseItems } as never,
      9,
      undefined,
    );

    const data = prisma.purchaseRequest.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data.createdByUserId).toBe(9);
  });

  // --- Regression tests for bugs found in QA 2026-10-05 --------------------
  // Originally `it.failing` (reproducing the bug); converted to plain `it`
  // once fixed so they stay in the suite permanently.

  it(
    'KNOWN BUG (CRITICAL): editing a request must not blanket-delete its items — that silently unlinks every PurchaseItem (ON DELETE SET NULL) and wipes fulfilment',
    async () => {
      const prisma = createPrismaMock();
      const service = createService(prisma);
      const existing = {
        id: 1,
        status: 'PARTIALLY_PURCHASED',
        updatedAt: VERSION,
        requesterDepartment: { id: 2 },
        requestedByEmployee: null,
        createdByUser: null,
        // unitId: a real PurchaseRequestItem row always carries it; same
        // unit as baseItems — the edit below changes priority only.
        items: [{ id: 501, name: 'روغن موتور', quantity: 10, unitId: 1 }],
        purchases: [{ id: 125 }],
      };
      prisma.purchaseRequest.findUnique.mockResolvedValue(existing);
      prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 6 } }]);
      prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
      prisma.unit.count.mockResolvedValue(1);
      prisma.purchaseRequest.update.mockResolvedValue({ ...existing, priority: 'URGENT' });

      // Priority-only edit, identical item list.
      await service.update(
        1,
        { requestDate: new Date('2026-01-01') as never, purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'URGENT' as never, status: 'PARTIALLY_PURCHASED' as never, updatedAt: VERSION, items: baseItems } as never,
        9,
        undefined,
      );

      expect(prisma.purchaseRequestItem.deleteMany).not.toHaveBeenCalledWith({ where: { purchaseRequestId: 1 } });
      // The existing line is updated in place — same id, so every
      // PurchaseItem linked to it keeps its link — and nothing is deleted
      // or recreated.
      const itemWrites = prisma.purchaseRequest.update.mock.calls[0][0].data.items;
      expect(itemWrites.update).toEqual([expect.objectContaining({ where: { id: 501 } })]);
      expect(itemWrites.create).toEqual([]);
      expect(itemWrites).not.toHaveProperty('deleteMany');
    },
  );

  it(
    'KNOWN BUG (CLAUDE.md rule 6): a user edit must not move a request INTO PARTIALLY_PURCHASED/COMPLETED — only recomputeStatus() may',
    async () => {
      const prisma = createPrismaMock();
      const service = createService(prisma);
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        id: 1,
        status: 'DRAFT',
        updatedAt: VERSION,
        requesterDepartment: { id: 2 },
        requestedByEmployee: null,
        createdByUser: null,
        items: [],
        purchases: [],
      });
      prisma.purchaseItem.groupBy.mockResolvedValue([]);
      prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
      prisma.unit.count.mockResolvedValue(1);
      prisma.purchaseRequest.update.mockResolvedValue({ id: 1, status: 'COMPLETED', items: [] });

      await expect(
        service.update(
          1,
          { requestDate: new Date('2026-01-01') as never, purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'NORMAL' as never, status: 'COMPLETED' as never, updatedAt: VERSION, items: baseItems } as never,
          9,
          undefined,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  // --- More QA 2026-10-05 regression coverage ------------------------------

  function editableRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      status: 'APPROVED',
      updatedAt: VERSION,
      purchaseTypeId: 1, requesterDepartmentId: 2,
      requestedByEmployeeId: null,
      requesterDepartment: { id: 2 },
      requestedByEmployee: null,
      createdByUser: null,
      items: [
        { id: 501, name: 'شیر خام', quantity: 1000, unitId: 6 },
        { id: 502, name: 'شکر', quantity: 200, unitId: 1 },
      ],
      purchases: [],
      ...overrides,
    };
  }

  const editDto = (items: unknown[], overrides: Record<string, unknown> = {}) =>
    ({ requestDate: new Date('2026-01-01'), purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'NORMAL', status: 'APPROVED', updatedAt: VERSION, items, ...overrides }) as never;

  it('update(): refuses to remove a request line that a Purchase line is linked to (would silently null the link)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 502, _sum: { quantity: 50 } }]);
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseItem.findMany.mockResolvedValue([{ purchaseRequestItemId: 502 }]);

    await expect(service.update(1, editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }]), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { purchaseRequestItemId: { in: [502] } } }));
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('update(): removes an unlinked line by id only, never via a blanket delete of every line', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([]);
    prisma.purchaseItem.findMany.mockResolvedValue([]);

    await service.update(1, editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }]), 9, undefined);

    const itemWrites = prisma.purchaseRequest.update.mock.calls[0][0].data.items;
    expect(itemWrites.deleteMany).toEqual({ id: { in: [502] } });
    expect(itemWrites.update).toEqual([expect.objectContaining({ where: { id: 501 } })]);
    expect(prisma.purchaseRequestItem.deleteMany).not.toHaveBeenCalled();
  });

  it('update(): refuses to shrink a line below the quantity already purchased against it', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 600 } }]);

    await expect(
      service.update(1, editDto([{ name: 'شیر خام', quantity: 500, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('update(): refuses to change the unit of a line that has purchases linked to it', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 100 } }]);
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseItem.findMany.mockResolvedValue([{ purchaseRequestItemId: 501 }]);

    await expect(
      service.update(1, editDto([{ id: 501, name: 'شیر خام', quantity: 1000, unitId: 7 }, { id: 502, name: 'شکر', quantity: 200, unitId: 1 }]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('update(): matches lines by explicit id (a renamed line keeps its row and links); new lines are created; ids from another request are refused', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    await service.update(
      1,
      editDto([
        { id: 501, name: 'شیر خام پرچرب', quantity: 1000, unitId: 6 },
        { id: 502, name: 'شکر', quantity: 250, unitId: 1 },
        { name: 'نمک', quantity: 5, unitId: 1 },
      ]),
      9,
      undefined,
    );
    const itemWrites = prisma.purchaseRequest.update.mock.calls[0][0].data.items;
    expect(itemWrites.update.map((write: { where: { id: number } }) => write.where.id)).toEqual([501, 502]);
    expect(itemWrites.update[0].data.name).toBe('شیر خام پرچرب');
    expect(itemWrites.create).toEqual([expect.objectContaining({ name: 'نمک' })]);
    expect(itemWrites.create[0]).not.toHaveProperty('id');

    prisma.purchaseRequest.update.mockClear();
    await expect(service.update(1, editDto([{ id: 999, name: 'x', quantity: 1, unitId: 1 }]), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('update(): re-runs recomputeStatus() — approving a request that already has purchased quantity lands on PARTIALLY_PURCHASED', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique
      .mockResolvedValueOnce(editableRequest({ status: 'SUBMITTED' })) // get() before the edit
      .mockResolvedValueOnce({ id: 1, status: 'APPROVED', items: [{ id: 501, quantity: 1000 }, { id: 502, quantity: 200 }] }) // recomputeStatus()
      .mockResolvedValueOnce(editableRequest({ status: 'PARTIALLY_PURCHASED' })); // get() for the response
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 300 } }]);

    const result = await service.update(
      1,
      editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }]),
      9,
      undefined,
    );

    expect(prisma.purchaseRequest.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { status: 'PARTIALLY_PURCHASED' } });
    expect(result.status).toBe('PARTIALLY_PURCHASED');
  });

  it('update(): a PATCH that only echoes an existing PARTIALLY_PURCHASED status is allowed (round-tripping is not a status change)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest({ status: 'PARTIALLY_PURCHASED' }));
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: 300 } }]);

    await expect(
      service.update(1, editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }], { status: 'PARTIALLY_PURCHASED', priority: 'URGENT' }), 9, undefined),
    ).resolves.toBeDefined();
  });

  it('update(): may keep a since-deactivated department/unit it already has, but only newly assigned units are checked for isActive', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([]);
    prisma.unit.count.mockResolvedValue(1);

    await service.update(
      1,
      editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }, { name: 'نمک', quantity: 1, unitId: 9 }]),
      9,
      undefined,
    );

    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.unit.count).toHaveBeenCalledWith({ where: { id: { in: [9] }, isActive: true } });
  });

  it('get(): remainingQuantity uses Decimal arithmetic (no 799.8000000000001 float noise)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest({ items: [{ id: 501, name: 'شیر', quantity: '1000.00', unitId: 6 }] }));
    prisma.purchaseItem.groupBy.mockResolvedValue([{ purchaseRequestItemId: 501, _sum: { quantity: '200.20' } }]);

    const result = await service.get(1);

    expect(result.items[0].remainingQuantity).toBe(799.8);
  });

  it('get(): the nested requestedByEmployee exposes display fields only (no national ID / salary / bank / contract)', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    await service.get(1);

    const include = prisma.purchaseRequest.findUnique.mock.calls[0][0].include;
    expect(include.requestedByEmployee).toEqual({ select: { id: true, code: true, firstName: true, lastName: true } });
  });

  it('create() returns items with purchasedQuantity/remainingQuantity, same shape as get()', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchaseRequest.create.mockResolvedValue({ id: 4 });
    prisma.purchaseRequest.update.mockResolvedValue({ id: 4, items: [{ id: 700, name: 'شیر', quantity: '12.50', unitId: 6 }] });
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    const result = await service.create(
      { requestDate: new Date('2026-01-01'), purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'NORMAL', items: [{ id: 123, name: 'شیر', quantity: 12.5, unitId: 6 }] } as never,
      9,
      undefined,
    );

    expect(result.items[0]).toMatchObject({ id: 700, purchasedQuantity: 0, remainingQuantity: 12.5 });
    // A client-supplied line id is never written on create.
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data.items.create[0]).not.toHaveProperty('id');
  });

  // --- #12 Optimistic locking (business decision 2026-10-05) ----------------

  it('#12 update(): a stale updatedAt is a 409 RECORD_MODIFIED — nothing is written', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest({ updatedAt: new Date('2026-01-01T10:00:01.000Z') }));
    prisma.purchaseItem.groupBy.mockResolvedValue([]);

    const error = await service
      .update(1, editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }]), 9, undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'RECORD_MODIFIED' });
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('#12 update(): loses the atomic compare-and-set if another save landed after the read', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue(editableRequest());
    prisma.purchaseItem.groupBy.mockResolvedValue([]);
    prisma.purchaseRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(1, editDto([{ name: 'شیر خام', quantity: 1000, unitId: 6 }, { name: 'شکر', quantity: 200, unitId: 1 }]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, updatedAt: VERSION } }));
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });
});
