import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { tehranToday } from '../common/business-date';
import { toIsoDay } from '../common/zod-fields';
import { PrismaService } from '../prisma/prisma.service';
import { isExpiredBatch } from './batch-allocation';
import { isBelowMinimum } from './inventory-rules';
import { InventoryService } from './inventory.service';

export type LowStockFilters = { locationId?: number };

export type ExpiryReportFilters = { withinDays?: number; includeExpired?: boolean };

export type ExpiryReportRow = {
  batchId: number;
  batchNumber: string;
  expiryDate: Date;
  productionDate: Date | null;
  itemId: number;
  item: { id: number; code: string; name: string; unit: { id: number; nameFa: string } } | null;
  locationId: number;
  onHand: string;
  qc: string;
  isExpired: boolean;
  // Negative once expired. Calendar-day difference (business-date convention
  // — same definition as isExpiredBatch()), not a wall-clock one.
  daysUntilExpiry: number;
};

export type LowStockRow = {
  id: number;
  itemId: number;
  locationId: number;
  minQty: string;
  reorderQty: string | null;
  maxQty: string | null;
  available: string;
  shortfall: string;
  item: { id: number; code: string; name: string; status: string; unit: { id: number; nameFa: string } };
  location: { id: number; code: string; name: string };
};

// Read-only reporting over Inventory's own tables — never writes. Exists so
// Dashboard (and any future Reports module) can ask "what's low" without
// re-deriving the rule itself (CLAUDE.md rule 11): lowStockSummary() is the
// one place that combines ItemStockLevel thresholds with availability.
@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // B14: low = available (onHand − reserved) < minQty, for every item+
  // location that has a configured threshold — including one that has never
  // had a stock movement yet (available defaults to zero, which is still
  // "below" any minQty > 0). Availability itself is never recomputed here:
  // InventoryService.listAvailability() (already the authoritative onHand −
  // reserved definition) is the only source of that number.
  async lowStockSummary(filters: LowStockFilters = {}): Promise<LowStockRow[]> {
    const where: Prisma.ItemStockLevelWhereInput = {};
    if (filters.locationId) where.locationId = filters.locationId;

    const levels = await this.prisma.itemStockLevel.findMany({
      where,
      include: {
        item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }],
    });
    if (levels.length === 0) return [];

    const locationIds = [...new Set(levels.map((level) => level.locationId))];
    const availabilityByLocation = new Map<number, Map<number, Prisma.Decimal>>();
    await Promise.all(
      locationIds.map(async (locationId) => {
        const rows = await this.inventory.listAvailability(locationId);
        availabilityByLocation.set(locationId, new Map(rows.map((row) => [row.itemId, row.available])));
      }),
    );

    const zero = new Prisma.Decimal(0);
    const result: LowStockRow[] = [];
    for (const level of levels) {
      const available = availabilityByLocation.get(level.locationId)?.get(level.itemId) ?? zero;
      const minQty = new Prisma.Decimal(level.minQty);
      if (!isBelowMinimum(available, minQty)) continue;
      result.push({
        id: level.id,
        itemId: level.itemId,
        locationId: level.locationId,
        minQty: minQty.toString(),
        reorderQty: level.reorderQty ? level.reorderQty.toString() : null,
        maxQty: level.maxQty ? level.maxQty.toString() : null,
        available: available.toString(),
        shortfall: minQty.minus(available).toString(),
        item: level.item,
        location: level.location,
      });
    }
    return result;
  }

  // I4 (build plan §5.4/§5.4a, §16 resume step 7): every dated batch that
  // still carries ON_HAND or QC stock, with its expiry status as of today
  // (Tehran calendar day) — excludes already-expired batches unless
  // includeExpired is set, and (when withinDays is given) excludes batches
  // expiring further out than that (already-expired ones always pass, since
  // they're the most urgent, not the least).
  async expiryReport(filters: ExpiryReportFilters = {}, asOf: Date = tehranToday()): Promise<ExpiryReportRow[]> {
    const balances = await this.prisma.stockBatchBalance.findMany({});
    const withStock = balances.filter((row) => new Prisma.Decimal(row.onHand).greaterThan(0) || new Prisma.Decimal(row.qc).greaterThan(0));
    if (withStock.length === 0) return [];

    const batchIds = [...new Set(withStock.map((row) => row.batchId))];
    const batches = await this.prisma.stockBatch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, batchNumber: true, expiryDate: true, productionDate: true, itemId: true },
    });
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));

    const itemIds = [...new Set(batches.map((batch) => batch.itemId))];
    const items = itemIds.length
      ? await this.prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true, unit: { select: { id: true, nameFa: true } } } })
      : [];
    const itemById = new Map(items.map((item) => [item.id, item]));

    const DAY_MS = 86_400_000;
    const asOfDay = new Date(toIsoDay(asOf)).getTime();
    const rows: ExpiryReportRow[] = [];
    for (const balance of withStock) {
      const batch = batchById.get(balance.batchId);
      if (!batch?.expiryDate) continue; // undated batches have nothing to report here
      rows.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        productionDate: batch.productionDate,
        itemId: batch.itemId,
        item: itemById.get(batch.itemId) ?? null,
        locationId: balance.locationId,
        onHand: new Prisma.Decimal(balance.onHand).toString(),
        qc: new Prisma.Decimal(balance.qc).toString(),
        isExpired: isExpiredBatch(batch.expiryDate, asOf),
        daysUntilExpiry: Math.round((new Date(toIsoDay(batch.expiryDate)).getTime() - asOfDay) / DAY_MS),
      });
    }

    return rows
      .filter((row) => filters.includeExpired || !row.isExpired)
      .filter((row) => filters.withinDays === undefined || row.isExpired || row.daysUntilExpiry <= filters.withinDays)
      .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || a.batchId - b.batchId);
  }
}
