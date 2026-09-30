import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

// list() is the active-only list used by the Purchase / Purchase Request
// item forms' unit dropdown — keep its shape and filter unchanged.
// listAll()/create()/update() back the admin/units page (purchases.manage).
// There's deliberately no delete: units are referenced by purchase and
// purchase-request items, so retiring one is done by setting isActive=false.
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.unit.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.unit.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async create(dto: CreateUnitDto) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.unit.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? -1) + 1;
    }

    return this.prisma.unit.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameFa: dto.nameFa,
        isActive: dto.isActive,
        sortOrder,
      },
    });
  }

  async update(id: number, dto: UpdateUnitDto) {
    const existing = await this.prisma.unit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('واحد پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    return this.prisma.unit.update({
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

  // Same rule as PurchaseTypesService.create(): reject a duplicate code
  // (DB-unique) AND a duplicate Persian name (not DB-unique, but two
  // identically-labelled units in the dropdown is the bug PurchaseType
  // already had fixed once). On update, the unit itself is excluded.
  private async ensureUnique(code: string, nameFa: string, excludedId?: number) {
    const duplicate = await this.prisma.unit.findFirst({
      where: {
        OR: [{ code }, { nameFa }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, nameFa: true },
    });
    if (duplicate?.code === code) throw new ConflictException('این کد قبلاً برای واحد دیگری استفاده شده است');
    if (duplicate?.nameFa === nameFa) throw new ConflictException('واحدی با این نام فارسی از قبل وجود دارد');
  }
}
