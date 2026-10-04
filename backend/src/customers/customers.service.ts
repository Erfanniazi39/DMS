import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerType, type Prisma } from '@prisma/client';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

export type CustomerListFilters = { q?: string; customerType?: string };

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as SuppliersService.list(): without
  // `pagination` → plain array (for future dropdowns, e.g. Sales); with it →
  // { items, total, page, pageSize }.
  async list(filters: CustomerListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.CustomerWhereInput = {};
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { code: { contains: filters.q, mode: 'insensitive' } },
        { phone: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.customerType) {
      if (!(Object.values(CustomerType) as string[]).includes(filters.customerType)) {
        throw new BadRequestException('نوع مشتری نامعتبر است');
      }
      where.customerType = filters.customerType as CustomerType;
    }

    if (!pagination) return this.prisma.customer.findMany({ where, orderBy: { name: 'asc' } });

    const [items, total] = await Promise.all([
      // id as a tiebreaker keeps page boundaries stable.
      this.prisma.customer.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(pagination) }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    return customer;
  }

  async create(dto: CreateCustomerDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.name);
    const created = await this.prisma.customer.create({
      data: {
        code: dto.code,
        name: dto.name,
        customerType: dto.customerType,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        note: dto.note,
      },
    });
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: created.id, details: created.code });
    return created;
  }

  async update(id: number, dto: UpdateCustomerDto, userId: number | null = null, ipAddress?: string) {
    await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        customerType: dto.customerType,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        note: dto.note ?? null,
      },
    });
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: id, details: updated.code });
    return updated;
  }

  // Plain delete: nothing references Customer yet. Once Sales exists
  // (Sales.customer → PROTECT per database_plan.txt), add a "has sales
  // history" guard here like SuppliersService.remove().
  async remove(id: number, userId: number | null = null, ipAddress?: string) {
    const customer = await this.get(id);
    await this.prisma.customer.delete({ where: { id } });
    await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_DELETED', entityType: 'Customer', entityId: id, details: customer.code });
    return { success: true };
  }

  private async ensureUnique(code: string, name: string, excludedId?: number) {
    const duplicate = await this.prisma.customer.findFirst({
      where: {
        OR: [{ code }, { name }],
        ...(excludedId ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicate?.code === code) throw new ConflictException('کد مشتری قبلاً استفاده شده است');
    if (duplicate?.name === name) throw new ConflictException('این نام قبلاً برای مشتری دیگری استفاده شده است');
  }

}
