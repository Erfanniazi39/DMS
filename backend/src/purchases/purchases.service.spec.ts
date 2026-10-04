import { readFileSync } from 'fs';
import { AuditService } from '../audit/audit.service';
import { join } from 'path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import type { CreatePurchaseDto, CreatePurchaseReturnDto, UpdatePurchaseDto } from './dto/purchase.dto';

// Covers the "Professionalize the Purchase module" architecture task —
// Purchase Request is optional, historical imports never fabricate a
// department/buyer/request, payment status is always derived (never set
// directly), and every listed business event writes one AUDIT_LOG row.

function createPrismaMock() {
  const mock = {
    purchase: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    purchaseItem: { deleteMany: jest.fn(), findMany: jest.fn() },
    purchaseType: { findUnique: jest.fn() },
    department: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    purchaseRequest: { findUnique: jest.fn() },
    purchaseRequestItem: { count: jest.fn() },
    unit: { count: jest.fn() },
    purchasePayment: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    purchaseDocument: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    purchaseReturn: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    purchaseReturnItem: { groupBy: jest.fn() },
    // Row lock taken on the parent Purchase inside createReturn()'s
    // transaction — the mock just reports whether that row exists.
    $queryRaw: jest.fn(),
    auditLog: { create: jest.fn() },
  };
  // create()/update() run inside a $transaction — the mock just invokes the
  // callback with itself, same convention as employees.service.spec.ts.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

// PurchasesService only calls recomputeStatus() on this — never any of
// PurchaseRequestsService's own CRUD methods (those stay untouched user
// edits). A plain jest.fn() double is enough.
function createPurchaseRequestsServiceMock() {
  return { recomputeStatus: jest.fn() };
}

const baseItems: CreatePurchaseDto['items'] = [
  { name: 'روغن موتور', quantity: 10 as never, unitId: 1, unitPrice: 1000 as never, totalPrice: 10000 as never },
];

describe('PurchasesService', () => {
  // --- 1 & 4. Create Purchase without / with a Purchase Request ----------

  it('creates a Purchase without a Purchase Request (most purchases have none)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5, purchaseNumber: 'PUR-000005', purchaseRequestId: null });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result).toEqual({ id: 5, purchaseNumber: 'PUR-000005', purchaseRequestId: null });
    expect(prisma.purchaseRequest.findUnique).not.toHaveBeenCalled();
    const createData = prisma.purchase.create.mock.calls[0][0].data;
    expect(createData.purchaseRequestId).toBeUndefined();
    expect(createData.sourceType).toBe('OPERATIONAL');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_CREATED', entityId: '5' }) }),
    );
  });

  it('creates a Purchase linked to an existing Purchase Request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7 });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6, purchaseNumber: 'PUR-000006', purchaseRequestId: 7 });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result.purchaseRequestId).toBe(7);
    expect(prisma.purchaseRequest.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(prisma.purchase.create.mock.calls[0][0].data.purchaseRequestId).toBe(7);
    // Creating a Purchase against a request lets the request re-derive its
    // own purchasing progress — see PurchaseRequestsService.recomputeStatus().
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
  });

  // --- Purchase Request → Purchase integration ----------------------------

  it('links a Purchase item to the specific Purchase Request item it fulfills, after validating it belongs to the same request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7 });
    prisma.purchaseRequestItem.count.mockResolvedValue(1);
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6, purchaseNumber: 'PUR-000006', purchaseRequestId: 7 });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: [{ ...baseItems[0], quantity: 300 as never, purchaseRequestItemId: 55 }],
    } as never;

    await service.create(dto, 9, '127.0.0.1');

    expect(prisma.purchaseRequestItem.count).toHaveBeenCalledWith({ where: { id: { in: [55] }, purchaseRequestId: 7 } });
    expect(prisma.purchase.create.mock.calls[0][0].data.items.create[0].purchaseRequestItemId).toBe(55);
  });

  it('rejects a Purchase item whose purchaseRequestItemId does not belong to the request it is being attached to', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7 });
    // The item exists, but not under request 7 — count comes back short.
    prisma.purchaseRequestItem.count.mockResolvedValue(0);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: [{ ...baseItems[0], purchaseRequestItemId: 999 }],
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('rejects a Purchase item that names a Purchase Request item without the Purchase itself being linked to any request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: undefined,
      note: undefined,
      items: [{ ...baseItems[0], purchaseRequestItemId: 55 }],
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    // The failure is specifically the item-link check, not some other
    // validator that happened to also throw — no lookup for a request item
    // that could never be valid without a purchaseRequestId was even made.
    expect(prisma.purchaseRequestItem.count).not.toHaveBeenCalled();
  });

  it('recomputes both the old and the new Purchase Request when editing a Purchase moves it from one request to another', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    const existing = {
      id: 8,
      status: 'CONFIRMED',
      paidAmount: 0,
      purchaseType: {},
      requesterDepartment: null,
      buyerEmployee: null,
      purchaseRequest: { id: 7, requestNumber: 'REQ-000007' },
      supplier: {},
      items: [],
      payments: [],
      documents: [],
    };
    prisma.purchase.findUnique.mockResolvedValue(existing);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 12 });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.update.mockResolvedValue({ id: 8, status: 'CONFIRMED', purchaseRequestId: 12 });

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      purchaseRequestId: 12,
      status: 'CONFIRMED' as never,
      note: undefined,
      items: baseItems,
    } as never;

    await service.update(8, dto, 9, '127.0.0.1');

    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(12, 9, '127.0.0.1');
  });

  it('recomputes the linked Purchase Request after a Purchase is removed', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      purchaseRequestId: 7,
      _count: { payments: 0, documents: 0 },
    });

    await service.remove(8, 9, '127.0.0.1');

    expect(prisma.purchase.delete).toHaveBeenCalledWith({ where: { id: 8 } });
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
  });

  it('rejects a Purchase linked to a non-existent Purchase Request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue(null);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 999,
      note: undefined,
      items: baseItems,
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  // --- 5, 6 & 7. Historical purchases -------------------------------------

  it('creates a historical Purchase without a Purchase Request, department, or buyer — never fabricating any of them', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 8 });
    prisma.purchase.update.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      sourceType: 'HISTORICAL_IMPORT',
      requesterDepartmentId: null,
      buyerEmployeeId: null,
      purchaseRequestId: null,
    });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2019-05-01') as never,
      purchaseTypeId: 1,
      sourceType: 'HISTORICAL_IMPORT' as never,
      requesterDepartmentId: undefined,
      buyerEmployeeId: undefined,
      supplierId: 4,
      purchaseRequestId: undefined,
      note: 'دیجیتال‌سازی سند کاغذی قدیمی',
      items: baseItems,
    } as never;

    const result = await service.create(dto, null, undefined);

    // Neither ensureDepartment nor ensureBuyerEmployee nor
    // ensurePurchaseRequest should even be consulted — nothing was fed a
    // fake id to validate.
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.findUnique).not.toHaveBeenCalled();
    const createData = prisma.purchase.create.mock.calls[0][0].data;
    expect(createData.requesterDepartmentId).toBeUndefined();
    expect(createData.buyerEmployeeId).toBeUndefined();
    expect(createData.sourceType).toBe('HISTORICAL_IMPORT');
    expect(result.sourceType).toBe('HISTORICAL_IMPORT');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'HISTORICAL_PURCHASE_IMPORTED' }) }),
    );
  });

  // --- 8, 9 & 10. Payments and payment-status derivation ------------------

  it('marks a historical Purchase as already paid when its first payment is recorded as COMPLETED', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    const purchase = { id: 8, totalAmount: 10000, paymentStatus: 'UNPAID' };
    prisma.purchase.findUnique.mockResolvedValue({ ...purchase, purchaseRequest: null, purchaseType: {}, requesterDepartment: null, buyerEmployee: null, supplier: {}, items: [], payments: [], documents: [] });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, purchaseId: 8, amount: 10000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 10000 }]);

    await service.addPayment(8, { amount: 10000, status: 'COMPLETED' } as never, 9, '127.0.0.1');

    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 }, data: { paidAmount: 10000, paymentStatus: 'PAID' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_COMPLETED' }) }),
    );
  });

  it('accumulates multiple payments toward one Purchase and derives PARTIAL, then PAID', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    const baseGet = { purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...baseGet });

    prisma.purchasePayment.create.mockResolvedValueOnce({ id: 1, purchaseId: 8, amount: 4000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValueOnce([{ status: 'COMPLETED', amount: 4000 }]);
    await service.addPayment(8, { amount: 4000, status: 'COMPLETED' } as never, 9, undefined);
    expect(prisma.purchase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { paidAmount: 4000, paymentStatus: 'PARTIAL' } }),
    );

    prisma.purchasePayment.create.mockResolvedValueOnce({ id: 2, purchaseId: 8, amount: 6000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValueOnce([
      { status: 'COMPLETED', amount: 4000 },
      { status: 'COMPLETED', amount: 6000 },
    ]);
    await service.addPayment(8, { amount: 6000, status: 'COMPLETED' } as never, 9, undefined);
    expect(prisma.purchase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { paidAmount: 10000, paymentStatus: 'PAID' } }),
    );
  });

  it('recomputes payment status back to UNPAID when a payment is removed, without erasing the removed row from history first', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    const baseGet = { purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...baseGet });
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

  // --- 11. Multiple documents ----------------------------------------------

  it('attaches multiple documents to one Purchase, each call returning its own document id (not the Purchase id)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8 });
    prisma.purchaseDocument.create
      .mockResolvedValueOnce({ id: 101, purchaseId: 8, documentType: 'INVOICE' })
      .mockResolvedValueOnce({ id: 102, purchaseId: 8, documentType: 'RECEIPT' });

    const first = await service.addDocument(8, { documentType: 'INVOICE' } as never, 9, undefined);
    const second = await service.addDocument(8, { documentType: 'RECEIPT' } as never, 9, undefined);

    expect(first.id).toBe(101);
    expect(second.id).toBe(102);
    expect(first.id).not.toBe(second.id);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_ADDED', entityId: '8', details: 'INVOICE' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_ADDED', entityId: '8', details: 'RECEIPT' }) }),
    );
  });

  // --- 12. Audit logging on status change / cancellation -------------------

  it('logs PURCHASE_STATUS_CHANGED on a status change and PURCHASE_CANCELLED when cancelled, but never both for one update', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    const existing = {
      id: 8,
      status: 'CONFIRMED',
      paidAmount: 0,
      purchaseType: {},
      requesterDepartment: null,
      buyerEmployee: null,
      purchaseRequest: null,
      supplier: {},
      items: [],
      payments: [],
      documents: [],
    };
    prisma.purchase.findUnique.mockResolvedValue(existing);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.update.mockResolvedValue({ id: 8, status: 'RECEIVED' });

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      status: 'RECEIVED' as never,
      note: undefined,
      items: baseItems,
    } as never;

    await service.update(8, dto, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_STATUS_CHANGED' }) }),
    );

    prisma.auditLog.create.mockClear();
    await service.update(8, { ...dto, status: 'CANCELLED' as never }, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_CANCELLED' }) }),
    );
  });

  // --- Return to Vendor (RTV) ----------------------------------------------

  const returnDto = (items: CreatePurchaseReturnDto['items']): CreatePurchaseReturnDto =>
    ({ returnDate: new Date('2026-09-30'), reason: 'کالای معیوب', note: undefined, items }) as never;

  function setUpReturnablePurchase(prisma: ReturnType<typeof createPrismaMock>, alreadyReturned: number | null) {
    prisma.$queryRaw.mockResolvedValue([{ id: 8 }]);
    prisma.purchaseItem.findMany.mockResolvedValue([{ id: 21, name: 'روغن موتور', quantity: 10 }]);
    prisma.purchaseReturnItem.groupBy.mockResolvedValue(
      alreadyReturned === null ? [] : [{ purchaseItemId: 21, _sum: { quantity: alreadyReturned } }],
    );
  }

  it('creates a valid return against a purchase item, generating an RTN- number and logging PURCHASE_RETURN_CREATED', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    setUpReturnablePurchase(prisma, 7);
    prisma.purchaseReturn.create.mockResolvedValue({ id: 13 });
    prisma.purchaseReturn.update.mockResolvedValue({ id: 13, returnNumber: 'RTN-000013' });

    await expect(
      service.createReturn(8, returnDto([{ purchaseItemId: 21, quantity: 3, creditAmount: 3000 } as never]), 9, undefined),
    ).resolves.toEqual(expect.objectContaining({ returnNumber: 'RTN-000013' }));
  });

  it('rejects a return whose quantity exceeds the original quantity minus what was already returned', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.$queryRaw.mockResolvedValue([{ id: 8 }]);
    prisma.purchaseItem.findMany.mockResolvedValue([]);

    await expect(
      service.createReturn(8, returnDto([{ purchaseItemId: 999, quantity: 1, creditAmount: 100 } as never]), 9, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseReturnItem.groupBy).not.toHaveBeenCalled();
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('rejects a return against a purchase that does not exist', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.createReturn(404, returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), 9, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it('never changes Purchase.totalAmount, paidAmount or paymentStatus when a return is created or deleted', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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

  it('refuses to edit a Purchase that has returns (its items would be recreated out from under them)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseRequest: null });
    prisma.purchaseReturn.count.mockResolvedValue(1);

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      status: 'CLOSED' as never,
      note: undefined,
      items: baseItems,
    } as never;

    await expect(service.update(8, dto, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a Purchase that has returns', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      purchaseRequestId: null,
      _count: { payments: 0, documents: 0, returns: 1 },
    });

    await expect(service.remove(8, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.delete).not.toHaveBeenCalled();
  });

  // --- 13 & 14. Reporting across historical + operational purchases -------

  it('lists both operational and historical purchases together when no sourceType filter is given (single Purchase table)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchase.findMany.mockResolvedValue([]);

    await service.list({});

    const whereArg = prisma.purchase.findMany.mock.calls[0][0].where;
    expect(whereArg.sourceType).toBeUndefined();
  });

  it('filters the purchase list by sourceType when requested (reports: all / operational / historical)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchase.findMany.mockResolvedValue([]);

    await service.list({ sourceType: 'HISTORICAL_IMPORT' });

    const whereArg = prisma.purchase.findMany.mock.calls[0][0].where;
    expect(whereArg.sourceType).toBe('HISTORICAL_IMPORT');
  });

  // --- Pagination (opt-in; plain array stays the default) -----------------

  it('returns one page of purchases plus the total matching count, keeping order and filters', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    const pageRows = [{ id: 30 }, { id: 29 }];
    prisma.purchase.findMany.mockResolvedValue(pageRows);
    prisma.purchase.count.mockResolvedValue(42);

    await expect(service.list({ status: 'DRAFT' }, { page: 2, pageSize: 20 })).resolves.toEqual({
      items: pageRows,
      total: 42,
      page: 2,
      pageSize: 20,
    });

    const findArgs = prisma.purchase.findMany.mock.calls[0][0];
    expect(findArgs).toMatchObject({ skip: 20, take: 20, orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }] });
    expect(findArgs.where.status).toBe('DRAFT');
    // Total is counted over the same filter, not the whole table.
    expect(prisma.purchase.count).toHaveBeenCalledWith({ where: findArgs.where });
  });

  it('returns the full plain array (no skip/take, no count) when pagination is not requested', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findMany.mockResolvedValue([{ id: 1 }]);

    await expect(service.list({})).resolves.toEqual([{ id: 1 }]);
    const findArgs = prisma.purchase.findMany.mock.calls[0][0];
    expect(findArgs.skip).toBeUndefined();
    expect(findArgs.take).toBeUndefined();
    expect(prisma.purchase.count).not.toHaveBeenCalled();
  });

  // --- 15. Existing Purchase records survive the migration -----------------

  it('backfills existing purchases with sourceType = OPERATIONAL and only relaxes department/buyer, touching nothing else', () => {
    const migrationPath = join(
      __dirname,
      '..',
      '..',
      'prisma',
      'migrations',
      '20260922150000_add_purchase_requests_and_source_type',
      'migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    // Every pre-existing row gets a real, non-null default — no purchase is
    // left with an unknown sourceType after the migration runs.
    expect(sql).toMatch(/ADD COLUMN "source_type" "PurchaseSourceType" NOT NULL DEFAULT 'OPERATIONAL'/);
    // purchase_request_id is added as nullable, never backfilled with a
    // fabricated request.
    expect(sql).toMatch(/ADD COLUMN "purchase_request_id" INTEGER;/);
    // Only these two columns lose their NOT NULL constraint — everything
    // else about the existing purchases table (purchaseNumber, items,
    // payments, documents, ...) is untouched by this migration.
    expect(sql).toMatch(/ALTER COLUMN "requester_department_id" DROP NOT NULL/);
    expect(sql).toMatch(/ALTER COLUMN "buyer_employee_id" DROP NOT NULL/);
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
  });
});
