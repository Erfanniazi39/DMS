import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockBucket } from '@prisma/client';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

export type StockBalanceListFilters = { q?: string; locationId?: number };

export type BalanceMismatch = {
  itemId: number;
  locationId: number;
  bucket: StockBucket;
  // As stored in stock_balances (0 when the row doesn't exist).
  balance: string;
  // Fresh SUM over stock_movements.
  ledger: string;
};

const BUCKETS: { bucket: StockBucket; column: 'onHand' | 'reserved' | 'qc' }[] = [
  { bucket: 'ON_HAND', column: 'onHand' },
  { bucket: 'RESERVED', column: 'reserved' },
  { bucket: 'QC', column: 'qc' },
];

// Read side of Inventory: locations, balances, availability, and the
// ledger-vs-balance consistency check. Never writes stock — every write goes
// through stock-ledger.ts applyMovements() (called by
// StockAdjustmentsService today; by Sales/Returns in later batches).
//
// The higher-level stock events (reserve/release/issue/receive-to-QC/
// restock/write-off) are intentionally NOT here yet — they get built with
// the Sales batches that actually trigger them.
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // Read-only list for now — single seeded warehouse, no management UI.
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

  // Stock list (موجودی). One row per item+location that has ever had a
  // movement. `available` is deliberately not returned — the page computes
  // onHand − reserved for display; getAvailability() is the authoritative
  // version for server-side decisions.
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
    const query = {
      where,
      include: {
        item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }],
    } satisfies Prisma.StockBalanceFindManyArgs;

    if (!pagination) return this.prisma.stockBalance.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.stockBalance.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.stockBalance.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
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

  // available = onHand − reserved (QC stock is not sellable). An item with
  // no balance row yet has zero everywhere.
  async getAvailability(itemId: number, locationId: number) {
    const balance = await this.prisma.stockBalance.findUnique({
      where: { itemId_locationId: { itemId, locationId } },
      select: { onHand: true, reserved: true, qc: true },
    });
    const zero = new Prisma.Decimal(0);
    const onHand = balance ? new Prisma.Decimal(balance.onHand) : zero;
    const reserved = balance ? new Prisma.Decimal(balance.reserved) : zero;
    const qc = balance ? new Prisma.Decimal(balance.qc) : zero;
    return { itemId, locationId, onHand, reserved, qc, available: onHand.minus(reserved) };
  }

  // Consistency check: every StockBalance bucket must equal the SUM of its
  // StockMovement rows. Returns every mismatch (including movements with no
  // balance row and a non-zero balance with no movements). Not wired into
  // any UI — a spec and a manual check use it.
  async verifyBalances(itemId?: number, locationId?: number): Promise<{ ok: boolean; mismatches: BalanceMismatch[] }> {
    if (itemId !== undefined && (!Number.isInteger(itemId) || itemId < 1)) throw new BadRequestException('کالا نامعتبر است');
    if (locationId !== undefined && (!Number.isInteger(locationId) || locationId < 1)) throw new BadRequestException('انبار نامعتبر است');
    const where = { ...(itemId ? { itemId } : {}), ...(locationId ? { locationId } : {}) };

    const [sums, balances] = await Promise.all([
      this.prisma.stockMovement.groupBy({ by: ['itemId', 'locationId', 'bucket'], where, _sum: { quantity: true } }),
      this.prisma.stockBalance.findMany({ where, select: { itemId: true, locationId: true, onHand: true, reserved: true, qc: true } }),
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
    return { ok: mismatches.length === 0, mismatches };
  }
}
