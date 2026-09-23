import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseSourceType, PurchaseStatus } from '@prisma/client';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import type {
  CreatePurchaseDocumentDto,
  CreatePurchaseDto,
  CreatePurchasePaymentDto,
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
  ) {}

  list(filters: PurchaseListFilters) {
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

    return this.prisma.purchase.findMany({
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
    });
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
    await this.writeAuditLog(userId, ipAddress, action, created.id);
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
  async update(id: number, dto: UpdatePurchaseDto, userId: number | null, ipAddress?: string) {
    const existing = await this.get(id);
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
    await this.writeAuditLog(userId, ipAddress, action, id, details);

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
      include: { _count: { select: { payments: true, documents: true } } },
    });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    if (purchase._count.payments > 0 || purchase._count.documents > 0) {
      throw new ConflictException('این خرید دارای پرداخت یا سند ثبت‌شده است و قابل حذف نیست. ابتدا آن‌ها را حذف کنید.');
    }
    await this.prisma.purchase.delete({ where: { id } });
    await this.writeAuditLog(userId, ipAddress, 'PURCHASE_DELETED', id, purchase.purchaseNumber);
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
    await this.writeAuditLog(userId, ipAddress, action, purchaseId, `${payment.amount} ریال`);
    return this.get(purchaseId);
  }

  async removePayment(purchaseId: number, paymentId: number, userId: number | null, ipAddress?: string) {
    const purchase = await this.get(purchaseId);
    const payment = await this.prisma.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
    if (!payment) throw new NotFoundException('پرداخت پیدا نشد');
    await this.prisma.purchasePayment.delete({ where: { id: paymentId } });
    await this.recomputePaymentTotals(purchaseId, Number(purchase.totalAmount));
    await this.writeAuditLog(userId, ipAddress, 'PAYMENT_REMOVED', purchaseId, `${payment.amount} ریال`);
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
    await this.writeAuditLog(userId, ipAddress, 'DOCUMENT_ADDED', purchaseId, document.documentType);
    return document;
  }

  async removeDocument(purchaseId: number, documentId: number, userId: number | null, ipAddress?: string) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    await this.prisma.purchaseDocument.delete({ where: { id: documentId } });
    await this.writeAuditLog(userId, ipAddress, 'DOCUMENT_REMOVED', purchaseId, document.documentType);
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

  private async recomputePaymentTotals(purchaseId: number, totalAmount: number) {
    const payments = await this.prisma.purchasePayment.findMany({ where: { purchaseId } });
    const paidAmount = payments
      .filter((payment) => payment.status === 'COMPLETED')
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);
    await this.prisma.purchase.update({ where: { id: purchaseId }, data: { paidAmount, paymentStatus } });
  }

  // Minimal, local write to the project's one shared AUDIT_LOG table — not
  // a separate audit system, and not an elaborate event taxonomy (see
  // database_plan.txt's own note on AUDIT_LOG: keep this simple for now).
  private async writeAuditLog(userId: number | null, ipAddress: string | undefined, action: string, purchaseId: number, details?: string) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        entityType: 'Purchase',
        entityId: String(purchaseId),
        details,
        ipAddress: ipAddress ?? undefined,
      },
    });
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
