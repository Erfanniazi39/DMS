import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { createInventoryDb } from '../inventory/inventory.spec-helpers';
import { DeliveriesService } from './deliveries.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersService, type SalesActor } from './sales-orders.service';
import { SalesReturnsService } from './sales-returns.service';

// Shared fixtures for the Sales specs. Test-only: excluded from the
// production build via tsconfig.build.json (`**/*.spec-helpers.ts`).
//
// Built on the Inventory in-memory fake (inventory.spec-helpers.ts), so
// reservations/releases really go through stock-ledger.ts and are asserted
// on balance/movement state, and $transaction really rolls back stock AND
// the document-sequence counter on failure (gap-freedom is checked on state,
// not on which mocks were called). Sales/Customer tables are plain jest
// mocks on top.

export const VERSION = new Date('2026-10-01T10:00:00.000Z');
// 2026-10-06 is 1405/07/14 (Jalali year 1405).
export const ORDER_DATE = new Date('2026-10-06T00:00:00.000Z');

export const SALESPERSON: SalesActor = { userId: 5, ipAddress: '127.0.0.1', canApprove: false, canViewCredit: false };
export const MANAGER: SalesActor = { userId: 2, ipAddress: '127.0.0.1', canApprove: true, canViewCredit: true };

// Item catalog the fake's item.findMany answers from.
export const CATALOG: Record<number, { id: number; code: string; name: string; status: string; sellingPrice: Prisma.Decimal | null; unitId: number; unit: { nameFa: string } }> = {
  1: { id: 1, code: 'ITM-1', name: 'شیر', status: 'active', sellingPrice: new Prisma.Decimal(1000), unitId: 1, unit: { nameFa: 'عدد' } },
  2: { id: 2, code: 'ITM-2', name: 'ماست', status: 'active', sellingPrice: null, unitId: 1, unit: { nameFa: 'عدد' } },
  3: { id: 3, code: 'ITM-3', name: 'پنیر', status: 'inactive', sellingPrice: new Prisma.Decimal(500), unitId: 1, unit: { nameFa: 'عدد' } },
};

export function createSalesDb() {
  const db = createInventoryDb();
  const inventoryRaw = db.$queryRaw;
  db.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM sales_orders')) return [{ id: values[0] }];
    if (sql.includes('FROM deliveries')) return [{ id: values[0] }];
    if (sql.includes('FROM sales_invoices')) return [{ id: values[0] }];
    if (sql.includes('FROM sales_returns')) return [{ id: values[0] }];
    if (sql.includes('FROM customer_financial_profiles')) return [{ id: 1 }];
    return inventoryRaw(strings, ...values);
  });

  db.item.findMany = jest.fn(async ({ where }: any) => (where.id.in as number[]).map((id) => CATALOG[id]).filter(Boolean));
  db.salesOrder = {
    // Also answers sales-credit.ts computeExposure() (no exposure by default).
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(async ({ data }: any) => ({ id: 11, ...data })),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
  };
  db.salesOrderItem = { update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
  db.delivery = {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(async ({ data }: any) => ({ id: 31, ...data })),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn(),
  };
  db.deliveryItem = { deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() };
  db.salesInvoice = {
    // Also answers listOpenInvoices() (no open invoices by default).
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(async ({ data }: any) => ({ id: 51, ...data })),
    update: jest.fn(),
    delete: jest.fn(),
  };
  db.salesInvoiceItem = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
  };
  // Sales batch 6 — Returns. `create` echoes the input (items.create → a
  // plain array) so a test's own world() helper can take over findUnique
  // for a mutable, lockable fixture — same convention as salesOrder/delivery
  // above.
  db.salesReturn = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(async ({ data }: any) => ({ id: 71, ...data, items: (data.items?.create ?? []).map((item: any, index: number) => ({ id: 701 + index, ...item })) })),
    update: jest.fn(),
    delete: jest.fn(),
  };
  db.salesReturnItem = { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
  // One object answers both ensureTransactableCustomer()'s select and the
  // snapshot select.
  db.customer = {
    findUnique: jest.fn().mockResolvedValue({ id: 9, status: 'ACTIVE', name: 'فروشگاه نمونه', economicCode: '411', financialProfile: { creditHold: false } }),
    findMany: jest.fn(),
  };
  db.customerFinancialProfile = {
    findUnique: jest.fn().mockResolvedValue({ creditLimit: new Prisma.Decimal(10_000_000), creditHold: false, paymentTerm: { id: 4, nameFa: '۳۰ روزه', dueDays: 30 } }),
  };
  db.customerAddress = { findFirst: jest.fn(), findMany: jest.fn() };
  db.employee = { findUnique: jest.fn().mockResolvedValue({ status: 'active' }), findMany: jest.fn() };
  return db;
}

