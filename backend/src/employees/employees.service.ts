import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_DEPARTMENT_STATUS } from '../departments/department-rules';
import type { CreateEmployeeDto, EmployeeContractDto, TerminateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { computeTenure, findOverlap, summarizeContracts } from './employee-tenure';

// EMPLOYEE is an independent Master Data record — it is never joined with
// or shown alongside USER/account data. See database_plan.txt at the project root.
const WITH_CONTRACTS = { department: true, contracts: { orderBy: [{ startDate: 'desc' }, { id: 'desc' }] } } satisfies Prisma.EmployeeInclude;
type EmployeeWithContracts = Prisma.EmployeeGetPayload<{ include: typeof WITH_CONTRACTS }>;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// Adds what every consumer needs about the contract history: the current
// contract (latest start), days to its expiry and the tenure computed from
// the contract periods (employee-tenure.ts). The legacy single-contract
// columns on Employee are dropped from the response — the history replaced them.
function withSummary(employee: EmployeeWithContracts) {
  const { contractType: _t, contractStartDate: _s, contractEndDate: _e, contractDocumentPath: _d, ...rest } = employee;
  void [_t, _s, _e, _d];
  const summary = summarizeContracts(employee.contracts);
  const tenure = computeTenure({ hireDate: employee.hireDate, contracts: employee.contracts, terminationDate: employee.terminationDate });
  return { ...rest, currentContract: summary.current, daysToExpiry: summary.daysToExpiry, contractExpired: summary.expired, tenure };
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const employees = await this.prisma.employee.findMany({ include: WITH_CONTRACTS, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    return employees.map(withSummary);
  }

  async get(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: WITH_CONTRACTS });
    if (!employee) throw new NotFoundException('کارمند پیدا نشد');
    return withSummary(employee);
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
  // The first contract, if given, becomes the first row of the contract history.
  async create(dto: CreateEmployeeDto) {
    const department = await this.ensureDepartment(dto.departmentId);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId);
    const { contractType, contractStartDate, contractEndDate, ...fields } = dto;
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data: { ...fields, code: `PENDING-${randomUUID()}` } });
      const code = `${department.code}-${String(created.id).padStart(4, '0')}`;
      await tx.employee.update({ where: { id: created.id }, data: { code } });
      if (contractType && contractStartDate) {
        await tx.employeeContract.create({
          data: { employeeId: created.id, contractType, startDate: contractStartDate, endDate: contractType === 'permanent' ? null : (contractEndDate ?? null) },
        });
      }
      return created.id;
    });
    return this.get(id);
  }

  // The code is generated at creation and does NOT change when the employee
  // moves department; it can be edited here (owner, 2026-10-14) as long as it
  // stays unique. Other modules reference an employee by id, never by code.
  // «پایان همکاری» can only be entered / left through terminate() /
  // reactivate(), which require / clear the written reason.
  async update(id: number, dto: UpdateEmployeeDto) {
    const current = await this.get(id);
    if ((dto.status === 'terminated') !== (current.status === 'terminated')) {
      throw new ConflictException(dto.status === 'terminated' ? 'برای پایان همکاری از دکمهٔ «پایان همکاری» (با ذکر علت) استفاده کنید' : 'برای بازگرداندن کارمند خاتمه‌یافته از دکمهٔ «بازگشت به کار» استفاده کنید');
    }
    await this.ensureDepartment(dto.departmentId);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId, id);
    if (dto.code !== current.code) await this.ensureUniqueCode(dto.code, id);
    await this.prisma.employee.update({ where: { id }, data: dto });
    return this.get(id);
  }

  // پایان همکاری: the employee is disabled (status terminated) and the date,
  // type and a written reason are recorded. Contracts stay as they are — the
  // tenure just stops at the termination date.
  async terminate(id: number, dto: TerminateEmployeeDto) {
    const current = await this.get(id);
    if (current.status === 'terminated') throw new ConflictException('همکاری این کارمند قبلاً خاتمه یافته است');
    if (current.hireDate && isoDay(dto.terminationDate) < isoDay(current.hireDate)) throw new BadRequestException('تاریخ پایان همکاری نمی‌تواند قبل از تاریخ استخدام باشد');
    await this.prisma.employee.update({
      where: { id },
      data: { status: 'terminated', terminationDate: dto.terminationDate, terminationType: dto.terminationType, terminationReason: dto.terminationReason },
    });
    return this.get(id);
  }

  // بازگشت به کار: back to active, the termination record is cleared (the
  // contract history is untouched, so a new contract can be added next).
  async reactivate(id: number) {
    const current = await this.get(id);
    if (current.status !== 'terminated') throw new ConflictException('این کارمند خاتمه‌یافته نیست');
    await this.prisma.employee.update({ where: { id }, data: { status: 'active', terminationDate: null, terminationType: null, terminationReason: null } });
    return this.get(id);
  }

  // --- Contract history ---------------------------------------------------------

  async addContract(employeeId: number, dto: EmployeeContractDto) {
    await this.get(employeeId);
    await this.ensureNoOverlap(employeeId, dto);
    await this.prisma.employeeContract.create({ data: { employeeId, contractType: dto.contractType, startDate: dto.startDate, endDate: dto.endDate, note: dto.note } });
    return this.get(employeeId);
  }

  async updateContract(employeeId: number, contractId: number, dto: EmployeeContractDto) {
    await this.findContract(employeeId, contractId);
    await this.ensureNoOverlap(employeeId, dto, contractId);
    await this.prisma.employeeContract.update({ where: { id: contractId }, data: { contractType: dto.contractType, startDate: dto.startDate, endDate: dto.endDate, note: dto.note ?? null } });
    return this.get(employeeId);
  }

  async removeContract(employeeId: number, contractId: number) {
    const contract = await this.findContract(employeeId, contractId);
    await this.prisma.employeeContract.delete({ where: { id: contractId } });
    if (contract.documentPath) this.deleteUploadedFile(contract.documentPath);
    return this.get(employeeId);
  }

  // Sets (or clears, when documentPath is null) one contract's scanned
  // document (PDF or image) — a separate upload step, same as the photo.
  async setContractDocument(employeeId: number, contractId: number, documentPath: string | null) {
    const contract = await this.findContract(employeeId, contractId);
    await this.prisma.employeeContract.update({ where: { id: contractId }, data: { documentPath } });
    if (contract.documentPath && contract.documentPath !== documentPath) this.deleteUploadedFile(contract.documentPath);
    return this.get(employeeId);
  }

  private async findContract(employeeId: number, contractId: number) {
    const contract = await this.prisma.employeeContract.findFirst({ where: { id: contractId, employeeId } });
    if (!contract) throw new NotFoundException('قرارداد پیدا نشد');
    return contract;
  }

  // Periods of one employee never overlap — the tenure would double-count them.
  private async ensureNoOverlap(employeeId: number, dto: { startDate: Date; endDate: Date | null }, ignoreContractId?: number) {
    const existing = await this.prisma.employeeContract.findMany({ where: { employeeId }, select: { id: true, startDate: true, endDate: true } });
    const clash = findOverlap(existing, dto.startDate, dto.endDate, ignoreContractId);
    if (clash) {
      throw new ConflictException(`این بازه با قرارداد دیگری (از ${isoDay(clash.startDate)}${clash.endDate ? ` تا ${isoDay(clash.endDate)}` : ' بدون پایان'}) همپوشانی دارد`);
    }
  }

  // Sets (or clears, when photoPath is null) the employee's photo. Kept
  // separate from update() because a photo is a file upload, not part of
  // the JSON employee form.
  async updatePhoto(id: number, photoPath: string | null) {
    const current = await this.get(id);
    await this.prisma.employee.update({ where: { id }, data: { photoPath } });
    if (current.photoPath && current.photoPath !== photoPath) {
      this.deleteUploadedFile(current.photoPath);
    }
    return this.get(id);
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

  private async ensureUniqueCode(code: string, excludedId: number) {
    const existing = await this.prisma.employee.findFirst({ where: { code, NOT: { id: excludedId } }, select: { id: true } });
    if (existing) throw new ConflictException('این کد پرسنلی قبلاً برای کارمند دیگری ثبت شده است');
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
