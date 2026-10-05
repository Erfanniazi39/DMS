import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseSourceType, PurchaseStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PurchaseQuantitiesService } from './purchase-quantities.service';
import { derivePaymentStatus, sumItemTotals } from './purchase-totals';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_DEPARTMENT_STATUS } from '../departments/department-rules';
import { ensureActiveUnits } from '../units/unit-rules';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import { LINKABLE_PURCHASE_REQUEST_STATUSES } from '../purchase-requests/purchase-request-rules';
import type { CreatePurchaseDto, UpdatePurchaseDto } from './dto/purchase.dto';

// Distinct, frontend-detectable 409 for "this purchase buys more than the
// linked request line still needs" — see ensureRequestOverageConfirmed().
export const PURCHASE_QUANTITY_EXCEEDS_REQUEST = 'PURCHASE_QUANTITY_EXCEEDS_REQUEST';

export type PurchaseListFilters = {
  q?: string;
  purchaseTypeId?: number;
  status?: string;
  paymentStatus?: string;
  supplierId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  // All / Operational / Historical reporting — see PurchaseSourceType.
  // Omitted = all purchases, both kinds, from this one table.
  sourceType?: string;
};

// Shared "everything the detail page needs" include — the list endpoint
// intentionally uses a lighter one (see list() below): "Keep the main table
// clean; detailed information belongs in the purchase detail page."
//
// buyerEmployee/supplier are narrowed to display fields only: a user with
// just purchases.view must not receive an Employee's national ID, mobile,
// salary, bank account or contract path, or a Supplier's national ID / bank
// details, through this nested include (they'd get a 403 on
// /employees/:id and /suppliers/:id directly). QA 2026-10-05.
const purchaseDetailInclude = {
  purchaseType: true,
  requesterDepartment: true,
  buyerEmployee: {
    select: { id: true, code: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
  },
  supplier: { select: { id: true, code: true, name: true } },
  purchaseRequest: { select: { id: true, requestNumber: true } },
  items: { include: { unit: true }, orderBy: { id: 'asc' } },
  payments: { orderBy: { paymentDate: 'desc' } },
  documents: { orderBy: { date: 'desc' } },
} satisfies Prisma.PurchaseInclude;

@Injectable()
export class PurchasesService {
  // Purchase lifecycle (list/get/create/update/remove) plus the reference
  // checks core purchase validation needs. Payments, documents and returns
  // live in their own services (purchase-payments/-documents/-returns
  // .service.ts); the derived money fields are computed only by
  // purchase-totals.ts (CLAUDE.md rule 6).
  //
  // purchaseQuantities: this module's own read-only quantity rule (also
  // exported, via PurchaseQuantitiesModule, to Purchase Requests) — used by
  // the overage check below.
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly audit: AuditService,
    private readonly purchaseQuantities: PurchaseQuantitiesService,
  ) {}

  // Without `pagination` this returns the full filtered array (original
  // shape, kept for any caller that wants everything). With it, returns one
  // page plus the total matching count: { items, total, page, pageSize }.
  async list(filters: PurchaseListFilters, pagination?: PaginationParams) {
    const where: Prisma.PurchaseWhereInput = {};

    if (filters.q) {
      where.OR = [
        { purchaseNumber: { contains: filters.q, mode: 'insensitive' } },
        { supplier: { name: { contains: filters.q, mode: 'insensitive' } } },
        { supplier: { code: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    if (filters.purchaseTypeId) where.purchaseTypeId = filters.purchaseTypeId;
    if (filters.status) where.status = filters.status as PurchaseStatus;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus as PurchasePaymentStatus;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.sourceType) where.sourceType = filters.sourceType as PurchaseSourceType;
    if (filters.dateFrom || filters.dateTo) {
      where.purchaseDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    const query = {
      where,
      orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
      include: {
        purchaseType: true,
        supplier: { select: { id: true, code: true, name: true } },
        buyerEmployee: { select: { id: true, firstName: true, lastName: true } },
        // Just the first item's name plus a total count — enough for a
        // compact list-table cell ("X و ۲ مورد دیگر") without fetching every
        // item row for every purchase. Full item detail stays on the detail
        // page ("Keep the main table clean").
        items: { select: { name: true }, orderBy: { id: 'asc' }, take: 1 },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.PurchaseFindManyArgs;

    if (!pagination) return this.prisma.purchase.findMany(query);

    const [items, total] = await Promise.all([
      this.prisma.purchase.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.purchase.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, include: purchaseDetailInclude });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    return purchase;
  }

  // Purchase number (PUR-000001) is generated here, not entered by the
  // user — same placeholder-then-fix pattern used for Employee.code: the id
  // isn't known until the row exists, so it's inserted with a throwaway
  // placeholder and corrected inside the same transaction. Items are created
  // together with the purchase in one transaction — a purchase is never left
  // half-saved with no line items.
  //
  // requesterDepartmentId/buyerEmployeeId are only checked when actually
  // provided — purchase.dto.ts already enforces they're present for an
  // OPERATIONAL purchase; a HISTORICAL_IMPORT one may leave either unset.
  async create(dto: CreatePurchaseDto, userId: number | null, ipAddress?: string) {
    await this.ensurePurchaseType(dto.purchaseTypeId);
    if (dto.requesterDepartmentId) await this.ensureDepartment(dto.requesterDepartmentId);
    if (dto.buyerEmployeeId) await this.ensureBuyerEmployee(dto.buyerEmployeeId);
    await this.ensureSupplier(dto.supplierId);
    if (dto.purchaseRequestId) await this.ensurePurchaseRequest(dto.purchaseRequestId, { requireLinkable: true });
    await this.ensureUnits(dto.items.map((item) => item.unitId));
    await this.ensurePurchaseRequestItems(dto.purchaseRequestId, dto.items);
    const totalAmount = sumItemTotals(dto.items);
    await this.ensureRequestOverageConfirmed(dto.purchaseRequestId, dto.items, dto.confirmOverage);

    const created = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          purchaseNumber: `PENDING-${randomUUID()}`,
          purchaseDate: dto.purchaseDate,
          purchaseTypeId: dto.purchaseTypeId,
          requesterDepartmentId: dto.requesterDepartmentId,
          buyerEmployeeId: dto.buyerEmployeeId,
          supplierId: dto.supplierId,
          purchaseRequestId: dto.purchaseRequestId,
          sourceType: dto.sourceType,
          // Explicit (CONFIRMED unless the user chose DRAFT — see
          // createPurchaseSchema), never the column's own @default(DRAFT).
          status: dto.status,
          note: dto.note,
          totalAmount,
          items: { create: dto.items },
        },
      });
      const purchaseNumber = `PUR-${String(created.id).padStart(6, '0')}`;
      return tx.purchase.update({
        where: { id: created.id },
        data: { purchaseNumber },
        include: purchaseDetailInclude,
      });
    });

    const action = dto.sourceType === 'HISTORICAL_IMPORT' ? 'HISTORICAL_PURCHASE_IMPORTED' : 'PURCHASE_CREATED';
    await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PURCHASE, entityId: created.id });
    // A new Purchase linked to a request may fulfill (part of) it — let the
    // request re-derive its own progress (APPROVED ⇄ PARTIALLY_PURCHASED ⇄
    // COMPLETED) from the actual quantities now on record.
    if (dto.purchaseRequestId) await this.purchaseRequestsService.recomputeStatus(dto.purchaseRequestId, userId, ipAddress);
    return created;
  }

  // Items are replaced wholesale (delete-all-then-recreate) rather than
  // diffed — the edit page submits the whole item table as one form, the
  // same way the rest of this project's edit forms submit a complete record
  // rather than a partial patch. purchaseNumber is never part of the update
  // payload — it's fixed at creation, same reasoning as Employee.code.
  //
  // Because items are deleted and recreated, a purchase that already has
  // Return-to-Vendor records can't be edited: those returns point at the
  // exact PurchaseItem rows (PurchaseReturnItem.purchaseItem is Restrict),
  // and recreating the items would orphan/break them. Refused up front with
  // a clear message rather than surfacing a raw FK error. That includes a
  // status change to CANCELLED — cancelling goes through this same update(),
  // so a purchase with returns can't be cancelled either.
  //
  // Optimistic locking: dto.updatedAt is the version the client loaded. A
  // mismatch (someone saved in between) is a 409 RECORD_MODIFIED; the same
  // check is repeated atomically inside the transaction (compare-and-set on
  // updatedAt) so two concurrent saves can't both pass it.
  async update(id: number, dto: UpdatePurchaseDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const returnCount = await this.prisma.purchaseReturn.count({ where: { purchaseId: id } });
    if (returnCount > 0) {
      throw new ConflictException('برای این خرید برگشت به تأمین‌کننده ثبت شده است و قابل ویرایش نیست. ابتدا برگشت‌ها را حذف کنید.');
    }
    // A reference is only re-checked for "still active" when it's actually
    // being changed — the purchase may keep a supplier/department/buyer/
    // purchase type/unit it already has even if that was retired since
    // (same rule as ItemsService.ensureReferences()). Otherwise e.g.
    // blacklisting a supplier would block cancelling its own purchases.
    if (dto.purchaseTypeId !== existing.purchaseTypeId) await this.ensurePurchaseType(dto.purchaseTypeId);
    if (dto.requesterDepartmentId && dto.requesterDepartmentId !== existing.requesterDepartmentId) {
      await this.ensureDepartment(dto.requesterDepartmentId);
    }
    if (dto.buyerEmployeeId && dto.buyerEmployeeId !== existing.buyerEmployeeId) await this.ensureBuyerEmployee(dto.buyerEmployeeId);
    if (dto.supplierId !== existing.supplierId) await this.ensureSupplier(dto.supplierId);
    // Linking to a request requires it to be APPROVED/PARTIALLY_PURCHASED —
    // but only when the link is being made/changed now; a purchase keeps the
    // request it already has even after that request moved on (e.g. to
    // COMPLETED because of this very purchase).
    if (dto.purchaseRequestId) {
      await this.ensurePurchaseRequest(dto.purchaseRequestId, { requireLinkable: dto.purchaseRequestId !== existing.purchaseRequestId });
    }
    await this.ensureUnits(
      dto.items.map((item) => item.unitId),
      (existing.items ?? []).map((item) => item.unitId),
    );
    await this.ensurePurchaseRequestItems(dto.purchaseRequestId, dto.items);

    const totalAmount = sumItemTotals(dto.items);
    // A CANCELLED purchase counts toward nothing, so it can't over-buy.
    if (dto.status !== 'CANCELLED') {
      await this.ensureRequestOverageConfirmed(dto.purchaseRequestId, dto.items, dto.confirmOverage, id);
    }
    const paidAmount = Number(existing.paidAmount);
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchase.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      return tx.purchase.update({
        where: { id },
        data: {
          purchaseDate: dto.purchaseDate,
          purchaseTypeId: dto.purchaseTypeId,
          requesterDepartmentId: dto.requesterDepartmentId ?? null,
          buyerEmployeeId: dto.buyerEmployeeId ?? null,
          supplierId: dto.supplierId,
          purchaseRequestId: dto.purchaseRequestId ?? null,
          sourceType: dto.sourceType,
          status: dto.status,
          note: dto.note,
          totalAmount,
          paymentStatus,
          items: { create: dto.items },
        },
        include: purchaseDetailInclude,
      });
    });

    // "Purchase edited" vs. the more specific "status changed"/"cancelled"
    // events — one audit row per update, not both, to avoid double-logging
    // what is, from the caller's side, a single edit.
    let action: string = 'PURCHASE_UPDATED';
    let details: string | undefined;
    if (existing.status !== dto.status) {
      action = dto.status === 'CANCELLED' ? 'PURCHASE_CANCELLED' : 'PURCHASE_STATUS_CHANGED';
      details = `از ${existing.status} به ${dto.status}`;
    }
    await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PURCHASE, entityId: id, details });

    // Items were just replaced wholesale and/or the linked request may have
    // changed — recompute progress for whichever request(s) the purchase
    // was linked to before and/or after this edit (e.g. a status change to
    // CANCELLED removes this purchase's quantities from the request's
    // total; switching purchaseRequestId moves them to a different request).
    const requestIdsToRecompute = new Set<number>();
    if (existing.purchaseRequest) requestIdsToRecompute.add(existing.purchaseRequest.id);
    if (dto.purchaseRequestId) requestIdsToRecompute.add(dto.purchaseRequestId);
    for (const requestId of requestIdsToRecompute) {
      await this.purchaseRequestsService.recomputeStatus(requestId, userId, ipAddress);
    }

    return updated;
  }

  // Purchases carry real business history once money or documents attach to
  // them, so deletion is deliberately narrow: only a purchase with no
  // recorded payments and no documents can be removed (this also mirrors
  // PurchasePayment/PurchaseDocument's onDelete: Restrict relation to
  // Purchase — the database would refuse the delete anyway). Items cascade
  // automatically. Remove the payments/documents first (see
  // PurchasePaymentsService.removePayment() / PurchaseDocumentsService
  // .removeDocument()) if a purchase truly needs to go.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { _count: { select: { payments: true, documents: true, returns: true } } },
    });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    if (purchase._count.payments > 0 || purchase._count.documents > 0 || purchase._count.returns > 0) {
      throw new ConflictException('این خرید دارای پرداخت، سند یا برگشت ثبت‌شده است و قابل حذف نیست. ابتدا آن‌ها را حذف کنید.');
    }
    await this.prisma.purchase.delete({ where: { id } });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_DELETED', entityType: AUDIT_ENTITY.PURCHASE, entityId: id, details: purchase.purchaseNumber });
    if (purchase.purchaseRequestId) await this.purchaseRequestsService.recomputeStatus(purchase.purchaseRequestId, userId, ipAddress);
    return { success: true };
  }

  // Buying more than a linked request line still needs is allowed, but only
  // with explicit self-confirmation (business decision 2026-10-05 — a
  // lightweight confirm, not a second approver). Without dto.confirmOverage
  // this throws a 409 whose body is:
  //   { statusCode: 409, code: 'PURCHASE_QUANTITY_EXCEEDS_REQUEST',
  //     message: '<Persian summary>',
  //     details: { overages: [{ purchaseRequestItemId, name, requested,
  //       alreadyPurchased, remaining, purchasing, excess }] } }
  // so the frontend can show a confirm dialog and resubmit with the flag.
  // "Already purchased" = every other non-cancelled purchase (this one
  // excluded on update), via the Purchases-owned quantity rule.
  private async ensureRequestOverageConfirmed(
    purchaseRequestId: number | undefined,
    items: { quantity: number; purchaseRequestItemId?: number }[],
    confirmOverage: boolean | undefined,
    excludePurchaseId?: number,
  ) {
    if (!purchaseRequestId) return;
    const purchasingByItem = new Map<number, Prisma.Decimal>();
    for (const item of items) {
      if (item.purchaseRequestItemId === undefined) continue;
      const current = purchasingByItem.get(item.purchaseRequestItemId) ?? new Prisma.Decimal(0);
      purchasingByItem.set(item.purchaseRequestItemId, current.plus(item.quantity));
    }
    if (purchasingByItem.size === 0) return;

    const ids = [...purchasingByItem.keys()];
    const [requestItems, purchasedElsewhere] = await Promise.all([
      this.prisma.purchaseRequestItem.findMany({ where: { id: { in: ids }, purchaseRequestId }, select: { id: true, name: true, quantity: true } }),
      this.purchaseQuantities.sumQuantitiesByRequestItem(ids, excludePurchaseId),
    ]);
    const overages = (requestItems ?? []).flatMap((requestItem) => {
      const requested = new Prisma.Decimal(requestItem.quantity);
      const alreadyPurchased = new Prisma.Decimal(purchasedElsewhere.get(requestItem.id) ?? 0);
      const remaining = Prisma.Decimal.max(0, requested.minus(alreadyPurchased));
      const purchasing = purchasingByItem.get(requestItem.id) ?? new Prisma.Decimal(0);
      if (!purchasing.greaterThan(remaining)) return [];
      return [{
        purchaseRequestItemId: requestItem.id,
        name: requestItem.name,
        requested: requested.toNumber(),
        alreadyPurchased: alreadyPurchased.toNumber(),
        remaining: remaining.toNumber(),
        purchasing: purchasing.toNumber(),
        excess: purchasing.minus(remaining).toNumber(),
      }];
    });
    if (overages.length === 0 || confirmOverage) return;
    const summary = overages.map((overage) => `«${overage.name}» (${overage.excess} بیشتر از باقی‌ماندهٔ ${overage.remaining})`).join('، ');
    throw new ConflictException({
      statusCode: 409,
      code: PURCHASE_QUANTITY_EXCEEDS_REQUEST,
      message: `مقدار خرید از مقدار باقی‌ماندهٔ درخواست بیشتر است: ${summary}. برای ادامه، خرید مازاد را تأیید کنید.`,
      details: { overages },
    });
  }

  // `requireLinkable`: a purchase may only be (newly) linked to a request in
  // LINKABLE_PURCHASE_REQUEST_STATUSES (APPROVED / PARTIALLY_PURCHASED —
  // business decision 2026-10-05, owned by purchase-request-rules.ts).
  private async ensurePurchaseRequest(id: number, options: { requireLinkable: boolean }) {
    const purchaseRequest = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!purchaseRequest) throw new ConflictException('درخواست خرید انتخاب‌شده یافت نشد');
    if (options.requireLinkable && !LINKABLE_PURCHASE_REQUEST_STATUSES.includes(purchaseRequest.status)) {
      throw new ConflictException('خرید فقط به درخواست خرید «تأییدشده» یا «خرید جزئی» قابل اتصال است');
    }
  }

  // An item's optional purchaseRequestItemId must belong to the same
  // purchaseRequestId the whole Purchase links to — a per-item link into
  // some other, unrelated request is never valid. Items without one are
  // simply skipped (most purchases, and most items even on a purchase
  // created from a request, have no such link — see purchase.dto.ts).
  private async ensurePurchaseRequestItems(purchaseRequestId: number | undefined, items: { purchaseRequestItemId?: number }[]) {
    const itemIds = [...new Set(items.map((item) => item.purchaseRequestItemId).filter((id): id is number => id !== undefined))];
    if (itemIds.length === 0) return;
    if (!purchaseRequestId) {
      throw new ConflictException('برای انتخاب قلم درخواست خرید، ابتدا درخواست خرید مرتبط را انتخاب کنید');
    }
    const count = await this.prisma.purchaseRequestItem.count({ where: { id: { in: itemIds }, purchaseRequestId } });
    if (count !== itemIds.length) throw new ConflictException('یکی از اقلام درخواست خرید انتخاب‌شده معتبر نیست');
  }

  private async ensurePurchaseType(id: number) {
    const purchaseType = await this.prisma.purchaseType.findUnique({ where: { id } });
    if (!purchaseType || !purchaseType.isActive) throw new ConflictException('نوع خرید انتخاب‌شده معتبر نیست');
  }

  private async ensureDepartment(id: number) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || department.status !== ACTIVE_DEPARTMENT_STATUS) throw new ConflictException('دپارتمان درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureBuyerEmployee(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.status !== 'active') throw new ConflictException('کارمند خریدار انتخاب‌شده فعال نیست');
  }

  private async ensureSupplier(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier || supplier.status !== 'active') throw new ConflictException('تأمین‌کننده انتخاب‌شده فعال نیست');
  }

  // A unit must exist and be active to be newly assigned. Units this
  // purchase's lines already use (`alreadyAssigned`, on update) are exempt —
  // a since-deactivated unit may stay where it already is, same rule as
  // ItemsService.ensureReferences().
  private async ensureUnits(unitIds: number[], alreadyAssigned: number[] = []) {
    await ensureActiveUnits(this.prisma, unitIds, alreadyAssigned, 'یکی از واحدهای انتخاب‌شده برای اقلام خرید معتبر یا فعال نیست');
  }
}
