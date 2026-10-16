import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemStatus, Prisma } from '@prisma/client';
import { toSkipTake, type PaginationParams, buildOrderBy, type SortParams } from '../common/pagination';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
// Plain function import (no module dependency) — see inventory-queries.ts's
// header comment and build plan §4's DI-cycle note.
import { hasStockHistory } from '../inventory/inventory-queries';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';

export type ItemListFilters = { q?: string; status?: string; categoryId?: string; sort?: SortParams };

// Columns the items table can be sorted by.
const ITEM_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.ItemOrderByWithRelationInput> = {
  name: (dir) => ({ name: dir }),
  code: (dir) => ({ code: dir }),
  category: (dir) => ({ category: { nameFa: dir } }),
  unit: (dir) => ({ unit: { nameFa: dir } }),
  itemKind: (dir) => ({ itemKind: dir }),
  sellingPrice: (dir) => ({ sellingPrice: { sort: dir, nulls: 'last' } }),
  status: (dir) => ({ status: dir }),
};

// Category and unit are returned alongside every item so the list/detail
// can show their Persian labels without a second lookup.
const itemInclude = {
  category: { select: { id: true, code: true, nameFa: true, isActive: true } },
  unit: { select: { id: true, code: true, nameFa: true, isActive: true } },
  secondaryUnit: { select: { id: true, code: true, nameFa: true, isActive: true } },
} satisfies Prisma.ItemInclude;

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as SuppliersService.list(): without
  // `pagination` returns a plain array (for a future Sales item dropdown);
  // with it, returns { items, total, page, pageSize }.
  async list(filters: ItemListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.ItemWhereInput = {};
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { code: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.status) {
      if (!(Object.values(ItemStatus) as string[]).includes(filters.status)) {
        throw new BadRequestException('وضعیت کالا نامعتبر است');
      }
      where.status = filters.status as ItemStatus;
    }
    if (filters.categoryId) {
      const categoryId = Number(filters.categoryId);
      if (!Number.isInteger(categoryId) || categoryId < 1) {
        throw new BadRequestException('دسته‌بندی کالا نامعتبر است');
      }
      where.categoryId = categoryId;
    }

    const orderBy = buildOrderBy(filters.sort, ITEM_SORT_COLUMNS, [{ name: 'asc' }, { id: 'asc' }], [{ id: 'asc' }]);
    if (!pagination) return this.prisma.item.findMany({ where, include: itemInclude, orderBy });

    const [items, total] = await Promise.all([
      // id as a tiebreaker keeps page boundaries stable.
      this.prisma.item.findMany({ where, include: itemInclude, orderBy, ...toSkipTake(pagination) }),
      this.prisma.item.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const item = await this.prisma.item.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundException('کالا پیدا نشد');
    return item;
  }

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('ITM', (startsWith) => this.prisma.item.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreateItemDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.name);
    await this.ensureReferences(dto.categoryId, dto.unitId, dto.secondaryUnitId);
    const created = await this.prisma.item.create({
      data: {
        code: dto.code,
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        secondaryUnitId: dto.secondaryUnitId ?? null,
        secondaryUnitFactor: dto.secondaryUnitFactor ?? null,
        description: dto.description,
        note: dto.note,
        sellingPrice: dto.sellingPrice,
        status: dto.status,
        itemKind: dto.itemKind,
      },
      include: itemInclude,
    });
    await this.audit.log({ userId, ipAddress, action: 'ITEM_CREATED', entityType: AUDIT_ENTITY.ITEM, entityId: created.id, details: created.code });
    return created;
  }

  async update(id: number, dto: UpdateItemDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    await this.ensureReferences(dto.categoryId, dto.unitId, dto.secondaryUnitId, existing);
    // Inventory build plan I1, finding §2.3-1: changing the unit after the
    // item has stock history would silently change the meaning of every
    // past quantity. An item with no movements yet is unaffected.
    if (dto.unitId !== existing.unitId && (await hasStockHistory(this.prisma, id))) {
      throw new BadRequestException('این کالا دارای سابقهٔ موجودی است؛ واحد آن پس از ثبت اولین رویداد انباری قابل تغییر نیست.');
    }
    // Same reasoning for the secondary unit: changing it or its factor after stock
    // exists would change how every past quantity reads in that unit.
    const secondaryChanged =
      (dto.secondaryUnitId ?? null) !== (existing.secondaryUnitId ?? null) ||
      (dto.secondaryUnitFactor ?? null) !== (existing.secondaryUnitFactor == null ? null : Number(existing.secondaryUnitFactor));
    if (secondaryChanged && (await hasStockHistory(this.prisma, id))) {
      throw new BadRequestException('این کالا دارای سابقهٔ موجودی است؛ واحد فرعی و ضریب تبدیل آن پس از ثبت اولین رویداد انباری قابل تغییر نیست.');
    }
    const updated = await this.prisma.item.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        secondaryUnitId: dto.secondaryUnitId ?? null,
        secondaryUnitFactor: dto.secondaryUnitFactor ?? null,
        description: dto.description ?? null,
        note: dto.note ?? null,
        // Full-record form: omitted/blank clears the default price.
        sellingPrice: dto.sellingPrice ?? null,
        status: dto.status,
        itemKind: dto.itemKind,
      },
      include: itemInclude,
    });
    // The default selling price is recorded field-level (from → to) so a
    // price change is never a silent overwrite.
    await this.audit.log({
      userId,
      ipAddress,
      action: 'ITEM_UPDATED',
      entityType: AUDIT_ENTITY.ITEM,
      entityId: id,
      details: updated.code,
      changes: diffChanges(existing, updated, ['sellingPrice', 'secondaryUnitId', 'secondaryUnitFactor']),
    });
    return updated;
  }

  // Inventory references Item (StockBalance/StockMovement/
  // StockAdjustmentItem, all onDelete: Restrict), and SalesItem will too.
  // P2003 below turns that into a clear message instead of a 500 — the
  // fallback there is setting status=inactive.
  async remove(id: number, userId: number | null = null, ipAddress?: string) {
    const item = await this.get(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.ITEM, entityId: id, label: item.code, record: item, userId });
        await tx.item.delete({ where: { id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('این کالا در اسناد دیگر استفاده شده است و قابل حذف نیست؛ به‌جای حذف، آن را غیرفعال کنید.');
      }
      throw error;
    }
    await this.audit.log({ userId, ipAddress, action: 'ITEM_DELETED', entityType: AUDIT_ENTITY.ITEM, entityId: id, details: item.code });
    return { success: true };
  }

  // Reject a duplicate code (DB-unique) AND a duplicate name, same rule as
  // Supplier/PurchaseType/Unit: two identically-named items would be
  // indistinguishable in the future Sales item picker. Excludes the item
  // itself on update so saving unchanged values works.
  private async ensureUnique(code: string, name: string, excludedId?: number) {
    const duplicate = await this.prisma.item.findFirst({
      where: {
        OR: [{ code }, { name }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicate?.code === code) throw new ConflictException('کد کالا قبلاً استفاده شده است');
    if (duplicate?.name === name) throw new ConflictException('این نام قبلاً برای کالای دیگری استفاده شده است');
  }

  // Category and unit must exist and be active — except that an item being
  // edited may keep the (since-deactivated) category/unit it already has.
  private async ensureReferences(categoryId: number, unitId: number, secondaryUnitId?: number, existing?: { categoryId: number; unitId: number; secondaryUnitId: number | null }) {
    const [category, unit, secondaryUnit] = await Promise.all([
      this.prisma.itemCategory.findUnique({ where: { id: categoryId }, select: { isActive: true } }),
      this.prisma.unit.findUnique({ where: { id: unitId }, select: { isActive: true } }),
      secondaryUnitId === undefined ? Promise.resolve(null) : this.prisma.unit.findUnique({ where: { id: secondaryUnitId }, select: { isActive: true } }),
    ]);
    if (!category || (!category.isActive && existing?.categoryId !== categoryId)) {
      throw new BadRequestException('دسته‌بندی کالا یافت نشد یا غیرفعال است');
    }
    if (!unit || (!unit.isActive && existing?.unitId !== unitId)) {
      throw new BadRequestException('واحد کالا یافت نشد یا غیرفعال است');
    }
    if (secondaryUnitId !== undefined && (!secondaryUnit || (!secondaryUnit.isActive && existing?.secondaryUnitId !== secondaryUnitId))) {
      throw new BadRequestException('واحد فرعی یافت نشد یا غیرفعال است');
    }
  }

}
