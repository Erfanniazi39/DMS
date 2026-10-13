import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { InventoryItemSettingsService } from './inventory-item-settings.service';
import { InventoryReportsService } from './inventory-reports.service';
import { InventoryService } from './inventory.service';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { GoodsReturnsService } from './goods-returns.service';
import { ProductionOutputsService } from './production-outputs.service';
import { StockCountsService } from './stock-counts.service';

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
//
// I4 (build plan §5.4/§5.4a) adds: $executeRaw (the per-item advisory lock),
// inventoryItemSetting / stockBatch / stockBatchBalance fake tables, and the
// stock_batch_balances raw-query shapes applyMovements()/issueForDelivery()
// use. No single raw statement here mentions both stock_balances and
// stock_batch_balances (§5.4a R8 — would break this fake's substring match).

type FakeBalance = { id: number; itemId: number; locationId: number; onHand: Prisma.Decimal; reserved: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal };
type FakeMovement = { itemId: number; locationId: number; bucket: string; quantity: Prisma.Decimal; batchId?: number | null; createdAt?: Date; [key: string]: unknown };
type FakeItemSetting = {
  itemId: number;
  batchTracked: boolean;
  expiryRequired: boolean;
  shelfLifeDays: number | null;
  batchTrackedSince: Date | null;
  updatedByUserId: number | null;
  updatedAt: Date;
};
type FakeBatch = {
  id: number;
  itemId: number;
  batchNumber: string;
  productionDate: Date | null;
  expiryDate: Date | null;
  note: string | null;
  createdByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
};
type FakeBatchBalance = { id: number; batchId: number; itemId: number; locationId: number; onHand: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal };
// I8: minimal shape GoodsReturnsService.validateReceiptCaps() needs.
type FakeGoodsReceiptItem = { id: number; itemId: number; quantity: Prisma.Decimal; releasedQty: Prisma.Decimal; rejectedQty: Prisma.Decimal; returnedQty: Prisma.Decimal };

// I8: DAMAGED joins ON_HAND/RESERVED/QC — setBucket() below stays additive
// (existing ON_HAND/RESERVED/QC callers are unaffected).
const BUCKET_COLUMN = { ON_HAND: 'onHand', RESERVED: 'reserved', QC: 'qc', DAMAGED: 'damaged' } as const;

