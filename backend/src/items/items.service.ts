import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemStatus, Prisma } from '@prisma/client';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';

export type ItemListFilters = { q?: string; status?: string; categoryId?: string };

// Category and unit are returned alongside every item so the list/detail
// can show their Persian labels without a second lookup.
const itemInclude = {
  category: { select: { id: true, code: true, nameFa: true, isActive: true } },
  unit: { select: { id: true, code: true, nameFa: true, isActive: true } },
} satisfies Prisma.ItemInclude;

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

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

    if (!pagination) return this.prisma.item.findMany({ where, include: itemInclude, orderBy: { name: 'asc' } });

    const [items, total] = await Promise.all([
      // id as a tiebreaker keeps page boundaries stable.
      this.prisma.item.findMany({ where, include: itemInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(pagination) }),
      this.prisma.item.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const item = await this.prisma.item.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundException('کالا پیدا نشد');
    return item;
  }

  async create(dto: CreateItemDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.name);
    await this.ensureReferences(dto.categoryId, dto.unitId);
    const created = await this.prisma.item.create({
      data: {
        code: dto.code,
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        description: dto.description,
        note: dto.note,
        status: dto.status,
      },
      include: itemInclude,
    });
    await this.writeAuditLog(userId, ipAddress, 'ITEM_CREATED', created.id, created.code);
    return created;
  }

  async update(id: number, dto: UpdateItemDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    await this.ensureReferences(dto.categoryId, dto.unitId, existing);
    const updated = await this.prisma.item.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        description: dto.description ?? null,
        note: dto.note ?? null,
        status: dto.status,
      },
      include: itemInclude,
    });
    await this.writeAuditLog(userId, ipAddress, 'ITEM_UPDATED', id, updated.code);
    return updated;
  }

  // Nothing references Item yet. Once SalesItem exists its FK will be
  // onDelete: Restrict, and P2003 below turns that into a clear message
  // instead of a 500 — the fallback there is setting status=inactive.
  async remove(id: number, userId: number | null = null, ipAddress?: string) {
    const item = await this.get(id);
    try {
      await this.prisma.item.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('این کالا در اسناد دیگر استفاده شده است و قابل حذف نیست؛ به‌جای حذف، آن را غیرفعال کنید.');
      }
      throw error;
    }
    await this.writeAuditLog(userId, ipAddress, 'ITEM_DELETED', id, item.code);
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
  private async ensureReferences(categoryId: number, unitId: number, existing?: { categoryId: number; unitId: number }) {
    const [category, unit] = await Promise.all([
      this.prisma.itemCategory.findUnique({ where: { id: categoryId }, select: { isActive: true } }),
      this.prisma.unit.findUnique({ where: { id: unitId }, select: { isActive: true } }),
    ]);
    if (!category || (!category.isActive && existing?.categoryId !== categoryId)) {
      throw new BadRequestException('دسته‌بندی کالا یافت نشد یا غیرفعال است');
    }
    if (!unit || (!unit.isActive && existing?.unitId !== unitId)) {
      throw new BadRequestException('واحد کالا یافت نشد یا غیرفعال است');
    }
  }

  // Minimal write to the shared AUDIT_LOG table, same shape as
  // PurchasesService.writeAuditLog(). details carries the item code so a
  // deleted item's entry stays readable.
  private async writeAuditLog(userId: number | null, ipAddress: string | undefined, action: string, itemId: number, details?: string) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        entityType: 'Item',
        entityId: String(itemId),
        details,
        ipAddress: ipAddress ?? undefined,
      },
    });
  }
}
