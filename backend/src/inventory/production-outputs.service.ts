import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { EDITABLE_STOCK_DOCUMENT_STATUSES, PRODUCTION_OUTPUT_DOC_TYPE, PRODUCTION_OUTPUT_ITEM_KINDS } from './inventory-rules';
import { ensureInboundBatchFields, ensureInboundItems, maskLineCosts, resolveInboundBatches, type CostAccess } from './inbound-documents';
import { applyMovements, type MovementInput } from './stock-ledger';
import type { CreateProductionOutputDto, UpdateProductionOutputDto } from './dto/production-output.dto';

export type ProductionOutputListFilters = { q?: string; status?: StockDocumentStatus };

const PRODUCTION_OUTPUT_COST_FIELDS = ['unitCost', 'costIsEstimated'] as const;
const DOCUMENT_LABEL_FA = '«رسید تولید»';

// Employee is joined for display only — id/code/name, never any of its
// sensitive columns (national ID, bank account, salary).
const productionOutputDetailInclude = {
  location: { select: { id: true, code: true, name: true } },
  producedByEmployee: { select: { id: true, code: true, firstName: true, lastName: true } },
  createdByUser: { select: { id: true, username: true } },
  postedByUser: { select: { id: true, username: true } },
  items: {
    include: {
      item: { select: { id: true, code: true, name: true, status: true, itemKind: true, unit: { select: { id: true, nameFa: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.ProductionOutputInclude;

type DraftLine = {
  itemId: number;
  quantity: number;
  unitCost?: number;
  costIsEstimated?: boolean;
  batchNumber?: string;
  productionDate?: Date;
  expiryDate?: Date;
  note?: string;
};

// Production output (رسید تولید) — Inventory batch I5, build plan §5.11.
// The primary way finished-good stock enters the system (B1: the company
// produces what it sells). Lines target Item.itemKind = FINISHED_GOOD only.
// Explicitly NOT a production module: no bill of materials, no automatic
// raw-material consumption, no recipes/yield (B1, CLAUDE.md rule 9) —
// unitCost is a manually entered per-unit cost (B15).
//
// Lifecycle: DRAFT (editable, deletable, no number) → POSTED (immutable,
// numbered PRD-<jalali year>-000001, PRODUCTION_OUTPUT ON_HAND +q per line
// at the line's batch). No approval step (inbound only). A mistake on a
// posted output is fixed with a CORRECTION stock adjustment.
@Injectable()
export class ProductionOutputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Pickers for the production-output form, behind inventory.receive:
  // locations, active FINISHED_GOOD items with their batch/expiry settings,
  // and active employees (id/code/name only — never a sensitive column).
  async formOptions() {
    const [defaultLocation, locations, items, employees] = await Promise.all([
      this.inventory.getDefaultLocation(),
      this.prisma.inventoryLocation.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ id: 'asc' }] }),
      this.prisma.item.findMany({
        where: { status: 'active', itemKind: { in: [...PRODUCTION_OUTPUT_ITEM_KINDS] } },
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
      this.prisma.employee.findMany({
        where: { status: 'active' },
        select: { id: true, code: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      defaultLocationId: defaultLocation.id,
      locations,
      items: items.map(({ inventoryItemSetting, ...item }) => ({
        ...item,
        batchTracked: inventoryItemSetting?.batchTracked ?? false,
        expiryRequired: inventoryItemSetting?.expiryRequired ?? false,
        shelfLifeDays: inventoryItemSetting?.shelfLifeDays ?? null,
      })),
      employees,
    };
  }

  // List rows carry no cost — nothing to mask.
  async list(filters: ProductionOutputListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.ProductionOutputWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      where.OR = [{ outputNumber: { contains: filters.q, mode: 'insensitive' } }, { note: { contains: filters.q, mode: 'insensitive' } }];
    }
    const query = {
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
        producedByEmployee: { select: { id: true, code: true, firstName: true, lastName: true } },
        createdByUser: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ productionDate: 'desc' }, { id: 'desc' }],
    } satisfies Prisma.ProductionOutputFindManyArgs;

    if (!pagination) return this.prisma.productionOutput.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.productionOutput.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.productionOutput.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number, access: CostAccess) {
    const output = await this.findOrThrow(id);
    return maskLineCosts(output as never, access.canViewCost, PRODUCTION_OUTPUT_COST_FIELDS) as typeof output;
  }

  async create(dto: CreateProductionOutputDto, access: CostAccess, userId: number | null, ipAddress?: string) {
    this.ensureCostWritable(dto.items, access);
    const locationId = await this.resolveLocation(dto.locationId);
    await this.ensureEmployee(dto.producedByEmployeeId);
    await ensureInboundItems(this.prisma, dto.items.map((line) => line.itemId), PRODUCTION_OUTPUT_ITEM_KINDS, DOCUMENT_LABEL_FA);
    await ensureInboundBatchFields(this.prisma, dto.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const output = await tx.productionOutput.create({
        data: {
          status: 'DRAFT',
          locationId,
          productionDate: dto.productionDate,
          producedByEmployeeId: dto.producedByEmployeeId ?? null,
          note: dto.note ?? null,
          createdByUserId: userId,
          items: { create: this.lineData(dto.items) },
        },
        include: productionOutputDetailInclude,
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'PRODUCTION_OUTPUT_CREATED',
          entityType: AUDIT_ENTITY.PRODUCTION_OUTPUT,
          entityId: output.id,
          details: `پیش‌نویس رسید تولید — ${dto.items.length} ردیف`,
        },
        tx,
      );
      return output;
    });
    return maskLineCosts(created as never, access.canViewCost, PRODUCTION_OUTPUT_COST_FIELDS) as typeof created;
  }

  // Full-record edit of a DRAFT (lines replaced wholesale, optimistic lock
  // re-checked inside the transaction). Same B15 cost carry-over as
  // GoodsReceiptsService.update(): a caller without inventory.cost keeps the
  // previous cost fields of the line at the same position when it is still
  // the same item.
  async update(id: number, dto: UpdateProductionOutputDto, access: CostAccess, userId: number | null, ipAddress?: string) {
    this.ensureCostWritable(dto.items, access);
    const existing = await this.findOrThrow(id);
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const locationId = dto.locationId === undefined ? existing.locationId : await this.resolveLocation(dto.locationId, existing.locationId);
    await this.ensureEmployee(dto.producedByEmployeeId, existing.producedByEmployeeId);
    await ensureInboundItems(
      this.prisma,
      dto.items.map((line) => line.itemId),
      PRODUCTION_OUTPUT_ITEM_KINDS,
      DOCUMENT_LABEL_FA,
      existing.items.map((line) => line.itemId),
    );
    await ensureInboundBatchFields(this.prisma, dto.items);

    const lines: DraftLine[] = access.canViewCost
      ? dto.items
      : dto.items.map((line, index) => {
          const previous = existing.items.find((old) => old.lineNo === index + 1);
          const same = previous && previous.itemId === line.itemId && previous.unitCost !== null;
          return { ...line, unitCost: same ? Number(previous.unitCost) : undefined, costIsEstimated: same ? previous.costIsEstimated : false };
        });

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.productionOutput.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.productionOutputItem.deleteMany({ where: { productionOutputId: id } });
      const updated = await tx.productionOutput.update({
        where: { id },
        data: {
          locationId,
          productionDate: dto.productionDate,
          producedByEmployeeId: dto.producedByEmployeeId ?? null,
          note: dto.note ?? null,
          items: { create: this.lineData(lines) },
        },
        include: productionOutputDetailInclude,
      });
      await this.audit.log(
        { userId, ipAddress, action: 'PRODUCTION_OUTPUT_UPDATED', entityType: AUDIT_ENTITY.PRODUCTION_OUTPUT, entityId: id, details: `${dto.items.length} ردیف` },
        tx,
      );
      return maskLineCosts(updated as never, access.canViewCost, PRODUCTION_OUTPUT_COST_FIELDS) as typeof updated;
    });
  }

  // DRAFT → POSTED (build plan §5.11's posting algorithm): lock the draft,
  // CAS on updatedAt, claim PRD-<jalali year of productionDate>-NNNNNN,
  // create/resolve each line's batch (a line without its own production
  // date uses the header's — so a shelf-life-days setting can derive the
  // expiry), applyMovements() writes PRODUCTION_OUTPUT ON_HAND +q at the
  // line's batch with its unitCost stamped, stamp the resolved batch back on
  // each line, set POSTED, audit. One transaction; any failure keeps
  // nothing, including the number.
  async post(id: number, loadedVersion: Date, access: CostAccess, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_outputs WHERE id = ${id} FOR UPDATE`;
      const output = await tx.productionOutput.findUnique({
        where: { id },
        include: { items: { orderBy: { lineNo: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!output) throw new NotFoundException('رسید تولید پیدا نشد');
      if (output.status !== 'DRAFT') throw new ConflictException('این رسید تولید قبلاً ثبت شده است');
      if (!isSameVersion(output.updatedAt, loadedVersion)) throw recordModifiedConflict();
      if (output.items.length === 0) throw new BadRequestException('رسید تولید بدون ردیف کالا قابل ثبت نیست');
      if (!output.location?.isActive) throw new ConflictException('انبار این رسید تولید غیرفعال است');
      await ensureInboundItems(
        tx,
        output.items.map((line) => line.itemId),
        PRODUCTION_OUTPUT_ITEM_KINDS,
        DOCUMENT_LABEL_FA,
        output.items.map((line) => line.itemId),
      );
      await ensureInboundBatchFields(tx, output.items);

      const outputNumber = await nextDocumentNumber(tx, PRODUCTION_OUTPUT_DOC_TYPE, output.productionDate);
      const batches = await resolveInboundBatches(tx, output.items, userId, output.productionDate);
      const rows: MovementInput[] = output.items.map((line) => ({
        itemId: line.itemId,
        locationId: output.locationId,
        bucket: 'ON_HAND',
        movementType: 'PRODUCTION_OUTPUT',
        quantity: new Prisma.Decimal(line.quantity),
        movementDate: output.productionDate,
        referenceType: 'PRODUCTION_OUTPUT',
        referenceId: output.id,
        referenceLineId: line.id,
        referenceNumber: outputNumber,
        note: line.note,
        createdByUserId: userId,
        batchId: batches.get(line.id)?.batchId ?? null,
        unitCost: line.unitCost,
      }));
      await applyMovements(tx, rows);

      for (const line of output.items) {
        const batch = batches.get(line.id);
        if (!batch) continue;
        await tx.productionOutputItem.update({ where: { id: line.id }, data: { batchId: batch.batchId, batchNumber: batch.batchNumber } });
      }
      await tx.productionOutput.update({
        where: { id },
        data: { status: 'POSTED', outputNumber, postedByUserId: userId, postedAt: new Date() },
      });
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'PRODUCTION_OUTPUT_POSTED',
          entityType: AUDIT_ENTITY.PRODUCTION_OUTPUT,
          entityId: id,
          details: `${outputNumber} — ${rows.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id, access);
  }

  // DRAFT only. A POSTED output has no delete path — ever.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_outputs WHERE id = ${id} FOR UPDATE`;
      const output = await tx.productionOutput.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!output) throw new NotFoundException('رسید تولید پیدا نشد');
      this.ensureEditable(output.status);
      await tx.productionOutput.delete({ where: { id } });
      await this.audit.log(
        { userId, ipAddress, action: 'PRODUCTION_OUTPUT_DELETED', entityType: AUDIT_ENTITY.PRODUCTION_OUTPUT, entityId: id, details: 'پیش‌نویس رسید تولید' },
        tx,
      );
    });
    return { success: true };
  }

  private async findOrThrow(id: number) {
    const output = await this.prisma.productionOutput.findUnique({ where: { id }, include: productionOutputDetailInclude });
    if (!output) throw new NotFoundException('رسید تولید پیدا نشد');
    return output;
  }

  private lineData(lines: DraftLine[]) {
    return lines.map((line, index) => ({
      lineNo: index + 1,
      itemId: line.itemId,
      quantity: line.quantity,
      unitCost: line.unitCost ?? null,
      costIsEstimated: line.unitCost === undefined ? false : (line.costIsEstimated ?? false),
      batchNumber: line.batchNumber ?? null,
      productionDate: line.productionDate ?? null,
      expiryDate: line.expiryDate ?? null,
      note: line.note ?? null,
    }));
  }

  // B15: setting a cost (or flagging it as estimated) requires the same
  // permission as seeing it.
  private ensureCostWritable(lines: { unitCost?: number; costIsEstimated?: boolean }[], access: CostAccess) {
    if (access.canViewCost) return;
    if (lines.some((line) => line.unitCost !== undefined || line.costIsEstimated)) {
      throw new ForbiddenException('ثبت بهای تمام‌شده نیازمند مجوز «مشاهده بهای موجودی» است');
    }
  }

  private ensureEditable(status: StockDocumentStatus) {
    if (!EDITABLE_STOCK_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException('رسید تولید ثبت‌شده قابل ویرایش یا حذف نیست؛ برای اصلاح، یک سند «اصلاح موجودی» ثبت کنید.');
    }
  }

  private async resolveLocation(locationId: number | undefined, currentLocationId?: number) {
    if (locationId === undefined) return (await this.inventory.getDefaultLocation()).id;
    const location = await this.prisma.inventoryLocation.findUnique({ where: { id: locationId }, select: { isActive: true } });
    if (!location || (!location.isActive && locationId !== currentLocationId)) {
      throw new BadRequestException('انبار انتخاب‌شده یافت نشد یا غیرفعال است');
    }
    return locationId;
  }

  // Read-only "exists and active" lookup into Employees (CLAUDE.md rule 11's
  // documented exception) — selects status only, never a sensitive column.
  // The employee the draft already has may stay even if no longer active.
  private async ensureEmployee(employeeId: number | undefined, currentEmployeeId?: number | null) {
    if (employeeId === undefined) return;
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, status: true } });
    if (!employee) throw new BadRequestException('کارمند انتخاب‌شده یافت نشد');
    if (employee.status !== 'active' && employeeId !== currentEmployeeId) {
      throw new BadRequestException('کارمند انتخاب‌شده فعال نیست');
    }
  }
}
