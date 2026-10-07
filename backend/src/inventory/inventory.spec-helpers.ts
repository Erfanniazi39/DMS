import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';

// Shared fixtures for the Inventory specs (stock-ledger / inventory.service /
// stock-adjustments.service). Test-only: excluded from the production build
// via tsconfig.build.json (`**/*.spec-helpers.ts`).
//
// Instead of bare jest.fn()s for the stock tables, this is a tiny in-memory
// fake of exactly the queries the ledger issues (balance upsert, the
// FOR UPDATE select, balance update, movement insert, the document-sequence
// UPDATE … RETURNING, groupBy for verifyBalances). $transaction snapshots the
// state and restores it if the callback throws — i.e. it behaves like a real
// rollback, so "nothing from the failed batch survives" and "a failed post
// burns no number" can be asserted on actual state, not just on which mocks
// were called.

type FakeBalance = { id: number; itemId: number; locationId: number; onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal };
type FakeMovement = { itemId: number; locationId: number; bucket: string; quantity: Prisma.Decimal; [key: string]: unknown };

const BUCKET_COLUMN = { ON_HAND: 'onHand', RESERVED: 'reserved', QC: 'qc' } as const;

export function createInventoryDb() {
  const state = {
    balances: [] as FakeBalance[],
    movements: [] as FakeMovement[],
    sequences: new Map<string, number>(),
    nextBalanceId: 1,
  };
  // SELECT … FOR UPDATE calls, in order: [itemId, locationId] per call.
  const lockOrder: [number, number][] = [];

  const db: any = {
    state,
    lockOrder,
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM stock_balances')) {
        const [itemId, locationId] = values as [number, number];
        lockOrder.push([itemId, locationId]);
        const balance = state.balances.find((row) => row.itemId === itemId && row.locationId === locationId);
        return balance ? [{ id: balance.id, on_hand: balance.onHand, reserved: balance.reserved, qc: balance.qc }] : [];
      }
      if (sql.includes('document_sequences')) {
        const [docType, fiscalYear] = values as [string, number];
        const key = `${docType}:${fiscalYear}`;
        const next = (state.sequences.get(key) ?? 0) + 1;
        state.sequences.set(key, next);
        return [{ last_value: next }];
      }
      if (sql.includes('FROM stock_adjustments')) return [{ id: values[0] }];
      throw new Error(`Unexpected raw query in fake: ${sql}`);
    }),
    stockBalance: {
      createMany: jest.fn(async ({ data }: { data: { itemId: number; locationId: number }[] }) => {
        let count = 0;
        for (const row of data) {
          if (state.balances.some((b) => b.itemId === row.itemId && b.locationId === row.locationId)) continue;
          const zero = new Prisma.Decimal(0);
          state.balances.push({ id: state.nextBalanceId++, itemId: row.itemId, locationId: row.locationId, onHand: zero, reserved: zero, qc: zero });
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Partial<FakeBalance> }) => {
        const balance = state.balances.find((row) => row.id === where.id);
        if (!balance) throw new Error('balance not found');
        Object.assign(balance, data);
        return balance;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const { itemId, locationId } = where.itemId_locationId;
        return state.balances.find((row) => row.itemId === itemId && row.locationId === locationId) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        state.balances.filter((row) => (!where?.itemId || row.itemId === where.itemId) && (!where?.locationId || row.locationId === where.locationId)),
      ),
      count: jest.fn(async () => state.balances.length),
    },
    stockMovement: {
      createMany: jest.fn(async ({ data }: { data: FakeMovement[] }) => {
        state.movements.push(...data.map((row) => ({ ...row, quantity: new Prisma.Decimal(row.quantity) })));
        return { count: data.length };
      }),
      groupBy: jest.fn(async ({ where }: any = {}) => {
        const sums = new Map<string, { itemId: number; locationId: number; bucket: string; _sum: { quantity: Prisma.Decimal } }>();
        for (const row of state.movements) {
          if (where?.itemId && row.itemId !== where.itemId) continue;
          if (where?.locationId && row.locationId !== where.locationId) continue;
          const key = `${row.itemId}:${row.locationId}:${row.bucket}`;
          const entry = sums.get(key) ?? { itemId: row.itemId, locationId: row.locationId, bucket: row.bucket, _sum: { quantity: new Prisma.Decimal(0) } };
          entry._sum.quantity = entry._sum.quantity.plus(row.quantity);
          sums.set(key, entry);
        }
        return [...sums.values()];
      }),
    },
    item: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, code: `ITM${where.id}`, name: `کالا ${where.id}` })),
      findMany: jest.fn(async ({ where }: any) => (where.id.in as number[]).map((id) => ({ id, status: 'active', name: `کالا ${id}` }))),
    },
    inventoryLocation: {
      findMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 1, code: 'MAIN', isActive: true, isDefault: true }),
      findUnique: jest.fn().mockResolvedValue({ isActive: true }),
    },
    stockAdjustment: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    stockAdjustmentItem: { deleteMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  db.$transaction = jest.fn(async (callback: (tx: unknown) => unknown) => {
    const snapshot = {
      balances: state.balances.map((row) => ({ ...row })),
      movements: [...state.movements],
      sequences: new Map(state.sequences),
      nextBalanceId: state.nextBalanceId,
    };
    try {
      return await callback(db);
    } catch (error) {
      state.balances = snapshot.balances;
      state.movements = snapshot.movements;
      state.sequences = snapshot.sequences;
      state.nextBalanceId = snapshot.nextBalanceId;
      throw error;
    }
  });

  return db;
}

