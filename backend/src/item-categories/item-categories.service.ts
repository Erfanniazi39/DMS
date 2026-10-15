import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges, masterDataUpdateAction } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import type { CreateItemCategoryDto, UpdateItemCategoryDto } from './dto/item-category.dto';

// Mirrors UnitsService. list() is the active-only list used by the Item
// form's category dropdown; listAll()/create()/update() back the
// /item-categories page. There's deliberately no delete: categories are
// referenced by items (onDelete: Restrict), so retiring one is done by
// setting isActive=false. No audit logging on create/update, same as Units —
// small reference data. The one exception is remove() (admin only, and only
// for a category no item uses): it keeps a view-only snapshot like every
// other business delete.
@Injectable()
export class ItemCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.itemCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.itemCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('ICT', (startsWith) => this.prisma.itemCategory.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreateItemCategoryDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.itemCategory.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? 0) + 1;
    }

    const created = await this.prisma.itemCategory.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameFa: dto.nameFa,
        isActive: dto.isActive,
        sortOrder,
      },
    });
    await this.audit.log({ userId, ipAddress, action: 'ITEM_CATEGORY_CREATED', entityType: AUDIT_ENTITY.ITEM_CATEGORY, entityId: created.id, details: `${created.code} — ${created.nameFa}` });
    return created;
  }

  async update(id: number, dto: UpdateItemCategoryDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('دسته‌بندی کالا پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    const updated = await this.prisma.itemCategory.update({
      where: { id },
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameFa: dto.nameFa,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    const changes = diffChanges(existing, updated, ['code', 'nameEn', 'nameFa', 'isActive', 'sortOrder']);
    if (changes.length > 0) {
      const action = masterDataUpdateAction('ITEM_CATEGORY', changes, 'isActive', updated.isActive);
      await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.ITEM_CATEGORY, entityId: id, details: `${updated.code} — ${updated.nameFa}`, changes });
    }
    return updated;
  }

  // Same rule as UnitsService / PurchaseTypesService: reject a duplicate
  // code (DB-unique) AND a duplicate Persian name (not DB-unique, but two
  // identically-labelled categories in the dropdown is the bug PurchaseType
  // already had fixed once). On update, the category itself is excluded.
  private async ensureUnique(code: string, nameFa: string, excludedId?: number) {
    const duplicate = await this.prisma.itemCategory.findFirst({
      where: {
        OR: [{ code }, { nameFa }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, nameFa: true },
    });
    if (duplicate?.code === code) throw new ConflictException('این کد قبلاً برای دسته‌بندی دیگری استفاده شده است');
    if (duplicate?.nameFa === nameFa) throw new ConflictException('دسته‌بندی با این نام فارسی از قبل وجود دارد');
  }

  // Admin-only (enforced on the route). Refused while any item still uses the
  // category — retire it with isActive=false instead.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    const category = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('دسته‌بندی کالا پیدا نشد');
    const itemCount = await this.prisma.item.count({ where: { categoryId: id } });
    if (itemCount > 0) {
      throw new ConflictException(`این دسته‌بندی در ${itemCount} کالا استفاده شده است و قابل حذف نیست؛ به‌جای حذف، آن را غیرفعال کنید.`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.ITEM_CATEGORY, entityId: id, label: category.code, record: category, userId });
        await tx.itemCategory.delete({ where: { id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('این دسته‌بندی در اسناد دیگر استفاده شده است و قابل حذف نیست؛ به‌جای حذف، آن را غیرفعال کنید.');
      }
      throw error;
    }
    await this.audit.log({ userId, ipAddress, action: 'ITEM_CATEGORY_DELETED', entityType: AUDIT_ENTITY.ITEM_CATEGORY, entityId: id, details: category.code });
  }
}
