import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseRequestPriority, PurchaseRequestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_DEPARTMENT_STATUS } from '../departments/department-rules';
import { ensureActiveUnits } from '../units/unit-rules';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PurchaseQuantitiesService } from '../purchases/purchase-quantities.service';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import type { CreatePurchaseRequestDto, UpdatePurchaseRequestDto } from './dto/purchase-request.dto';

type IncomingItem = UpdatePurchaseRequestDto['items'][number];

export type PurchaseRequestListFilters = {
  q?: string;
  status?: string;
  priority?: string;
  requesterDepartmentId?: number;
};

// Everything the detail page needs — same "one shared include, list() uses
// a lighter one" split as PurchasesService.
const purchaseRequestDetailInclude = {
  requesterDepartment: true,
  // Display fields only — a purchases.view user must not receive the
  // Employee's national ID, mobile, salary, bank account or contract path
  // through this nested include (QA 2026-10-05; see
  // PurchasesService's purchaseDetailInclude for the same fix).
  requestedByEmployee: { select: { id: true, code: true, firstName: true, lastName: true } },
  createdByUser: { select: { id: true, username: true } },
  items: { include: { unit: true }, orderBy: { id: 'asc' } },
  // Purchases this request has already led to — read-only here; a
  // Purchase links back to its request via Purchase.purchaseRequestId,
  // never the other way around (see PurchasesService).
  purchases: {
    select: { id: true, purchaseNumber: true, purchaseDate: true, status: true, totalAmount: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PurchaseRequestInclude;

// Everything purchaseRequestDetailInclude returns, before purchased/remaining
// quantities are attached — used only to type withItemQuantities() below.
type PurchaseRequestWithDetails = Prisma.PurchaseRequestGetPayload<{ include: typeof purchaseRequestDetailInclude }>;

// Statuses recomputeStatus() is allowed to move between — see its own
// comment and the PurchaseRequestStatus enum in schema.prisma.
const AUTO_MANAGED_STATUSES: PurchaseRequestStatus[] = ['APPROVED', 'PARTIALLY_PURCHASED', 'COMPLETED'];

// Statuses ONLY recomputeStatus() may move a request into (CLAUDE.md rule 6).
const SYSTEM_ONLY_STATUSES: PurchaseRequestStatus[] = ['PARTIALLY_PURCHASED', 'COMPLETED'];

// The columns a request line is written with — `id` (update-only, used for
// diffing) is never written; blank optional fields are stored as null.
function toItemData(item: IncomingItem) {
  return {
    name: item.name,
    quantity: item.quantity,
    unitId: item.unitId,
    requiredDate: item.requiredDate ?? null,
    note: item.note ?? null,
  };
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    // The Purchases module owns "what counts as purchased" (CANCELLED
    // excluded) — this module asks it rather than re-deriving that rule
    // (CLAUDE.md rule 11).
    private readonly purchaseQuantities: PurchaseQuantitiesService,
    private readonly audit: AuditService,
  ) {}

  // Without `pagination` this returns the full filtered array (original
  // shape — the Purchase form's "درخواست خرید مرتبط" picker needs the full
  // list, not one page of it). With it, returns one page plus the total
  // matching count: { items, total, page, pageSize } — same opt-in shape as
  // PurchasesService.list().
  async list(filters: PurchaseRequestListFilters, pagination?: PaginationParams) {
    const where: Prisma.PurchaseRequestWhereInput = {};

    if (filters.q) {
      where.OR = [
        { requestNumber: { contains: filters.q, mode: 'insensitive' } },
        { note: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.status) where.status = filters.status as PurchaseRequestStatus;
    if (filters.priority) where.priority = filters.priority as PurchaseRequestPriority;
    if (filters.requesterDepartmentId) where.requesterDepartmentId = filters.requesterDepartmentId;

    const query = {
      where,
      orderBy: [{ requestDate: 'desc' }, { id: 'desc' }],
      include: {
        requesterDepartment: { select: { id: true, code: true, name: true } },
        requestedByEmployee: { select: { id: true, firstName: true, lastName: true } },
        items: { select: { name: true }, orderBy: { id: 'asc' }, take: 1 },
        _count: { select: { items: true, purchases: true } },
      },
    } satisfies Prisma.PurchaseRequestFindManyArgs;

    if (!pagination) return this.prisma.purchaseRequest.findMany(query);

    const [items, total] = await Promise.all([
      this.prisma.purchaseRequest.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const purchaseRequest = await this.prisma.purchaseRequest.findUnique({
      where: { id },
      include: purchaseRequestDetailInclude,
    });
    if (!purchaseRequest) throw new NotFoundException('درخواست خرید پیدا نشد');
    return this.withItemQuantities(purchaseRequest);
  }

  // Attaches derived purchasedQuantity/remainingQuantity to each requested
  // item — computed from the PurchaseItem rows that link back to it via
  // PurchaseItem.purchaseRequestItemId, excluding items on a CANCELLED
  // Purchase (a cancelled purchase never actually delivered anything). That
  // exclusion rule lives in the Purchases module — see
  // PurchaseQuantitiesService.sumQuantitiesByRequestItem().
  // Never stored on the row itself — generated fresh from the underlying
  // transactional data on every read, same principle as Purchase's own
  // totals. remainingQuantity is floored at 0: over-purchasing beyond what
  // was requested is allowed (the business rule for that isn't specified),
  // but "remaining" itself is never negative.
  private async withItemQuantities(request: PurchaseRequestWithDetails) {
    const purchasedByItemId = await this.purchaseQuantities.sumQuantitiesByRequestItem(request.items.map((item) => item.id));

    return {
      ...request,
      items: request.items.map((item) => {
        const purchasedQuantity = purchasedByItemId.get(item.id) ?? 0;
        // Decimal arithmetic, not JS floats — 1000 − 200.2 must come back
        // as 799.8, not 799.8000000000001 (QA 2026-10-05).
        const remaining = new Prisma.Decimal(item.quantity).minus(purchasedQuantity);
        return {
          ...item,
          purchasedQuantity,
          remainingQuantity: Prisma.Decimal.max(0, remaining).toNumber(),
        };
      }),
    };
  }

  // Auto-managed transition, triggered from PurchasesService whenever a
  // Purchase linked to this request (via Purchase.purchaseRequestId) is
  // created, edited, or removed — and at the end of this service's own
  // update() (an edit can change items/quantities, or approve a request
  // that already has linked purchases). Only moves between
  // APPROVED ⇄ PARTIALLY_PURCHASED ⇄ COMPLETED (see AUTO_MANAGED_STATUSES);
  // a request still in DRAFT/SUBMITTED, or already REJECTED/CANCELLED, is
  // left untouched — a Purchase should never approve, reject, or revive a
  // request on the company's behalf. Creating a Purchase from a request
  // item never by itself marks the request COMPLETED — only the actual
  // purchased-vs-requested quantities decide that.
  async recomputeStatus(requestId: number, userId: number | null, ipAddress?: string) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id: requestId },
      include: { items: { select: { id: true, quantity: true } } },
    });
    if (!request) return;
    if (!AUTO_MANAGED_STATUSES.includes(request.status)) return;

    // Same purchased-quantity source as withItemQuantities() — the Purchases
    // module decides what counts (CANCELLED excluded).
    const purchasedByItemId = await this.purchaseQuantities.sumQuantitiesByRequestItem(request.items.map((item) => item.id));
    let anyPurchased = false;
    let allFullyPurchased = true;
    for (const item of request.items) {
      const purchased = purchasedByItemId.get(item.id) ?? 0;
      if (purchased > 0) anyPurchased = true;
      if (purchased < Number(item.quantity)) allFullyPurchased = false;
    }

    const nextStatus: PurchaseRequestStatus = !anyPurchased ? 'APPROVED' : allFullyPurchased ? 'COMPLETED' : 'PARTIALLY_PURCHASED';
    if (nextStatus === request.status) return;

    await this.prisma.purchaseRequest.update({ where: { id: requestId }, data: { status: nextStatus } });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_REQUEST_STATUS_CHANGED', entityType: AUDIT_ENTITY.PURCHASE_REQUEST, entityId: requestId, details: `از ${request.status} به ${nextStatus} (خودکار، بر اساس مقدار خریداری‌شده)` });
  }

  // Same placeholder-then-fix pattern as PurchasesService.create() —
  // requestNumber depends on the row's own id, so it's inserted with a
  // throwaway value and corrected inside the same transaction.
  async create(dto: CreatePurchaseRequestDto, userId: number | null, ipAddress?: string) {
    await this.ensureDepartment(dto.requesterDepartmentId);
    if (dto.requestedByEmployeeId) await this.ensureEmployee(dto.requestedByEmployeeId);
    await this.ensureUnits(dto.items.map((item) => item.unitId));

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.create({
        data: {
          requestNumber: `PENDING-${randomUUID()}`,
          requestDate: dto.requestDate,
          requesterDepartmentId: dto.requesterDepartmentId,
          requestedByEmployeeId: dto.requestedByEmployeeId,
          priority: dto.priority,
          note: dto.note,
          createdByUserId: userId ?? undefined,
          items: { create: dto.items.map(toItemData) },
        },
      });
      const requestNumber = `REQ-${String(request.id).padStart(6, '0')}`;
      return tx.purchaseRequest.update({
        where: { id: request.id },
        data: { requestNumber },
        include: purchaseRequestDetailInclude,
      });
    });

    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_REQUEST_CREATED', entityType: AUDIT_ENTITY.PURCHASE_REQUEST, entityId: created.id });
    // Same response shape as get() (purchasedQuantity/remainingQuantity on
    // every item) — a brand-new request has nothing purchased yet.
    return this.withItemQuantities(created);
  }

  // Items are DIFFED, never deleted-and-recreated (QA 2026-10-05, CRITICAL):
  // purchase_items.purchase_request_item_id is ON DELETE SET NULL, so the
  // old delete-all-then-recreate silently unlinked every Purchase line from
  // the request on ANY edit — even a priority-only change or the detail
  // page's تایید/رد buttons, which PATCH the whole record.
  //
  // Each incoming line is matched to an existing row (see matchItems()):
  // matched rows are updated in place (keeping their id, and with it every
  // Purchase link), unmatched incoming lines are created, and unmatched
  // existing rows are deleted — but only if no PurchaseItem references them.
  // A line that has purchases against it can't be removed, can't change its
  // unit, and can't drop below the quantity already purchased; each is
  // refused with a Persian message rather than silently losing data.
  //
  // PARTIALLY_PURCHASED / COMPLETED can never be chosen here (rule 6) — a
  // PATCH that merely echoes the request's current status is fine. After the
  // edit, recomputeStatus() re-derives purchasing progress.
  //
  // Optimistic locking: dto.updatedAt is the version the client loaded
  // (the edit form and the تایید/رد buttons both send it). A mismatch is a
  // 409 RECORD_MODIFIED, re-checked atomically inside the transaction.
  async update(id: number, dto: UpdatePurchaseRequestDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (dto.status !== existing.status && SYSTEM_ONLY_STATUSES.includes(dto.status)) {
      throw new ConflictException('وضعیت‌های «خرید جزئی» و «تکمیل‌شده» به‌صورت خودکار و بر اساس خریدهای ثبت‌شده تعیین می‌شوند و قابل انتخاب دستی نیستند');
    }
    // Same "only re-check a reference that is actually changing" rule as
    // PurchasesService.update() / ItemsService.ensureReferences().
    if (dto.requesterDepartmentId !== existing.requesterDepartmentId) await this.ensureDepartment(dto.requesterDepartmentId);
    if (dto.requestedByEmployeeId && dto.requestedByEmployeeId !== existing.requestedByEmployeeId) {
      await this.ensureEmployee(dto.requestedByEmployeeId);
    }
    await this.ensureUnits(
      dto.items.map((item) => item.unitId),
      existing.items.map((item) => item.unitId),
    );

    const { updates, creates, deleteIds } = await this.planItemChanges(existing.items, dto.items);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseRequest.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          requestDate: dto.requestDate,
          requesterDepartmentId: dto.requesterDepartmentId,
          requestedByEmployeeId: dto.requestedByEmployeeId ?? null,
          status: dto.status,
          priority: dto.priority,
          note: dto.note,
          items: {
            ...(deleteIds.length > 0 ? { deleteMany: { id: { in: deleteIds } } } : {}),
            update: updates,
            create: creates,
          },
        },
      });
    });

    const action = existing.status !== dto.status ? 'PURCHASE_REQUEST_STATUS_CHANGED' : 'PURCHASE_REQUEST_UPDATED';
    const details = existing.status !== dto.status ? `از ${existing.status} به ${dto.status}` : undefined;
    await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PURCHASE_REQUEST, entityId: id, details });
    await this.recomputeStatus(id, userId, ipAddress);
    // Same shape as get() (purchasedQuantity/remainingQuantity attached) and
    // re-read after recomputeStatus() so the returned status is current —
    // the detail page applies this response directly instead of re-fetching.
    return this.get(id);
  }

  // Works out the nested item writes for update(). Throws (409, Persian) if
  // the edit would remove, re-unit or under-size a line that purchases are
  // already recorded against.
  private async planItemChanges(
    existingItems: { id: number; name: string; unitId: number; purchasedQuantity: number }[],
    incoming: IncomingItem[],
  ) {
    const matches = this.matchItems(existingItems, incoming);
    const matchedIds = new Set(matches.filter((row) => row !== undefined).map((row) => row.id));
    const removed = existingItems.filter((row) => !matchedIds.has(row.id));
    const unitChanged = incoming
      .map((item, index) => ({ item, row: matches[index] }))
      .filter((pair): pair is { item: IncomingItem; row: (typeof existingItems)[number] } => pair.row !== undefined && pair.row.unitId !== pair.item.unitId);

    // Any PurchaseItem link counts here, cancelled purchases included — the
    // link itself is history (asked of the Purchases module, rule 11).
    const linked = await this.purchaseQuantities.findLinkedRequestItemIds([
      ...removed.map((row) => row.id),
      ...unitChanged.map(({ row }) => row.id),
    ]);
    for (const row of removed) {
      if (linked.has(row.id)) {
        throw new ConflictException(`برای قلم «${row.name}» خرید ثبت شده است و نمی‌توان آن را از درخواست حذف کرد`);
      }
    }
    for (const { row } of unitChanged) {
      if (linked.has(row.id)) {
        throw new ConflictException(`برای قلم «${row.name}» خرید ثبت شده است و واحد آن قابل تغییر نیست`);
      }
    }
    incoming.forEach((item, index) => {
      const row = matches[index];
      if (row && new Prisma.Decimal(item.quantity).lessThan(row.purchasedQuantity)) {
        throw new ConflictException(`مقدار قلم «${row.name}» نمی‌تواند کمتر از مقدار خریداری‌شده (${row.purchasedQuantity}) باشد`);
      }
    });

    return {
      updates: incoming.flatMap((item, index) => {
        const row = matches[index];
        return row ? [{ where: { id: row.id }, data: toItemData(item) }] : [];
      }),
      creates: incoming.filter((_item, index) => matches[index] === undefined).map(toItemData),
      deleteIds: removed.map((row) => row.id),
    };
  }

  // Pairs each incoming line with at most one existing row: first by an
  // explicit `id` (must belong to this request), then — for clients that
  // don't send ids, like the current edit form and the تایید/رد buttons —
  // by identical name + unit, then by identical name alone. Anything left
  // unmatched is a new line.
  private matchItems<T extends { id: number; name: string; unitId: number }>(existingItems: T[], incoming: IncomingItem[]) {
    const matches: (T | undefined)[] = new Array<T | undefined>(incoming.length).fill(undefined);
    const claimed = new Set<number>();
    const existingById = new Map(existingItems.map((row) => [row.id, row]));

    incoming.forEach((item, index) => {
      if (item.id === undefined) return;
      const row = existingById.get(item.id);
      if (!row) throw new ConflictException('یکی از اقلام ارسال‌شده متعلق به این درخواست خرید نیست');
      if (claimed.has(row.id)) throw new ConflictException('یک قلم درخواست بیش از یک بار ارسال شده است');
      claimed.add(row.id);
      matches[index] = row;
    });

    for (const requireSameUnit of [true, false]) {
      incoming.forEach((item, index) => {
        if (item.id !== undefined || matches[index]) return;
        const row = existingItems.find(
          (candidate) =>
            !claimed.has(candidate.id) &&
            candidate.name.trim() === item.name.trim() &&
            (!requireSameUnit || candidate.unitId === item.unitId),
        );
        if (row) {
          claimed.add(row.id);
          matches[index] = row;
        }
      });
    }
    return matches;
  }

  private async ensureDepartment(id: number) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || department.status !== ACTIVE_DEPARTMENT_STATUS) throw new ConflictException('دپارتمان درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureEmployee(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.status !== 'active') throw new ConflictException('کارمند درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  // A unit must exist and be active to be newly assigned; units this
  // request's lines already use (`alreadyAssigned`, on update) may stay even
  // if deactivated since — same rule as ItemsService.ensureReferences().
  private async ensureUnits(unitIds: number[], alreadyAssigned: number[] = []) {
    await ensureActiveUnits(this.prisma, unitIds, alreadyAssigned, 'یکی از واحدهای انتخاب‌شده برای اقلام درخواست معتبر یا فعال نیست');
  }
}