export type InventoryDb = ReturnType<typeof createInventoryDb>;

// Reads a balance from the fake as plain strings, e.g. { onHand: '5' }.
export function balanceOf(db: InventoryDb, itemId: number, locationId = 1) {
  const row = db.state.balances.find((b: FakeBalance) => b.itemId === itemId && b.locationId === locationId);
  if (!row) return null;
  return { onHand: row.onHand.toString(), reserved: row.reserved.toString(), qc: row.qc.toString() };
}

// Puts stock directly into the fake (balance + matching OPENING movement), as
// if an earlier adjustment had been posted.
export function seedStock(db: InventoryDb, itemId: number, onHand: number, locationId = 1) {
  const quantity = new Prisma.Decimal(onHand);
  db.state.balances.push({ id: db.state.nextBalanceId++, itemId, locationId, onHand: quantity, reserved: new Prisma.Decimal(0), qc: new Prisma.Decimal(0) });
  db.state.movements.push({ itemId, locationId, bucket: 'ON_HAND', quantity, movementType: 'OPENING_BALANCE' });
}

export function setBucket(db: InventoryDb, itemId: number, bucket: keyof typeof BUCKET_COLUMN, value: number, locationId = 1) {
  const row = db.state.balances.find((b: FakeBalance) => b.itemId === itemId && b.locationId === locationId);
  row[BUCKET_COLUMN[bucket]] = new Prisma.Decimal(value);
}

export function buildInventoryService(db: InventoryDb) {
  return new InventoryService(db as never);
}

export function buildStockAdjustmentsService(db: InventoryDb) {
  return new StockAdjustmentsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

export const VERSION = new Date('2026-10-01T10:00:00.000Z');
// 2026-10-06 is 1405/07/14 (Jalali year 1405).
export const ADJ_DATE = new Date('2026-10-06T00:00:00.000Z');

export function draftAdjustment(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    adjustmentNumber: null,
    kind: 'RECEIPT',
    status: 'DRAFT',
    locationId: 1,
    location: { isActive: true },
    adjustmentDate: ADJ_DATE,
    reason: 'رسید اولیه',
    note: null,
    updatedAt: VERSION,
    items: [
      { id: 71, itemId: 1, quantity: new Prisma.Decimal(10), note: null },
      { id: 72, itemId: 2, quantity: new Prisma.Decimal(5), note: null },
    ],
    ...overrides,
  };
}
