import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockAdjustmentKind, type StockDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import {
  EDITABLE_STOCK_DOCUMENT_STATUSES,
  STOCK_ADJUSTMENT_DOC_TYPE,
  STOCK_ADJUSTMENT_KIND_LABELS_FA,
  movementTypeForAdjustmentLine,
} from './inventory-rules';
import { applyMovements, type MovementInput } from './stock-ledger';
import type { CreateStockAdjustmentDto, UpdateStockAdjustmentDto } from './dto/inventory.dto';

export type StockAdjustmentListFilters = { q?: string; status?: StockDocumentStatus; kind?: StockAdjustmentKind };

// Everything the detail page needs. Users narrowed to id/username.
const stockAdjustmentDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  createdByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  items: {
    include: { item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockAdjustmentInclude;

// Stock adjustment documents (رسید / اصلاح موجودی) — the only way stock
// enters or is corrected today (no Purchases/Production integration,
// CLAUDE.md rule 7).
//
// Lifecycle: DRAFT (editable, deletable, no number) → POSTED (immutable,
// numbered ADJ-<jalali year>-000001, stock movements written). Posting is
// one transaction: lock the draft, claim the gap-free number, apply the
// movements through stock-ledger.ts, mark POSTED, write the audit row. If
// anything fails (e.g. a CORRECTION would take stock negative) nothing is
// kept — not the number, not a single movement.
@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: StockAdjustmentListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.StockAdjustmentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.kind) where.kind = filters.kind;
    if (filters.q) {
      where.OR = [
        { adjustmentNumber: { contains: filters.q, mode: 'insensitive' } },
        { reason: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    const query = {
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
      // Drafts (no number) and posted documents together, newest first.
      orderBy: [{ adjustmentDate: 'desc' }, { id: 'desc' }],
    } satisfies Prisma.StockAdjustmentFindManyArgs;

    if (!pagination) return this.prisma.stockAdjustment.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({ where: { id }, include: stockAdjustmentDetailInclude });
    if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
    return adjustment;
  }

  async create(dto: CreateStockAdjustmentDto, userId: number | null, ipAddress?: string) {
    const locationId = await this.resolveLocation(dto.locationId);
    await this.ensureActiveItems(dto.items.map((line) => line.itemId));

    const created = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          kind: dto.kind,
          status: 'DRAFT',
          locationId,
          adjustmentDate: dto.adjustmentDate,
          reason: dto.reason,
          note: dto.note,
          createdByUserId: userId,
          items: { create: dto.items.map((line) => ({ itemId: line.itemId, quantity: line.quantity, note: line.note })) },
        },
        include: stockAdjustmentDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_CREATED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: adjustment.id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — پیش‌نویس، ${dto.items.length} ردیف`,
        },
        tx,
      );
      return adjustment;
    });
    return created;
  }

  // Full-record edit of a DRAFT: header fields plus lines replaced wholesale
  // (same delete-then-recreate convention as PurchasesService.update()).
  // Optimistic lock on updatedAt, re-checked atomically inside the
  // transaction together with status = DRAFT, so an edit can't land on a
  // document that was posted (or edited) in the meantime.
  async update(id: number, dto: UpdateStockAdjustmentDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    // An item already on this draft may stay even if it was deactivated since
    // (same rule as ItemsService.ensureReferences()); newly added ones must be active.
    await this.ensureActiveItems(
      dto.items.map((line) => line.itemId),
      existing.items.map((line) => line.itemId),
    );

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: id } });
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          kind: dto.kind,
          locationId,
          adjustmentDate: dto.adjustmentDate,
          reason: dto.reason,
          note: dto.note ?? null,
          items: { create: dto.items.map((line) => ({ itemId: line.itemId, quantity: line.quantity, note: line.note })) },
        },
        include: stockAdjustmentDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_ADJUSTMENT_UPDATED', entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return updated;
    });
  }

  // DRAFT → POSTED. See the class comment for the transaction shape.
  //
  // Concurrency: the draft row is locked FOR UPDATE first (same convention as
  // PurchasePaymentsService), so two simultaneous "post" clicks on the same
  // draft serialize and the second sees POSTED and is refused. Two different
  // adjustments posted at once each lock their own draft, then both reach
  // nextDocumentNumber(), whose UPDATE … RETURNING row-locks the
  // (ADJ, year) counter until commit — the second waits and receives the
  // next value, never the same one (adjustment_number is UNIQUE as a
  // backstop). Stock rows are locked by applyMovements() in itemId/locationId
  // order, so overlapping adjustments can't deadlock on balances either.
  async post(id: number, loadedVersion: Date, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      if (adjustment.status === 'POSTED') throw new ConflictException('این سند قبلاً ثبت شده است');
      if (!isSameVersion(adjustment.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (adjustment.items.length === 0) throw new BadRequestException('سند بدون ردیف کالا قابل ثبت نیست');
      if (!adjustment.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');

      const adjustmentNumber = await nextDocumentNumber(tx, STOCK_ADJUSTMENT_DOC_TYPE, adjustment.adjustmentDate);
      const rows: MovementInput[] = adjustment.items.map((line) => {
        const quantity = new Prisma.Decimal(line.quantity);
        return {
          itemId: line.itemId,
          locationId: adjustment.locationId,
          bucket: 'ON_HAND',
          movementType: movementTypeForAdjustmentLine(adjustment.kind, quantity.isNegative() ? -1 : 1),
          quantity,
          movementDate: adjustment.adjustmentDate,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: adjustment.id,
          referenceLineId: line.id,
          referenceNumber: adjustmentNumber,
          note: line.note,
          createdByUserId: userId,
        };
      });
      await applyMovements(tx, rows);

      await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', adjustmentNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_POSTED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${adjustmentNumber} — ${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]}، ${rows.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // DRAFT only. A POSTED adjustment has no delete path — ever.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const adjustment = await tx.stockAdjustment.findUnique({ where: { id }, select: { id: true, status: true, kind: true } });
      if (!adjustment) throw new NotFoundException('سند موجودی پیدا نشد');
      this.ensureEditable(adjustment.status);
      await tx.stockAdjustment.delete({ where: { id } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_ADJUSTMENT_DELETED',
          entityType: AUDIT_ENTITY.STOCK_ADJUSTMENT,
          entityId: id,
          details: `${STOCK_ADJUSTMENT_KIND_LABELS_FA[adjustment.kind]} — پیش‌نویس`,
        },
        tx,
      );
    });
    return { success: true };
  }

  private ensureEditable(status: StockDocumentStatus) {
    if (!EDITABLE_STOCK_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException('سند ثبت‌شده قابل ویرایش یا حذف نیست؛ برای اصلاح، یک سند «اصلاح موجودی» جدید ثبت کنید.');
    }
  }

  // Omitted → the default warehouse. A given location must exist and be
  // active (unless it's the one the draft already has).
  private async resolveLocation(locationId: number | undefined, currentLocationId?: number) {
    if (locationId === undefined) return (await this.inventory.getDefaultLocation()).id;
    const location = await this.prisma.inventoryLocation.findUnique({ where: { id: locationId }, select: { isActive: true } });
    if (!location || (!location.isActive && locationId !== currentLocationId)) {
      throw new BadRequestException('انبار انتخاب‌شده یافت نشد یا غیرفعال است');
    }
    return locationId;
  }

  // Read-only "exists and active" lookup into Items (CLAUDE.md rule 11's
  // documented exception).
  private async ensureActiveItems(itemIds: number[], alreadyOnDocument: number[] = []) {
    const unique = [...new Set(itemIds)];
    const items = await this.prisma.item.findMany({ where: { id: { in: unique } }, select: { id: true, status: true, name: true } });
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = new Set(alreadyOnDocument);
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) throw new BadRequestException('کالای انتخاب‌شده یافت نشد');
      if (item.status !== 'active' && !kept.has(id)) throw new BadRequestException(`کالای «${item.name}» غیرفعال است`);
    }
  }
}
