import { AuditService } from '../audit/audit.service';
import { CustomersService } from './customers.service';

// Shared fixtures for the Customers specs. Test-only: excluded from the
// production build via tsconfig.build.json (`**/*.spec-helpers.ts`), same
// convention as purchases.spec-helpers.ts.

export function createPrismaMock() {
  const mock = {
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // Optimistic-lock compare-and-set — 1 row = version matched.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    customerGroup: { findUnique: jest.fn() },
    territory: { findUnique: jest.fn() },
    paymentTerm: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    customerContact: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    customerAddress: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    customerNote: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    customerDocument: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    customerComplaint: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    customerFinancialProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    // Search ids / duplicate candidates.
    $queryRaw: jest.fn().mockResolvedValue([]),
    auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
  // Transactions just invoke the callback with the mock itself.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

export function buildCustomersService(prisma: PrismaMock) {
  return new CustomersService(prisma as never, new AuditService(prisma as never));
}

export function buildAudit(prisma: PrismaMock) {
  return new AuditService(prisma as never);
}

export const VERSION = new Date('2026-01-01T10:00:00.000Z');

// A complete get() row (customerDetailInclude shape) with no children.
export const detailRow = {
  id: 5,
  customerNumber: 'CUS-000005',
  customerKind: 'ORGANIZATION',
  name: 'شرکت نمونه',
  legacyCustomerType: 'retail',
  legacyAddress: 'old',
  legacyNote: null,
  updatedAt: VERSION,
  customerGroup: { id: 1 },
  territory: null,
  createdByUser: null,
  contacts: [],
  addresses: [],
  notes: [],
  documents: [],
  complaints: [],
  financialProfile: { creditHold: false, paymentTermId: null },
};

export const validCreateDto = {
  customerKind: 'ORGANIZATION' as const,
  name: 'شرکت نمونه',
  phone: '02112345678',
  customerGroupId: 1,
};
