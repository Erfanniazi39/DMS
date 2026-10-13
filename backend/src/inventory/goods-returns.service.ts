import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockBucket, type StockDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { EDITABLE_STOCK_DOCUMENT_STATUSES, GOODS_RETURN_DOC_TYPE, STOCK_BUCKET_LABELS_FA } from './inventory-rules';
import { applyMovements, STOCK_RESERVED_FOR_OTHERS, type MovementInput } from './stock-ledger';
import type { CreateGoodsReturnDto, UpdateGoodsReturnDto } from './dto/goods-return.dto';

export type GoodsReturnListFilters = { q?: string; status?: StockDocumentStatus; supplierId?: number };

type DraftLine = {
  goodsReceiptItemId?: number;
  itemId: number;
  batchId?: number;
  fromBucket: StockBucket;
  quantity: number;
  note?: string;
};

const goodsReturnDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true, status: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true } },
  createdByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  items: {
    include: {
      item: { select: { id: true, code: true, name: true, status: true, unit: { select: { id: true, nameFa: true } } } },
      goodsReceiptItem: { select: { id: true, lineNo: true, goodsReceiptId: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.GoodsReturnInclude;

// Goods returns (برگشت کالا به تأمین‌کننده) — Inventory batch I8, build plan
// §5.8/§6/§7, B9. Physical stock leaving ON_HAND/QC/DAMAGED back to the
// supplier for credit/claim. Lines may optionally cite a GoodsReceiptItem
// (caps Σ quantity ≤ quantity − returnedQty, the overall-any-bucket cap —
// §6's own note) and/or a Purchases Return-to-Vendor record, purely for
// display (purchaseReturnId/purchaseReturnNumber — NO FK, CLAUDE.md rule 5's
// loose-coupling convention; no synchronization between the two, Purchases'
// PurchaseReturn has no Inventory effect of its own).
//
// Lifecycle: DRAFT (editable, deletable, no number) → POSTED (immutable,
// numbered GRT-<jalali year>-000001, stock written) via post() — no approval
// step, same as GoodsReceipt. A posted return is never edited: a mistake is
// fixed with a CORRECTION stock adjustment.
//
// Permission: inventory.receive throughout (create/edit/delete/post) — the
// same permission already documented as "Goods receipts, QC release, goods
// returns" (build plan §7); inventory.view for reads. No new permission.
@Injectable()
export class GoodsReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Pickers for the (future) return form, behind inventory.receive — same
  // reasoning as GoodsReceiptsService.formOptions() (the receiving role
  // doesn't hold suppliers.view/items.view).
  async formOptions() {
    const [defaultLocation, locations, suppliers] = await Promise.all([
      this.inventory.getDefaultLocation(),
      this.prisma.inventoryLocation.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ id: 'asc' }] }),
      this.prisma.supplier.findMany({ where: { status: 'active' }, select: { id: true, code: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    ]);
    return { defaultLocationId: defaultLocation.id, locations, suppliers };
  }

  // The optional goods-receipt reference picker: one supplier's POSTED
  // receipts, newest first — display data only, same shape as
  // GoodsReceiptsService.purchaseOptions().
  async goodsReceiptOptions(supplierId: number) {
    return this.prisma.goodsReceipt.findMany({
      where: { supplierId, status: 'POSTED' },
      select: { id: true, receiptNumber: true, receiptDate: true },
      orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async list(filters: GoodsReturnListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.GoodsReturnWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.q) {
      where.OR = [
        { returnNumber: { contains: filters.q, mode: 'insensitive' } },
        { supplierName: { contains: filters.q, mode: 'insensitive' } },
        { reason: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    const query = {
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
    } satisfies Prisma.GoodsReturnFindManyArgs;

    if (!pagination) return this.prisma.goodsReturn.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.goodsReturn.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.goodsReturn.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    return this.findOrThrow(id);
  }

  async create(dto: CreateGoodsReturnDto, userId: number | null, ipAddress?: string) {
    const locationId = await this.resolveLocation(dto.locationId);
    const supplier = await this.resolveSupplier(dto.supplierId);
    const goodsReceipt = await this.resolveGoodsReceipt(dto.goodsReceiptId);
    const purchaseReturn = await this.resolvePurchaseReturn(dto.purchaseReturnId);
    await this.ensureActiveItems(dto.items.map((line) => line.itemId));
    await this.ensureBatchFieldsValid(dto.items);
    await this.validateReceiptCaps(this.prisma, dto.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const goodsReturn = await tx.goodsReturn.create({
        data: {
          status: 'DRAFT',
          locationId,
          supplierId: supplier.id,
          supplierName: supplier.name,
          goodsReceiptId: goodsReceipt?.id ?? null,
          purchaseReturnId: purchaseReturn?.id ?? null,
          purchaseReturnNumber: purchaseReturn?.returnNumber ?? null,
          returnDate: dto.returnDate,
          reason: dto.reason,
          note: dto.note ?? null,
          createdByUserId: userId,
          items: { create: this.lineData(dto.items) },
        },
        include: goodsReturnDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RETURN_CREATED',
          entityType: AUDIT_ENTITY.GOODS_RETURN,
          entityId: goodsReturn.id,
          details: `پیش‌نویس برگشت کالا — ${supplier.name}، ${dto.items.length} ردیف`,
        },
        tx,
      );
      return goodsReturn;
    });
    return created;
  }

  // Full-record edit of a DRAFT: header + lines replaced wholesale, with the
  // optimistic lock re-checked atomically (updatedAt + status = DRAFT)
  // inside the transaction — same convention as GoodsReceiptsService.update().
  async update(id: number, dto: UpdateGoodsReturnDto, userId: number | null, ipAddress?: string) {
    const existing = await this.findOrThrow(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    const supplier = await this.resolveSupplier(dto.supplierId, existing.supplierId);
    const goodsReceipt = await this.resolveGoodsReceipt(dto.goodsReceiptId);
    const purchaseReturn = await this.resolvePurchaseReturn(dto.purchaseReturnId);
    await this.ensureActiveItems(
      dto.items.map((line) => line.itemId),
      existing.items.map((line) => line.itemId),
    );
    await this.ensureBatchFieldsValid(dto.items);
    await this.validateReceiptCaps(this.prisma, dto.items);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.goodsReturn.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.goodsReturnItem.deleteMany({ where: { goodsReturnId: id } });
      const updated = await tx.goodsReturn.update({
        where: { id },
        data: {
          locationId,
          supplierId: supplier.id,
          supplierName: supplier.name,
          goodsReceiptId: goodsReceipt?.id ?? null,
          purchaseReturnId: purchaseReturn?.id ?? null,
          purchaseReturnNumber: purchaseReturn?.returnNumber ?? null,
          returnDate: dto.returnDate,
          reason: dto.reason,
          note: dto.note ?? null,
          items: { create: this.lineData(dto.items) },
        },
        include: goodsReturnDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'GOODS_RETURN_UPDATED', entityType: AUDIT_ENTITY.GOODS_RETURN, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return updated;
    });
  }

  // DRAFT → POSTED. One transaction, same shape as
  // GoodsReceiptsService.post(): lock the draft row FOR UPDATE, check
  // status + version, claim GRT-<jalali year of returnDate>-NNNNNN,
  // re-validate (item kind/batch state/receipt caps may have changed since
  // the draft was saved), lock every referenced GoodsReceiptItem row and
  // every ON_HAND line's stock balance row (free-stock guard), write
  // SUPPLIER_RETURN movements, increment the referenced GoodsReceiptItem
  // counters, mark POSTED, audit. Any failure keeps nothing, including the
  // number (gap-free).
  async post(id: number, loadedVersion: Date, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_returns WHERE id = ${id} FOR UPDATE`;
      const goodsReturn = await tx.goodsReturn.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!goodsReturn) throw new NotFoundException('برگشت کالا پیدا نشد');
      if (goodsReturn.status !== 'DRAFT') throw new ConflictException('این برگشت کالا قبلاً ثبت شده است');
      if (!isSameVersion(goodsReturn.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (goodsReturn.items.length === 0) throw new BadRequestException('برگشت کالا بدون ردیف قابل ثبت نیست');
      if (!goodsReturn.location?.isActive) throw new ConflictException('انبار این سند غیرفعال است');

      await this.ensureActiveItems(
        goodsReturn.items.map((line) => line.itemId),
        goodsReturn.items.map((line) => line.itemId),
      );
      await this.ensureBatchFieldsValid(goodsReturn.items);
      const receiptCaps = await this.validateReceiptCaps(tx, goodsReturn.items, { lock: true });
      await this.ensureFreeOnHandStock(tx, goodsReturn.locationId, goodsReturn.items);

      const returnNumber = await nextDocumentNumber(tx, GOODS_RETURN_DOC_TYPE, goodsReturn.returnDate);
      // No batchNumber is ever typed on a GoodsReturn line (outbound-only,
      // an existing batch is always picked directly at create/update time
      // via ensureBatchFieldsValid()) — batchId is already resolved, no
      // stock-batches.ts resolveBatches() step needed here.
      const rows: MovementInput[] = goodsReturn.items.map((line) => ({
        itemId: line.itemId,
        locationId: goodsReturn.locationId,
        bucket: line.fromBucket,
        movementType: 'SUPPLIER_RETURN',
        quantity: new Prisma.Decimal(line.quantity).negated(),
        movementDate: goodsReturn.returnDate,
        referenceType: 'GOODS_RETURN',
        referenceId: goodsReturn.id,
        referenceLineId: line.id,
        referenceNumber: returnNumber,
        note: line.note,
        createdByUserId: userId,
        batchId: line.batchId ?? null,
      }));
      await applyMovements(tx, rows);

      for (const [goodsReceiptItemId, cap] of receiptCaps) {
        await tx.goodsReceiptItem.update({
          where: { id: goodsReceiptItemId },
          data: {
            returnedQty: { increment: cap.returnedIncrement },
            ...(cap.rejectedIncrement.greaterThan(0) ? { rejectedQty: { increment: cap.rejectedIncrement } } : {}),
          },
        });
      }

      await tx.goodsReturn.update({
        where: { id },
        data: { status: 'POSTED', returnNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RETURN_POSTED',
          entityType: AUDIT_ENTITY.GOODS_RETURN,
          entityId: id,
          details: `${returnNumber} — ${goodsReturn.supplierName}، ${rows.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // DRAFT only. A POSTED return has no delete path — ever.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_returns WHERE id = ${id} FOR UPDATE`;
      const goodsReturn = await tx.goodsReturn.findUnique({ where: { id }, select: { id: true, status: true, supplierName: true } });
      if (!goodsReturn) throw new NotFoundException('برگشت کالا پیدا نشد');
      this.ensureEditable(goodsReturn.status);
      await tx.goodsReturn.delete({ where: { id } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RETURN_DELETED',
          entityType: AUDIT_ENTITY.GOODS_RETURN,
          entityId: id,
          details: `پیش‌نویس برگشت کالا — ${goodsReturn.supplierName}`,
        },
        tx,
      );
    });
    return { success: true };
  }

  private async findOrThrow(id: number) {
    const goodsReturn = await this.prisma.goodsReturn.findUnique({ where: { id }, include: goodsReturnDetailInclude });
    if (!goodsReturn) throw new NotFoundException('برگشت کالا پیدا نشد');
    return goodsReturn;
  }

  private lineData(lines: DraftLine[]) {
    return lines.map((line) => ({
      goodsReceiptItemId: line.goodsReceiptItemId ?? null,
      itemId: line.itemId,
      batchId: line.batchId ?? null,
      fromBucket: line.fromBucket,
      quantity: line.quantity,
      note: line.note ?? null,
    }));
  }

  private ensureEditable(status: StockDocumentStatus) {
    if (!EDITABLE_STOCK_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException('سند ثبت‌شده قابل ویرایش یا حذف نیست؛ برای اصلاح، یک سند «اصلاح موجودی» ثبت کنید.');
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

  // Read-only "exists and active" lookup into Suppliers (CLAUDE.md rule 11's
  // documented exception). The supplier the draft already has may stay even
  // if it has been deactivated since.
  private async resolveSupplier(supplierId: number, currentSupplierId?: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, status: true } });
    if (!supplier) throw new BadRequestException('تأمین‌کنندهٔ انتخاب‌شده یافت نشد');
    if (supplier.status !== 'active' && supplierId !== currentSupplierId) {
      throw new BadRequestException(`تأمین‌کنندهٔ «${supplier.name}» فعال نیست`);
    }
    return supplier;
  }

  // Optional, read-only existence lookup into GoodsReceipt — never a write.
  private async resolveGoodsReceipt(goodsReceiptId: number | undefined) {
    if (goodsReceiptId === undefined) return null;
    const goodsReceipt = await this.prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, select: { id: true } });
    if (!goodsReceipt) throw new BadRequestException('رسید انبار انتخاب‌شده یافت نشد');
    return goodsReceipt;
  }

  // Optional, read-only existence lookup into Purchases' PurchaseReturn —
  // never a write, never a FK (B3/B12 philosophy; CLAUDE.md rule 5/7).
  // Snapshots returnNumber for display.
  private async resolvePurchaseReturn(purchaseReturnId: number | undefined) {
    if (purchaseReturnId === undefined) return null;
    const purchaseReturn = await this.prisma.purchaseReturn.findUnique({ where: { id: purchaseReturnId }, select: { id: true, returnNumber: true } });
    if (!purchaseReturn) throw new BadRequestException('برگشت از خرید انتخاب‌شده یافت نشد');
    return purchaseReturn;
  }

  // Read-only "exists and active" lookup into Items (CLAUDE.md rule 11's
  // documented exception) — same shape as StockAdjustmentsService
  // .ensureActiveItems(). No itemKind restriction here — a GoodsReturn moves
  // whatever is physically sitting in ON_HAND/QC/DAMAGED, not a fixed set of
  // kinds like GoodsReceipt/ProductionOutput.
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

  // I4: a line is always outbound (the stock is leaving to the supplier), so
  // a batch-tracked item's line must name an EXISTING batch (batchId only —
  // never creates a new lot here, the mirror of StockAdjustmentsService
  // .ensureBatchFieldsValid()'s negative-line branch); an untracked item's
  // line must carry none.
  private async ensureBatchFieldsValid(items: { itemId: number; batchId?: number | null }[]) {
    const itemIds = [...new Set(items.map((item) => item.itemId))];
    const settings = await this.prisma.inventoryItemSetting.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, batchTracked: true } });
    const trackedIds = new Set(settings.filter((row) => row.batchTracked).map((row) => row.itemId));
    const batchIds = items.map((item) => item.batchId).filter((id): id is number => typeof id === 'number');
    const batches = batchIds.length ? await this.prisma.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, itemId: true } }) : [];
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));

    items.forEach((item, index) => {
      const label = `ردیف ${index + 1}`;
      const tracked = trackedIds.has(item.itemId);
      const hasBatchId = typeof item.batchId === 'number';
      if (!tracked) {
        if (hasBatchId) throw new BadRequestException(`${label}: این کالا ردیابی بچ ندارد؛ برای این ردیف نباید بچ مشخص شود`);
        return;
      }
      if (!hasBatchId) throw new BadRequestException(`${label}: این کالا ردیابی بچ دارد؛ یک بچ موجود را انتخاب کنید`);
      const batch = batchById.get(item.batchId!);
      if (!batch || batch.itemId !== item.itemId) throw new BadRequestException(`${label}: بچ انتخاب‌شده برای این کالا معتبر نیست`);
    });
  }

  // Build plan §6: a goods-receipt-item-linked line is capped by
  // goodsReceiptItem.quantity − returnedQty (the overall-any-bucket cap, NOT
  // just the QC-specific releasedQty/rejectedQty figure). Lines are grouped
  // by goodsReceiptItemId so two lines of the same document referencing the
  // same receipt line are judged together. When lock=true (posting), each
  // referenced row is locked FOR UPDATE, in ascending id order, before being
  // read — the same "lock before read" discipline as every other posting
  // path here — so two concurrent GoodsReturn postings against the same
  // receipt line serialize instead of racing.
  private async validateReceiptCaps(
    db: Prisma.TransactionClient | PrismaService,
    items: { goodsReceiptItemId?: number | null; itemId: number; fromBucket: StockBucket; quantity: number | Prisma.Decimal }[],
    options: { lock?: boolean } = {},
  ): Promise<Map<number, { returnedIncrement: Prisma.Decimal; rejectedIncrement: Prisma.Decimal }>> {
    const byReceiptItem = new Map<number, { itemId: number; fromBucket: StockBucket; quantity: Prisma.Decimal }[]>();
    items.forEach((line) => {
      if (!line.goodsReceiptItemId) return;
      const list = byReceiptItem.get(line.goodsReceiptItemId) ?? [];
      list.push({ itemId: line.itemId, fromBucket: line.fromBucket, quantity: new Prisma.Decimal(line.quantity) });
      byReceiptItem.set(line.goodsReceiptItemId, list);
    });
    const result = new Map<number, { returnedIncrement: Prisma.Decimal; rejectedIncrement: Prisma.Decimal }>();
    if (byReceiptItem.size === 0) return result;

    type ReceiptLineSnapshot = { itemId: number; quantity: Prisma.Decimal; releasedQty: Prisma.Decimal; rejectedQty: Prisma.Decimal; returnedQty: Prisma.Decimal };

    const ids = [...byReceiptItem.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const lines = byReceiptItem.get(id)!;
      let snapshot: ReceiptLineSnapshot | undefined;
      if (options.lock) {
        const rows = await (db as Prisma.TransactionClient).$queryRaw<{ item_id: number; quantity: unknown; released_qty: unknown; rejected_qty: unknown; returned_qty: unknown }[]>`
          SELECT item_id, quantity, released_qty, rejected_qty, returned_qty FROM goods_receipt_items
          WHERE id = ${id} FOR UPDATE`;
        const row = rows?.[0];
        snapshot = row
          ? {
              itemId: Number(row.item_id),
              quantity: new Prisma.Decimal(String(row.quantity)),
              releasedQty: new Prisma.Decimal(String(row.released_qty)),
              rejectedQty: new Prisma.Decimal(String(row.rejected_qty)),
              returnedQty: new Prisma.Decimal(String(row.returned_qty)),
            }
          : undefined;
      } else {
        const row = await (db as PrismaService).goodsReceiptItem.findUnique({
          where: { id },
          select: { itemId: true, quantity: true, releasedQty: true, rejectedQty: true, returnedQty: true },
        });
        snapshot = row
          ? {
              itemId: row.itemId,
              quantity: new Prisma.Decimal(row.quantity),
              releasedQty: new Prisma.Decimal(row.releasedQty),
              rejectedQty: new Prisma.Decimal(row.rejectedQty),
              returnedQty: new Prisma.Decimal(row.returnedQty),
            }
          : undefined;
      }
      if (!snapshot) throw new BadRequestException('ردیف رسید انبار انتخاب‌شده یافت نشد');

      const { itemId, quantity, releasedQty, rejectedQty, returnedQty } = snapshot;

      const totalRequested = lines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
      const remainingOverall = quantity.minus(returnedQty);
      if (totalRequested.greaterThan(remainingOverall)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'GOODS_RETURN_EXCEEDS_RECEIPT_LINE',
          message: `ردیف رسید انبار #${id}: مقدار برگشت (${totalRequested.toString()}) بیش از مقدار باقی‌مانده قابل برگشت (${remainingOverall.toString()}) است.`,
          details: { goodsReceiptItemId: id, requested: totalRequested.toString(), remaining: remainingOverall.toString() },
        });
      }
      const mismatchedItem = lines.find((line) => line.itemId !== itemId);
      if (mismatchedItem) throw new BadRequestException('ردیف رسید انبار انتخاب‌شده با کالای این ردیف مطابقت ندارد');

      const fromQc = lines.filter((line) => line.fromBucket === 'QC').reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
      if (fromQc.greaterThan(0)) {
        const remainingInQc = quantity.minus(releasedQty).minus(rejectedQty);
        if (fromQc.greaterThan(remainingInQc)) {
          throw new ConflictException({
            statusCode: 409,
            code: 'GOODS_RETURN_EXCEEDS_QC_REMAINING',
            message: `ردیف رسید انبار #${id}: مقدار برگشت از «${STOCK_BUCKET_LABELS_FA.QC}» (${fromQc.toString()}) بیش از مقدار باقی‌مانده در کنترل کیفیت (${remainingInQc.toString()}) است.`,
            details: { goodsReceiptItemId: id, requested: fromQc.toString(), remaining: remainingInQc.toString() },
          });
        }
      }

      result.set(id, { returnedIncrement: totalRequested, rejectedIncrement: fromQc });
    }
    return result;
  }

  // ON_HAND lines must come from free stock only (never eat another order's
  // reservation) — same 409 pattern as stock-ledger.ts issueForDelivery()'s
  // STOCK_RESERVED_FOR_OTHERS guard, reusing its code. Reads under the same
  // FOR UPDATE lock applyMovements() then takes (re-locking a row this
  // transaction already holds is a no-op).
  private async ensureFreeOnHandStock(tx: Prisma.TransactionClient, locationId: number, items: { itemId: number; fromBucket: StockBucket; quantity: number | Prisma.Decimal }[]) {
    const byItem = new Map<number, Prisma.Decimal>();
    for (const line of items) {
      if (line.fromBucket !== 'ON_HAND') continue;
      byItem.set(line.itemId, (byItem.get(line.itemId) ?? new Prisma.Decimal(0)).plus(line.quantity));
    }
    const itemIds = [...byItem.keys()].sort((a, b) => a - b);
    for (const itemId of itemIds) {
      const rows = await tx.$queryRaw<{ on_hand: unknown; reserved: unknown }[]>`
        SELECT on_hand, reserved FROM stock_balances
        WHERE item_id = ${itemId} AND location_id = ${locationId}
        FOR UPDATE`;
      const row = rows?.[0];
      const onHand = row ? new Prisma.Decimal(String(row.on_hand)) : new Prisma.Decimal(0);
      const reserved = row ? new Prisma.Decimal(String(row.reserved)) : new Prisma.Decimal(0);
      const free = Prisma.Decimal.max(new Prisma.Decimal(0), onHand.minus(reserved));
      const requested = byItem.get(itemId)!;
      // Plain insufficient stock (requested > onHand entirely) is left for
      // applyMovements()'s own NEGATIVE_STOCK check below — this guard is
      // only for the narrower "physically enough, but some is reserved for
      // another order" case, same two-tier split as issueForDelivery().
      if (requested.greaterThan(onHand)) continue;
      if (requested.greaterThan(free)) {
        const item = await tx.item.findUnique({ where: { id: itemId }, select: { code: true, name: true } });
        const itemLabel = item ? `«${item.name}» (${item.code})` : `کالای #${itemId}`;
        throw new ConflictException({
          statusCode: 409,
          code: STOCK_RESERVED_FOR_OTHERS,
          message: `موجودی آزاد ${itemLabel} کافی نیست: مقدار درخواستی برای برگشت ${requested.toString()}، موجودی آزاد (رزرونشده) ${free.toString()} است. بقیهٔ موجودی برای سفارش‌های دیگر رزرو شده است.`,
          details: { itemId, onHand: onHand.toString(), reserved: reserved.toString(), requested: requested.toString(), free: free.toString() },
        });
      }
    }
  }
}
