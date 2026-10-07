import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import type { CreateTerritoryDto, UpdateTerritoryDto } from './dto/territory.dto';

// Mirrors ItemCategoriesService. list() is the active-only list used by the
// Customer form's territory dropdown; listAll()/create()/update() back the
// /territories page. No delete: territories are referenced by customers, so
// retiring one is done by setting isActive=false. Unlike Item Categories,
// create/update are audited (AUDIT_ENTITY.TERRITORY).
@Injectable()
export class TerritoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.territory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.territory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async create(dto: CreateTerritoryDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.territory.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? -1) + 1;
    }

    const created = await this.prisma.territory.create({
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, isActive: dto.isActive, sortOrder },
    });
    await this.audit.log({ userId, ipAddress, action: 'TERRITORY_CREATED', entityType: AUDIT_ENTITY.TERRITORY, entityId: created.id, details: created.code });
    return created;
  }

  async update(id: number, dto: UpdateTerritoryDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.prisma.territory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('منطقهٔ فروش پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    const updated = await this.prisma.territory.update({
      where: { id },
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, isActive: dto.isActive, sortOrder: dto.sortOrder },
    });
    await this.audit.log({ userId, ipAddress, action: 'TERRITORY_UPDATED', entityType: AUDIT_ENTITY.TERRITORY, entityId: id, details: updated.code });
    return updated;
  }

  // Same rule as ItemCategoriesService: reject a duplicate code (DB-unique)
  // AND a duplicate Persian name. On update, the territory itself is excluded.
  private async ensureUnique(code: string, nameFa: string, excludedId?: number) {
    const duplicate = await this.prisma.territory.findFirst({
      where: {
        OR: [{ code }, { nameFa }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, nameFa: true },
    });
    if (duplicate?.code === code) throw new ConflictException('این کد قبلاً برای منطقهٔ فروش دیگری استفاده شده است');
    if (duplicate?.nameFa === nameFa) throw new ConflictException('منطقهٔ فروش با این نام فارسی از قبل وجود دارد');
  }
}