export type SalesDb = ReturnType<typeof createSalesDb>;

export function buildSalesOrdersService(db: SalesDb) {
  return new SalesOrdersService(db as never, new InventoryService(db as never), new AuditService(db as never));
}

export function buildDeliveriesService(db: SalesDb) {
  return new DeliveriesService(db as never, new InventoryService(db as never), new AuditService(db as never));
}

export function buildSalesInvoicesService(db: SalesDb) {
  return new SalesInvoicesService(db as never, new AuditService(db as never));
}

export function buildSalesReturnsService(db: SalesDb) {
  return new SalesReturnsService(db as never, new AuditService(db as never));
}

export function setCreditPolicy(db: SalesDb, policy: { creditLimit: number | null; creditHold?: boolean }) {
  db.customerFinancialProfile.findUnique.mockResolvedValue({
    creditLimit: policy.creditLimit === null ? null : new Prisma.Decimal(policy.creditLimit),
    creditHold: policy.creditHold ?? false,
    paymentTerm: null,
  });
}

export function orderLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    lineNo: 1,
    itemId: 1,
    itemCode: 'ITM-1',
    itemName: 'شیر',
    unitId: 1,
    unitName: 'عدد',
    quantity: new Prisma.Decimal(5),
    listUnitPrice: new Prisma.Decimal(1000),
    unitPrice: new Prisma.Decimal(1000),
    priceOverrideReason: null,
    discountPercent: null,
    discountAmount: new Prisma.Decimal(0),
    taxRate: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    lineTotal: new Prisma.Decimal(5000),
    reservedQty: new Prisma.Decimal(0),
    deliveredQty: new Prisma.Decimal(0),
    invoicedQty: new Prisma.Decimal(0),
    returnedQty: new Prisma.Decimal(0),
    note: null,
    ...overrides,
  };
}

export function draftOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    orderNumber: null,
    orderDate: ORDER_DATE,
    customerId: 9,
    customerName: 'فروشگاه نمونه',
    deliveryAddressId: null,
    salespersonEmployeeId: null,
    locationId: 1,
    location: { isActive: true },
    status: 'DRAFT',
    paymentStatus: 'UNPAID',
    totalAmount: new Prisma.Decimal(5000),
    updatedAt: VERSION,
    items: [orderLine()],
    // Posted invoices (recomputeOrderProgress reads them for paymentStatus).
    invoices: [],
    ...overrides,
  };
}

// findUnique returns the current order on every read (the locked load and
// the final get()); update() merges into it so get() sees the new status.
export function mockOrder(db: SalesDb, order: Record<string, unknown> = draftOrder()) {
  let current: any = order;
  db.salesOrder.findUnique.mockImplementation(async () => current);
  db.salesOrder.update.mockImplementation(async ({ data }: any) => {
    current = { ...current, ...data };
    return current;
  });
  return () => current;
}

export const validCreateDto = {
  orderDate: ORDER_DATE,
  customerId: 9,
  items: [{ itemId: 1, quantity: 5, unitPrice: 1000 }],
};
