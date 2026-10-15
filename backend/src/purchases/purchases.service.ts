import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseSourceType, PurchaseStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PurchaseQuantitiesService } from './purchase-quantities.service';
import { derivePaymentStatus, findLineTotalMismatches, recomputePaymentTotals, sumItemTotals } from './purchase-totals';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { rowsOf, scalarData } from '../audit/restore/snapshot-data';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_DEPARTMENT_STATUS } from '../departments/department-rules';
import { ensureActiveUnits } from '../units/unit-rules';
import { ensureActivePurchaseType } from '../purchase-types/purchase-type-rules';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import { LINKABLE_PURCHASE_REQUEST_STATUSES } from '../purchase-requests/purchase-request-rules';
import { WorkflowService } from '../workflow/workflow.service';
import { ALLOWED_PURCHASE_STATUS_TRANSITIONS, PURCHASE_STATUS_LABELS_FA, RETURN_BLOCKED_TARGET_STATUSES, purchaseWorkflowFacts } from './purchase-rules';
import type {
  ChangePurchaseStatusDto,
  CreatePurchaseDto,
  PurchaseApprovalDecisionDto,
  PurchaseApprovalPreviewDto,
  PurchaseApprovalRejectDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';

type Tx = Prisma.TransactionClient;

// Statuses whose purchase has already been committed — an edit that pushes
// one of them into an approval rule needs (re-)approval.
const COMMITTED_STATUSES: PurchaseStatus[] = ['CONFIRMED', 'RECEIVED', 'CLOSED'];

// Distinct, frontend-detectable 409 for "this purchase buys more than the
// linked request line still needs" — see ensureRequestOverageConfirmed().
export const PURCHASE_QUANTITY_EXCEEDS_REQUEST = 'PURCHASE_QUANTITY_EXCEEDS_REQUEST';

// 409 code: a line's total differs from quantity × unit price — resubmit with confirmTotalMismatch.
export const PURCHASE_LINE_TOTAL_MISMATCH = 'PURCHASE_LINE_TOTAL_MISMATCH';

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
  sort?: SortParams;
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

// Columns the purchases table can be sorted by (the first-item/«قلم» count
// and the derived payment cell are not sortable).
const PURCHASE_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.PurchaseOrderByWithRelationInput> = {
  purchaseNumber: (dir) => ({ purchaseNumber: dir }),
  purchaseDate: (dir) => ({ purchaseDate: dir }),
  supplier: (dir) => ({ supplier: { name: dir } }),
  purchaseType: (dir) => ({ purchaseType: { nameFa: dir } }),
  buyer: (dir) => ({ buyerEmployee: { lastName: dir } }),
  totalAmount: (dir) => ({ totalAmount: dir }),
  paymentStatus: (dir) => ({ paymentStatus: dir }),
  status: (dir) => ({ status: dir }),
  sourceType: (dir) => ({ sourceType: dir }),
};

@Injectable()
export class PurchasesService {
  // Purchase lifecycle (list/get/create/update/changeStatus/remove) plus the reference
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
    // Approval engine (workflow module). Purchases sends it the facts and
    // changes its own status from the result — see the approval section at
    // the end of this class. HISTORICAL_IMPORT purchases are never evaluated.
    private readonly workflow: WorkflowService,
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
      orderBy: buildOrderBy(filters.sort, PURCHASE_SORT_COLUMNS, [{ purchaseDate: 'desc' }, { id: 'desc' }], [{ id: 'desc' }]),
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

  // GET /purchases/:id — the detail page: the purchase plus its approval
  // history and whether this user may approve/reject it right now. Guarded by
  // purchases.view, so the approval timeline needs no permission of its own.
  async getDetail(id: number, userId: number | null) {
    const purchase = await this.get(id);
    const [requests, canDecide, pending] = await Promise.all([
      this.workflow.getTimeline('PURCHASE', id),
      userId !== null && purchase.status === 'PENDING_APPROVAL' ? this.workflow.canDecide('PURCHASE', id, userId) : Promise.resolve(false),
      purchase.status === 'PENDING_APPROVAL' ? this.workflow.pendingRequest('PURCHASE', id) : Promise.resolve(null),
    ]);
    return { ...purchase, approval: { requests, canDecide, requestedByUserId: pending?.requestedByUserId ?? null } };
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
    this.ensureLineTotalsConfirmed(dto.items, dto.confirmTotalMismatch);
    await this.ensureRequestOverageConfirmed(dto.purchaseRequestId, dto.items, dto.confirmOverage);

    const facts = purchaseWorkflowFacts(dto);
    const { created, needsApproval } = await this.prisma.$transaction(async (tx) => {
      // A purchase saved as confirmed that matches an approval rule waits in
      // PENDING_APPROVAL instead (historical imports are never gated).
      const needsApproval =
        dto.status === 'CONFIRMED' && dto.sourceType === 'OPERATIONAL' && (await this.workflow.evaluate('PURCHASE', facts, tx)).required;
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
          status: needsApproval ? 'PENDING_APPROVAL' : dto.status,
          note: dto.note,
          totalAmount,
          items: { create: dto.items },
        },
      });
      const purchaseNumber = `PUR-${String(created.id).padStart(6, '0')}`;
      const numbered = await tx.purchase.update({
        where: { id: created.id },
        data: { purchaseNumber },
        include: purchaseDetailInclude,
      });
      if (needsApproval) await this.startApproval(tx, numbered, facts, userId, ipAddress);
      return { created: numbered, needsApproval };
    });

    const action = dto.sourceType === 'HISTORICAL_IMPORT' ? 'HISTORICAL_PURCHASE_IMPORTED' : 'PURCHASE_CREATED';
    await this.audit.log({
      userId,
      ipAddress,
      action,
      entityType: AUDIT_ENTITY.PURCHASE,
      entityId: created.id,
      ...(needsApproval ? { details: 'ارسال برای تأیید' } : {}),
    });
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
  // a clear message rather than surfacing a raw FK error.
  //
  // This is a field edit only — it never changes status. dto.status must
  // equal the current status (the edit form echoes it back); any status
  // change goes through changeStatus() (PATCH /purchases/:id/status) instead,
  // which doesn't touch items and so has its own, narrower returns rule.
  //
  // Optimistic locking: dto.updatedAt is the version the client loaded. A
  // mismatch (someone saved in between) is a 409 RECORD_MODIFIED; the same
  // check is repeated atomically inside the transaction (compare-and-set on
  // updatedAt) so two concurrent saves can't both pass it.
  async update(id: number, dto: UpdatePurchaseDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (dto.status !== existing.status) {
      throw new ConflictException('تغییر وضعیت از این مسیر مجاز نیست — از دکمه‌های وضعیت استفاده کنید.');
    }
    // The source decides whether approval rules apply, so it is fixed at creation.
    if (dto.sourceType !== existing.sourceType) {
      throw new ConflictException('نوع منبع خرید (عملیاتی/تاریخی) پس از ثبت قابل تغییر نیست.');
    }
    if (existing.status === 'PENDING_APPROVAL') {
      throw new ConflictException('خریدِ در انتظار تأیید قابل ویرایش نیست. برای ویرایش، ابتدا درخواست تأیید را پس بگیرید.');
    }
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
    this.ensureLineTotalsConfirmed(dto.items, dto.confirmTotalMismatch);
    // A CANCELLED purchase counts toward nothing, so it can't over-buy
    // (dto.status === existing.status here — see the guard above).
    if (dto.status !== 'CANCELLED') {
      await this.ensureRequestOverageConfirmed(dto.purchaseRequestId, dto.items, dto.confirmOverage, id);
    }
    const paidAmount = Number(existing.paidAmount);
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);

    const facts = purchaseWorkflowFacts(dto);
    const { updated, reapproval } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchase.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      // Edit after approval (owner default 2026-10-14): raising the amount
      // above what was approved, or moving the purchase into another rule's
      // scope, sends a CONFIRMED purchase back for approval; a RECEIVED or
      // CLOSED one can't go back, so such an edit is refused.
      const reapproval = await this.needsReapproval(tx, existing, { ...dto, totalAmount }, facts);
      if (reapproval && existing.status !== 'CONFIRMED') {
        throw new ConflictException(
          `این تغییر طبق قوانین گردش کار به تأیید نیاز دارد و خریدِ «${PURCHASE_STATUS_LABELS_FA[existing.status]}» را نمی‌توان دوباره به تأیید فرستاد. مبلغ را از مبلغ تأییدشده بیشتر نکنید.`,
        );
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      const saved = await tx.purchase.update({
        where: { id },
        data: {
          purchaseDate: dto.purchaseDate,
          purchaseTypeId: dto.purchaseTypeId,
          requesterDepartmentId: dto.requesterDepartmentId ?? null,
          buyerEmployeeId: dto.buyerEmployeeId ?? null,
          supplierId: dto.supplierId,
          purchaseRequestId: dto.purchaseRequestId ?? null,
          sourceType: dto.sourceType,
          status: reapproval ? 'PENDING_APPROVAL' : dto.status,
          note: dto.note,
          totalAmount,
          paymentStatus,
          items: { create: dto.items },
        },
        include: purchaseDetailInclude,
      });
      if (reapproval) await this.startApproval(tx, saved, facts, userId, ipAddress);
      return { updated: saved, reapproval };
    });

    // The user never changes status here (see the guard above); the only
    // status effect is an automatic return to PENDING_APPROVAL (re-approval).
    await this.audit.log({
      userId,
      ipAddress,
      action: 'PURCHASE_UPDATED',
      entityType: AUDIT_ENTITY.PURCHASE,
      entityId: id,
      ...(reapproval ? { details: 'نیاز به تأیید مجدد — ارسال برای تأیید' } : {}),
    });

    // Items were just replaced wholesale and/or the linked request may have
    // changed — recompute progress for whichever request(s) the purchase
    // was linked to before and/or after this edit (e.g. changed quantities
    // on request-linked lines; switching purchaseRequestId moves them to a
    // different request).
    const requestIdsToRecompute = new Set<number>();
    if (existing.purchaseRequest) requestIdsToRecompute.add(existing.purchaseRequest.id);
    if (dto.purchaseRequestId) requestIdsToRecompute.add(dto.purchaseRequestId);
    for (const requestId of requestIdsToRecompute) {
      await this.purchaseRequestsService.recomputeStatus(requestId, userId, ipAddress);
    }

    return updated;
  }

  // PATCH /purchases/:id/status — the only way an existing purchase's status
  // changes (the detail page's تأیید / ثبت دریافت / بستن / لغو buttons).
  // Status-only on purpose: no items, no money fields, no reference
  // re-checks — none of that is being changed. Because items are untouched,
  // returns don't get in the way of closing (RECEIVED → CLOSED with returns
  // is allowed, business decision 2026-10-06); cancelling a purchase with
  // returns stays refused (RETURN_BLOCKED_TARGET_STATUSES, decision #10).
  //
  // Legal transitions: ALLOWED_PURCHASE_STATUS_TRANSITIONS (purchase-rules.ts).
  // Same optimistic locking as update(): up-front version check, then an
  // atomic compare-and-set inside the transaction. The returns check runs
  // inside the transaction *after* that claim, so a return created between
  // the page load and the click can't slip past it.
  async changeStatus(id: number, dto: ChangePurchaseStatusDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (!ALLOWED_PURCHASE_STATUS_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new ConflictException(
        `تغییر وضعیت خرید از «${PURCHASE_STATUS_LABELS_FA[existing.status]}» به «${PURCHASE_STATUS_LABELS_FA[dto.status]}» مجاز نیست`,
      );
    }

    const { updated, target } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchase.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      if (RETURN_BLOCKED_TARGET_STATUSES.includes(dto.status)) {
        const returnCount = await tx.purchaseReturn.count({ where: { purchaseId: id } });
        if (returnCount > 0) {
          throw new ConflictException('برای این خرید برگشت به تأمین‌کننده ثبت شده است و قابل لغو نیست. ابتدا برگشت‌ها را حذف کنید.');
        }
      }
      // Confirming a draft that an approval rule matches sends it for
      // approval instead; cancelling a waiting purchase closes its request.
      const facts = purchaseWorkflowFacts(existing);
      const target: PurchaseStatus =
        dto.status === 'CONFIRMED' && existing.sourceType === 'OPERATIONAL' && (await this.workflow.evaluate('PURCHASE', facts, tx)).required
          ? 'PENDING_APPROVAL'
          : dto.status;
      if (dto.status === 'CANCELLED' && existing.status === 'PENDING_APPROVAL') {
        await this.workflow.cancel(tx, { documentType: 'PURCHASE', documentId: id, actor: this.actor(userId, ipAddress), kind: 'CANCELLED', reason: 'لغو خرید' });
      }
      const result = await tx.purchase.update({ where: { id }, data: { status: target }, include: purchaseDetailInclude });
      if (target === 'PENDING_APPROVAL') await this.startApproval(tx, result, facts, userId, ipAddress);
      return { updated: result, target };
    });

    const action =
      dto.status === 'CANCELLED' ? 'PURCHASE_CANCELLED' : target === 'PENDING_APPROVAL' ? 'PURCHASE_SUBMITTED_FOR_APPROVAL' : 'PURCHASE_STATUS_CHANGED';
    await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PURCHASE, entityId: id, details: `از ${existing.status} به ${target}` });

    // Only CANCELLED changes what counts toward a request's purchased
    // quantities (COUNTABLE_PURCHASE_WHERE excludes nothing else), so only a
    // cancellation can move the linked request's progress — and since
    // CANCELLED is terminal, a purchase never leaves it to re-count.
    if (dto.status === 'CANCELLED' && existing.purchaseRequestId) {
      await this.purchaseRequestsService.recomputeStatus(existing.purchaseRequestId, userId, ipAddress);
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
      include: { _count: { select: { payments: true, documents: true, returns: true } }, items: true },
    });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    if (purchase._count.payments > 0 || purchase._count.documents > 0 || purchase._count.returns > 0) {
      throw new ConflictException('این خرید دارای پرداخت، سند یا برگشت ثبت‌شده است و قابل حذف نیست. ابتدا آن‌ها را حذف کنید.');
    }
    const { _count, ...record } = purchase;
    void _count;
    await this.prisma.$transaction(async (tx) => {
      // The approval history stays in the workflow tables (no FK to purchases).
      if (purchase.status === 'PENDING_APPROVAL') {
        await this.workflow.cancel(tx, { documentType: 'PURCHASE', documentId: id, actor: this.actor(userId, ipAddress), kind: 'CANCELLED', reason: 'حذف خرید' });
      }
      await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.PURCHASE, entityId: id, label: purchase.purchaseNumber, record, userId });
      await tx.purchase.delete({ where: { id } });
    });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_DELETED', entityType: AUDIT_ENTITY.PURCHASE, entityId: id, details: purchase.purchaseNumber });
    if (purchase.purchaseRequestId) await this.purchaseRequestsService.recomputeStatus(purchase.purchaseRequestId, userId, ipAddress);
    return { success: true };
  }

  // Restore from the delete archive (called by PurchasesRestorer). A purchase
  // could only be deleted without payments, documents or returns, so the
  // snapshot is the header plus its items. Rules kept here, in the owning
  // module: the paid amount / payment status are re-derived by
  // recomputePaymentTotals (rule 6), a purchase that was waiting for approval
  // comes back as a DRAFT (its approval request was cancelled at delete), and
  // restoring may not push the linked purchase request past its requested
  // quantity. The request's own status is recomputed after commit.
  async restoreDeleted({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const items = rowsOf(record.items);
    const requestId = record.purchaseRequestId === null || record.purchaseRequestId === undefined ? undefined : Number(record.purchaseRequestId);
    if (requestId) {
      try {
        await this.ensureRequestOverageConfirmed(
          requestId,
          items.map((item) => ({ quantity: Number(item.quantity), purchaseRequestItemId: item.purchaseRequestItemId == null ? undefined : Number(item.purchaseRequestItemId) })),
          false,
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          throw new ConflictException('بازیابی این خرید باعث می‌شود مقدار خریدشده از مقدار درخواست خرید مرتبط بیشتر شود؛ بازیابی انجام نشد');
        }
        throw error;
      }
    }
    const wasPending = record.status === 'PENDING_APPROVAL';
    const created = await tx.purchase.create({
      data: scalarData('Purchase', record, { status: wasPending ? 'DRAFT' : record.status, paidAmount: 0, paymentStatus: 'UNPAID', totalAmount: sumItemTotals(items.map((item) => ({ totalPrice: Number(item.totalPrice) }))) }) as never,
    });
    await tx.purchaseItem.createMany({ data: items.map((item) => scalarData('PurchaseItem', item) as never) });
    await recomputePaymentTotals(tx, created.id, sumItemTotals(items.map((item) => ({ totalPrice: Number(item.totalPrice) }))));
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_RESTORED', entityType: AUDIT_ENTITY.PURCHASE, entityId: created.id, details: created.purchaseNumber }, tx);
    return {
      entityId: created.id,
      warnings: wasPending ? ['این خرید در انتظار تأیید بود؛ به‌صورت پیش‌نویس بازیابی شد و برای تأیید باید دوباره ارسال شود.'] : [],
      afterCommit: requestId ? () => this.purchaseRequestsService.recomputeStatus(requestId, userId, ipAddress) : undefined,
    };
  }

  // ─── Workflow approval ───────────────────────────────────────────────────

  // POST /purchases/approval-preview: would this purchase need approval if
  // confirmed, and from whom? With `purchaseId` (edit form) it answers the
  // edit-after-approval question instead: would saving send it back?
  async approvalPreview(dto: PurchaseApprovalPreviewDto & { purchaseId?: number }) {
    if (dto.sourceType === 'HISTORICAL_IMPORT') return { required: false as const, reapproval: false };
    const facts = purchaseWorkflowFacts(dto);
    const preview = await this.workflow.evaluate('PURCHASE', facts);
    if (dto.purchaseId === undefined) return { ...preview, reapproval: false };
    const existing = await this.get(dto.purchaseId);
    const reapproval = await this.needsReapproval(this.prisma, existing, { ...dto, totalAmount: facts.amountTotal }, facts);
    return { ...preview, reapproval };
  }

  // POST /purchases/:id/approve — the engine checks the user may decide the
  // open level; the final approval confirms the purchase.
  async approve(id: number, dto: PurchaseApprovalDecisionDto, userId: number, ipAddress?: string) {
    return this.decide(id, dto.updatedAt, 'APPROVE', dto.comment ?? null, userId, ipAddress);
  }

  // POST /purchases/:id/reject — comment required; back to DRAFT for editing
  // and resubmitting (a resubmission opens a new approval request).
  async reject(id: number, dto: PurchaseApprovalRejectDto, userId: number, ipAddress?: string) {
    return this.decide(id, dto.updatedAt, 'REJECT', dto.comment, userId, ipAddress);
  }

  // POST /purchases/:id/withdraw — the requester (or a purchases.manage
  // holder) takes a waiting purchase back to DRAFT.
  async withdraw(id: number, dto: PurchaseApprovalDecisionDto, userId: number, canManage: boolean, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (existing.status !== 'PENDING_APPROVAL') throw new ConflictException('این خرید در انتظار تأیید نیست');
    const pending = await this.workflow.pendingRequest('PURCHASE', id);
    if (!canManage && pending?.requestedByUserId !== userId) {
      throw new ForbiddenException('فقط ارسال‌کنندهٔ درخواست تأیید یا مدیر خرید می‌تواند آن را پس بگیرد');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchase.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await this.workflow.cancel(tx, { documentType: 'PURCHASE', documentId: id, actor: this.actor(userId, ipAddress), kind: 'WITHDRAWN', reason: dto.comment ?? null });
      return tx.purchase.update({ where: { id }, data: { status: 'DRAFT' }, include: purchaseDetailInclude });
    });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_APPROVAL_WITHDRAWN', entityType: AUDIT_ENTITY.PURCHASE, entityId: id, details: 'بازگشت به پیش‌نویس' });
    return updated;
  }

  private async decide(id: number, updatedAt: Date, decision: 'APPROVE' | 'REJECT', comment: string | null, userId: number, ipAddress?: string) {
    const existing = await this.get(id);
    if (!isSameVersion(existing.updatedAt, updatedAt)) throw recordModifiedConflict();
    if (existing.status !== 'PENDING_APPROVAL') throw new ConflictException('این خرید در انتظار تأیید نیست');
    const { updated, outcome, level } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchase.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      const result = await this.workflow.decide(tx, { documentType: 'PURCHASE', documentId: id, actor: this.actor(userId, ipAddress), decision, comment });
      const status: PurchaseStatus | null = result.outcome === 'APPROVED' ? 'CONFIRMED' : result.outcome === 'REJECTED' ? 'DRAFT' : null;
      const updated = status
        ? await tx.purchase.update({ where: { id }, data: { status }, include: purchaseDetailInclude })
        : await tx.purchase.findUniqueOrThrow({ where: { id }, include: purchaseDetailInclude });
      return { updated, outcome: result.outcome, level: result.level };
    });
    const action = outcome === 'APPROVED' ? 'PURCHASE_APPROVED' : outcome === 'REJECTED' ? 'PURCHASE_REJECTED' : 'PURCHASE_APPROVAL_LEVEL_APPROVED';
    await this.audit.log({
      userId,
      ipAddress,
      action,
      entityType: AUDIT_ENTITY.PURCHASE,
      entityId: id,
      details: comment ? `مرحلهٔ ${level}: ${comment}` : `مرحلهٔ ${level}`,
    });
    return updated;
  }

  // Edit-after-approval rule for a committed operational purchase: needs
  // approval again when a rule matches the edited purchase AND (its total
  // rises above the last approved amount — or above its current total if it
  // was never approved — OR its type/supplier/department changed).
  private async needsReapproval(
    db: Tx | PrismaService,
    existing: { id: number; status: PurchaseStatus; sourceType: PurchaseSourceType; totalAmount: unknown; purchaseTypeId: number; supplierId: number; requesterDepartmentId: number | null },
    next: { sourceType: PurchaseSourceType; totalAmount: number; purchaseTypeId: number; supplierId: number; requesterDepartmentId?: number | null },
    facts: ReturnType<typeof purchaseWorkflowFacts>,
  ): Promise<boolean> {
    if (!COMMITTED_STATUSES.includes(existing.status)) return false;
    if (existing.sourceType !== 'OPERATIONAL' && next.sourceType !== 'OPERATIONAL') return false;
    if (!(await this.workflow.evaluate('PURCHASE', facts, db as Tx)).required) return false;
    const baseline = (await this.workflow.approvedAmount('PURCHASE', existing.id, db as Tx)) ?? Number(existing.totalAmount);
    const scopeChanged =
      next.purchaseTypeId !== existing.purchaseTypeId ||
      next.supplierId !== existing.supplierId ||
      (next.requesterDepartmentId ?? null) !== (existing.requesterDepartmentId ?? null);
    return next.totalAmount > baseline || scopeChanged;
  }

  private async startApproval(
    tx: Tx,
    purchase: { id: number; purchaseNumber: string; totalAmount: unknown; supplier?: { name: string } | null; items?: unknown[] },
    facts: ReturnType<typeof purchaseWorkflowFacts>,
    userId: number | null,
    ipAddress?: string,
  ) {
    if (userId === null) throw new ForbiddenException('برای ارسال به تأیید، کاربر واردشده لازم است');
    const supplierName = purchase.supplier?.name ?? '';
    const lineCount = purchase.items?.length ?? 0;
    await this.workflow.start(tx, {
      documentType: 'PURCHASE',
      documentId: purchase.id,
      documentNumber: purchase.purchaseNumber,
      summary: `خرید از ${supplierName}${lineCount ? ` — ${lineCount.toLocaleString('fa-IR')} قلم` : ''}`,
      amount: Number(purchase.totalAmount),
      facts,
      actor: this.actor(userId, ipAddress),
    });
  }

  private actor(userId: number | null, ipAddress?: string) {
    // Every caller sits behind SessionAuthGuard; null only in direct service use.
    return { userId: userId ?? 0, ipAddress };
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
  private ensureLineTotalsConfirmed(items: { name: string; quantity: number; unitPrice?: number | null; totalPrice: number }[], confirmed: boolean | undefined) {
    const mismatches = findLineTotalMismatches(items);
    if (mismatches.length === 0 || confirmed) return;
    const summary = mismatches.map((line) => `ردیف ${line.line} «${line.name}» (مبلغ واردشده ${line.entered.toLocaleString('en-US')} به‌جای ${line.expected.toLocaleString('en-US')})`).join('، ');
    throw new ConflictException({
      statusCode: 409,
      code: PURCHASE_LINE_TOTAL_MISMATCH,
      message: `قیمت کل ردیف با مقدار × قیمت واحد برابر نیست: ${summary}. برای ادامه، مغایرت را تأیید کنید.`,
      details: { mismatches },
    });
  }

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
    await ensureActivePurchaseType(this.prisma, id);
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
