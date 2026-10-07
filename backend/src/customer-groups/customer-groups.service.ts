import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import type { CreateCustomerGroupDto, UpdateCustomerGroupDto } from './dto/customer-group.dto';

// Mirrors ItemCategoriesService. list() is the active-only list used by the
// Customer form's group dropdown; listAll()/create()/update() back the
// /customer-groups page. No delete: groups are referenced by customers, so
// retiring one is done by setting isActive=false. Unlike Item Categories,
// create/update are audited (AUDIT_ENTITY.CUSTOMER_GROUP).
@Injectable()
export class CustomerGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.customerGroup.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.customerGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async create(dto: CreateCustomerGroupDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.customerGroup.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? -1) + 1;
    }

    const created = await this.prisma.customerGroup.create({
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, isActive: dto.isActive, sortOrder },
    });
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_GROUP_CREATED', entityType: AUDIT_ENTITY.CUSTOMER_GROUP, entityId: created.id, details: created.code });
    return created;
  }

  async update(id: number, dto: UpdateCustomerGroupDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.prisma.customerGroup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('گروه مشتری پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    const updated = await this.prisma.customerGroup.update({
      where: { id },
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, isActive: dto.isActive, sortOrder: dto.sortOrder },
    });
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_GROUP_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER_GROUP, entityId: id, details: updated.code });
    return updated;
  }

  // Same rule as ItemCategoriesService: reject a duplicate code (DB-unique)
  // AND a duplicate Persian name. On update, the group itself is excluded.
  private async ensureUnique(code: string, nameFa: string, excludedId?: number) {
    const duplicate = await this.prisma.customerGroup.findFirst({
      where: {
        OR: [{ code }, { nameFa }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, nameFa: true },
    });
    if (duplicate?.code === code) throw new ConflictException('این کد قبلاً برای گروه مشتری دیگری استفاده شده است');
    if (duplicate?.nameFa === nameFa) throw new ConflictException('گروه مشتری با این نام فارسی از قبل وجود دارد');
  }
}
