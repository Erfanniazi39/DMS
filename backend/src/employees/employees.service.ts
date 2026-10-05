import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_DEPARTMENT_STATUS } from '../departments/department-rules';
import type { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

// EMPLOYEE is an independent Master Data record — it is never joined with
// or shown alongside USER/account data. See database_plan.txt at the project root.
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.employee.findMany({
      include: { department: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async get(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: { department: true } });
    if (!employee) throw new NotFoundException('کارمند پیدا نشد');
    return employee;
  }

  // Employee code (کد پرسنلی) is generated here, not entered by the user:
  // "<DEPARTMENT_CODE>-<employee id>", zero-padded (e.g. "IT-0007"). The
  // department code is already unique and stable, and the employee's own id
  // is unique and never reused, so the result can never collide with an
  // existing code — no separate uniqueness check or "next number" counter
  // (which would risk a race between two simultaneous creates) is needed.
  // The id isn't known until the row exists, so the row is inserted with a
  // throwaway placeholder and immediately corrected inside the same
  // transaction — that placeholder is never visible outside it.
  async create(dto: CreateEmployeeDto) {
    const department = await this.ensureDepartment(dto.departmentId);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data: { ...dto, code: `PENDING-${randomUUID()}` } });
      const code = `${department.code}-${String(created.id).padStart(4, '0')}`;
      return tx.employee.update({ where: { id: created.id }, data: { code }, include: { department: true } });
    });
  }

  // "code" is intentionally not part of UpdateEmployeeDto — it is assigned
  // once at creation and stays fixed even if the employee later moves to a
  // different department, so it keeps working as a stable historical
  // identifier (e.g. already printed on a badge or referenced elsewhere).
  async update(id: number, dto: UpdateEmployeeDto) {
    await this.get(id);
    await this.ensureDepartment(dto.departmentId);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId, id);
    return this.prisma.employee.update({ where: { id }, data: dto, include: { department: true } });
  }

  // Sets (or clears, when photoPath is null) the employee's photo. Kept
  // separate from update() because a photo is a file upload, not part of
  // the JSON employee form.
  async updatePhoto(id: number, photoPath: string | null) {
    const current = await this.get(id);
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { photoPath },
      include: { department: true },
    });
    if (current.photoPath && current.photoPath !== photoPath) {
      this.deleteUploadedFile(current.photoPath);
    }
    return updated;
  }

  // Sets (or clears, when contractDocumentPath is null) the employee's
  // contract document (PDF or scanned image). Same pattern as updatePhoto:
  // a separate upload step, not part of the JSON employee form.
  async updateContractDocument(id: number, contractDocumentPath: string | null) {
    const current = await this.get(id);
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { contractDocumentPath },
      include: { department: true },
    });
    if (current.contractDocumentPath && current.contractDocumentPath !== contractDocumentPath) {
      this.deleteUploadedFile(current.contractDocumentPath);
    }
    return updated;
  }

  private deleteUploadedFile(relativePath: string) {
    // Best-effort cleanup of the previous file. The database record is what
    // matters for correctness; a leftover file on disk is not a data-loss
    // concern, so a failure here is silently ignored.
    const filePath = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(filePath)) {
      unlink(filePath, () => undefined);
    }
  }

  private async ensureUniqueNationalId(nationalId: string, excludedId?: number) {
    const existing = await this.prisma.employee.findFirst({ where: { nationalId, ...(excludedId ? { NOT: { id: excludedId } } : {}) } });
    if (existing) throw new ConflictException('این کد ملی قبلاً برای کارمند دیگری ثبت شده است');
  }

  private async ensureDepartment(departmentId: number) {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department || department.status !== ACTIVE_DEPARTMENT_STATUS) throw new ConflictException('واحد سازمانی انتخاب‌شده فعال نیست');
    return department;
  }
}