export function createInventoryDb() {
  const state = {
    balances: [] as FakeBalance[],
    movements: [] as FakeMovement[],
    sequences: new Map<string, number>(),
    nextBalanceId: 1,
    itemSettings: [] as FakeItemSetting[],
    batches: [] as FakeBatch[],
    batchBalances: [] as FakeBatchBalance[],
    nextBatchId: 1,
    nextBatchBalanceId: 1,
    // I5: Item.itemKind per item id — FINISHED_GOOD unless set via
    // setItemKind() (the real column's default).
    itemKinds: new Map<number, string>(),
    // I8: GoodsReceiptItem rows, for GoodsReturnsService's receipt-item cap
    // check (validateReceiptCaps()) — both its plain findUnique() read
    // (create/update) and its FOR UPDATE raw-SQL read (posting).
    goodsReceiptItems: [] as FakeGoodsReceiptItem[],
    nextGoodsReceiptItemId: 1,
  };
  // SELECT … FOR UPDATE calls, in order: [itemId, locationId] per call.
  const lockOrder: [number, number][] = [];
  // pg_advisory_xact_lock(_shared) calls, in order: [namespace, itemId].
  const advisoryLockOrder: [number, number][] = [];
  // Batch-balance FOR UPDATE calls, in order: [batchId, locationId].
  const batchLockOrder: [number, number][] = [];

  const db: any = {
    state,
    lockOrder,
    advisoryLockOrder,
    batchLockOrder,
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('pg_advisory_xact_lock')) {
        advisoryLockOrder.push(values as [number, number]);
        return 0;
      }
      throw new Error(`Unexpected executeRaw in fake: ${sql}`);
    }),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM stock_batch_balances')) {
        if (sql.includes('WHERE batch_id')) {
          const [batchId, locationId] = values as [number, number];
          batchLockOrder.push([batchId, locationId]);
          const row = state.batchBalances.find((b) => b.batchId === batchId && b.locationId === locationId);
          return row ? [{ id: row.id, on_hand: row.onHand, qc: row.qc, damaged: row.damaged }] : [];
        }
        if (sql.includes('WHERE item_id')) {
          const [itemId, locationId] = values as [number, number];
          const rows = state.batchBalances
            .filter((b) => b.itemId === itemId && b.locationId === locationId && b.onHand.greaterThan(0))
            .sort((a, b) => a.batchId - b.batchId);
          return rows.map((r) => ({ batch_id: r.batchId, on_hand: r.onHand }));
        }
        throw new Error(`Unexpected stock_batch_balances raw query in fake: ${sql}`);
      }
      if (sql.includes('FROM stock_balances')) {
        // BATCH_CUTOVER's item-wide lock (StockAdjustmentsService
        // postBatchCutover()): WHERE item_id = ? ORDER BY location_id ASC
        // FOR UPDATE — no "location_id =" predicate, distinguishing it from
        // every other single-pair query below.
        if (!sql.includes('location_id =')) {
          const [itemId] = values as [number];
          const rows = state.balances.filter((row) => row.itemId === itemId).sort((a, b) => a.locationId - b.locationId);
          return rows.map((row) => ({ location_id: row.locationId, on_hand: row.onHand, qc: row.qc }));
        }
        const [itemId, locationId] = values as [number, number];
        lockOrder.push([itemId, locationId]);
        const balance = state.balances.find((row) => row.itemId === itemId && row.locationId === locationId);
        return balance ? [{ id: balance.id, on_hand: balance.onHand, reserved: balance.reserved, qc: balance.qc, damaged: balance.damaged }] : [];
      }
      if (sql.includes('document_sequences')) {
        const [docType, fiscalYear] = values as [string, number];
        const key = `${docType}:${fiscalYear}`;
        const next = (state.sequences.get(key) ?? 0) + 1;
        state.sequences.set(key, next);
        return [{ last_value: next }];
      }
      if (sql.includes('FROM stock_adjustments')) return [{ id: values[0] }];
      // I5: the inbound documents' own FOR UPDATE row locks.
      if (sql.includes('FROM goods_receipts')) return [{ id: values[0] }];
      if (sql.includes('FROM production_outputs')) return [{ id: values[0] }];
      // I6: the stock count's own FOR UPDATE row lock.
      if (sql.includes('FROM stock_counts')) return [{ id: values[0] }];
      // I8: the goods-return's own FOR UPDATE row lock, and the receipt-item
      // cap check's own lock (GoodsReturnsService.validateReceiptCaps()).
      if (sql.includes('FROM goods_returns')) return [{ id: values[0] }];
      if (sql.includes('FROM goods_receipt_items')) {
        const [id] = values as [number];
        const row = state.goodsReceiptItems.find((r) => r.id === id);
        return row
          ? [{ item_id: row.itemId, quantity: row.quantity, released_qty: row.releasedQty, rejected_qty: row.rejectedQty, returned_qty: row.returnedQty }]
          : [];
      }
      throw new Error(`Unexpected raw query in fake: ${sql}`);
    }),
    stockBalance: {
      createMany: jest.fn(async ({ data }: { data: { itemId: number; locationId: number }[] }) => {
        let count = 0;
        for (const row of data) {
          if (state.balances.some((b) => b.itemId === row.itemId && b.locationId === row.locationId)) continue;
          const zero = new Prisma.Decimal(0);
          state.balances.push({ id: state.nextBalanceId++, itemId: row.itemId, locationId: row.locationId, onHand: zero, reserved: zero, qc: zero, damaged: zero });
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
        state.movements.push(...data.map((row) => ({ createdAt: new Date(), ...row, quantity: new Prisma.Decimal(row.quantity) })));
        return { count: data.length };
      }),
      // Overridable per test (getStockCard / listMovements specs) — the
      // default answers from the same in-memory state the ledger writes to.
      // I6: itemId may also be `{ in: number[] }` (the stale-line check),
      // and createdAt may be `{ gt: Date }` (same check's anchor comparison).
      findMany: jest.fn(async ({ where, skip, take }: any = {}) => {
        const matchesItemId = (row: FakeMovement) => {
          if (where?.itemId === undefined) return true;
          if (typeof where.itemId === 'object' && where.itemId !== null && 'in' in where.itemId) {
            return (where.itemId.in as number[]).includes(row.itemId);
          }
          return row.itemId === where.itemId;
        };
        const matchesCreatedAt = (row: FakeMovement) => {
          if (where?.createdAt === undefined) return true;
          const gt = where.createdAt.gt as Date | undefined;
          return gt === undefined || (row.createdAt !== undefined && row.createdAt.getTime() > gt.getTime());
        };
        const rows = state.movements.filter(
          (row) =>
            matchesItemId(row) &&
            matchesCreatedAt(row) &&
            (!where?.locationId || row.locationId === where.locationId) &&
            (!where?.referenceType || row.referenceType === where.referenceType) &&
            (where?.referenceId === undefined || row.referenceId === where.referenceId) &&
            (where?.referenceLineId === undefined || row.referenceLineId === where.referenceLineId) &&
            (!where?.bucket || row.bucket === where.bucket) &&
            (!where?.movementType || row.movementType === where.movementType),
        );
        return typeof skip === 'number' || typeof take === 'number' ? rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length)) : rows;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) =>
        state.movements.find((row) => (!where?.itemId || row.itemId === where.itemId)) ?? null,
      ),
      count: jest.fn(async () => state.movements.length),
      // Generic over `by` (defaults to the pre-I4 ['itemId','locationId','bucket']
      // shape) so verifyBalances()'s I4 batch-mismatch query (grouping by
      // batchId too, filtered to `batchId: { not: null }`) is answered by the
      // same fake, not a second one (§5.4a R8/build plan §16 step 1).
      groupBy: jest.fn(async ({ by, where }: any = {}) => {
        const fields: string[] = by ?? ['itemId', 'locationId', 'bucket'];
        const matches = (row: FakeMovement) => {
          if (where?.itemId !== undefined && row.itemId !== where.itemId) return false;
          if (where?.locationId !== undefined && row.locationId !== where.locationId) return false;
          if (where?.batchId !== undefined) {
            const hasBatch = row.batchId !== null && row.batchId !== undefined;
            if (where.batchId && typeof where.batchId === 'object' && where.batchId.not === null) {
              if (!hasBatch) return false;
            } else if (typeof where.batchId === 'number') {
              if (row.batchId !== where.batchId) return false;
            }
          }
          return true;
        };
        const sums = new Map<string, Record<string, unknown> & { _sum: { quantity: Prisma.Decimal } }>();
        for (const row of state.movements) {
          if (!matches(row)) continue;
          const key = fields.map((field) => String((row as Record<string, unknown>)[field] ?? 'null')).join(':');
          const entry =
            sums.get(key) ??
            ({
              ...Object.fromEntries(fields.map((field) => [field, (row as Record<string, unknown>)[field] ?? null])),
              _sum: { quantity: new Prisma.Decimal(0) },
            } as Record<string, unknown> & { _sum: { quantity: Prisma.Decimal } });
          entry._sum.quantity = entry._sum.quantity.plus(row.quantity);
          sums.set(key, entry);
        }
        return [...sums.values()];
      }),
    },
    item: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, code: `ITM${where.id}`, name: `کالا ${where.id}` })),
      findMany: jest.fn(async ({ where }: any) =>
        (where.id.in as number[]).map((id) => ({ id, status: 'active', name: `کالا ${id}`, itemKind: state.itemKinds.get(id) ?? 'FINISHED_GOOD' })),
      ),
    },
    // I5: inbound-document tables are plain mocks (same convention as
    // stockAdjustment above) — each spec wires findUnique/update to a
    // mutable "current" document; the stock side stays the in-memory fake.
    goodsReceipt: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    // I8: findUnique/update have real default behaviour over
    // state.goodsReceiptItems (GoodsReturnsService's own needs) — goods
    // receipt specs override `update` per-test via mockReceipt(), which
    // replaces this default, so it never affects them.
    goodsReceiptItem: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = state.goodsReceiptItems.find((r) => r.id === where.id);
        return row ? { id: row.id, itemId: row.itemId, quantity: row.quantity, releasedQty: row.releasedQty, rejectedQty: row.rejectedQty, returnedQty: row.returnedQty } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.goodsReceiptItems.find((r) => r.id === where.id);
        if (!row) throw new Error('goodsReceiptItem not found');
        if (data.returnedQty?.increment !== undefined) row.returnedQty = row.returnedQty.plus(data.returnedQty.increment);
        if (data.rejectedQty?.increment !== undefined) row.rejectedQty = row.rejectedQty.plus(data.rejectedQty.increment);
        if (data.releasedQty?.increment !== undefined) row.releasedQty = row.releasedQty.plus(data.releasedQty.increment);
        return row;
      }),
    },
    productionOutput: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    productionOutputItem: { deleteMany: jest.fn(), update: jest.fn() },
    // I6: stock counts are plain mocks too (same convention as goodsReceipt/
    // productionOutput above) — each spec wires findUnique/update to a
    // mutable "current" document via mockCount() below.
    stockCount: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    stockCountItem: { deleteMany: jest.fn(), update: jest.fn(), createMany: jest.fn() },
    // I8: goods returns are plain mocks too (same convention as goodsReceipt/
    // stockCount above) — each spec wires findUnique/update to a mutable
    // "current" document.
    goodsReturn: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    goodsReturnItem: { deleteMany: jest.fn() },
    purchaseReturn: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 5, name: 'تأمین‌کننده نمونه', status: 'active' }), findMany: jest.fn() },
    purchase: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 9, status: 'active' }), findMany: jest.fn() },
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
    // I3: empty by default (no configured thresholds) — tests that need
    // low-stock behaviour override this per-test, same convention as
    // stockBalance.findMany above.
    itemStockLevel: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    // I4: empty by default (no row = untracked, the real table's whole-row
    // default) — tests that need batch tracking call trackItem() below.
    inventoryItemSetting: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        const ids: number[] | undefined = where?.itemId?.in;
        return state.itemSettings.filter((row) => !ids || ids.includes(row.itemId));
      }),
      findUnique: jest.fn(async ({ where }: any) => state.itemSettings.find((row) => row.itemId === where.itemId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = state.itemSettings.find((row) => row.itemId === where.itemId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created: FakeItemSetting = {
          itemId: where.itemId,
          batchTracked: false,
          expiryRequired: false,
          shelfLifeDays: null,
          batchTrackedSince: null,
          updatedByUserId: null,
          updatedAt: new Date(),
          ...create,
        };
        state.itemSettings.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = state.itemSettings.find((row) => row.itemId === where.itemId);
        if (!existing) throw new Error('inventoryItemSetting not found');
        Object.assign(existing, data);
        return existing;
      }),
    },
    stockBatch: {
      findFirst: jest.fn(async ({ where }: any) => state.batches.find((b) => b.itemId === where.itemId && b.batchNumber === where.batchNumber) ?? null),
      findUnique: jest.fn(async ({ where }: any) => state.batches.find((b) => b.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => {
        const ids: number[] | undefined = where?.id?.in;
        return state.batches.filter((b) => (!ids || ids.includes(b.id)) && (!where?.itemId || b.itemId === where.itemId));
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: FakeBatch = {
          id: state.nextBatchId++,
          itemId: data.itemId,
          batchNumber: data.batchNumber,
          productionDate: data.productionDate ?? null,
          expiryDate: data.expiryDate ?? null,
          note: data.note ?? null,
          createdByUserId: data.createdByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.batches.push(row);
        return row;
      }),
    },
    stockBatchBalance: {
      createMany: jest.fn(async ({ data }: { data: { batchId: number; itemId: number; locationId: number }[] }) => {
        let count = 0;
        for (const row of data) {
          if (state.batchBalances.some((b) => b.batchId === row.batchId && b.locationId === row.locationId)) continue;
          state.batchBalances.push({ id: state.nextBatchBalanceId++, batchId: row.batchId, itemId: row.itemId, locationId: row.locationId, onHand: new Prisma.Decimal(0), qc: new Prisma.Decimal(0), damaged: new Prisma.Decimal(0) });
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Partial<FakeBatchBalance> }) => {
        const row = state.batchBalances.find((b) => b.id === where.id);
        if (!row) throw new Error('batch balance not found');
        Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        state.batchBalances.filter(
          (row) =>
            (where?.itemId === undefined || row.itemId === where.itemId) &&
            (where?.locationId === undefined || row.locationId === where.locationId) &&
            // I6: readCurrentOnHand()/requestRecount() look up a specific batch.
            (where?.batchId === undefined || row.batchId === where.batchId) &&
            (!where?.onHand?.gt || row.onHand.greaterThan(where.onHand.gt)),
        ),
      ),
    },
    auditLog: { create: jest.fn() },
  };

  db.$transaction = jest.fn(async (callback: (tx: unknown) => unknown) => {
    const snapshot = {
      balances: state.balances.map((row) => ({ ...row })),
      movements: [...state.movements],
      sequences: new Map(state.sequences),
      nextBalanceId: state.nextBalanceId,
      itemSettings: state.itemSettings.map((row) => ({ ...row })),
      batches: state.batches.map((row) => ({ ...row })),
      batchBalances: state.batchBalances.map((row) => ({ ...row })),
      nextBatchId: state.nextBatchId,
      nextBatchBalanceId: state.nextBatchBalanceId,
      // I8: a failed GoodsReturn post() must not leave a partial
      // returnedQty/rejectedQty increment behind either.
      goodsReceiptItems: state.goodsReceiptItems.map((row) => ({ ...row })),
    };
    try {
      return await callback(db);
    } catch (error) {
      state.balances = snapshot.balances;
      state.movements = snapshot.movements;
      state.sequences = snapshot.sequences;
      state.nextBalanceId = snapshot.nextBalanceId;
      state.itemSettings = snapshot.itemSettings;
      state.batches = snapshot.batches;
      state.batchBalances = snapshot.batchBalances;
      state.nextBatchId = snapshot.nextBatchId;
      state.nextBatchBalanceId = snapshot.nextBatchBalanceId;
      state.goodsReceiptItems = snapshot.goodsReceiptItems;
      throw error;
    }
  });

  return db;
}

export type InventoryDb = ReturnType<typeof createInventoryDb>;

// Reads a balance from the fake as plain strings, e.g. { onHand: '5' }.
// Deliberately NOT extended with `damaged` (I8) — many existing specs assert
// toEqual() against this exact shape; use damagedOf() below instead.
export function balanceOf(db: InventoryDb, itemId: number, locationId = 1) {
  const row = db.state.balances.find((b: FakeBalance) => b.itemId === itemId && b.locationId === locationId);
  if (!row) return null;
  return { onHand: row.onHand.toString(), reserved: row.reserved.toString(), qc: row.qc.toString() };
}

// I8: the DAMAGED bucket, read separately from balanceOf() above so that
// function's exact-equality shape stays unchanged for every pre-I8 spec.
export function damagedOf(db: InventoryDb, itemId: number, locationId = 1): string | null {
  const row = db.state.balances.find((b: FakeBalance) => b.itemId === itemId && b.locationId === locationId);
  return row ? row.damaged.toString() : null;
}

// Puts stock directly into the fake (balance + matching OPENING movement), as
// if an earlier adjustment had been posted.
export function seedStock(db: InventoryDb, itemId: number, onHand: number, locationId = 1, createdAt: Date = new Date()) {
  const quantity = new Prisma.Decimal(onHand);
  db.state.balances.push({ id: db.state.nextBalanceId++, itemId, locationId, onHand: quantity, reserved: new Prisma.Decimal(0), qc: new Prisma.Decimal(0), damaged: new Prisma.Decimal(0) });
  db.state.movements.push({ itemId, locationId, bucket: 'ON_HAND', quantity, movementType: 'OPENING_BALANCE', createdAt });
}

// I6: records a bare ON_HAND movement at a specific moment, without
// touching the balance — used to simulate "a movement happened for this
// item after the count started" for the stale-check specs, independent of
// whatever posting path would normally produce it.
export function seedMovementAt(db: InventoryDb, itemId: number, locationId: number, createdAt: Date) {
  db.state.movements.push({ itemId, locationId, bucket: 'ON_HAND', quantity: new Prisma.Decimal(1), movementType: 'ADJUSTMENT_IN', createdAt });
}

export function setBucket(db: InventoryDb, itemId: number, bucket: keyof typeof BUCKET_COLUMN, value: number, locationId = 1) {
  const row = db.state.balances.find((b: FakeBalance) => b.itemId === itemId && b.locationId === locationId);
  row[BUCKET_COLUMN[bucket]] = new Prisma.Decimal(value);
}

// I4: marks an item as batch-tracked in the fake (as if a cutover/settings
// change already happened), optionally requiring expiry / a shelf-life-days
// default. Most batch specs start from this instead of posting a real
// BATCH_CUTOVER, which is covered on its own in stock-adjustments.service.spec.ts.
export function trackItem(db: InventoryDb, itemId: number, overrides: Partial<FakeItemSetting> = {}) {
  const existing = db.state.itemSettings.find((row) => row.itemId === itemId);
  const row: FakeItemSetting = {
    itemId,
    batchTracked: true,
    expiryRequired: false,
    shelfLifeDays: null,
    batchTrackedSince: new Date(),
    updatedByUserId: null,
    updatedAt: new Date(),
    ...overrides,
  };
  if (existing) Object.assign(existing, row);
  else db.state.itemSettings.push(row);
  return row;
}

// Creates a batch with a given on-hand/qc balance directly in the fake, as if
// an earlier batch-aware movement had posted it (mirrors seedStock() above).
export function seedBatch(
  db: InventoryDb,
  args: { itemId: number; batchNumber: string; expiryDate?: Date | null; productionDate?: Date | null; onHand?: number; qc?: number; damaged?: number; locationId?: number },
) {
  const batch: FakeBatch = {
    id: db.state.nextBatchId++,
    itemId: args.itemId,
    batchNumber: args.batchNumber,
    productionDate: args.productionDate ?? null,
    expiryDate: args.expiryDate ?? null,
    note: null,
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  db.state.batches.push(batch);
  const locationId = args.locationId ?? 1;
  const balance: FakeBatchBalance = {
    id: db.state.nextBatchBalanceId++,
    batchId: batch.id,
    itemId: args.itemId,
    locationId,
    onHand: new Prisma.Decimal(args.onHand ?? 0),
    qc: new Prisma.Decimal(args.qc ?? 0),
    damaged: new Prisma.Decimal(args.damaged ?? 0),
  };
  db.state.batchBalances.push(balance);
  return batch;
}

export function buildInventoryService(db: InventoryDb) {
  return new InventoryService(db as never, new AuditService(db as never));
}

export function buildStockAdjustmentsService(db: InventoryDb) {
  return new StockAdjustmentsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

export function buildInventoryReportsService(db: InventoryDb) {
  return new InventoryReportsService(db as never, buildInventoryService(db));
}

export function buildGoodsReceiptsService(db: InventoryDb) {
  return new GoodsReceiptsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

export function buildProductionOutputsService(db: InventoryDb) {
  return new ProductionOutputsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

export function buildStockCountsService(db: InventoryDb) {
  return new StockCountsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

// I5: sets an item's itemKind in the fake (default FINISHED_GOOD).
export function setItemKind(db: InventoryDb, itemId: number, kind: 'FINISHED_GOOD' | 'RAW_MATERIAL' | 'PACKAGING') {
  db.state.itemKinds.set(itemId, kind);
}

export function buildInventoryItemSettingsService(db: InventoryDb) {
  return new InventoryItemSettingsService(db as never, new AuditService(db as never));
}

export function buildGoodsReturnsService(db: InventoryDb) {
  return new GoodsReturnsService(db as never, buildInventoryService(db), new AuditService(db as never));
}

// I8: a GoodsReceiptItem row GoodsReturnsService's validateReceiptCaps()
// reads/locks — both the plain findUnique() path (create/update) and the
// FOR UPDATE raw-SQL path (posting) answer from this same state.
export function seedGoodsReceiptItem(
  db: InventoryDb,
  args: { id: number; itemId: number; quantity: number; releasedQty?: number; rejectedQty?: number; returnedQty?: number },
) {
  db.state.goodsReceiptItems.push({
    id: args.id,
    itemId: args.itemId,
    quantity: new Prisma.Decimal(args.quantity),
    releasedQty: new Prisma.Decimal(args.releasedQty ?? 0),
    rejectedQty: new Prisma.Decimal(args.rejectedQty ?? 0),
    returnedQty: new Prisma.Decimal(args.returnedQty ?? 0),
  });
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
    reasonCode: null,
    note: null,
    updatedAt: VERSION,
    submittedByUserId: null,
    submittedAt: null,
    postedByUserId: null,
    postedAt: null,
    rejectedByUserId: null,
    rejectedAt: null,
    rejectReason: null,
    items: [
      { id: 71, itemId: 1, quantity: new Prisma.Decimal(10), note: null, batchId: null, batchNumber: null, productionDate: null, expiryDate: null },
      { id: 72, itemId: 2, quantity: new Prisma.Decimal(5), note: null, batchId: null, batchNumber: null, productionDate: null, expiryDate: null },
    ],
    ...overrides,
  };
}
