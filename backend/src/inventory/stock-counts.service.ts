import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockCountStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import { InventoryService } from './inventory.service';
import { CANCELLABLE_STOCK_COUNT_STATUSES, EDITABLE_STOCK_COUNT_STATUSES, STOCK_COUNT_DOC_TYPE } from './inventory-rules';
import { applyMovements, type MovementInput } from './stock-ledger';
import type {
  ApproveStockCountDto,
  CancelStockCountDto,
  CreateStockCountDto,
  EnterStockCountDto,
  RequestRecountStockCountDto,
  StartStockCountDto,
  SubmitStockCountDto,
  UpdateStockCountDto,
} from './dto/stock-count.dto';

export type StockCountListFilters = { q?: string; status?: StockCountStatus; scope?: 'FULL' | 'PARTIAL'; locationId?: number; sort?: SortParams };

// B13 (not yet confirmed by the business owner — the architect's documented
// default was adopted so the batch could proceed; see
// docs/inventory-module-build-plan.md §3): what the caller may see. Same
// "flag from the session, decide in the service" pattern as
// GoodsReceiptsController's CostAccess. Only inventory.approve sees
// systemQty/varianceQty while a blind count is COUNTING.
export type CountAccess = { canSeeSystemQty: boolean };

const stockCountDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  createdByUser: { select: { id: true, username: true } },
  startedByUser: { select: { id: true, username: true } },
  submittedByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  cancelledByUser: { select: { id: true, username: true } },
  items: {
    include: {
      item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
      countedByUser: { select: { id: true, username: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockCountInclude;

// B13: strips systemQty/varianceQty from every line unless the caller holds
// inventory.approve — server-side, not a frontend hide. Only while the
// document is both isBlind and COUNTING; REVIEW/POSTED/CANCELLED reveal both
// to anyone who could already read the document (inventory.view).
function maskBlindFields<T extends { status: string; isBlind: boolean; items: Record<string, unknown>[] }>(count: T, access: CountAccess): T {
  if (access.canSeeSystemQty) return count;
  if (!(count.isBlind && count.status === 'COUNTING')) return count;
  return {
    ...count,
    items: count.items.map((item) => {
      const copy = { ...item };
      delete copy.systemQty;
      delete copy.varianceQty;
      return copy;
    }),
  };
}

// Columns the stock-counts table can be sorted by (the line count is derived).
const STOCK_COUNT_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.StockCountOrderByWithRelationInput> = {
  countNumber: (dir) => ({ countNumber: { sort: dir, nulls: 'last' } }),
  countDate: (dir) => ({ countDate: dir }),
  scope: (dir) => ({ scope: dir }),
  isBlind: (dir) => ({ isBlind: dir }),
  location: (dir) => ({ location: { name: dir } }),
  createdBy: (dir) => ({ createdByUser: { username: dir } }),
  status: (dir) => ({ status: dir }),
};

// Stock counts (شمارش موجودی) — Inventory batch I6, build plan §5.6/§6.
// B13 (adopted the architect's documented default, NOT yet confirmed by the
// business owner): blind entry while COUNTING, approval by a different
// person than the submitter (reusing B10's no-self-approval rule), and
// "stale-line" detection instead of freezing warehouse operations during a
// count.
//
// Lifecycle: DRAFT (editable/deletable) → COUNTING (start(), systemQty
// snapshotted per line at startedAt) → REVIEW (submit(), every line
// counted) → POSTED (approve(), variances posted as COUNT_GAIN/COUNT_LOSS,
// numbered CNT-<jalali year>-000001) or CANCELLED (any time before POSTED).
// REVIEW may also go back to COUNTING for selected lines (requestRecount())
// — the un-staling mechanism: it refreshes those lines' systemQty and bumps
// the document's startedAt, which is safe for every OTHER line too (a line
// that wasn't flagged stale, by definition, had no movement between the old
// and new startedAt, so its old systemQty is still accurate as of the new
// anchor).
@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Pickers for the count form, behind inventory.count (same rationale as
  // GoodsReceiptsService.formOptions() — the counting roles don't necessarily
  // hold items.view): the default/active locations and every active item.
  // Not restricted by itemKind — a physical count covers whatever is
  // physically on the shelf, finished good or raw material alike.
  async formOptions() {
    const [defaultLocation, locations, items] = await Promise.all([
      this.inventory.getDefaultLocation(),
      this.prisma.inventoryLocation.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ id: 'asc' }] }),
      this.prisma.item.findMany({
        where: { status: 'active' },
        select: { id: true, code: true, name: true, itemKind: true, unit: { select: { id: true, nameFa: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { defaultLocationId: defaultLocation.id, locations, items };
  }

  async list(filters: StockCountListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.StockCountWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.scope) where.scope = filters.scope;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.q) where.countNumber = { contains: filters.q, mode: 'insensitive' };
    const query = {
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
      orderBy: buildOrderBy(filters.sort, STOCK_COUNT_SORT_COLUMNS, [{ countDate: 'desc' }, { id: 'desc' }], [{ id: 'desc' }]),
    } satisfies Prisma.StockCountFindManyArgs;

    if (!pagination) return this.prisma.stockCount.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.stockCount.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.stockCount.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number, access: CountAccess) {
    const count = await this.findOrThrow(id);
    return maskBlindFields(count as never, access) as typeof count;
  }

  async create(dto: CreateStockCountDto, userId: number | null, ipAddress?: string) {
    const locationId = await this.resolveLocation(dto.locationId);
    await this.ensureActiveItems(dto.items.map((line) => line.itemId));
    await this.ensureBatchesValid(dto.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.create({
        data: {
          status: 'DRAFT',
          locationId,
          countDate: dto.countDate,
          scope: dto.scope,
          isBlind: dto.isBlind,
          note: dto.note ?? null,
          createdByUserId: userId,
          items: { create: dto.items.map((line) => ({ itemId: line.itemId, batchId: line.batchId ?? null, note: line.note ?? null })) },
        },
        include: stockCountDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_COUNT_CREATED',
          entityType: AUDIT_ENTITY.STOCK_COUNT,
          entityId: count.id,
          details: `پیش‌نویس — ${dto.scope === 'FULL' ? 'شمارش کامل' : `شمارش بخشی، ${dto.items.length} ردیف`}`,
        },
        tx,
      );
      return count;
    });
    return created;
  }

  // Full-record edit of a DRAFT: header + (PARTIAL) lines replaced wholesale,
  // with the usual optimistic lock — same convention as every other
  // document in this module.
  async update(id: number, dto: UpdateStockCountDto, userId: number | null, ipAddress?: string) {
    const existing = await this.findOrThrow(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    await this.ensureActiveItems(
      dto.items.map((line) => line.itemId),
      existing.items.map((line) => line.itemId),
    );
    await this.ensureBatchesValid(dto.items);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockCount.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.stockCountItem.deleteMany({ where: { stockCountId: id } });
      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          locationId,
          countDate: dto.countDate,
          scope: dto.scope,
          isBlind: dto.isBlind,
          note: dto.note ?? null,
          items: { create: dto.items.map((line) => ({ itemId: line.itemId, batchId: line.batchId ?? null, note: line.note ?? null })) },
        },
        include: stockCountDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_UPDATED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return updated;
    });
  }

  // DRAFT → COUNTING. FULL scope: enumerate every item with a balance row at
  // the location (real stock balances, not an invented list) and create one
  // line per item. PARTIAL scope: the lines already exist (create()/
  // update()) — just snapshot their systemQty. Either way, systemQty is the
  // current ON_HAND of the item (or, if the line names one, its batch) at
  // this location, read under the same lock every posting method uses.
  async start(id: number, dto: StartStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true, location: { select: { isActive: true } } } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (count.status !== 'DRAFT') throw new ConflictException('این سند در وضعیت «پیش‌نویس» نیست و قابل شروع نیست');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (!count.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');

      const now = new Date();
      if (count.scope === 'FULL') {
        const balances = await tx.stockBalance.findMany({ where: { locationId: count.locationId }, select: { itemId: true, onHand: true } });
        if (balances.length === 0) throw new BadRequestException('در این انبار هیچ موجودی ثبت‌شده‌ای وجود ندارد؛ شمارش کامل قابل شروع نیست');
        await tx.stockCountItem.createMany({
          data: balances.map((balance) => ({ stockCountId: id, itemId: balance.itemId, systemQty: balance.onHand })),
        });
      } else {
        if (count.items.length === 0) throw new BadRequestException('سند شمارش بدون ردیف کالا قابل شروع نیست');
        for (const item of count.items) {
          const systemQty = await this.readCurrentOnHand(tx, item.itemId, count.locationId, item.batchId);
          await tx.stockCountItem.update({ where: { id: item.id }, data: { systemQty } });
        }
      }

      await tx.stockCount.update({ where: { id }, data: { status: 'COUNTING', startedAt: now, startedByUserId: userId } });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_STARTED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: `شروع شمارش — ${count.scope === 'FULL' ? 'کامل' : 'بخشی'}` },
        tx,
      );
    });
    return this.get(id, access);
  }

  // Records countedQty (and, optionally, a reasonCode/note) per line while
  // COUNTING. Any subset of lines, any number of calls — a later call
  // overwrites an earlier one for the same line. countedByUserId is always
  // the caller of THIS call, even if they're correcting someone else's entry.
  async enterCount(id: number, dto: EnterStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (count.status !== 'COUNTING') throw new ConflictException('سند در وضعیت «در حال شمارش» نیست؛ امکان ثبت شمارش وجود ندارد');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();

      const byId = new Map(count.items.map((item) => [item.id, item]));
      for (const line of dto.lines) {
        if (!byId.has(line.stockCountItemId)) throw new BadRequestException('ردیف انتخاب‌شده متعلق به این سند نیست');
      }
      for (const line of dto.lines) {
        await tx.stockCountItem.update({
          where: { id: line.stockCountItemId },
          data: { countedQty: line.countedQty, countedByUserId: userId, ...(line.reasonCode !== undefined ? { reasonCode: line.reasonCode } : {}), ...(line.note !== undefined ? { note: line.note } : {}) },
        });
      }
      await tx.stockCount.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_COUNTED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: `ثبت شمارش — ${dto.lines.length} ردیف` },
        tx,
      );
    });
    return this.get(id, access);
  }

  // COUNTING → REVIEW. Every line must have a countedQty. Computes and
  // stores varianceQty = counted − system for every line — pure arithmetic,
  // no permission concern on its own (the stored value is still masked from
  // a non-approver by get()/maskBlindFields() while still COUNTING, though
  // by definition submit() always leaves COUNTING, so REVIEW reveals it to
  // anyone who can read the document at all).
  async submit(id: number, dto: SubmitStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (count.status !== 'COUNTING') throw new ConflictException('سند در وضعیت «در حال شمارش» نیست و قابل ارسال برای بررسی نیست');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      const missing = count.items.filter((item) => item.countedQty === null);
      if (missing.length > 0) {
        throw new BadRequestException(`برای ${missing.length} ردیف هنوز مقدار شمارش‌شده ثبت نشده است؛ پیش از ارسال برای بررسی، همهٔ ردیف‌ها را شمارش کنید`);
      }

      for (const item of count.items) {
        const variance = new Prisma.Decimal(item.countedQty!).minus(new Prisma.Decimal(item.systemQty ?? 0));
        await tx.stockCountItem.update({ where: { id: item.id }, data: { varianceQty: variance } });
      }
      await tx.stockCount.update({ where: { id }, data: { status: 'REVIEW', submittedAt: new Date(), submittedByUserId: userId } });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_SUBMITTED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: `ارسال برای بررسی — ${count.items.length} ردیف` },
        tx,
      );
    });
    return this.get(id, access);
  }

  // REVIEW → POSTED. No self-approval (B10's rule, reused — the approver
  // must not be the user who submitted). Stale check FIRST: if any ON_HAND
  // movement happened for a counted item at this location after startedAt,
  // refuses with 409 COUNT_STALE naming the items, without posting anything
  // — the caller must requestRecount() those lines instead. Otherwise, each
  // line with a non-zero variance needs a reasonCode (from an earlier
  // enterCount() call or from this call's own `lines`); posts COUNT_GAIN/
  // COUNT_LOSS via applyMovements(), claims CNT-<jalali year>-NNNNNN, marks
  // POSTED. A loss that leaves stock over-committed still posts (B12) — the
  // response carries a `warnings` array instead of blocking.
  async approve(id: number, dto: ApproveStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    const warnings = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true, location: { select: { isActive: true } } } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (count.status !== 'REVIEW') throw new ConflictException('این سند در وضعیت «در انتظار بررسی» نیست و قابل تأیید نیست');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (userId !== null && count.submittedByUserId !== null && count.submittedByUserId === userId) {
        throw new ConflictException('ارسال‌کنندهٔ سند نمی‌تواند همان سند را تأیید کند؛ باید کاربر دیگری آن را تأیید کند.');
      }
      if (!count.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');

      // Stale check — before anything else is validated or written.
      const itemIds = [...new Set(count.items.map((item) => item.itemId))];
      const staleMovements = await tx.stockMovement.findMany({
        where: { itemId: { in: itemIds }, locationId: count.locationId, bucket: 'ON_HAND', createdAt: { gt: count.startedAt ?? new Date(0) } },
        select: { itemId: true },
      });
      if (staleMovements.length > 0) {
        const staleItemIds = new Set(staleMovements.map((m) => m.itemId));
        const staleLines = count.items.filter((item) => staleItemIds.has(item.itemId));
        const items = await tx.item.findMany({ where: { id: { in: [...staleItemIds] } }, select: { id: true, code: true, name: true } });
        const byId = new Map(items.map((item) => [item.id, item]));
        const labels = [...staleItemIds].map((itemId) => {
          const item = byId.get(itemId);
          return item ? `«${item.name}» (${item.code})` : `کالا #${itemId}`;
        });
        throw new ConflictException({
          statusCode: 409,
          code: 'COUNT_STALE',
          message: `پس از شروع این شمارش، رویداد انباری برای این کالاها ثبت شده است؛ ابتدا شمارش مجدد را درخواست کنید: ${labels.join('، ')}`,
          details: { itemIds: [...staleItemIds], stockCountItemIds: staleLines.map((line) => line.id) },
        });
      }

      // Reason codes — required for every non-zero-variance line, from
      // either an earlier enterCount() or this call's own `lines`.
      const reasonOverrides = new Map(dto.lines.map((line) => [line.stockCountItemId, line.reasonCode]));
      const rows: MovementInput[] = [];
      const varianceUpdates: { id: number; itemId: number; locationId: number; varianceQty: Prisma.Decimal; reasonCode: string }[] = [];
      const missingReason: string[] = [];
      for (const item of count.items) {
        const systemQty = new Prisma.Decimal(item.systemQty ?? 0);
        const countedQty = new Prisma.Decimal(item.countedQty ?? 0);
        const variance = countedQty.minus(systemQty);
        if (variance.isZero()) continue;
        const reasonCode = reasonOverrides.get(item.id) ?? item.reasonCode ?? undefined;
        if (!reasonCode) {
          missingReason.push(`ردیف کالا #${item.itemId}`);
          continue;
        }
        rows.push({
          itemId: item.itemId,
          locationId: count.locationId,
          bucket: 'ON_HAND',
          movementType: variance.isPositive() ? 'COUNT_GAIN' : 'COUNT_LOSS',
          quantity: variance,
          movementDate: count.countDate,
          referenceType: 'STOCK_COUNT',
          referenceId: count.id,
          referenceLineId: item.id,
          note: item.note,
          createdByUserId: userId,
          batchId: item.batchId ?? null,
        });
        varianceUpdates.push({ id: item.id, itemId: item.itemId, locationId: count.locationId, varianceQty: variance, reasonCode });
      }
      if (missingReason.length > 0) {
        throw new BadRequestException(`علت مغایرت برای این ردیف‌ها الزامی است: ${missingReason.join('، ')}`);
      }

      const countNumber = await nextDocumentNumber(tx, STOCK_COUNT_DOC_TYPE, count.countDate);
      if (rows.length > 0) {
        await applyMovements(
          tx,
          rows.map((row) => ({ ...row, referenceNumber: countNumber })),
        );
      }
      for (const update of varianceUpdates) {
        await tx.stockCountItem.update({ where: { id: update.id }, data: { varianceQty: update.varianceQty, reasonCode: update.reasonCode as never } });
      }

      // B12: a loss may still post even if it leaves stock over-committed —
      // a warning, never a block.
      const lineWarnings: { itemId: number; available: string }[] = [];
      for (const update of varianceUpdates.filter((u) => u.varianceQty.isNegative())) {
        const balance = await tx.stockBalance.findUnique({ where: { itemId_locationId: { itemId: update.itemId, locationId: update.locationId } }, select: { onHand: true, reserved: true } });
        if (!balance) continue;
        const available = new Prisma.Decimal(balance.onHand).minus(new Prisma.Decimal(balance.reserved));
        if (available.isNegative()) lineWarnings.push({ itemId: update.itemId, available: available.toString() });
      }

      await tx.stockCount.update({ where: { id }, data: { status: 'POSTED', countNumber, postedByUserId: userId, postedAt: new Date() } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_COUNT_APPROVED',
          entityType: AUDIT_ENTITY.STOCK_COUNT,
          entityId: id,
          details: `${countNumber} — ${varianceUpdates.length} ردیف با مغایرت از ${count.items.length} ردیف`,
        },
        tx,
      );
      return lineWarnings;
    });
    return { ...(await this.get(id, access)), warnings };
  }

  // REVIEW → COUNTING for the selected lines only (the un-staling
  // mechanism): refreshes their systemQty, clears countedQty/varianceQty/
  // reasonCode so they must be re-entered, increments recountCount. Bumps
  // the document's startedAt forward — safe for every other (non-selected)
  // line too, since a line that wasn't flagged stale had, by definition, no
  // movement between the old and new startedAt.
  async requestRecount(id: number, dto: RequestRecountStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (count.status !== 'REVIEW') throw new ConflictException('این سند در وضعیت «در انتظار بررسی» نیست و قابل درخواست شمارش مجدد نیست');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();

      const byId = new Map(count.items.map((item) => [item.id, item]));
      for (const lineId of dto.lineIds) {
        if (!byId.has(lineId)) throw new BadRequestException('ردیف انتخاب‌شده متعلق به این سند نیست');
      }

      const now = new Date();
      for (const lineId of dto.lineIds) {
        const item = byId.get(lineId)!;
        const systemQty = await this.readCurrentOnHand(tx, item.itemId, count.locationId, item.batchId);
        await tx.stockCountItem.update({
          where: { id: lineId },
          data: { systemQty, countedQty: null, varianceQty: null, reasonCode: null, countedByUserId: null, recountCount: { increment: 1 } },
        });
      }
      await tx.stockCount.update({
        where: { id },
        data: { status: 'COUNTING', startedAt: now, submittedAt: null, submittedByUserId: null },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'STOCK_COUNT_RECOUNT_REQUESTED',
          entityType: AUDIT_ENTITY.STOCK_COUNT,
          entityId: id,
          details: `درخواست شمارش مجدد — ${dto.lineIds.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id, access);
  }

  // DRAFT/COUNTING/REVIEW → CANCELLED. Reason required. Same permission as
  // create/start/submit (inventory.count), the same convention as
  // SalesOrdersService.cancel() using sales.manage rather than the
  // approval-level permission (sales.approve) — the document's own
  // "manage" permission cancels it, at any pre-posting status.
  async cancel(id: number, dto: CancelStockCountDto, access: CountAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      if (!CANCELLABLE_STOCK_COUNT_STATUSES.includes(count.status)) throw new ConflictException('این سند در وضعیتی نیست که قابل لغو باشد');
      if (!isSameVersion(count.updatedAt, dto.updatedAt)) throw recordModifiedConflict();

      await tx.stockCount.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledByUserId: userId, cancelledAt: new Date(), cancelReason: dto.cancelReason },
      });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_CANCELLED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: dto.cancelReason },
        tx,
      );
    });
    return this.get(id, access);
  }

  // DRAFT only. A count that has ever been started has history worth
  // keeping (even a CANCELLED one) — cancel() instead.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
      if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
      this.ensureEditable(count.status);
      await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, label: 'پیش‌نویس شمارش موجودی', record: count, userId });
      await tx.stockCount.delete({ where: { id } });
      await this.audit.log(
        { userId, ipAddress, action: 'STOCK_COUNT_DELETED', entityType: AUDIT_ENTITY.STOCK_COUNT, entityId: id, details: 'پیش‌نویس' },
        tx,
      );
    });
    return { success: true };
  }

  // Current ON_HAND of the item (or, if batchId is given, that batch) at
  // this location — read under the caller's existing row lock. A missing
  // balance row is zero, not an error (a line with literally nothing
  // recorded yet is still a valid thing to count).
  private async readCurrentOnHand(tx: Prisma.TransactionClient, itemId: number, locationId: number, batchId: number | null): Promise<Prisma.Decimal> {
    if (batchId) {
      const rows = await tx.stockBatchBalance.findMany({ where: { batchId, locationId }, select: { onHand: true } });
      return rows[0] ? new Prisma.Decimal(rows[0].onHand) : new Prisma.Decimal(0);
    }
    const balance = await tx.stockBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } }, select: { onHand: true } });
    return balance ? new Prisma.Decimal(balance.onHand) : new Prisma.Decimal(0);
  }

  private async findOrThrow(id: number) {
    const count = await this.prisma.stockCount.findUnique({ where: { id }, include: stockCountDetailInclude });
    if (!count) throw new NotFoundException('سند شمارش موجودی پیدا نشد');
    return count;
  }

  private ensureEditable(status: StockCountStatus) {
    if (!EDITABLE_STOCK_COUNT_STATUSES.includes(status)) {
      throw new ConflictException('سند شمارش در این وضعیت قابل ویرایش یا حذف نیست');
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
  // documented exception) — same shape as StockAdjustmentsService's.
  private async ensureActiveItems(itemIds: number[], alreadyOnDocument: number[] = []) {
    const unique = [...new Set(itemIds)];
    if (unique.length === 0) return;
    const items = await this.prisma.item.findMany({ where: { id: { in: unique } }, select: { id: true, status: true, name: true } });
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = new Set(alreadyOnDocument);
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) throw new BadRequestException('کالای انتخاب‌شده یافت نشد');
      if (item.status !== 'active' && !kept.has(id)) throw new BadRequestException(`کالای «${item.name}» غیرفعال است`);
    }
  }

  // A count line never creates a new batch (unlike receipts/adjustments'
  // typed-lot-number lines) — only an existing batch of the same item may
  // be picked.
  private async ensureBatchesValid(items: { itemId: number; batchId?: number }[]) {
    const batchIds = items.map((item) => item.batchId).filter((id): id is number => typeof id === 'number');
    if (batchIds.length === 0) return;
    const batches = await this.prisma.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, itemId: true } });
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    items.forEach((item, index) => {
      if (item.batchId === undefined) return;
      const batch = byId.get(item.batchId);
      if (!batch || batch.itemId !== item.itemId) {
        throw new BadRequestException(`ردیف ${index + 1}: بچ انتخاب‌شده برای این کالا معتبر نیست`);
      }
    });
  }
}
