import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseRequestPriority, PurchaseRequestStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePurchaseRequestDto, UpdatePurchaseRequestDto } from './dto/purchase-request.dto';

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
  requestedByEmployee: true,
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

@Injectable()
export class PurchaseRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  list(filters: PurchaseRequestListFilters) {
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

    return this.prisma.purchaseRequest.findMany({
      where,
      orderBy: [{ requestDate: 'desc' }, { id: 'desc' }],
      include: {
        requesterDepartment: { select: { id: true, code: true, name: true } },
        requestedByEmployee: { select: { id: true, firstName: true, lastName: true } },
        items: { select: { name: true }, orderBy: { id: 'asc' }, take: 1 },
        _count: { select: { items: true, purchases: true } },
      },
    });
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
  // Purchase (a cancelled purchase never actually delivered anything).
  // Never stored on the row itself — generated fresh from the underlying
  // transactional data on every read, same principle as Purchase's own
  // totals. remainingQuantity is floored at 0: over-purchasing beyond what
  // was requested is allowed (the business rule for that isn't specified),
  // but "remaining" itself is never negative.
  private async withItemQuantities(request: PurchaseRequestWithDetails) {
    const itemIds = request.items.map((item) => item.id);
    const purchasedRows = itemIds.length
      ? await this.prisma.purchaseItem.groupBy({
          by: ['purchaseRequestItemId'],
          where: { purchaseRequestItemId: { in: itemIds }, purchase: { status: { not: 'CANCELLED' } } },
          _sum: { quantity: true },
        })
      : [];
    const purchasedByItemId = new Map<number, number>(
      purchasedRows
        .filter((row) => row.purchaseRequestItemId !== null)
        .map((row) => [row.purchaseRequestItemId as number, Number(row._sum.quantity ?? 0)]),
    );

    return {
      ...request,
      items: request.items.map((item) => {
        const requestedQuantity = Number(item.quantity);
        const purchasedQuantity = purchasedByItemId.get(item.id) ?? 0;
        return {
          ...item,
          purchasedQuantity,
          remainingQuantity: Math.max(0, requestedQuantity - purchasedQuantity),
        };
      }),
    };
  }

  // Auto-managed transition, triggered from PurchasesService whenever a
  // Purchase linked to this request (via Purchase.purchaseRequestId) is
  // created, edited, or removed — never called from this service's own
  // create()/update(), which are plain user edits. Only moves between
  // APPROVED ⇄ PARTIALLY_PURCHASED ⇄ COMPLETED (see AUTO_MANAGED_STATUSES);
  // a request still in DRAFT/SUBMITTED, or already REJECTED/CANCELLED, is
  // left untouched — a Purchase should never approve, reject, or revive a
  // request on the company's behalf. Creating a Purchase from a request
  // item never by itself marks the request COMPLETED — only the actual
  // purchased-vs-requested quantities decide that.
  async recomputeStatus(requestId: number, userId: number | null, ipAddress?: string) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id: requestId },
      include: {
        items: {
          select: {
            quantity: true,
            purchaseItems: {
              where: { purchase: { status: { not: 'CANCELLED' } } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    if (!request) return;
    if (!AUTO_MANAGED_STATUSES.includes(request.status)) return;

    let anyPurchased = false;
    let allFullyPurchased = true;
    for (const item of request.items) {
      const purchased = item.purchaseItems.reduce((sum, purchaseItem) => sum + Number(purchaseItem.quantity), 0);
      if (purchased > 0) anyPurchased = true;
      if (purchased < Number(item.quantity)) allFullyPurchased = false;
    }

    const nextStatus: PurchaseRequestStatus = !anyPurchased ? 'APPROVED' : allFullyPurchased ? 'COMPLETED' : 'PARTIALLY_PURCHASED';
    if (nextStatus === request.status) return;

    await this.prisma.purchaseRequest.update({ where: { id: requestId }, data: { status: nextStatus } });
    await this.writeAuditLog(userId, ipAddress, 'PURCHASE_REQUEST_STATUS_CHANGED', requestId, `از ${request.status} به ${nextStatus} (خودکار، بر اساس مقدار خریداری‌شده)`);
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
          items: { create: dto.items },
        },
      });
      const requestNumber = `REQ-${String(request.id).padStart(6, '0')}`;
      return tx.purchaseRequest.update({
        where: { id: request.id },
        data: { requestNumber },
        include: purchaseRequestDetailInclude,
      });
    });

    await this.writeAuditLog(userId, ipAddress, 'PURCHASE_REQUEST_CREATED', created.id);
    return created;
  }

  // Items are replaced wholesale (delete-all-then-recreate), same reasoning
  // as PurchasesService.update() — the edit form submits the whole item
  // table as one record.
  async update(id: number, dto: UpdatePurchaseRequestDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    await this.ensureDepartment(dto.requesterDepartmentId);
    if (dto.requestedByEmployeeId) await this.ensureEmployee(dto.requestedByEmployeeId);
    await this.ensureUnits(dto.items.map((item) => item.unitId));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });
      return tx.purchaseRequest.update({
        where: { id },
        data: {
          requestDate: dto.requestDate,
          requesterDepartmentId: dto.requesterDepartmentId,
          requestedByEmployeeId: dto.requestedByEmployeeId ?? null,
          status: dto.status,
          priority: dto.priority,
          note: dto.note,
          items: { create: dto.items },
        },
        include: purchaseRequestDetailInclude,
      });
    });

    const action = existing.status !== dto.status ? 'PURCHASE_REQUEST_STATUS_CHANGED' : 'PURCHASE_REQUEST_UPDATED';
    const details = existing.status !== dto.status ? `از ${existing.status} به ${dto.status}` : undefined;
    await this.writeAuditLog(userId, ipAddress, action, id, details);
    return updated;
  }

  // Minimal, local write to the project's one shared AUDIT_LOG table — not
  // a separate audit system, and not an elaborate event taxonomy (see
  // database_plan.txt's own note on AUDIT_LOG: keep this simple for now).
  private async writeAuditLog(
    userId: number | null,
    ipAddress: string | undefined,
    action: string,
    purchaseRequestId: number,
    details?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        entityType: 'PurchaseRequest',
        entityId: String(purchaseRequestId),
        details,
        ipAddress: ipAddress ?? undefined,
      },
    });
  }

  private async ensureDepartment(id: number) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || department.status !== 'active') throw new ConflictException('دپارتمان درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureEmployee(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.status !== 'active') throw new ConflictException('کارمند درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureUnits(unitIds: number[]) {
    const uniqueIds = [...new Set(unitIds)];
    const count = await this.prisma.unit.count({ where: { id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new ConflictException('یکی از واحدهای انتخاب‌شده برای اقلام درخواست معتبر نیست');
  }
}
