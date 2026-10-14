import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockBucket, type StockMovementType, type StockReferenceType } from '@prisma/client';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { tehranToday } from '../common/business-date';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { isExpiredBatch } from './batch-allocation';
import type { CreateLocationDto, UpdateLocationDto } from './dto/inventory.dto';
import { isBelowMinimum } from './inventory-rules';
import { listExpiredOnHandByItem, sumExpiredOnHand } from './inventory-queries';

export type StockBalanceListFilters = {
  q?: string;
  locationId?: number;
  // Column sort. Every column is a DB orderBy except 'available' (onHand −
  // reserved, قابل فروش), which has no column and is sorted in memory —
  // surfacing the lowest-stock items first when ascending. Default: item name.
  sort?: SortParams;
  // I3 (B14): only rows whose available is below their own ItemStockLevel
  // threshold. An item+location with no configured threshold never matches —
  // the system never invents one.
  lowStockOnly?: boolean;
};

// Movement browser (/inventory/movements) filters.
export type StockMovementListFilters = {
  itemId?: number;
  locationId?: number;
  bucket?: StockBucket;
  movementType?: StockMovementType;
  referenceType?: StockReferenceType;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: SortParams;
};

export type BalanceMismatch = {
  itemId: number;
  locationId: number;
  bucket: StockBucket;
  // As stored in stock_balances (0 when the row doesn't exist).
  balance: string;
  // Fresh SUM over stock_movements.
  ledger: string;
};

// I4 (build plan §5.4a): the three additive batch-aware mismatch kinds
// verifyBalances() also checks, alongside the pre-existing BalanceMismatch
// above:
//  - BATCH_LEDGER: a batch's own StockBatchBalance ≠ the SUM of its
//    StockMovement rows (the batch-level mirror of BalanceMismatch).
//  - BATCH_SUM: a batch-tracked item's item-level StockBalance ≠ the SUM of
//    its StockBatchBalance rows (the invariant §5.4's schema comment names).
//  - UNEXPECTED_BATCH: a movement carries a batchId it never should — either
//    on the RESERVED bucket (batches never apply there), or on an item that
//    isn't (or is no longer) batch-tracked.
export type BatchBalanceMismatch =
  | { kind: 'BATCH_LEDGER'; batchId: number; itemId: number; locationId: number; bucket: 'ON_HAND' | 'QC' | 'DAMAGED'; balance: string; ledger: string }
  | { kind: 'BATCH_SUM'; itemId: number; locationId: number; bucket: 'ON_HAND' | 'QC' | 'DAMAGED'; balance: string; ledger: string }
  | { kind: 'UNEXPECTED_BATCH'; itemId: number; locationId: number; batchId: number; bucket: StockBucket };

const BUCKETS: { bucket: StockBucket; column: 'onHand' | 'reserved' | 'qc' | 'damaged' }[] = [
  { bucket: 'ON_HAND', column: 'onHand' },
  { bucket: 'RESERVED', column: 'reserved' },
  { bucket: 'QC', column: 'qc' },
  // I8 (build plan §5.8): held, not sellable — included in the ledger-vs-
  // balance check like every other bucket, never folded into "available".
  { bucket: 'DAMAGED', column: 'damaged' },
];

// Over-committed = available (onHand − reserved) < 0. applyMovements() only
// blocks a single bucket from going negative, not on-hand against reserved,
// so a posted CORRECTION can leave this true with nothing surfacing it
// otherwise (build plan §2.3 finding 2). Visibility only — B12 (whether to
// ever block it) is still open.
function withOverCommitted<T extends { onHand: Prisma.Decimal | string; reserved: Prisma.Decimal | string }>(
  row: T,
): T & { overCommitted: boolean } {
  const overCommitted = new Prisma.Decimal(row.onHand).minus(row.reserved).isNegative();
  return { ...row, overCommitted };
}

