import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseSourceType, PurchaseStatus } from '@prisma/client';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import type {
  CreatePurchaseDocumentDto,
  CreatePurchaseDto,
  CreatePurchasePaymentDto,
  CreatePurchaseReturnDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';

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
const purchaseDetailInclude = {
  purchaseType: true,
  requesterDepartment: true,
  buyerEmployee: { include: { department: true } },
  supplier: true,
  purchaseRequest: { select: { id: true, requestNumber: true } },
  items: { include: { unit: true }, orderBy: { id: 'asc' } },
  payments: { orderBy: { paymentDate: 'desc' } },
  documents: { orderBy: { date: 'desc' } },
} satisfies Prisma.PurchaseInclude;

// A Return-to-Vendor record with each returned line's original PurchaseItem
// (name/unit/quantity) — enough for the detail page to render the return and
// derive "still returnable" per item without another round-trip.
const purchaseReturnInclude = {
  items: { include: { purchaseItem: { include: { unit: true } } }, orderBy: { id: 'asc' } },
  createdByUser: { select: { id: true, username: true } },
} satisfies Prisma.PurchaseReturnInclude;

function sumItemTotals(items: { totalPrice: number }[]): number {
  return items.reduce((sum, item) => sum + item.totalPrice, 0);
}

// UNPAID / PARTIAL / PAID is always derived from totalAmount vs. paidAmount
// — never set directly by the client. See PurchasesService.create()/update()
// /addPayment() for where this gets (re)applied.
function derivePaymentStatus(totalAmount: number, paidAmount: number): PurchasePaymentStatus {
  if (paidAmount <= 0) return 'UNPAID';
  if (paidAmount >= totalAmount) return 'PAID';
  return 'PARTIAL';
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly audit: AuditService,
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
    if (dto.purchaseRequestId) await this.ensurePurchaseRequest(dto.purchaseRequestId);
    await this.ensureUnits(dto.items.map((item) => item.unitId));
    await this.ensurePurchaseRequestItems(dto.purchaseRequestId, dto.items);

    const totalAmount = sumItemTotals(dto.items);

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
    await this.audit.log({ userId, ipAddress, action, entityType: 'Purchase', entityId: created.id });
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
  async update(id: number, dto: UpdatePurchaseDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
    const returnCount = await this.prisma.purchaseReturn.count({ where: { purchaseId: id } });
    if (returnCount > 0) {
      throw new ConflictException('برای این خرید برگشت به تأمین‌کننده ثبت شده است و قابل ویرایش نیست. ابتدا برگشت‌ها را حذف کنید.');
    }
    await this.ensurePurchaseType(dto.purchaseTypeId);
    if (dto.requesterDepartmentId) await this.ensureDepartment(dto.requesterDepartmentId);
    if (dto.buyerEmployeeId) await this.ensureBuyerEmployee(dto.buyerEmployeeId);
    await this.ensureSupplier(dto.supplierId);
    if (dto.purchaseRequestId) await this.ensurePurchaseRequest(dto.purchaseRequestId);
    await this.ensureUnits(dto.items.map((item) => item.unitId));
    await this.ensurePurchaseRequestItems(dto.purchaseRequestId, dto.items);

    const totalAmount = sumItemTotals(dto.items);
    const paidAmount = Number(existing.paidAmount);
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);

    const updated = await this.prisma.$transaction(async (tx) => {
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
    await this.audit.log({ userId, ipAddress, action, entityType: 'Purchase', entityId: id, details });

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
  // removePayment()/removeDocument() below) if a purchase truly needs to go.
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
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_DELETED', entityType: 'Purchase', entityId: id, details: purchase.purchaseNumber });
    if (purchase.purchaseRequestId) await this.purchaseRequestsService.recomputeStatus(purchase.purchaseRequestId, userId, ipAddress);
    return { success: true };
  }

  // Payments are a separate, append-only-by-default record of what's
  // actually been paid ("Keep payments separate from the Purchase") —
  // adding one recomputes and persists paidAmount/paymentStatus on the
  // parent Purchase. Removing a mistaken entry does the same recompute.
  async addPayment(purchaseId: number, dto: CreatePurchasePaymentDto, userId: number | null, ipAddress?: string) {
    const purchase = await this.get(purchaseId);
    const payment = await this.prisma.purchasePayment.create({ data: { purchaseId, ...dto } });
    await this.recomputePaymentTotals(purchaseId, Number(purchase.totalAmount));
    // "Payment added" and "Payment completed" are the same event here —
    // there's no separate mark-as-completed step (see PurchasePayment) — so
    // a payment created already COMPLETED logs as completed directly.
    const action = payment.status === 'COMPLETED' ? 'PAYMENT_COMPLETED' : 'PAYMENT_ADDED';
    await this.audit.log({ userId, ipAddress, action, entityType: 'Purchase', entityId: purchaseId, details: `${payment.amount} ریال` });
    return this.get(purchaseId);
  }

  async removePayment(purchaseId: number, paymentId: number, userId: number | null, ipAddress?: string) {
    const purchase = await this.get(purchaseId);
    const payment = await this.prisma.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
    if (!payment) throw new NotFoundException('پرداخت پیدا نشد');
    await this.prisma.purchasePayment.delete({ where: { id: paymentId } });
    await this.recomputePaymentTotals(purchaseId, Number(purchase.totalAmount));
    await this.audit.log({ userId, ipAddress, action: 'PAYMENT_REMOVED', entityType: 'Purchase', entityId: purchaseId, details: `${payment.amount} ریال` });
    return this.get(purchaseId);
  }

  // Returns the created PurchaseDocument itself (with its own id) — the
  // frontend needs that real id right back to attach the file in its
  // second step (see PurchasesController.uploadDocumentFile()). Returning
  // this.get(purchaseId) here instead, as removePayment()/removeDocument()
  // do, would hand back the *Purchase*'s id (same field name, wrong
  // record), sending the file upload to whatever unrelated document
  // happened to share that id — or to no document at all.
  async addDocument(purchaseId: number, dto: CreatePurchaseDocumentDto, userId: number | null, ipAddress?: string) {
    await this.get(purchaseId);
    const document = await this.prisma.purchaseDocument.create({ data: { purchaseId, ...dto } });
    await this.audit.log({ userId, ipAddress, action: 'DOCUMENT_ADDED', entityType: 'Purchase', entityId: purchaseId, details: document.documentType });
    return document;
  }

  async removeDocument(purchaseId: number, documentId: number, userId: number | null, ipAddress?: string) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    await this.prisma.purchaseDocument.delete({ where: { id: documentId } });
    await this.audit.log({ userId, ipAddress, action: 'DOCUMENT_REMOVED', entityType: 'Purchase', entityId: purchaseId, details: document.documentType });
    return this.get(purchaseId);
  }

  // Attaches the uploaded file to a document record already created via
  // addDocument() — same two-step pattern as Employee.photoPath /
  // contractDocumentPath: metadata first (JSON), file second (multipart).
  async setDocumentFile(purchaseId: number, documentId: number, filePath: string) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    await this.prisma.purchaseDocument.update({ where: { id: documentId }, data: { filePath } });
    return this.get(purchaseId);
  }

  // --- Return to Vendor (RTV) ----------------------------------------------
  //
  // A PurchaseReturn is a historical record of goods sent back and their
  // credit value. It deliberately does NOT touch Purchase.totalAmount /
  // paidAmount / paymentStatus (those stay "what was originally billed /
  // paid") and has no status lifecycle — same create/list/delete shape as
  // PurchasePayment. No Inventory effect.

  // returnNumber (RTN-000001) uses the same placeholder-then-fix pattern as
  // purchaseNumber. The returnable-quantity check runs inside the same
  // transaction, after locking the parent Purchase row, so two concurrent
  // returns against the same purchase can't both pass the check and
  // together exceed an item's original quantity.
  async createReturn(purchaseId: number, dto: CreatePurchaseReturnDto, userId: number | null, ipAddress?: string) {
    const created = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('خرید پیدا نشد');

      const itemIds = [...new Set(dto.items.map((item) => item.purchaseItemId))];
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
        select: { id: true, name: true, quantity: true },
      });
      if (purchaseItems.length !== itemIds.length) {
        throw new ConflictException('یکی از اقلام انتخاب‌شده برای برگشت، متعلق به این خرید نیست');
      }

      const alreadyReturned = await tx.purchaseReturnItem.groupBy({
        by: ['purchaseItemId'],
        where: { purchaseItemId: { in: itemIds } },
        _sum: { quantity: true },
      });
      const returnedByItem = new Map(alreadyReturned.map((row) => [row.purchaseItemId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
      // The same item may appear on more than one line of this return —
      // what counts is the total being returned now.
      const requestedByItem = new Map<number, Prisma.Decimal>();
      for (const line of dto.items) {
        const current = requestedByItem.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
        requestedByItem.set(line.purchaseItemId, current.plus(line.quantity));
      }
      for (const item of purchaseItems) {
        const remaining = new Prisma.Decimal(item.quantity).minus(returnedByItem.get(item.id) ?? 0);
        const requested = requestedByItem.get(item.id) ?? new Prisma.Decimal(0);
        if (requested.greaterThan(remaining)) {
          throw new ConflictException(`مقدار برگشتی «${item.name}» بیشتر از مقدار قابل برگشت (${remaining.toString()}) است`);
        }
      }

      const record = await tx.purchaseReturn.create({
        data: {
          returnNumber: `PENDING-${randomUUID()}`,
          purchaseId,
          returnDate: dto.returnDate,
          reason: dto.reason,
          note: dto.note,
          createdByUserId: userId ?? undefined,
          items: { create: dto.items },
        },
      });
      const returnNumber = `RTN-${String(record.id).padStart(6, '0')}`;
      return tx.purchaseReturn.update({ where: { id: record.id }, data: { returnNumber }, include: purchaseReturnInclude });
    });

    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_RETURN_CREATED', entityType: 'Purchase', entityId: purchaseId, details: created.returnNumber });
    return created;
  }

  async listReturns(purchaseId: number) {
    await this.ensurePurchaseExists(purchaseId);
    return this.prisma.purchaseReturn.findMany({
      where: { purchaseId },
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
      include: purchaseReturnInclude,
    });
  }

  async getReturn(purchaseId: number, returnId: number) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({ where: { id: returnId, purchaseId }, include: purchaseReturnInclude });
    if (!purchaseReturn) throw new NotFoundException('برگشت پیدا نشد');
    return purchaseReturn;
  }

  // Removing a mistaken return — its lines cascade with it. Like
  // removePayment(), no Purchase field needs recomputing here (returns
  // never touched them in the first place).
  async removeReturn(purchaseId: number, returnId: number, userId: number | null, ipAddress?: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({ where: { id: returnId, purchaseId } });
    if (!purchaseReturn) throw new NotFoundException('برگشت پیدا نشد');
    await this.prisma.purchaseReturn.delete({ where: { id: returnId } });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_RETURN_DELETED', entityType: 'Purchase', entityId: purchaseId, details: purchaseReturn.returnNumber });
    return { success: true };
  }

  private async ensurePurchaseExists(id: number) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, select: { id: true } });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
  }

  private async recomputePaymentTotals(purchaseId: number, totalAmount: number) {
    const payments = await this.prisma.purchasePayment.findMany({ where: { purchaseId } });
    const paidAmount = payments
      .filter((payment) => payment.status === 'COMPLETED')
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);
    await this.prisma.purchase.update({ where: { id: purchaseId }, data: { paidAmount, paymentStatus } });
  }


  private async ensurePurchaseRequest(id: number) {
    const purchaseRequest = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!purchaseRequest) throw new ConflictException('درخواست خرید انتخاب‌شده یافت نشد');
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

  private deleteUploadedFile(relativePath: string) {
    // Best-effort cleanup, same as EmployeesService.deleteUploadedFile — the
    // database record is what matters; a leftover file is not a data-loss
    // concern, so a failure here is silently ignored.
    const filePath = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(filePath)) unlink(filePath, () => undefined);
  }

  private async ensurePurchaseType(id: number) {
    const purchaseType = await this.prisma.purchaseType.findUnique({ where: { id } });
    if (!purchaseType || !purchaseType.isActive) throw new ConflictException('نوع خرید انتخاب‌شده معتبر نیست');
  }

  private async ensureDepartment(id: number) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department || department.status !== 'active') throw new ConflictException('دپارتمان درخواست‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureBuyerEmployee(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.status !== 'active') throw new ConflictException('کارمند خریدار انتخاب‌شده فعال نیست');
  }

  private async ensureSupplier(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier || supplier.status !== 'active') throw new ConflictException('تأمین‌کننده انتخاب‌شده فعال نیست');
  }

  private async ensureUnits(unitIds: number[]) {
    const uniqueIds = [...new Set(unitIds)];
    const count = await this.prisma.unit.count({ where: { id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new ConflictException('یکی از واحدهای انتخاب‌شده برای اقلام خرید معتبر نیست');
  }
}
