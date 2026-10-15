import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges, masterDataUpdateAction } from '../audit/audit.service';
import { archiveDeletedRecord } from '../audit/deleted-records';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
  }

  async get(id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
    if (!department) throw new NotFoundException('واحد سازمانی پیدا نشد');
    return department;
  }

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('DEP', (startsWith) => this.prisma.department.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreateDepartmentDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.name);
    const created = await this.prisma.department.create({
      data: { code: dto.code, name: dto.name, note: dto.note || undefined },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
    await this.audit.log({ userId, ipAddress, action: 'DEPARTMENT_CREATED', entityType: AUDIT_ENTITY.DEPARTMENT, entityId: created.id, details: `${created.code} — ${created.name}` });
    return created;
  }

  async update(id: number, dto: UpdateDepartmentDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    const updated = await this.prisma.department.update({
      where: { id },
      data: { code: dto.code, name: dto.name, status: dto.status, note: dto.note || null },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
    const changes = diffChanges(existing, updated, ['code', 'name', 'status', 'note']);
    if (changes.length > 0) {
      const action = masterDataUpdateAction('DEPARTMENT', changes, 'status', updated.status === 'active');
      await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.DEPARTMENT, entityId: id, details: `${updated.code} — ${updated.name}`, changes });
    }
    return updated;
  }

  async remove(id: number, userId: number | null = null, ipAddress?: string) {
    const department = await this.get(id);
    const employeeCount = await this.prisma.employee.count({ where: { departmentId: id } });
    if (employeeCount > 0) {
      throw new ConflictException('این دپارتمان دارای کارمند است و قابل حذف نیست.');
    }
    await this.prisma.$transaction(async (tx) => {
      await archiveDeletedRecord(tx, { entityType: AUDIT_ENTITY.DEPARTMENT, entityId: id, label: department.code, record: department, userId });
      await tx.department.delete({ where: { id } });
    });
    await this.audit.log({ userId, ipAddress, action: 'DEPARTMENT_DELETED', entityType: AUDIT_ENTITY.DEPARTMENT, entityId: id, details: `${department.code} — ${department.name}` });
    return { success: true };
  }

  private async ensureUnique(code: string, name: string, excludedId?: number) {
    const duplicate = await this.prisma.department.findFirst({
      where: {
        OR: [{ code }, { name }],
        ...(excludedId ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicate?.code === code) throw new ConflictException('کد واحد قبلاً استفاده شده است');
    if (duplicate?.name === name) throw new ConflictException('نام واحد قبلاً استفاده شده است');
  }
}
