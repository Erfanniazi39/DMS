import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseSourceType, PurchaseStatus } from '@prisma/client';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { matchesFileSignature } from '../common/file-signature';
import { MAX_MONEY, toIsoDay } from '../common/zod-fields';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PAYABLE_PURCHASE_STATUSES, RETURNABLE_PURCHASE_STATUSES } from './purchase-rules';
import { PurchaseQuantitiesService } from './purchase-quantities.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import type {
  CreatePurchaseDocumentDto,
  CreatePurchaseDto,
  CreatePurchasePaymentDto,
  CreatePurchaseReturnDto,
  UpdatePurchaseDto,
  UpdatePurchasePaymentDto,
} from './dto/purchase.dto';

// Distinct, frontend-detectable 409 for "this purchase buys more than the
// linked request line still needs" — see ensureRequestOverageConfirmed().
export const PURCHASE_QUANTITY_EXCEEDS_REQUEST = 'PURCHASE_QUANTITY_EXCEEDS_REQUEST';

const PURCHASE_STATUS_LABELS_FA: Record<PurchaseStatus, string> = {
  DRAFT: 'پیش‌نویس',
  CONFIRMED: 'تأییدشده',
  RECEIVED: 'دریافت‌شده',
  CLOSED: 'بسته‌شده',
  CANCELLED: 'لغوشده',
};

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

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const PURCHASE_UPLOAD_DIR = join(process.cwd(), 'uploads', 'purchases');
// Stored names are always `<uuid><ext>` (see setDocumentFile()) — anything
// else (path separators, "..", other extensions) is never a valid request.
const STORED_DOCUMENT_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$/;

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

// A Return-to-Vendor record with each returned line's original PurchaseItem
// (name/unit/quantity) — enough for the detail page to render the return and
// derive "still returnable" per item without another round-trip.
const purchaseReturnInclude = {
  items: { include: { purchaseItem: { include: { unit: true } } }, orderBy: { id: 'asc' } },
  createdByUser: { select: { id: true, username: true } },
} satisfies Prisma.PurchaseReturnInclude;

