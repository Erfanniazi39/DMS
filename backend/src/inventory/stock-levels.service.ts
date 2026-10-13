import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import type { UpsertStockLevelDto } from './dto/stock-level.dto';

export type StockLevelListFilters = { q?: string; locationId?: number };

const stockLevelInclude = {
  item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
  location: { select: { id: true, code: true, name: true } },
  updatedByUser: { select: { id: true, username: true } },
} satisfies Prisma.ItemStockLevelInclude;

// I3 (build plan §5.3, B14): per item+location min/reorder/max thresholds —
// users set these themselves; the system never invents or defaults one.
// CRUD is a plain upsert keyed by the itemId+locationId unique constraint
// (same shape as the grid editor on the frontend: one row per item, saved in
// place). No document number, no posting workflow — this is master-data
// configuration, not a business transaction, so it doesn't go through
// stock-ledger.ts and never touches StockBalance/StockMovement.
@Injectable()
export class StockLevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  list(filters: StockLevelListFilters = {}) {
    const where: Prisma.ItemStockLevelWhereInput = {};
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.q) {
      where.item = {
        OR: [
          { name: { contains: filters.q, mode: 'insensitive' } },
          { code: { contains: filters.q, mode: 'insensitive' } },
        ],
      };
    }
    return this.prisma.itemStockLevel.findMany({ where, include: stockLevelInclude, orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }] });
  }

  async get(id: number) {
    const level = await this.prisma.itemStockLevel.findUnique({ where: { id }, include: stockLevelInclude });
    if (!level) throw new NotFoundException('آستانه موجودی پیدا نشد');
    return level;
  }

  // Create-or-update by (itemId, locationId) — the unique constraint the
  // schema's @@unique([itemId, locationId]) backs. maxQty >= minQty and
  // minQty >= 0 are already enforced by the DTO (clean Persian message); the
  // database's CHECK constraints are the backstop.
  async upsert(dto: UpsertStockLevelDto, userId: number | null, ipAddress?: string) {
    const locationId = await this.resolveLocation(dto.locationId);
    await this.ensureActiveItem(dto.itemId);

    const existing = await this.prisma.itemStockLevel.findUnique({
      where: { itemId_locationId: { itemId: dto.itemId, locationId } },
      include: stockLevelInclude,
    });

    const data = {
      minQty: dto.minQty,
      reorderQty: dto.reorderQty ?? null,
      maxQty: dto.maxQty ?? null,
      note: dto.note ?? null,
      updatedByUserId: userId,
    };

    const saved = await this.prisma.itemStockLevel.upsert({
      where: { itemId_locationId: { itemId: dto.itemId, locationId } },
      create: { itemId: dto.itemId, locationId, ...data },
      update: data,
      include: stockLevelInclude,
    });

    await this.audit.log({
      userId,
      ipAddress,
      action: existing ? 'ITEM_STOCK_LEVEL_UPDATED' : 'ITEM_STOCK_LEVEL_CREATED',
      entityType: AUDIT_ENTITY.ITEM_STOCK_LEVEL,
      entityId: saved.id,
      details: `${saved.item.name} — ${saved.location.name}`,
      changes: existing ? diffChanges(existing, saved, ['minQty', 'reorderQty', 'maxQty']) : undefined,
    });
    return saved;
  }

  // Deletes the threshold entirely (back to "no threshold set" — never
  // flagged as low, per B14). Not a soft-delete: a threshold carries no
  // historical-fact meaning of its own (unlike a posted stock movement), so
  // there is nothing to preserve by keeping a row around.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    const level = await this.get(id);
    await this.prisma.itemStockLevel.delete({ where: { id } });
    await this.audit.log({
      userId,
      ipAddress,
      action: 'ITEM_STOCK_LEVEL_DELETED',
      entityType: AUDIT_ENTITY.ITEM_STOCK_LEVEL,
      entityId: id,
      details: `${level.item.name} — ${level.location.name}`,
    });
    return { success: true };
  }

  private async resolveLocation(locationId: number | undefined) {
    if (locationId === undefined) return (await this.inventory.getDefaultLocation()).id;
    const location = await this.prisma.inventoryLocation.findUnique({ where: { id: locationId }, select: { isActive: true } });
    if (!location || !location.isActive) throw new BadRequestException('انبار انتخاب‌شده یافت نشد یا غیرفعال است');
    return locationId;
  }

  // Read-only "exists and active" lookup (CLAUDE.md rule 11's documented
  // exception) — same convention as StockAdjustmentsService.ensureActiveItems().
  private async ensureActiveItem(itemId: number) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true, status: true, name: true } });
    if (!item) throw new BadRequestException('کالای انتخاب‌شده یافت نشد');
    if (item.status !== 'active') throw new BadRequestException(`کالای «${item.name}» غیرفعال است`);
  }
}