// Columns the stock list / movement browser can be sorted by. «قابل فروش»
// (available) is the one computed column — see listBalances().
const STOCK_BALANCE_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.StockBalanceOrderByWithRelationInput> = {
  code: (dir) => ({ item: { code: dir } }),
  name: (dir) => ({ item: { name: dir } }),
  unit: (dir) => ({ item: { unit: { nameFa: dir } } }),
  location: (dir) => ({ location: { name: dir } }),
  onHand: (dir) => ({ onHand: dir }),
  reserved: (dir) => ({ reserved: dir }),
  qc: (dir) => ({ qc: dir }),
};
const STOCK_MOVEMENT_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.StockMovementOrderByWithRelationInput> = {
  movementDate: (dir) => ({ movementDate: dir }),
  item: (dir) => ({ item: { name: dir } }),
  location: (dir) => ({ location: { name: dir } }),
  bucket: (dir) => ({ bucket: dir }),
  movementType: (dir) => ({ movementType: dir }),
  quantity: (dir) => ({ quantity: dir }),
  referenceType: (dir) => ({ referenceType: dir }),
  createdBy: (dir) => ({ createdByUser: { username: dir } }),
};

// Read side of Inventory: locations, balances, availability, and the
// ledger-vs-balance consistency check. Never writes stock — every write goes
// through stock-ledger.ts applyMovements() (called by
// StockAdjustmentsService today; by Sales/Returns in later batches).
//
// The higher-level stock events are plain functions in stock-ledger.ts
// (they need the caller's transaction): reserve/release since Sales batch 2;
// issue/receive-to-QC/restock/write-off get built with the batches that
// trigger them.
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Suggested code for a new location (LOC-000001, editable on the form).
  nextLocationCode() {
    return suggestNextCode('LOC', (startsWith) => this.prisma.inventoryLocation.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  listLocations() {
    return this.prisma.inventoryLocation.findMany({ orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] });
  }

  // The default warehouse (seeded MAIN). Used when a document doesn't name
  // a location.
  async getDefaultLocation() {
    const location = await this.prisma.inventoryLocation.findFirst({ where: { isDefault: true, isActive: true }, orderBy: { id: 'asc' } });
    if (!location) throw new NotFoundException('انبار پیش‌فرض تعریف نشده است');
    return location;
  }

  // Location (warehouse) admin — plain master data, same shape as
  // Units/PurchaseType. isDefault is exclusive: setting it on one location
  // unsets every other one in the same transaction, matching the single
  // "default warehouse" meaning getDefaultLocation() relies on everywhere
  // else in this module. A new default that's inactive makes no sense (it
  // could never be used), so it's rejected up front.
  async createLocation(dto: CreateLocationDto, userId: number | null, ipAddress?: string) {
    if (dto.isDefault && !dto.isActive) throw new BadRequestException('انبار غیرفعال نمی‌تواند پیش‌فرض باشد');
    await this.ensureUniqueLocationCode(dto.code);

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.inventoryLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.inventoryLocation.create({
        data: { code: dto.code, name: dto.name, isActive: dto.isActive, isDefault: dto.isDefault, note: dto.note ?? null },
      });
    });
    await this.audit.log({
      userId,
      ipAddress,
      action: 'INVENTORY_LOCATION_CREATED',
      entityType: AUDIT_ENTITY.INVENTORY_LOCATION,
      entityId: created.id,
      details: `${created.code} — ${created.name}`,
    });
    return created;
  }

  // Full-record edit. Keeps exactly one location default at all times
  // (every other write path in this module assumes getDefaultLocation()
  // always resolves): unsetting the current default directly is refused —
  // make a different location default instead, which atomically clears this
  // one. Deactivating the current default while still claiming isDefault is
  // caught by the isDefault-requires-isActive guard above; deactivating it
  // after un-defaulting it is caught by the guard below, since both would
  // have to happen in the same call.
  async updateLocation(id: number, dto: UpdateLocationDto, userId: number | null, ipAddress?: string) {
    const existing = await this.prisma.inventoryLocation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('انبار پیدا نشد');
    if (dto.isDefault && !dto.isActive) throw new BadRequestException('انبار غیرفعال نمی‌تواند پیش‌فرض باشد');
    if (dto.code !== existing.code) await this.ensureUniqueLocationCode(dto.code, id);
    if (existing.isDefault && !dto.isDefault) {
      throw new ConflictException('حداقل یک انبار باید پیش‌فرض باشد؛ به‌جای لغو این مورد، انبار دیگری را پیش‌فرض کنید');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault && !existing.isDefault) await tx.inventoryLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.inventoryLocation.update({
        where: { id },
        data: { code: dto.code, name: dto.name, isActive: dto.isActive, isDefault: dto.isDefault, note: dto.note ?? null },
      });
    });
    await this.audit.log({
      userId,
      ipAddress,
      action: 'INVENTORY_LOCATION_UPDATED',
      entityType: AUDIT_ENTITY.INVENTORY_LOCATION,
      entityId: id,
      details: `${updated.code} — ${updated.name}`,
      changes: diffChanges(existing, updated, ['code', 'name', 'isActive', 'isDefault', 'note']),
    });
    return updated;
  }

  private async ensureUniqueLocationCode(code: string, excludedId?: number) {
    const duplicate = await this.prisma.inventoryLocation.findFirst({
      where: { code, ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}) },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('این کد قبلاً برای انبار دیگری استفاده شده است');
  }

  // Stock list (موجودی). One row per item+location that has ever had a
  // movement. `available` is deliberately not returned — the page computes
  // onHand − reserved for display; getAvailability() is the authoritative
  // version for server-side decisions. `overCommitted` IS returned: a posted
  // CORRECTION can leave onHand < reserved (build plan §2.3 finding 2) and
  // that is otherwise invisible — this is visibility only, not a block (B12
  // is still open).
  async listBalances(filters: StockBalanceListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.StockBalanceWhereInput = {};
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.q) {
      where.item = {
        OR: [
          { name: { contains: filters.q, mode: 'insensitive' } },
          { code: { contains: filters.q, mode: 'insensitive' } },
        ],
      };
    }
    const include = {
      item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
      location: { select: { id: true, code: true, name: true } },
    } satisfies Prisma.StockBalanceInclude;

    // I3 (B14): bypasses DB pagination, same bounded in-memory exception as
    // the available-sort branch below — the candidate set is bounded by how
    // many item+location pairs have a configured ItemStockLevel threshold at
    // all (never the whole movement history).
    if (filters.lowStockOnly) {
      const levels = await this.prisma.itemStockLevel.findMany({
        where: filters.locationId ? { locationId: filters.locationId } : {},
        select: { itemId: true, locationId: true, minQty: true },
      });
      if (levels.length === 0) return pagination ? { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize } : [];
      const minByKey = new Map(levels.map((level) => [`${level.itemId}:${level.locationId}`, new Prisma.Decimal(level.minQty)]));
      const candidateItemIds = [...new Set(levels.map((level) => level.itemId))];
      const rows = await this.prisma.stockBalance.findMany({
        where: { ...where, itemId: { in: candidateItemIds } },
        include,
        orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }],
      });
      const low = rows.map(withOverCommitted).filter((row) => {
        const minQty = minByKey.get(`${row.itemId}:${row.locationId}`);
        if (!minQty) return false;
        return isBelowMinimum(new Prisma.Decimal(row.onHand).minus(row.reserved), minQty);
      });
      if (!pagination) return low;
      const { skip, take } = toSkipTake(pagination);
      return { items: low.slice(skip, skip + take), total: low.length, page: pagination.page, pageSize: pagination.pageSize };
    }

    if (filters.sort?.sortBy !== 'available') {
      const orderBy = buildOrderBy(filters.sort, STOCK_BALANCE_SORT_COLUMNS, [{ item: { name: 'asc' } }, { id: 'asc' }], [{ id: 'asc' }]);
      const query = { where, include, orderBy } satisfies Prisma.StockBalanceFindManyArgs;
      if (!pagination) return (await this.prisma.stockBalance.findMany(query)).map(withOverCommitted);
      const [items, total] = await Promise.all([
        this.prisma.stockBalance.findMany({ ...query, ...toSkipTake(pagination) }),
        this.prisma.stockBalance.count({ where }),
      ]);
      return { items: items.map(withOverCommitted), total, page: pagination.page, pageSize: pagination.pageSize };
    }

    // available = onHand − reserved has no DB column to order by directly
    // (Prisma 6 can't orderBy a computed expression). The filtered set is
    // one row per item+location that has ever had a movement — bounded by
    // the catalog, not the whole transaction history — so sorting it
    // in-memory and paginating after is a deliberate, bounded exception to
    // "never sort/paginate in application code" rather than a scalability
    // risk.
    const sortDir = filters.sort.sortDir;
    const rows = await this.prisma.stockBalance.findMany({ where, include, orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }] });
    const availableOf = (row: (typeof rows)[number]) => new Prisma.Decimal(row.onHand).minus(row.reserved);
    const sorted = [...rows].sort((a, b) => {
      const diff = availableOf(a).comparedTo(availableOf(b));
      return sortDir === 'asc' ? diff : -diff;
    }).map(withOverCommitted);
    if (!pagination) return sorted;
    const { skip, take } = toSkipTake(pagination);
    return { items: sorted.slice(skip, skip + take), total: sorted.length, page: pagination.page, pageSize: pagination.pageSize };
  }

  // Item picker for the stock-adjustment form. Exists because the
  // WAREHOUSE role (inventory.adjust) deliberately has no items.view, so it
  // can't call GET /items. A read-only display lookup (CLAUDE.md rule 11's
  // documented exception): active items only, display fields only — no
  // price, description or note.
  listItemOptions() {
    return this.prisma.item.findMany({
      where: { status: 'active' },
      select: { id: true, code: true, name: true, unit: { select: { id: true, nameFa: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  // available = onHand − reserved − expired (QC stock is not sellable; I4/B21:
  // expired-but-not-written-off batch stock is excluded too, the same
  // "sellable on hand" definition reserveAvailable() uses — otherwise this
  // display could show stock that then fails at delivery with
  // EXPIRED_STOCK_ONLY). An item with no balance row yet has zero everywhere.
  async getAvailability(itemId: number, locationId: number) {
    const balance = await this.prisma.stockBalance.findUnique({
      where: { itemId_locationId: { itemId, locationId } },
      select: { onHand: true, reserved: true, qc: true },
    });
    const zero = new Prisma.Decimal(0);
    const onHand = balance ? new Prisma.Decimal(balance.onHand) : zero;
    const reserved = balance ? new Prisma.Decimal(balance.reserved) : zero;
    const qc = balance ? new Prisma.Decimal(balance.qc) : zero;
    const expired = await sumExpiredOnHand(this.prisma, itemId, locationId, tehranToday());
    return { itemId, locationId, onHand, reserved, qc, available: onHand.minus(reserved).minus(expired) };
  }

  // Availability for every item with a balance row at this location (same
  // definition as getAvailability(), expired exclusion included — B21). An
  // item missing from the result has zero stock. For the sales-order form's
  // per-line availability display — display only; the authoritative check
  // at confirmation is stock-ledger.ts reserveAvailable(), under a row lock.
  async listAvailability(locationId: number) {
    const balances = await this.prisma.stockBalance.findMany({
      where: { locationId },
      select: { itemId: true, onHand: true, reserved: true },
    });
    const expiredByItem = await listExpiredOnHandByItem(this.prisma, locationId, tehranToday());
    return balances.map((balance) => {
      const onHand = new Prisma.Decimal(balance.onHand);
      const reserved = new Prisma.Decimal(balance.reserved);
      const expired = expiredByItem.get(balance.itemId) ?? new Prisma.Decimal(0);
      return { itemId: balance.itemId, onHand, reserved, available: onHand.minus(reserved).minus(expired) };
    });
  }

  // Consistency check: every StockBalance bucket must equal the SUM of its
  // StockMovement rows. Returns every mismatch (including movements with no
  // balance row and a non-zero balance with no movements), plus the I4
  // batch-aware mismatches (see BatchBalanceMismatch's own comment). Not
  // wired into any UI — a spec and a manual check (/inventory/integrity) use it.
  async verifyBalances(itemId?: number, locationId?: number): Promise<{ ok: boolean; mismatches: BalanceMismatch[]; batchMismatches: BatchBalanceMismatch[] }> {
    if (itemId !== undefined && (!Number.isInteger(itemId) || itemId < 1)) throw new BadRequestException('کالا نامعتبر است');
    if (locationId !== undefined && (!Number.isInteger(locationId) || locationId < 1)) throw new BadRequestException('انبار نامعتبر است');
    const where = { ...(itemId ? { itemId } : {}), ...(locationId ? { locationId } : {}) };

    const [sums, balances, batchMovementSums, batchBalances] = await Promise.all([
      this.prisma.stockMovement.groupBy({ by: ['itemId', 'locationId', 'bucket'], where, _sum: { quantity: true } }),
      this.prisma.stockBalance.findMany({ where, select: { itemId: true, locationId: true, onHand: true, reserved: true, qc: true, damaged: true } }),
      this.prisma.stockMovement.groupBy({ by: ['itemId', 'locationId', 'bucket', 'batchId'], where: { ...where, batchId: { not: null } }, _sum: { quantity: true } }),
      this.prisma.stockBatchBalance.findMany({ where: { ...(itemId ? { itemId } : {}), ...(locationId ? { locationId } : {}) } }),
    ]);

    const zero = new Prisma.Decimal(0);
    const ledger = new Map<string, Prisma.Decimal>();
    const keys = new Map<string, { itemId: number; locationId: number }>();
    for (const sum of sums) {
      ledger.set(`${sum.itemId}:${sum.locationId}:${sum.bucket}`, new Prisma.Decimal(sum._sum.quantity ?? 0));
      keys.set(`${sum.itemId}:${sum.locationId}`, { itemId: sum.itemId, locationId: sum.locationId });
    }
    const stored = new Map<string, Prisma.Decimal>();
    for (const balance of balances) {
      keys.set(`${balance.itemId}:${balance.locationId}`, { itemId: balance.itemId, locationId: balance.locationId });
      for (const { bucket, column } of BUCKETS) {
        stored.set(`${balance.itemId}:${balance.locationId}:${bucket}`, new Prisma.Decimal(balance[column]));
      }
    }

    const mismatches: BalanceMismatch[] = [];
    for (const { itemId: keyItem, locationId: keyLocation } of keys.values()) {
      for (const { bucket } of BUCKETS) {
        const key = `${keyItem}:${keyLocation}:${bucket}`;
        const fromBalance = stored.get(key) ?? zero;
        const fromLedger = ledger.get(key) ?? zero;
        if (!fromBalance.equals(fromLedger)) {
          mismatches.push({ itemId: keyItem, locationId: keyLocation, bucket, balance: fromBalance.toString(), ledger: fromLedger.toString() });
        }
      }
    }

    // --- I4 batch-aware mismatches -----------------------------------------

    const batchMismatches: BatchBalanceMismatch[] = [];

    // Settings for every item referenced by either a batch movement or a
    // batch balance (plus the plain balances above, so an item that LOST its
    // tracked flag after posting batch movements is still caught).
    const involvedItemIds = new Set<number>();
    for (const row of batchMovementSums) involvedItemIds.add(row.itemId);
    for (const row of batchBalances) involvedItemIds.add(row.itemId);
    for (const { itemId: keyItem } of keys.values()) involvedItemIds.add(keyItem);
    const settings = involvedItemIds.size
      ? await this.prisma.inventoryItemSetting.findMany({ where: { itemId: { in: [...involvedItemIds] } }, select: { itemId: true, batchTracked: true } })
      : [];
    const trackedItemIds = new Set(settings.filter((row) => row.batchTracked).map((row) => row.itemId));

    // UNEXPECTED_BATCH (a RESERVED movement with a batchId, or any batchId
    // movement on an item that isn't/no-longer-is tracked) + the ledger side
    // of BATCH_LEDGER (batch+location+bucket sums, for everything else).
    const batchLedger = new Map<string, Prisma.Decimal>();
    for (const row of batchMovementSums) {
      const batchId = row.batchId as number | null;
      if (batchId === null) continue; // defensive — the where clause already excludes this
      if (row.bucket === 'RESERVED' || !trackedItemIds.has(row.itemId)) {
        batchMismatches.push({ kind: 'UNEXPECTED_BATCH', itemId: row.itemId, locationId: row.locationId, batchId, bucket: row.bucket });
        continue;
      }
      batchLedger.set(`${batchId}:${row.locationId}:${row.bucket}`, new Prisma.Decimal(row._sum.quantity ?? 0));
    }

    // BATCH_LEDGER: each batch+location's stored ON_HAND/QC/DAMAGED (I8) vs
    // the ledger sum above.
    const batchColumns: { bucket: 'ON_HAND' | 'QC' | 'DAMAGED'; column: 'onHand' | 'qc' | 'damaged' }[] = [
      { bucket: 'ON_HAND', column: 'onHand' },
      { bucket: 'QC', column: 'qc' },
      { bucket: 'DAMAGED', column: 'damaged' },
    ];
    for (const row of batchBalances) {
      for (const { bucket, column } of batchColumns) {
        const fromBalance = new Prisma.Decimal(row[column]);
        const fromLedger = batchLedger.get(`${row.batchId}:${row.locationId}:${bucket}`) ?? zero;
        if (!fromBalance.equals(fromLedger)) {
          batchMismatches.push({
            kind: 'BATCH_LEDGER',
            batchId: row.batchId,
            itemId: row.itemId,
            locationId: row.locationId,
            bucket,
            balance: fromBalance.toString(),
            ledger: fromLedger.toString(),
          });
        }
      }
    }

    // BATCH_SUM: a tracked item's item-level StockBalance vs the SUM of its
    // batch balances, per location — over the union of every item+location
    // key either side has, so a tracked item whose batches vanished (bug) or
    // whose item-level row is missing still surfaces a mismatch.
    const batchSumByItemLocation = new Map<string, { onHand: Prisma.Decimal; qc: Prisma.Decimal; damaged: Prisma.Decimal }>();
    for (const row of batchBalances) {
      const key = `${row.itemId}:${row.locationId}`;
      const entry = batchSumByItemLocation.get(key) ?? { onHand: zero, qc: zero, damaged: zero };
      entry.onHand = entry.onHand.plus(row.onHand);
      entry.qc = entry.qc.plus(row.qc);
      entry.damaged = entry.damaged.plus(row.damaged);
      batchSumByItemLocation.set(key, entry);
    }
    const batchSumKeys = new Set<string>([...keys.keys(), ...batchSumByItemLocation.keys()]);
    for (const key of batchSumKeys) {
      const [keyItemStr, keyLocationStr] = key.split(':');
      const keyItem = Number(keyItemStr);
      const keyLocation = Number(keyLocationStr);
      if (!trackedItemIds.has(keyItem)) continue;
      const sum = batchSumByItemLocation.get(key) ?? { onHand: zero, qc: zero, damaged: zero };
      for (const { bucket, column } of batchColumns) {
        const fromBalance = stored.get(`${key}:${bucket}`) ?? zero;
        const fromLedger = sum[column];
        if (!fromBalance.equals(fromLedger)) {
          batchMismatches.push({ kind: 'BATCH_SUM', itemId: keyItem, locationId: keyLocation, bucket, balance: fromBalance.toString(), ledger: fromLedger.toString() });
        }
      }
    }

    return { ok: mismatches.length === 0 && batchMismatches.length === 0, mismatches, batchMismatches };
  }

  // Stock card (کاردکس): every StockMovement for one item, across every
  // location, in posting order (id — E5's convention: posting order, not
  // document date, so the running balance never has to be recomputed for a
  // backdated document), with a running balance per bucket. Read-only; never
  // writes (stock-ledger.ts applyMovements() remains the only writer).
  //
  // The running balance is item-wide (summed across locations), matching
  // today's single-warehouse reality. Once I7 (locations/transfers) lands,
  // a per-location breakdown can be added without changing this shape —
  // `locationId` filters which movements are shown; the running balance
  // itself would need revisiting for a true per-location kardex then.
  async getStockCard(itemId: number, filters: { locationId?: number } = {}) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true, code: true, name: true, status: true, itemKind: true, unit: { select: { id: true, nameFa: true } } },
    });
    if (!item) throw new NotFoundException('کالا پیدا نشد');

    const movements = await this.prisma.stockMovement.findMany({
      where: { itemId, ...(filters.locationId ? { locationId: filters.locationId } : {}) },
      orderBy: [{ id: 'asc' }],
      include: {
        location: { select: { id: true, code: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
      },
      // I5 (B15): unitCost is cost data, visible only with inventory.cost —
      // never returned from this inventory.view read.
      omit: { unitCost: true },
    });

    // I8 (build plan §5.8): DAMAGED included so a MARK_DAMAGED/RETURN_TO_
    // DAMAGED/SUPPLIER_RETURN movement has a running bucket to add to — never
    // folded into onHand/reserved/qc.
    const running: Record<StockBucket, Prisma.Decimal> = {
      ON_HAND: new Prisma.Decimal(0),
      RESERVED: new Prisma.Decimal(0),
      QC: new Prisma.Decimal(0),
      DAMAGED: new Prisma.Decimal(0),
    };
    const rows = movements.map((movement) => {
      running[movement.bucket] = running[movement.bucket].plus(movement.quantity);
      return {
        ...movement,
        // Deliberately NOT extended with damaged (I8) — keeps this existing
        // response shape unchanged; DAMAGED is still tracked in `running`
        // above so a MARK_DAMAGED/RETURN_TO_DAMAGED/SUPPLIER_RETURN movement
        // has a running bucket to add to without crashing.
        balanceAfter: { onHand: running.ON_HAND.toString(), reserved: running.RESERVED.toString(), qc: running.QC.toString() },
      };
    });

    return { item, rows };
  }

  // I4 (build plan §5.4/§16 resume step 7): every batch of one item that
  // still carries ON_HAND/QC stock (optionally narrowed to one location),
  // with its expiry status as of today (Tehran calendar day). Read-only —
  // batches/balances are written only by stock-ledger.ts.
  async listItemBatches(itemId: number, locationId?: number) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true, code: true, name: true } });
    if (!item) throw new NotFoundException('کالا پیدا نشد');

    const balances = await this.prisma.stockBatchBalance.findMany({
      where: { itemId, ...(locationId ? { locationId } : {}) },
    });
    if (balances.length === 0) return { item, batches: [] };

    const batchIds = [...new Set(balances.map((balance) => balance.batchId))];
    const batches = await this.prisma.stockBatch.findMany({ where: { id: { in: batchIds } } });
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));

    const today = tehranToday();
    const rows = balances
      .map((balance) => {
        const batch = batchById.get(balance.batchId);
        if (!batch) return null;
        return {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          productionDate: batch.productionDate,
          expiryDate: batch.expiryDate,
          isExpired: isExpiredBatch(batch.expiryDate, today),
          locationId: balance.locationId,
          onHand: new Prisma.Decimal(balance.onHand).toString(),
          qc: new Prisma.Decimal(balance.qc).toString(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => (a.expiryDate?.getTime() ?? Infinity) - (b.expiryDate?.getTime() ?? Infinity) || a.batchId - b.batchId);

    return { item, batches: rows };
  }

  // Movement browser (/inventory/movements): a filterable, paginated view
  // over StockMovement — read-only, same opt-in pagination contract as every
  // other list here. Most recent first by default (id — insertion order is
  // also posting order).
  async listMovements(filters: StockMovementListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.StockMovementWhereInput = {};
    if (filters.itemId) where.itemId = filters.itemId;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.bucket) where.bucket = filters.bucket;
    if (filters.movementType) where.movementType = filters.movementType;
    if (filters.referenceType) where.referenceType = filters.referenceType;
    if (filters.dateFrom || filters.dateTo) {
      where.movementDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    const include = {
      item: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
      createdByUser: { select: { id: true, username: true } },
    } satisfies Prisma.StockMovementInclude;
    // I5 (B15): unitCost omitted — cost is inventory.cost-only, this is an
    // inventory.view read.
    const orderBy = buildOrderBy(filters.sort, STOCK_MOVEMENT_SORT_COLUMNS, [{ id: 'desc' }], [{ id: 'desc' }]);
    const query = { where, include, omit: { unitCost: true }, orderBy } satisfies Prisma.StockMovementFindManyArgs;

    if (!pagination) return this.prisma.stockMovement.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }
}