// Every line is already a whole-Rial amount within Decimal(15,0) (see
// purchase.dto.ts); the sum can still exceed the column, which used to
// surface as a raw 500 from Postgres. A purchase must also be worth
// something: a 0 total is refused (business decision 2026-10-05 — free/gift
// items are out of scope).
function sumItemTotals(items: { totalPrice: number }[]): number {
  const total = items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (total > MAX_MONEY) throw new BadRequestException('جمع مبلغ اقلام خرید بیش از حد مجاز است');
  if (total <= 0) throw new BadRequestException('جمع مبلغ اقلام خرید باید بیشتر از صفر باشد');
  return total;
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
  // This module's own stateless quantity query helper (also exported, via
  // PurchaseQuantitiesModule, to Purchase Requests). Built from the same
  // PrismaService rather than injected — it's Purchases-owned code, and this
  // keeps PurchasesService's constructor (and its specs) unchanged.
  private readonly purchaseQuantities: PurchaseQuantitiesService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly audit: AuditService,
  ) {
    this.purchaseQuantities = new PurchaseQuantitiesService(prisma);
  }

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
  //
  // The payment write, the paidAmount/paymentStatus recompute and the audit
  // row happen in ONE transaction (QA 2026-10-05: previously a payment could
  // be persisted while the recompute then failed, leaving paidAmount stale
  // and no audit row). The parent Purchase row is locked first — same
  // convention as createReturn() — so two concurrent payments on the same
  // purchase can't each recompute from a sum that misses the other.
  //
  // Business rules (2026-10-05): only a CONFIRMED/RECEIVED/CLOSED purchase
  // takes payments; a payment can't be dated before the purchase (a future
  // date — a post-dated cheque — is fine); paying MORE than totalAmount is
  // allowed — the response carries totalAmount and paidAmount, and the
  // frontend flags paidAmount > totalAmount as overpaid.
  async addPayment(purchaseId: number, dto: CreatePurchasePaymentDto, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await this.lockPurchaseForPayment(tx, purchaseId);
      this.ensurePayable(purchase, dto.paymentDate);
      const totalAmount = purchase.totalAmount;
      const payment = await tx.purchasePayment.create({ data: { purchaseId, ...dto } });
      await this.recomputePaymentTotals(tx, purchaseId, totalAmount);
      // "Payment added" and "Payment completed" are the same event here —
      // there's no separate mark-as-completed step (see PurchasePayment) —
      // so a payment created already COMPLETED logs as completed directly.
      const action = payment.status === 'COMPLETED' ? 'PAYMENT_COMPLETED' : 'PAYMENT_ADDED';
      await this.audit.log({ userId, ipAddress, action, entityType: 'Purchase', entityId: purchaseId, details: `${payment.amount} ریال` }, tx);
    });
    return this.get(purchaseId);
  }

  // Edits a payment in place (business decision 2026-10-05 — previously only
  // delete + re-add). Same transaction/lock/recompute/audit shape as
  // addPayment(), and the same status and date rules.
  async updatePayment(purchaseId: number, paymentId: number, dto: UpdatePurchasePaymentDto, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await this.lockPurchaseForPayment(tx, purchaseId);
      const existing = await tx.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
      if (!existing) throw new NotFoundException('پرداخت پیدا نشد');
      this.ensurePayable(purchase, dto.paymentDate);
      const payment = await tx.purchasePayment.update({ where: { id: paymentId }, data: { ...dto } });
      await this.recomputePaymentTotals(tx, purchaseId, purchase.totalAmount);
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'PAYMENT_UPDATED',
          entityType: 'Purchase',
          entityId: purchaseId,
          details: `پرداخت #${paymentId}: ${existing.amount} ریال (${existing.status}) → ${payment.amount} ریال (${payment.status})`,
        },
        tx,
      );
    });
    return this.get(purchaseId);
  }

  // Deliberately NOT status-gated: removing a mistaken payment must stay
  // possible even after the purchase was cancelled.
  async removePayment(purchaseId: number, paymentId: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const { totalAmount } = await this.lockPurchaseForPayment(tx, purchaseId);
      const payment = await tx.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
      if (!payment) throw new NotFoundException('پرداخت پیدا نشد');
      await tx.purchasePayment.delete({ where: { id: paymentId } });
      await this.recomputePaymentTotals(tx, purchaseId, totalAmount);
      await this.audit.log({ userId, ipAddress, action: 'PAYMENT_REMOVED', entityType: 'Purchase', entityId: purchaseId, details: `${payment.amount} ریال` }, tx);
    });
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
  //
  // The upload arrives in memory (see PurchasesController); nothing touches
  // the disk until the purchase/document pair has been found and the file's
  // content has been checked against its extension. The old file (if any)
  // is only removed once the new path is committed, and the attach/replace
  // is audited (QA 2026-10-05: a replaced file used to leave no trace).
  async setDocumentFile(
    purchaseId: number,
    documentId: number,
    file: { originalName: string; buffer: Buffer },
    userId: number | null,
    ipAddress?: string,
  ) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');

    const extension = extname(file.originalName).toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است');
    }
    if (!matchesFileSignature(file.buffer, extension)) {
      throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد. فقط فایل PDF یا تصویر jpg/png واقعی مجاز است');
    }

    const filename = `${randomUUID()}${extension}`;
    const filePath = `/uploads/purchases/${filename}`;
    await writeFile(join(PURCHASE_UPLOAD_DIR, filename), file.buffer);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.purchaseDocument.update({ where: { id: documentId }, data: { filePath } });
        await this.audit.log(
          {
            userId,
            ipAddress,
            action: document.filePath ? 'DOCUMENT_FILE_REPLACED' : 'DOCUMENT_FILE_ATTACHED',
            entityType: 'Purchase',
            entityId: purchaseId,
            details: `${document.documentType} (سند #${document.id})`,
          },
          tx,
        );
      });
    } catch (error) {
      this.deleteUploadedFile(filePath);
      throw error;
    }
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    return this.get(purchaseId);
  }

  // Resolves a stored purchase-document filename to its absolute path on
  // disk for the guarded download route (PurchaseFilesController) — only a
  // file that a PurchaseDocument actually references is ever served.
  async resolveDocumentFile(filename: string): Promise<string> {
    if (!STORED_DOCUMENT_FILENAME.test(filename)) throw new NotFoundException('فایل پیدا نشد');
    const document = await this.prisma.purchaseDocument.findFirst({
      where: { filePath: `/uploads/purchases/${filename}` },
      select: { id: true },
    });
    const absolutePath = join(PURCHASE_UPLOAD_DIR, filename);
    if (!document || !existsSync(absolutePath)) throw new NotFoundException('فایل پیدا نشد');
    return absolutePath;
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
  //
  // Business rules (2026-10-05): only a RECEIVED/CLOSED purchase can have a
  // return (it represents goods actually received); the return can't be
  // dated before the purchase; and each line's credit is capped at that
  // purchase line's remaining value (totalPrice minus credit already
  // returned) — same enforcement level as the quantity cap.
  async createReturn(purchaseId: number, dto: CreatePurchaseReturnDto, userId: number | null, ipAddress?: string) {
    const created = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number; status: PurchaseStatus; purchase_date: Date }[]>`SELECT id, status, purchase_date FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('خرید پیدا نشد');
      const [purchase] = locked;
      if (!RETURNABLE_PURCHASE_STATUSES.includes(purchase.status)) {
        throw new ConflictException(
          `برگشت فقط برای خرید «دریافت‌شده» یا «بسته‌شده» قابل ثبت است؛ وضعیت این خرید «${PURCHASE_STATUS_LABELS_FA[purchase.status] ?? purchase.status}» است`,
        );
      }
      if (toIsoDay(dto.returnDate) < toIsoDay(purchase.purchase_date)) {
        throw new ConflictException('تاریخ برگشت نمی‌تواند قبل از تاریخ خرید باشد');
      }

      const itemIds = [...new Set(dto.items.map((item) => item.purchaseItemId))];
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
        select: { id: true, name: true, quantity: true, totalPrice: true },
      });
      if (purchaseItems.length !== itemIds.length) {
        throw new ConflictException('یکی از اقلام انتخاب‌شده برای برگشت، متعلق به این خرید نیست');
      }

      const alreadyReturned = await tx.purchaseReturnItem.groupBy({
        by: ['purchaseItemId'],
        where: { purchaseItemId: { in: itemIds } },
        _sum: { quantity: true, creditAmount: true },
      });
      const returnedByItem = new Map(alreadyReturned.map((row) => [row.purchaseItemId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
      const creditedByItem = new Map(alreadyReturned.map((row) => [row.purchaseItemId, new Prisma.Decimal(row._sum.creditAmount ?? 0)]));
      // The same item may appear on more than one line of this return —
      // what counts is the total being returned now.
      const requestedByItem = new Map<number, Prisma.Decimal>();
      const creditRequestedByItem = new Map<number, Prisma.Decimal>();
      for (const line of dto.items) {
        const current = requestedByItem.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
        requestedByItem.set(line.purchaseItemId, current.plus(line.quantity));
        const currentCredit = creditRequestedByItem.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
        creditRequestedByItem.set(line.purchaseItemId, currentCredit.plus(line.creditAmount));
      }
      for (const item of purchaseItems) {
        const remaining = new Prisma.Decimal(item.quantity).minus(returnedByItem.get(item.id) ?? 0);
        const requested = requestedByItem.get(item.id) ?? new Prisma.Decimal(0);
        if (requested.greaterThan(remaining)) {
          throw new ConflictException(`مقدار برگشتی «${item.name}» بیشتر از مقدار قابل برگشت (${remaining.toString()}) است`);
        }
        const remainingValue = new Prisma.Decimal(item.totalPrice).minus(creditedByItem.get(item.id) ?? 0);
        const creditRequested = creditRequestedByItem.get(item.id) ?? new Prisma.Decimal(0);
        if (creditRequested.greaterThan(remainingValue)) {
          throw new ConflictException(`مبلغ اعتبار برگشتی «${item.name}» بیشتر از ارزش باقی‌ماندهٔ قابل برگشت (${remainingValue.toString()} ریال) است`);
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

  // Locks the parent Purchase row for the rest of the transaction (see
  // addPayment()) and returns what the payment rules need, read after the lock.
  private async lockPurchaseForPayment(tx: Prisma.TransactionClient, purchaseId: number) {
    await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      select: { totalAmount: true, status: true, purchaseDate: true },
    });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    return { totalAmount: Number(purchase.totalAmount), status: purchase.status, purchaseDate: purchase.purchaseDate };
  }

  private ensurePayable(purchase: { status: PurchaseStatus; purchaseDate: Date }, paymentDate: Date) {
    if (!PAYABLE_PURCHASE_STATUSES.includes(purchase.status)) {
      throw new ConflictException(
        `پرداخت فقط برای خرید «تأییدشده»، «دریافت‌شده» یا «بسته‌شده» قابل ثبت است؛ وضعیت این خرید «${PURCHASE_STATUS_LABELS_FA[purchase.status] ?? purchase.status}» است`,
      );
    }
    if (toIsoDay(paymentDate) < toIsoDay(purchase.purchaseDate)) {
      throw new ConflictException('تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد');
    }
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

  private async recomputePaymentTotals(tx: Prisma.TransactionClient, purchaseId: number, totalAmount: number) {
    const payments = await tx.purchasePayment.findMany({ where: { purchaseId } });
    const paidAmount = payments
      .filter((payment) => payment.status === 'COMPLETED')
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (paidAmount > MAX_MONEY) throw new BadRequestException('مجموع پرداخت‌های این خرید بیش از حد مجاز است');
    const paymentStatus = derivePaymentStatus(totalAmount, paidAmount);
    await tx.purchase.update({ where: { id: purchaseId }, data: { paidAmount, paymentStatus } });
  }


  // `requireLinkable`: a purchase may only be (newly) linked to an APPROVED
  // or PARTIALLY_PURCHASED request (business decision 2026-10-05) — not a
  // DRAFT/SUBMITTED one that nobody approved, nor a REJECTED/CANCELLED/
  // COMPLETED one.
  private async ensurePurchaseRequest(id: number, options: { requireLinkable: boolean }) {
    const purchaseRequest = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!purchaseRequest) throw new ConflictException('درخواست خرید انتخاب‌شده یافت نشد');
    if (options.requireLinkable && purchaseRequest.status !== 'APPROVED' && purchaseRequest.status !== 'PARTIALLY_PURCHASED') {
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

  // A unit must exist and be active to be newly assigned. Units this
  // purchase's lines already use (`alreadyAssigned`, on update) are exempt —
  // a since-deactivated unit may stay where it already is, same rule as
  // ItemsService.ensureReferences().
  private async ensureUnits(unitIds: number[], alreadyAssigned: number[] = []) {
    const kept = new Set(alreadyAssigned);
    const toCheck = [...new Set(unitIds)].filter((id) => !kept.has(id));
    if (toCheck.length === 0) return;
    const count = await this.prisma.unit.count({ where: { id: { in: toCheck }, isActive: true } });
    if (count !== toCheck.length) throw new ConflictException('یکی از واحدهای انتخاب‌شده برای اقلام خرید معتبر یا فعال نیست');
  }
}
