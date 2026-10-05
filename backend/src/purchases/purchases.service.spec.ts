import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { AuditService } from '../audit/audit.service';
import { join } from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import type { CreatePurchaseDto, CreatePurchaseReturnDto, UpdatePurchaseDto } from './dto/purchase.dto';

// Covers the "Professionalize the Purchase module" architecture task —
// Purchase Request is optional, historical imports never fabricate a
// department/buyer/request, payment status is always derived (never set
// directly), and every listed business event writes one AUDIT_LOG row.

function createPrismaMock() {
  const mock = {
    purchase: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      // Optimistic-lock compare-and-set inside update() — 1 row = version matched.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // groupBy: quantities already purchased against request lines (overage check).
    purchaseItem: { deleteMany: jest.fn(), findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    purchaseType: { findUnique: jest.fn() },
    department: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    purchaseRequest: { findUnique: jest.fn() },
    purchaseRequestItem: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    unit: { count: jest.fn() },
    purchasePayment: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn(), update: jest.fn() },
    purchaseDocument: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), update: jest.fn() },
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

// The version (updatedAt) a client "loaded" — update DTOs send it back and
// the mocked existing row carries the same value, i.e. no concurrent edit.
const VERSION = new Date('2026-01-01T10:00:00.000Z');
// Payment fixtures: a purchase that can take payments (CONFIRMED, dated
// before the payment) — business rules of 2026-10-05.
const PAYABLE = { status: 'CONFIRMED', purchaseDate: new Date('2026-01-01'), updatedAt: VERSION };
const PAY_DATE = new Date('2026-02-01');

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
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
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
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
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
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
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
      updatedAt: VERSION,
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
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 12, status: 'APPROVED' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.update.mockResolvedValue({ id: 8, status: 'CONFIRMED', purchaseRequestId: 12 });

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      purchaseRequestId: 12,
      status: 'CONFIRMED' as never,
      updatedAt: VERSION,
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
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
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
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
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
      updatedAt: VERSION,
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
      updatedAt: VERSION,
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
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, updatedAt: VERSION, purchaseRequest: null });
    prisma.purchaseReturn.count.mockResolvedValue(1);

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      status: 'CLOSED' as never,
      updatedAt: VERSION,
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

  // --- QA pass 2026-10-05: coverage gaps ------------------------------------

  const fullGet = { updatedAt: VERSION, purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };

  function mockActiveMasterData(prisma: ReturnType<typeof createPrismaMock>) {
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
  }

  const updateDto = (status: string, totalPrice: number): UpdatePurchaseDto =>
    ({
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      status: status as never,
      updatedAt: VERSION,
      note: undefined,
      items: [{ name: 'شیر خام', quantity: 10 as never, unitId: 1, totalPrice: totalPrice as never }],
    }) as never;

  it('counts only COMPLETED payments toward paidAmount — PENDING and CANCELLED payments never make a purchase PARTIAL/PAID', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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

  it.each([
    // [new item total, already paid, expected derived status]
    [20000000, 30000000, 'PAID'], // total lowered below what was paid
    [30000000, 30000000, 'PAID'], // exactly paid
    [30000001, 30000000, 'PARTIAL'], // total raised one Rial above paid
  ])('update(): re-derives paymentStatus from the new item total (%d) against the existing paidAmount (%d) → %s', async (total, paid, expected) => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: paid, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await service.update(8, updateDto('CONFIRMED', total), 9, undefined);

    const data = prisma.purchase.update.mock.calls[0][0].data;
    expect(data.totalAmount).toBe(total);
    expect(data.paymentStatus).toBe(expected);
    // paidAmount is owned by the payment recompute, never rewritten by an edit.
    expect(data).not.toHaveProperty('paidAmount');
  });

  it('create(): totalAmount is the sum of line totalPrice values — never quantity × unitPrice', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    mockActiveMasterData(prisma);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await service.create(
      {
        purchaseDate: new Date('2026-01-01') as never,
        purchaseTypeId: 1,
        sourceType: 'OPERATIONAL' as never,
        requesterDepartmentId: 2,
        buyerEmployeeId: 3,
        supplierId: 4,
        items: [
          // 10 × 1000 would be 10000, but a lump-sum discount was billed.
          { name: 'بطری پلاستیکی', quantity: 10 as never, unitId: 1, unitPrice: 1000 as never, totalPrice: 7500 as never },
          // No unit price at all — lump-sum line.
          { name: 'حمل شیر خام', quantity: 1 as never, unitId: 1, totalPrice: 2500 as never },
        ],
      } as never,
      9,
      undefined,
    );

    expect(prisma.purchase.create.mock.calls[0][0].data.totalAmount).toBe(10000);
    // The line items are stored exactly as entered — no recomputed totalPrice.
    expect(prisma.purchase.create.mock.calls[0][0].data.items.create[0].totalPrice).toBe(7500);
  });

  it.each([
    ['payments', { payments: 1, documents: 0, returns: 0 }],
    ['documents', { payments: 0, documents: 1, returns: 0 }],
  ])('refuses to delete a Purchase that has %s, without touching the row or the audit log', async (_label, counts) => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = new PurchasesService(prisma as never, purchaseRequestsService as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, purchaseNumber: 'PUR-000008', purchaseRequestId: 7, _count: counts });

    await expect(service.remove(8, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.delete).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(purchaseRequestsService.recomputeStatus).not.toHaveBeenCalled();
  });

  it('logs PURCHASE_DELETED with the purchase number when an unencumbered purchase is removed', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, purchaseNumber: 'PUR-000008', purchaseRequestId: null, _count: { payments: 0, documents: 0, returns: 0 } });

    await service.remove(8, 9, '127.0.0.1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PURCHASE_DELETED', entityType: 'Purchase', entityId: '8', details: 'PUR-000008', userId: 9 }),
      }),
    );
  });

  it('refuses to remove a payment that belongs to a different purchase', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue(null);

    await expect(service.removePayment(8, 3, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchasePayment.findFirst).toHaveBeenCalledWith({ where: { id: 3, purchaseId: 8 } });
    expect(prisma.purchasePayment.delete).not.toHaveBeenCalled();
  });

  // --- Regression tests for bugs found in QA 2026-10-05 --------------------
  // Originally `it.failing` (reproducing the bug); converted to plain `it`
  // once fixed so they stay in the suite permanently.

  it('KNOWN BUG: a purchase whose supplier was later deactivated can still be cancelled', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, supplierId: 4, ...fullGet });
    mockActiveMasterData(prisma);
    // Same supplier the purchase already had — it was blacklisted after the purchase was made.
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'blacklisted' });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await expect(service.update(8, updateDto('CANCELLED', 10000), 9, undefined)).resolves.toBeDefined();
  });

  it('KNOWN BUG: an inactive Unit is refused on a new purchase item', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    mockActiveMasterData(prisma);
    const units = [{ id: 1, isActive: false }];
    prisma.unit.count.mockImplementation(({ where }: { where: { id: { in: number[] }; isActive?: boolean } }) =>
      Promise.resolve(units.filter((u) => where.id.in.includes(u.id) && (where.isActive === undefined || u.isActive === where.isActive)).length),
    );
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await expect(
      service.create(
        {
          purchaseDate: new Date('2026-01-01') as never,
          purchaseTypeId: 1,
          sourceType: 'OPERATIONAL' as never,
          requesterDepartmentId: 2,
          buyerEmployeeId: 3,
          supplierId: 4,
          items: baseItems,
        } as never,
        9,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('KNOWN BUG: adding a payment and recomputing paidAmount happen in one transaction (no orphan payment on a failed recompute)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.create.mockResolvedValue({ id: 1, purchaseId: 8, amount: 5, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([{ status: 'COMPLETED', amount: 5 }]);

    await service.addPayment(8, { amount: 5, status: 'COMPLETED', paymentDate: PAY_DATE } as never, 9, undefined);

    expect((prisma as any).$transaction).toHaveBeenCalled();
  });

  // --- More QA 2026-10-05 regression coverage ------------------------------

  it('get(): nested buyerEmployee/supplier expose display fields only (no national ID, salary, bank, contract path)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, ...fullGet });

    await service.get(8);

    const include = prisma.purchase.findUnique.mock.calls[0][0].include;
    expect(include.supplier).toEqual({ select: { id: true, code: true, name: true } });
    expect(include.buyerEmployee).toEqual({
      select: { id: true, code: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
    });
  });

  it('removing a payment runs in one transaction with the parent purchase locked', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, totalAmount: 10000, ...fullGet, ...PAYABLE });
    prisma.purchasePayment.findFirst.mockResolvedValue({ id: 1, amount: 4000, status: 'COMPLETED' });
    prisma.purchasePayment.findMany.mockResolvedValue([]);

    await service.removePayment(8, 1, 9, undefined);

    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('a payment that would push paidAmount past Decimal(15,0) is refused with a 400 inside the transaction (no orphan row, no raw 500)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
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

  it('create(): a line total sum beyond Decimal(15,0) is a 400, not a database 500', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    mockActiveMasterData(prisma);
    const line = { name: 'x', quantity: 1 as never, unitId: 1, totalPrice: 999_999_999_999_999 as never };

    await expect(
      service.create({ purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, items: [line, line] } as never, 9, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('update(): an unchanged purchase type / department / buyer is not re-validated, and units already on the purchase may stay even if deactivated', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4,
      ...fullGet, items: [{ id: 1, unitId: 1 }],
    });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await service.update(8, updateDto('CANCELLED', 10000), 9, undefined);

    expect(prisma.purchaseType.findUnique).not.toHaveBeenCalled();
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
    expect(prisma.unit.count).not.toHaveBeenCalled();
  });

  it('update(): switching to a different, inactive supplier is still refused', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 99, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'blacklisted' });

    await expect(service.update(8, updateDto('CONFIRMED', 10000), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  // --- Document files ------------------------------------------------------

  const PDF_BYTES = Buffer.from('%PDF-1.7\n%test\n');

  it('setDocumentFile(): a purchase/document id mismatch is a 404 before anything is written to disk', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchaseDocument.findFirst.mockResolvedValue(null);

    await expect(service.setDocumentFile(8, 77, { originalName: 'a.pdf', buffer: PDF_BYTES }, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseDocument.findFirst).toHaveBeenCalledWith({ where: { id: 77, purchaseId: 8 } });
    expect(prisma.purchaseDocument.update).not.toHaveBeenCalled();
  });

  it.each([
    ['an executable renamed to .pdf', 'invoice.pdf', Buffer.from('MZ\x90\x00binary')],
    ['HTML renamed to .png', 'scan.png', Buffer.from('<html><script>alert(1)</script>')],
    ['a PDF renamed to .jpg', 'photo.jpg', Buffer.from('%PDF-1.4')],
    ['a disallowed extension', 'run.exe', Buffer.from('%PDF-1.4')],
  ])('setDocumentFile(): rejects %s (content must match the extension)', async (_label, originalName, buffer) => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchaseDocument.findFirst.mockResolvedValue({ id: 77, purchaseId: 8, filePath: null, documentType: 'INVOICE' });

    await expect(service.setDocumentFile(8, 77, { originalName, buffer }, 9, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchaseDocument.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('setDocumentFile(): replacing an existing file is audited as DOCUMENT_FILE_REPLACED (first upload: DOCUMENT_FILE_ATTACHED)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    mkdirSync(join(process.cwd(), 'uploads', 'purchases'), { recursive: true });
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, ...fullGet });
    const written: string[] = [];
    prisma.purchaseDocument.update.mockImplementation(({ data }: { data: { filePath: string } }) => {
      written.push(data.filePath);
      return Promise.resolve({});
    });

    try {
      prisma.purchaseDocument.findFirst.mockResolvedValueOnce({ id: 77, purchaseId: 8, filePath: null, documentType: 'INVOICE' });
      await service.setDocumentFile(8, 77, { originalName: 'Invoice.PDF', buffer: PDF_BYTES }, 9, '127.0.0.1');
      expect(written[0]).toMatch(/^\/uploads\/purchases\/[0-9a-f-]{36}\.pdf$/);
      expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_FILE_ATTACHED', entityType: 'Purchase', entityId: '8', userId: 9 }) }),
      );

      prisma.purchaseDocument.findFirst.mockResolvedValueOnce({ id: 77, purchaseId: 8, filePath: written[0], documentType: 'INVOICE' });
      await service.setDocumentFile(8, 77, { originalName: 'scan.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) }, 9, '127.0.0.1');
      expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_FILE_REPLACED', entityId: '8' }) }),
      );
    } finally {
      for (const relative of written) {
        const absolute = join(process.cwd(), relative.replace(/^\//, ''));
        if (existsSync(absolute)) unlinkSync(absolute);
      }
    }
  });

  it.each(['../../.env', '..%2F..%2Fsecret', 'not-a-uuid.pdf', '0b0e0f6e-1111-4222-8333-944455556666.exe'])(
    'resolveDocumentFile(): refuses a filename that is not a stored <uuid>.<pdf|png|jpg|jpeg> name (%s)',
    async (filename) => {
      const prisma = createPrismaMock();
      const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
      (prisma.purchaseDocument as any).findFirst.mockResolvedValue({ id: 1 });

      await expect(service.resolveDocumentFile(filename)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.purchaseDocument.findFirst).not.toHaveBeenCalled();
    },
  );

  it('resolveDocumentFile(): a well-formed name that no PurchaseDocument references is a 404 (orphans are never served)', async () => {
    const prisma = createPrismaMock();
    const service = new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));
    prisma.purchaseDocument.findFirst.mockResolvedValue(null);

    await expect(service.resolveDocumentFile('0b0e0f6e-1111-4222-8333-944455556666.pdf')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseDocument.findFirst).toHaveBeenCalledWith({
      where: { filePath: '/uploads/purchases/0b0e0f6e-1111-4222-8333-944455556666.pdf' },
      select: { id: true },
    });
  });

  // --- Business-owner decisions of 2026-10-05 -------------------------------

  const svc = (prisma: ReturnType<typeof createPrismaMock>) =>
    new PurchasesService(prisma as never, createPurchaseRequestsServiceMock() as never, new AuditService(prisma as never));

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

  it('#4 refuses a return dated before the purchase', async () => {
    const prisma = createPrismaMock();
    setUpReturnablePurchase(prisma, null);

    await expect(
      svc(prisma).createReturn(8, { ...returnDto([{ purchaseItemId: 21, quantity: 1, creditAmount: 100 } as never]), returnDate: new Date('2025-12-31') } as never, 9, undefined),
    ).rejects.toThrow('تاریخ برگشت نمی‌تواند قبل از تاریخ خرید باشد');
  });

  // #5 Linking + overage confirmation
  const linkedCreateDto = (items: unknown[], extra: Record<string, unknown> = {}) =>
    ({ purchaseDate: new Date('2026-01-02'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, purchaseRequestId: 7, items, ...extra }) as never;

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED', 'COMPLETED'])('#5 refuses to link a new purchase to a %s request', async (status) => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status });

    await expect(svc(prisma).create(linkedCreateDto(baseItems), 9, undefined)).rejects.toThrow('خرید فقط به درخواست خرید «تأییدشده» یا «خرید جزئی» قابل اتصال است');
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('#5 an existing purchase keeps its (now COMPLETED) request on edit — only a new/changed link must be APPROVED/PARTIALLY_PURCHASED', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: 7, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'COMPLETED' });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await expect(svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7 } as never, 9, undefined)).resolves.toBeDefined();

    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: null, ...fullGet });
    await expect(svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7 } as never, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
  });

  function mockRequestLine(prisma: ReturnType<typeof createPrismaMock>, requested: number, purchasedElsewhere: number) {
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'PARTIALLY_PURCHASED' });
    prisma.purchaseRequestItem.count.mockResolvedValue(1);
    prisma.purchaseRequestItem.findMany.mockResolvedValue([{ id: 55, name: 'شیر خام', quantity: requested }]);
    prisma.purchaseItem.groupBy.mockResolvedValue(purchasedElsewhere ? [{ purchaseRequestItemId: 55, _sum: { quantity: purchasedElsewhere } }] : []);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6 });
  }

  it('#5 buying more than the request line still needs is refused with a detectable PURCHASE_QUANTITY_EXCEEDS_REQUEST 409 listing each overage', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 60);
    const items = [{ ...baseItems[0], quantity: 50, purchaseRequestItemId: 55 }];

    const error = await svc(prisma).create(linkedCreateDto(items), 9, undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'PURCHASE_QUANTITY_EXCEEDS_REQUEST',
      details: { overages: [{ purchaseRequestItemId: 55, name: 'شیر خام', requested: 100, alreadyPurchased: 60, remaining: 40, purchasing: 50, excess: 10 }] },
    });
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('#5 the same overage is accepted once the user confirms it (confirmOverage: true); exactly the remaining quantity needs no confirmation', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 60);

    await expect(svc(prisma).create(linkedCreateDto([{ ...baseItems[0], quantity: 50, purchaseRequestItemId: 55 }], { confirmOverage: true }), 9, undefined)).resolves.toBeDefined();
    await expect(svc(prisma).create(linkedCreateDto([{ ...baseItems[0], quantity: 40, purchaseRequestItemId: 55 }]), 9, undefined)).resolves.toBeDefined();
  });

  it('#5 on update, the purchase being edited is excluded from "already purchased" (re-saving it never counts its own quantity twice)', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 0);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: 7, ...fullGet });

    await svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7, items: [{ ...baseItems[0], quantity: 100, purchaseRequestItemId: 55 }] } as never, 9, undefined);

    expect(prisma.purchaseItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { purchaseRequestItemId: { in: [55] }, purchase: { status: { not: 'CANCELLED' }, id: { not: 8 } } } }),
    );
  });

  // #6 Zero total
  it('#6 refuses a purchase whose item totals sum to 0 (create and update)', async () => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    const zeroItems = [{ ...baseItems[0], totalPrice: 0 }];

    await expect(
      svc(prisma).create({ purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, items: zeroItems } as never, 9, undefined),
    ).rejects.toThrow('جمع مبلغ اقلام خرید باید بیشتر از صفر باشد');
    expect(prisma.purchase.create).not.toHaveBeenCalled();

    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet });
    await expect(svc(prisma).update(8, updateDto('CONFIRMED', 0), 9, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
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

  // #10 Returns block cancelling too
  it('#10 a purchase with returns cannot be CANCELLED either (cancel goes through the same guarded update())', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'RECEIVED', paidAmount: 0, ...fullGet });
    prisma.purchaseReturn.count.mockResolvedValue(2);

    await expect(svc(prisma).update(8, updateDto('CANCELLED', 10000), 9, undefined)).rejects.toThrow(/برگشت به تأمین‌کننده ثبت شده است/);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // #12 Optimistic locking
  it('#12 refuses an edit made against a stale version with a 409 RECORD_MODIFIED (never silently overwrites)', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet, updatedAt: new Date('2026-01-01T10:05:00.000Z') });
    mockActiveMasterData(prisma);

    const error = await svc(prisma).update(8, updateDto('CONFIRMED', 10000), 9, undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'RECORD_MODIFIED' });
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  it('#12 the version check is repeated atomically in the transaction (compare-and-set on updatedAt) — a save that lands in between loses', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchase.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc(prisma).update(8, updateDto('CONFIRMED', 10000), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, updatedAt: VERSION } }));
    expect(prisma.purchaseItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  // --- New purchases default to CONFIRMED (business decision 2026-10-05) ---

  it.each(['CONFIRMED', 'DRAFT'])('create() writes the DTO\'s resolved status (%s) explicitly, never relying on the column default', async (status) => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await svc(prisma).create(
      { purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, status, items: baseItems } as never,
      9,
      undefined,
    );

    expect(prisma.purchase.create.mock.calls[0][0].data.status).toBe(status);
  });

  it('create(): the zero-total rule still applies whatever creation status is chosen', async () => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    for (const status of ['CONFIRMED', 'DRAFT']) {
      await expect(
        svc(prisma).create(
          { purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, status, items: [{ ...baseItems[0], totalPrice: 0 }] } as never,
          9,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });
});

