import { AuditService } from '../audit/audit.service';
import { PurchaseQuantitiesService } from './purchase-quantities.service';
import { PurchasesService } from './purchases.service';
import { PurchasePaymentsService } from './purchase-payments.service';
import { PurchaseDocumentsService } from './purchase-documents.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import type { CreatePurchaseDto } from './dto/purchase.dto';

// Shared fixtures for the Purchases specs (purchases.service.spec.ts,
// purchase-payments/-documents/-returns.service.spec.ts). Test-only: excluded
// from the production build via tsconfig.build.json (`**/*.spec-helpers.ts`).
//
// Every service is built over ONE Prisma mock, exactly as before the service
// split — e.g. a payment test's prisma.purchase.findUnique mock answers both
// the payment lock read and the PurchasesService.get() detail response.

export function createPrismaMock() {
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
    // Row lock taken on the parent Purchase inside createReturn()'s /
    // the payment methods' transaction — the mock just reports whether
    // that row exists.
    $queryRaw: jest.fn(),
    auditLog: { create: jest.fn() },
  };
  // create()/update() run inside a $transaction — the mock just invokes the
  // callback with itself, same convention as employees.service.spec.ts.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

// PurchasesService only calls recomputeStatus() on this — never any of
// PurchaseRequestsService's own CRUD methods (those stay untouched user
// edits). A plain jest.fn() double is enough.
export function createPurchaseRequestsServiceMock() {
  return { recomputeStatus: jest.fn() };
}

// PurchaseQuantitiesService is the real one over the same mock, so the
// overage tests exercise its actual query (purchaseItem.groupBy).
export function buildPurchasesService(prisma: PrismaMock, purchaseRequestsService = createPurchaseRequestsServiceMock()) {
  return new PurchasesService(
    prisma as never,
    purchaseRequestsService as never,
    new AuditService(prisma as never),
    new PurchaseQuantitiesService(prisma as never),
  );
}

export function buildPaymentsService(prisma: PrismaMock) {
  return new PurchasePaymentsService(prisma as never, buildPurchasesService(prisma), new AuditService(prisma as never));
}

export function buildDocumentsService(prisma: PrismaMock) {
  return new PurchaseDocumentsService(prisma as never, buildPurchasesService(prisma), new AuditService(prisma as never));
}

export function buildReturnsService(prisma: PrismaMock) {
  return new PurchaseReturnsService(prisma as never, new AuditService(prisma as never));
}

// The version (updatedAt) a client "loaded" — update DTOs send it back and
// the mocked existing row carries the same value, i.e. no concurrent edit.
export const VERSION = new Date('2026-01-01T10:00:00.000Z');
// Payment fixtures: a purchase that can take payments (CONFIRMED, dated
// before the payment) — business rules of 2026-10-05.
export const PAYABLE = { status: 'CONFIRMED', purchaseDate: new Date('2026-01-01'), updatedAt: VERSION };
export const PAY_DATE = new Date('2026-02-01');

export const baseItems: CreatePurchaseDto['items'] = [
  { name: 'روغن موتور', quantity: 10 as never, unitId: 1, unitPrice: 1000 as never, totalPrice: 10000 as never },
];

// A complete get() row (purchaseDetailInclude shape) with no relations.
export const fullGet = { updatedAt: VERSION, purchaseType: {}, requesterDepartment: null, buyerEmployee: null, purchaseRequest: null, supplier: {}, items: [], payments: [], documents: [] };

export function mockActiveMasterData(prisma: PrismaMock) {
  prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
  prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
  prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
  prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
  prisma.unit.count.mockResolvedValue(1);
}
