import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { buildSalesInvoicesService, buildSalesReturnsService, createSalesDb, draftOrder, ORDER_DATE, orderLine, VERSION, type SalesDb } from '../sales/sales.spec-helpers';
import { CreditNotesService } from './credit-notes.service';
import { CustomerBalancesService } from './customer-balances.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { PaymentAllocationsService } from './payment-allocations.service';

// Shared fixtures for the Receivables specs. Test-only: excluded from the
// production build via tsconfig.build.json (`**/*.spec-helpers.ts`).
//
// Built on the Sales fake (sales.spec-helpers.ts, itself built on the
// Inventory in-memory fake) — so SalesInvoicesService.applySettlement()
// really runs (invoice paidAmount/paymentStatus and the order's
// paymentStatus are asserted on resulting state, not on which mocks were
// called). CustomerPayment/PaymentAllocation are a small in-memory table of
// their own on top, since neither table exists in the Sales fake.

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export function createReceivablesDb() {
  const db = createSalesDb();
  const salesRaw = db.$queryRaw;

  const state = {
    payments: [] as any[],
    allocations: [] as any[],
    creditNotes: [] as any[],
    nextPaymentId: 101,
    nextAllocationId: 201,
    nextCreditNoteId: 301,
    nextCreditNoteItemId: 3001,
  };

  db.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM customer_payments')) return [{ id: values[0] }];
    if (sql.includes('FROM payment_allocations')) return [{ id: values[0] }];
    if (sql.includes('FROM credit_notes')) return [{ id: values[0] }];
    return salesRaw(strings, ...values);
  });

  function matches(row: any, where: any = {}): boolean {
    for (const [key, condition] of Object.entries(where)) {
      if (key === 'sourcePayment') {
        const payment = state.payments.find((p) => p.id === row.sourcePaymentId);
        if (!payment || !matches(payment, condition)) return false;
        continue;
      }
      if (key === 'sourceCreditNote') {
        const creditNote = state.creditNotes.find((c) => c.id === row.sourceCreditNoteId);
        if (!creditNote || !matches(creditNote, condition)) return false;
        continue;
      }
      if (condition === null) {
        if (row[key] !== null && row[key] !== undefined) return false;
        continue;
      }
      if (typeof condition === 'object' && condition !== null) {
        if ('not' in (condition as any)) {
          const notValue = (condition as any).not;
          if (notValue === null) {
            if (row[key] === null || row[key] === undefined) return false;
          } else if (row[key] === notValue) return false;
          continue;
        }
        if ('gte' in (condition as any) && row[key] < (condition as any).gte) return false;
        if ('lte' in (condition as any) && row[key] > (condition as any).lte) return false;
        continue;
      }
      if (row[key] !== condition) return false;
    }
    return true;
  }

  db.customerPayment = {
    findUnique: jest.fn(async ({ where }: any) => state.payments.find((row) => row.id === where.id) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = state.payments.find((r) => r.id === where.id);
      if (!row) throw new Error('payment not found');
      return row;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => state.payments.filter((row) => matches(row, where))),
    count: jest.fn(async ({ where }: any = {}) => state.payments.filter((row) => matches(row, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: state.nextPaymentId++, updatedAt: VERSION, ...data };
      state.payments.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.payments.find((r) => r.id === where.id);
      if (!row) throw new Error('payment not found');
      Object.assign(row, data);
      return row;
    }),
    aggregate: jest.fn(async ({ where }: any = {}) => {
      const rows = state.payments.filter((row) => matches(row, where));
      const sum = rows.reduce((acc, row) => acc.plus(dec(row.amount)), new Prisma.Decimal(0));
      return { _sum: { amount: rows.length > 0 ? sum : null } };
    }),
  };

  db.paymentAllocation = {
    findUnique: jest.fn(async ({ where }: any) => state.allocations.find((row) => row.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => state.allocations.filter((row) => matches(row, where))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: state.nextAllocationId++, allocatedAt: new Date(), reversedAt: null, reversedByUserId: null, ...data };
      state.allocations.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.allocations.find((r) => r.id === where.id);
      if (!row) throw new Error('allocation not found');
      Object.assign(row, data);
      return row;
    }),
    aggregate: jest.fn(async ({ where }: any = {}) => {
      const rows = state.allocations.filter((row) => matches(row, where));
      const sum = rows.reduce((acc, row) => acc.plus(dec(row.amount)), new Prisma.Decimal(0));
      return { _sum: { amount: rows.length > 0 ? sum : null } };
    }),
  };

  // Credit notes (Sales batch 6) — a flat list, same convention as
  // payments/allocations above (PaymentAllocationsService/
  // CustomerBalancesService read it generically; create() flattens the
  // nested `items.create` shape into a plain array, same as
  // sales.spec-helpers.ts's salesReturn.create()).
  db.creditNote = {
    findUnique: jest.fn(async ({ where }: any) => state.creditNotes.find((row) => row.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => state.creditNotes.filter((row) => matches(row, where))),
    count: jest.fn(async ({ where }: any = {}) => state.creditNotes.filter((row) => matches(row, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const { items, ...header } = data;
      const row = {
        id: state.nextCreditNoteId++,
        updatedAt: VERSION,
        createdAt: VERSION,
        ...header,
        items: (items?.create ?? []).map((item: any) => ({ id: state.nextCreditNoteItemId++, ...item })),
      };
      state.creditNotes.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = state.creditNotes.find((r) => r.id === where.id);
      if (!row) throw new Error('credit note not found');
      Object.assign(row, data);
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const index = state.creditNotes.findIndex((row) => row.id === where.id);
      if (index !== -1) state.creditNotes.splice(index, 1);
    }),
    aggregate: jest.fn(async ({ where }: any = {}) => {
      const rows = state.creditNotes.filter((row) => matches(row, where));
      const sum = rows.reduce((acc, row) => acc.plus(dec(row.totalAmount)), new Prisma.Decimal(0));
      return { _sum: { totalAmount: rows.length > 0 ? sum : null } };
    }),
  };

  db.state.payments = state.payments;
  db.state.allocations = state.allocations;
  db.state.creditNotes = state.creditNotes;
  return db;
}

export type ReceivablesDb = ReturnType<typeof createReceivablesDb>;

export function buildCustomerPaymentsService(db: ReceivablesDb) {
  return new CustomerPaymentsService(db as never, buildSalesInvoicesService(db) as never, new AuditService(db as never));
}

export function buildPaymentAllocationsService(db: ReceivablesDb) {
  return new PaymentAllocationsService(db as never, buildSalesInvoicesService(db) as never, new AuditService(db as never));
}

export function buildCustomerBalancesService(db: ReceivablesDb) {
  return new CustomerBalancesService(db as never, buildSalesInvoicesService(db) as never);
}

export function buildCreditNotesService(db: ReceivablesDb) {
  return new CreditNotesService(
    db as never,
    buildSalesReturnsService(db) as never,
    buildSalesInvoicesService(db) as never,
    buildPaymentAllocationsService(db) as never,
    new AuditService(db as never),
  );
}

export const ACTOR = { userId: 6, ipAddress: '127.0.0.1' };

// A CONFIRMED, posted-invoice world: one POSTED SalesInvoice (total 10,000,
// nothing settled yet) against customer 9's CONFIRMED order — the target of
// most allocation tests. Mirrors sales-invoices.service.spec.ts's `world()`.
export function postedInvoiceWorld(db: ReceivablesDb, overrides: Record<string, unknown> = {}) {
  const order = draftOrder({
    status: 'CONFIRMED',
    orderNumber: 'SO-1405-000001',
    items: [orderLine({ id: 101, lineNo: 1, deliveredQty: dec(5), invoicedQty: dec(5) })],
  });
  const invoice = {
    id: 51,
    invoiceNumber: 'INV-1405-000001',
    sourceType: 'OPERATIONAL',
    customerId: 9,
    salesOrderId: order.id,
    status: 'POSTED',
    totalAmount: dec(10_000),
    paidAmount: dec(0),
    creditedAmount: dec(0),
    paymentStatus: 'UNPAID',
    dueDate: ORDER_DATE,
    invoiceDate: ORDER_DATE,
    updatedAt: VERSION,
    ...overrides,
  };
  db.salesOrder.findUnique.mockImplementation(async () => order);
  db.salesOrder.update.mockImplementation(async ({ data }: any) => Object.assign(order, data));
  db.salesInvoice.findUnique.mockImplementation(async () => invoice);
  db.salesInvoice.update.mockImplementation(async ({ data }: any) => Object.assign(invoice, data));
  return { order, invoice };
}
