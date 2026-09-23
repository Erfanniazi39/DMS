import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
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
