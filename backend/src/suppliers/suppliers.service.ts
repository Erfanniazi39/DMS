import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SupplierStatus, type Prisma } from '@prisma/client';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

export type SupplierListFilters = { q?: string; status?: string };

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  // Without `pagination` this returns every supplier as a plain array
  // (original shape — the supplier dropdowns on the purchase form/filters
  // depend on it). With it, returns one page plus the total matching count:
  // { items, total, page, pageSize }. `q`/`status` filter server-side so
  // search and paging work together on the list page.
  async list(filters: SupplierListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.SupplierWhereInput = {};
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { code: { contains: filters.q, mode: 'insensitive' } },
        { phone: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.status) {
      if (!(Object.values(SupplierStatus) as string[]).includes(filters.status)) {
        throw new BadRequestException('وضعیت تأمین‌کننده نامعتبر است');
      }
      where.status = filters.status as SupplierStatus;
    }

    if (!pagination) return this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });

    const [items, total] = await Promise.all([
      // id as a tiebreaker keeps page boundaries stable.
      this.prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(pagination) }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    await this.ensureUnique(dto.code, dto.name);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId);
    return this.prisma.supplier.create({
      data: {
        code: dto.code,
        name: dto.name,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        bankName: dto.bankName,
        bankAccountNumber: dto.bankAccountNumber,
        bankShebaNumber: dto.bankShebaNumber,
        note: dto.note,
      },
    });
  }

  async update(id: number, dto: UpdateSupplierDto) {
    await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        nationalId: dto.nationalId ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        bankName: dto.bankName ?? null,
        bankAccountNumber: dto.bankAccountNumber ?? null,
        bankShebaNumber: dto.bankShebaNumber ?? null,
        note: dto.note ?? null,
        status: dto.status,
      },
    });
  }

  async remove(id: number) {
    await this.get(id);
    const purchaseCount = await this.prisma.purchase.count({ where: { supplierId: id } });
    if (purchaseCount > 0) {
      throw new ConflictException('این تأمین‌کننده دارای سابقه خرید است و قابل حذف نیست.');
    }
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }

  private async ensureUnique(code: string, name: string, excludedId?: number) {
    const duplicate = await this.prisma.supplier.findFirst({
      where: {
        OR: [{ code }, { name }],
        ...(excludedId ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicate?.code === code) throw new ConflictException('کد تأمین‌کننده قبلاً استفاده شده است');
    if (duplicate?.name === name) throw new ConflictException('این نام قبلاً برای تأمین‌کننده دیگری استفاده شده است');
  }

  private async ensureUniqueNationalId(nationalId: string, excludedId?: number) {
    const existing = await this.prisma.supplier.findFirst({
      where: { nationalId, ...(excludedId ? { NOT: { id: excludedId } } : {}) },
    });
    if (existing) throw new ConflictException('این شناسه ملی قبلاً برای تأمین‌کننده دیگری ثبت شده است');
  }
}
