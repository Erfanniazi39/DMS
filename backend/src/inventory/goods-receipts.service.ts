import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import { InventoryService } from './inventory.service';
import { EDITABLE_STOCK_DOCUMENT_STATUSES, GOODS_RECEIPT_DOC_TYPE, GOODS_RECEIPT_ITEM_KINDS } from './inventory-rules';
import { ensureInboundBatchFields, ensureInboundItems, maskLineCosts, resolveInboundBatches, type CostAccess } from './inbound-documents';
import { applyMovements, type MovementInput } from './stock-ledger';
import type { CreateGoodsReceiptDto, ReleaseGoodsReceiptQcDto, UpdateGoodsReceiptDto } from './dto/goods-receipt.dto';

export type GoodsReceiptListFilters = { q?: string; status?: StockDocumentStatus; supplierId?: number; sort?: SortParams };

const GOODS_RECEIPT_COST_FIELDS = ['unitCost'] as const;
const DOCUMENT_LABEL_FA = '«رسید انبار»';

const goodsReceiptDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true, status: true } },
  createdByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  items: {
    include: {
      item: { select: { id: true, code: true, name: true, status: true, itemKind: true, unit: { select: { id: true, nameFa: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.GoodsReceiptInclude;

type DraftLine = {
  itemId: number;
  quantity: number;
  unitCost?: number;
  batchNumber?: string;
  productionDate?: Date;
  expiryDate?: Date;
  note?: string;
};

// Columns the goods-receipts table can be sorted by (the line count is derived).
const GOODS_RECEIPT_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.GoodsReceiptOrderByWithRelationInput> = {
  receiptNumber: (dir) => ({ receiptNumber: { sort: dir, nulls: 'last' } }),
  receiptDate: (dir) => ({ receiptDate: dir }),
  supplier: (dir) => ({ supplierName: dir }),
  supplierDocumentNumber: (dir) => ({ supplierDocumentNumber: { sort: dir, nulls: 'last' } }),
  purchaseNumber: (dir) => ({ purchaseNumber: { sort: dir, nulls: 'last' } }),
  location: (dir) => ({ location: { name: dir } }),
  inspectionRequired: (dir) => ({ inspectionRequired: dir }),
  createdBy: (dir) => ({ createdByUser: { username: dir } }),
  status: (dir) => ({ status: dir }),
};

// Goods receipts (رسید انبار) — Inventory batch I5, build plan §5.5/§6.
// Raw materials / packaging received from a supplier (B3 reframed): lines
// target Item.itemKind IN (RAW_MATERIAL, PACKAGING) only. Finished goods
// enter through ProductionOutputsService instead (B1 — the company produces
// what it sells).
//
// Lifecycle: DRAFT (editable, deletable, no number) → POSTED (immutable,
// numbered GRN-<jalali year>-000001, stock written) via post() — no approval
// step (inbound only). When inspectionRequired (B19) the lines land in QC
// instead of ON_HAND, and releaseFromQc() moves them QC → ON_HAND per line,
// in any number of partial releases. A posted receipt is never edited: a
// mistake is fixed with a CORRECTION stock adjustment (or, from I8, a goods
// return).
//
// Purchases are never touched (CLAUDE.md rule 7): purchaseId is a plain,
// optional, non-FK reference whose number is snapshotted; nothing here
// reads or writes Purchase beyond the existence check.
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Pickers for the receipt form, all behind inventory.receive (the
  // receiving roles don't hold suppliers.view/items.view): the default and
  // active locations, active suppliers (id/code/name only — never bank or
  // national-ID fields), and active RAW_MATERIAL/PACKAGING items with their
  // batch/expiry settings so the form knows which lines need a lot number.
  async formOptions() {
    const [defaultLocation, locations, suppliers, items] = await Promise.all([
      this.inventory.getDefaultLocation(),
      this.prisma.inventoryLocation.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ id: 'asc' }] }),
      this.prisma.supplier.findMany({ where: { status: 'active' }, select: { id: true, code: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.prisma.item.findMany({
        where: { status: 'active', itemKind: { in: [...GOODS_RECEIPT_ITEM_KINDS] } },
        select: {
          id: true,
          code: true,
          name: true,
          itemKind: true,
          unit: { select: { id: true, nameFa: true } },
          inventoryItemSetting: { select: { batchTracked: true, expiryRequired: true, shelfLifeDays: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      defaultLocationId: defaultLocation.id,
      locations,
      suppliers,
      items: items.map(({ inventoryItemSetting, ...item }) => ({
        ...item,
        batchTracked: inventoryItemSetting?.batchTracked ?? false,
        expiryRequired: inventoryItemSetting?.expiryRequired ?? false,
        shelfLifeDays: inventoryItemSetting?.shelfLifeDays ?? null,
      })),
    };
  }

  // The optional purchase-reference picker: one supplier's purchases, newest
  // first, read-only display data only (CLAUDE.md rule 11's read-only lookup
  // exception). Deliberately unfiltered by purchase status — what a status
  // means is Purchases' business rule, not Inventory's; status is returned
  // so the picker can show it.
  async purchaseOptions(supplierId: number) {
    return this.prisma.purchase.findMany({
      where: { supplierId },
      select: { id: true, purchaseNumber: true, purchaseDate: true, status: true },
      orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  // List rows carry no cost — nothing to mask.
  async list(filters: GoodsReceiptListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.GoodsReceiptWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.q) {
      where.OR = [
        { receiptNumber: { contains: filters.q, mode: 'insensitive' } },
        { supplierName: { contains: filters.q, mode: 'insensitive' } },
        { supplierDocumentNumber: { contains: filters.q, mode: 'insensitive' } },
        { purchaseNumber: { contains: filters.q, mode: 'insensitive' } },
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
      orderBy: buildOrderBy(filters.sort, GOODS_RECEIPT_SORT_COLUMNS, [{ receiptDate: 'desc' }, { id: 'desc' }], [{ id: 'desc' }]),
    } satisfies Prisma.GoodsReceiptFindManyArgs;

    if (!pagination) return this.prisma.goodsReceipt.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number, access: CostAccess) {
    const receipt = await this.findOrThrow(id);
    return maskLineCosts(receipt as never, access.canViewCost, GOODS_RECEIPT_COST_FIELDS) as typeof receipt;
  }

  async create(dto: CreateGoodsReceiptDto, access: CostAccess, userId: number | null, ipAddress?: string) {
    this.ensureCostWritable(dto.items, access);
    const locationId = await this.resolveLocation(dto.locationId);
    const supplier = await this.resolveSupplier(dto.supplierId);
    const purchase = await this.resolvePurchase(dto.purchaseId);
    await ensureInboundItems(this.prisma, dto.items.map((line) => line.itemId), GOODS_RECEIPT_ITEM_KINDS, DOCUMENT_LABEL_FA);
    await ensureInboundBatchFields(this.prisma, dto.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          status: 'DRAFT',
          locationId,
          receiptDate: dto.receiptDate,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierDocumentNumber: dto.supplierDocumentNumber ?? null,
          purchaseId: purchase?.id ?? null,
          purchaseNumber: purchase?.purchaseNumber ?? null,
          inspectionRequired: dto.inspectionRequired ?? false,
          note: dto.note ?? null,
          createdByUserId: userId,
          items: { create: this.lineData(dto.items) },
        },
        include: goodsReceiptDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RECEIPT_CREATED',
          entityType: AUDIT_ENTITY.GOODS_RECEIPT,
          entityId: receipt.id,
          details: `پیش‌نویس رسید انبار — ${supplier.name}، ${dto.items.length} ردیف${dto.inspectionRequired ? '، نیازمند کنترل کیفیت' : ''}`,
        },
        tx,
      );
      return receipt;
    });
    return maskLineCosts(created as never, access.canViewCost, GOODS_RECEIPT_COST_FIELDS) as typeof created;
  }

  // Full-record edit of a DRAFT: header + lines replaced wholesale, with the
  // optimistic lock re-checked atomically (updatedAt + status = DRAFT) inside
  // the transaction — same convention as StockAdjustmentsService.update().
  //
  // B15: a caller without inventory.cost can't see the cost fields, so their
  // submitted lines never carry them. Rather than silently wiping costs a
  // cost-holder entered earlier, each new line keeps the previous unitCost
  // of the draft line at the same position (lineNo) when it is still the
  // same item. A changed item at that position starts with no cost.
  async update(id: number, dto: UpdateGoodsReceiptDto, access: CostAccess, userId: number | null, ipAddress?: string) {
    this.ensureCostWritable(dto.items, access);
    const existing = await this.findOrThrow(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    const supplier = await this.resolveSupplier(dto.supplierId, existing.supplierId);
    const purchase = await this.resolvePurchase(dto.purchaseId);
    await ensureInboundItems(
      this.prisma,
      dto.items.map((line) => line.itemId),
      GOODS_RECEIPT_ITEM_KINDS,
      DOCUMENT_LABEL_FA,
      existing.items.map((line) => line.itemId),
    );
    await ensureInboundBatchFields(this.prisma, dto.items);

    const lines: DraftLine[] = access.canViewCost
      ? dto.items
      : dto.items.map((line, index) => {
          const previous = existing.items.find((old) => old.lineNo === index + 1);
          const keptCost = previous && previous.itemId === line.itemId && previous.unitCost !== null ? Number(previous.unitCost) : undefined;
          return { ...line, unitCost: keptCost };
        });

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: id } });
      const updated = await tx.goodsReceipt.update({
        where: { id },
        data: {
          locationId,
          receiptDate: dto.receiptDate,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierDocumentNumber: dto.supplierDocumentNumber ?? null,
          purchaseId: purchase?.id ?? null,
          purchaseNumber: purchase?.purchaseNumber ?? null,
          inspectionRequired: dto.inspectionRequired ?? false,
          note: dto.note ?? null,
          items: { create: this.lineData(lines) },
        },
        include: goodsReceiptDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'GOODS_RECEIPT_UPDATED', entityType: AUDIT_ENTITY.GOODS_RECEIPT, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return maskLineCosts(updated as never, access.canViewCost, GOODS_RECEIPT_COST_FIELDS) as typeof updated;
    });
  }

  // DRAFT → POSTED (build plan §6). One transaction, same shape as
  // StockAdjustmentsService.post(): lock the draft row FOR UPDATE, check
  // status + version, claim GRN-<jalali year of receiptDate>-NNNNNN,
  // resolve/create each line's batch (I4 machinery), applyMovements() —
  // GOODS_RECEIPT into ON_HAND, or QC when inspectionRequired (B19) — with
  // the line's unitCost stamped on its movement (B15), stamp the resolved
  // batch back on each line, mark POSTED, audit. Any failure keeps nothing,
  // including the number (gap-free).
  async post(id: number, loadedVersion: Date, access: CostAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ${id} FOR UPDATE`;
      const receipt = await tx.goodsReceipt.findUnique({
        where: { id },
        include: { items: { orderBy: { lineNo: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!receipt) throw new NotFoundException('رسید انبار پیدا نشد');
      if (receipt.status !== 'DRAFT') throw new ConflictException('این رسید قبلاً ثبت شده است');
      if (!isSameVersion(receipt.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (receipt.items.length === 0) throw new BadRequestException('رسید بدون ردیف کالا قابل ثبت نیست');
      if (!receipt.location?.isActive) throw new ConflictException('انبار این رسید غیرفعال است');
      // Re-checked here: an item's kind or batch-tracked state may have
      // changed since the draft was saved (an inactive item already on the
      // draft may still post, same as stock adjustments).
      await ensureInboundItems(
        tx,
        receipt.items.map((line) => line.itemId),
        GOODS_RECEIPT_ITEM_KINDS,
        DOCUMENT_LABEL_FA,
        receipt.items.map((line) => line.itemId),
      );
      await ensureInboundBatchFields(tx, receipt.items);

      const receiptNumber = await nextDocumentNumber(tx, GOODS_RECEIPT_DOC_TYPE, receipt.receiptDate);
      const batches = await resolveInboundBatches(tx, receipt.items, userId);
      const bucket = receipt.inspectionRequired ? ('QC' as const) : ('ON_HAND' as const);
      const rows: MovementInput[] = receipt.items.map((line) => ({
        itemId: line.itemId,
        locationId: receipt.locationId,
        bucket,
        movementType: 'GOODS_RECEIPT',
        quantity: new Prisma.Decimal(line.quantity),
        movementDate: receipt.receiptDate,
        referenceType: 'GOODS_RECEIPT',
        referenceId: receipt.id,
        referenceLineId: line.id,
        referenceNumber: receiptNumber,
        note: line.note,
        createdByUserId: userId,
        batchId: batches.get(line.id)?.batchId ?? null,
        unitCost: line.unitCost,
      }));
      await applyMovements(tx, rows);

      for (const line of receipt.items) {
        const batch = batches.get(line.id);
        if (!batch) continue;
        await tx.goodsReceiptItem.update({ where: { id: line.id }, data: { batchId: batch.batchId, batchNumber: batch.batchNumber } });
      }
      await tx.goodsReceipt.update({
        where: { id },
        data: { status: 'POSTED', receiptNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RECEIPT_POSTED',
          entityType: AUDIT_ENTITY.GOODS_RECEIPT,
          entityId: id,
          details: `${receiptNumber} — ${receipt.supplierName}، ${rows.length} ردیف${receipt.inspectionRequired ? '، به انبار کنترل کیفیت' : ''}`,
        },
        tx,
      );
    });
    return this.get(id, access);
  }

  // B19: QC → ON_HAND, per line, partial quantities allowed. Only for a
  // POSTED receipt that was received into QC (inspectionRequired). Each
  // line's still-in-QC quantity is quantity − releasedQty − rejectedQty
  // (rejectedQty is moved by I8's goods returns; always 0 until then). One
  // transaction: lock the receipt, check version, applyMovements() with
  // QC_RELEASE rows (QC −r, ON_HAND +r, the line's own batch), increment
  // releasedQty, touch the header's updatedAt (new version), audit.
  // Movement date is the moment of release (same convention as Sales
  // returns' receive/inspect events), not the receipt date.
  async releaseFromQc(id: number, dto: ReleaseGoodsReceiptQcDto, access: CostAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ${id} FOR UPDATE`;
      const receipt = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } } } });
      if (!receipt) throw new NotFoundException('رسید انبار پیدا نشد');
      if (receipt.status !== 'POSTED') throw new ConflictException('آزادسازی از کنترل کیفیت فقط برای رسید ثبت‌شده ممکن است');
      if (!receipt.inspectionRequired) throw new ConflictException('این رسید بدون کنترل کیفیت ثبت شده و موجودی آن مستقیماً به انبار رفته است');
      if (!isSameVersion(receipt.updatedAt, dto.updatedAt)) throw recordModifiedConflict();

      const linesById = new Map(receipt.items.map((line) => [line.id, line]));
      const now = new Date();
      const rows: MovementInput[] = [];
      const increments: { lineId: number; quantity: Prisma.Decimal }[] = [];
      for (const request of dto.lines) {
        const line = linesById.get(request.goodsReceiptItemId);
        if (!line) throw new BadRequestException('ردیف انتخاب‌شده متعلق به این رسید نیست');
        const quantity = new Prisma.Decimal(request.quantity);
        const remaining = new Prisma.Decimal(line.quantity).minus(line.releasedQty).minus(line.rejectedQty);
        if (quantity.greaterThan(remaining)) {
          throw new ConflictException({
            statusCode: 409,
            code: 'QC_RELEASE_EXCEEDS_REMAINING',
            message: `ردیف ${line.lineNo}: مقدار آزادسازی (${quantity.toString()}) بیش از مقدار باقی‌مانده در کنترل کیفیت (${remaining.toString()}) است.`,
            details: { goodsReceiptItemId: line.id, requested: quantity.toString(), remaining: remaining.toString() },
          });
        }
        const common = {
          itemId: line.itemId,
          locationId: receipt.locationId,
          movementType: 'QC_RELEASE' as const,
          movementDate: now,
          referenceType: 'GOODS_RECEIPT' as const,
          referenceId: receipt.id,
          referenceLineId: line.id,
          referenceNumber: receipt.receiptNumber,
          createdByUserId: userId,
          batchId: line.batchId,
        };
        rows.push({ ...common, bucket: 'QC', quantity: quantity.negated() }, { ...common, bucket: 'ON_HAND', quantity });
        increments.push({ lineId: line.id, quantity });
      }
      await applyMovements(tx, rows);

      for (const { lineId, quantity } of increments) {
        await tx.goodsReceiptItem.update({ where: { id: lineId }, data: { releasedQty: { increment: quantity } } });
      }
      await tx.goodsReceipt.update({ where: { id }, data: { updatedAt: now } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RECEIPT_QC_RELEASED',
          entityType: AUDIT_ENTITY.GOODS_RECEIPT,
          entityId: id,
          details: `${receipt.receiptNumber} — آزادسازی از کنترل کیفیت، ${increments.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id, access);
  }

  // DRAFT only. A POSTED receipt has no delete path — ever.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ${id} FOR UPDATE`;
      const receipt = await tx.goodsReceipt.findUnique({ where: { id }, include: { items: true } });
      if (!receipt) throw new NotFoundException('رسید انبار پیدا نشد');
      this.ensureEditable(receipt.status);
      await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.GOODS_RECEIPT, entityId: id, label: receipt.supplierName, record: receipt, userId });
      await tx.goodsReceipt.delete({ where: { id } });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'GOODS_RECEIPT_DELETED',
          entityType: AUDIT_ENTITY.GOODS_RECEIPT,
          entityId: id,
          details: `پیش‌نویس رسید انبار — ${receipt.supplierName}`,
        },
        tx,
      );
    });
    return { success: true };
  }

  private async findOrThrow(id: number) {
    const receipt = await this.prisma.goodsReceipt.findUnique({ where: { id }, include: goodsReceiptDetailInclude });
    if (!receipt) throw new NotFoundException('رسید انبار پیدا نشد');
    return receipt;
  }

  private lineData(lines: DraftLine[]) {
    return lines.map((line, index) => ({
      lineNo: index + 1,
      itemId: line.itemId,
      quantity: line.quantity,
      unitCost: line.unitCost ?? null,
      batchNumber: line.batchNumber ?? null,
      productionDate: line.productionDate ?? null,
      expiryDate: line.expiryDate ?? null,
      note: line.note ?? null,
    }));
  }

  // B15: setting a cost requires the same permission as seeing it.
  private ensureCostWritable(lines: { unitCost?: number }[], access: CostAccess) {
    if (access.canViewCost) return;
    if (lines.some((line) => line.unitCost !== undefined)) {
      throw new ForbiddenException('ثبت بهای واحد نیازمند مجوز «مشاهده بهای موجودی» است');
    }
  }

  private ensureEditable(status: StockDocumentStatus) {
    if (!EDITABLE_STOCK_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException('رسید ثبت‌شده قابل ویرایش یا حذف نیست؛ برای اصلاح، یک سند «اصلاح موجودی» ثبت کنید.');
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

  // Optional, read-only existence lookup into Purchases — never a write, never
  // a FK (B3/B12; CLAUDE.md rule 7). Snapshots purchaseNumber.
  private async resolvePurchase(purchaseId: number | undefined) {
    if (purchaseId === undefined) return null;
    const purchase = await this.prisma.purchase.findUnique({ where: { id: purchaseId }, select: { id: true, purchaseNumber: true } });
    if (!purchase) throw new BadRequestException('خرید انتخاب‌شده یافت نشد');
    return purchase;
  }
}
