import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateItemCategoryDto, UpdateItemCategoryDto } from './dto/item-category.dto';

// Mirrors UnitsService. list() is the active-only list used by the Item
// form's category dropdown; listAll()/create()/update() back the
// /item-categories page. There's deliberately no delete: categories are
// referenced by items (onDelete: Restrict), so retiring one is done by
// setting isActive=false. No audit logging, same as Units — this is small
// reference data, not a business record.
@Injectable()
export class ItemCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: CreateItemCategoryDto) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.itemCategory.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? -1) + 1;
    }

    return this.prisma.itemCategory.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameFa: dto.nameFa,
        isActive: dto.isActive,
        sortOrder,
      },
    });
  }

  async update(id: number, dto: UpdateItemCategoryDto) {
    const existing = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('دسته‌بندی کالا پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    return this.prisma.itemCategory.update({
      where: { id },
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameFa: dto.nameFa,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
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
}
