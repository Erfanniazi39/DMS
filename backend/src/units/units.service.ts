import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import type { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

// list() is the active-only list used by the Purchase / Purchase Request
// item forms' unit dropdown — keep its shape and filter unchanged.
// listAll()/create()/update() back the admin/units page (purchases.manage).
// remove() is admin-only (controller) and refused while any record uses the
// unit — retiring a used unit is done by setting isActive=false.
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('UNT', (startsWith) => this.prisma.unit.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreateUnitDto) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.unit.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? 0) + 1;
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

  // Hard delete, only for a unit nothing references (every FK to units is
  // RESTRICT, so a used unit fails with P2003 → 409). A view-only snapshot
  // goes to the delete archive like every other business delete.
  async remove(id: number, userId: number | null, ipAddress?: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundException('واحد پیدا نشد');
    try {
      await this.prisma.$transaction(async (tx) => {
        await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.UNIT, entityId: id, label: unit.code, record: unit, userId });
        await tx.unit.delete({ where: { id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('این واحد در اسناد یا کالاها استفاده شده است و قابل حذف نیست؛ به‌جای حذف، آن را غیرفعال کنید.');
      }
      throw error;
    }
    await this.audit.log({ userId, ipAddress, action: 'UNIT_DELETED', entityType: AUDIT_ENTITY.UNIT, entityId: id, details: unit.code });
  }
}
