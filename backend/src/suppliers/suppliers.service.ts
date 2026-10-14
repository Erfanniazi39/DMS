import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SupplierStatus, type Prisma } from '@prisma/client';
import { buildOrderBy, toSkipTake, type PaginationParams, type SortParams } from '../common/pagination';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

export type SupplierListFilters = { q?: string; status?: string; sort?: SortParams };

// Columns the suppliers table can be sorted by (public key → Prisma orderBy).
const SUPPLIER_SORT_COLUMNS: Record<string, (dir: 'asc' | 'desc') => Prisma.SupplierOrderByWithRelationInput> = {
  name: (dir) => ({ name: dir }),
  code: (dir) => ({ code: dir }),
  phone: (dir) => ({ phone: dir }),
  email: (dir) => ({ email: dir }),
  status: (dir) => ({ status: dir }),
};

// Audited on update (nationalId is masked: only "it changed").
const AUDITED_SUPPLIER_FIELDS = ['code', 'name', 'status', 'supplierKind', 'nationalId', 'economicCode', 'registrationNumber', 'country'] as const;
const MASKED_SUPPLIER_FIELDS = ['nationalId'] as const;

// The legacy bank_* columns (superseded by supplier_bank_accounts, kept in
// the table only as a migration safety net) are never sent to the client.
function withoutLegacyBank<T extends { bankName?: unknown; bankAccountNumber?: unknown; bankShebaNumber?: unknown }>(row: T) {
  const { bankName: _name, bankAccountNumber: _number, bankShebaNumber: _sheba, ...rest } = row;
  return rest;
}

// Everything create/update store, from a validated DTO (omitted = null).
function partyData(dto: CreateSupplierDto | UpdateSupplierDto) {
  return {
    code: dto.code,
    name: dto.name,
    supplierKind: dto.supplierKind ?? null,
    title: dto.title ?? null,
    nationalId: dto.nationalId ?? null,
    economicCode: dto.economicCode ?? null,
    registrationNumber: dto.registrationNumber ?? null,
    phone: dto.phone ?? null,
    phone2: dto.phone2 ?? null,
    mobile: dto.mobile ?? null,
    fax: dto.fax ?? null,
    telex: dto.telex ?? null,
    website: dto.website ?? null,
    email: dto.email ?? null,
    address: dto.address ?? null,
    address2: dto.address2 ?? null,
    province: dto.province ?? null,
    city: dto.city ?? null,
    postalCode: dto.postalCode ?? null,
    country: dto.country ?? null,
    cityCode: dto.cityCode ?? null,
    locationNumber: dto.locationNumber ?? null,
    locationName: dto.locationName ?? null,
    taxOfficeProvince: dto.taxOfficeProvince ?? null,
    taxOfficeCity: dto.taxOfficeCity ?? null,
    note: dto.note ?? null,
  };
}

// Lists carry each supplier's purchase types (small) so the purchase / request
// forms can auto-fill the type when a supplier is picked.
const LIST_INCLUDE = { purchaseTypes: { select: { purchaseType: { select: { id: true, code: true, nameFa: true, isActive: true } } } } } satisfies Prisma.SupplierInclude;

// Flattens the join rows to plain purchase types.
function flattenTypes<T extends { purchaseTypes?: { purchaseType: unknown }[] }>(row: T) {
  return { ...row, purchaseTypes: (row.purchaseTypes ?? []).map((link) => link.purchaseType) };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
        // "who supplies X": match the free-text goods list too.
        { goods: { some: { name: { contains: filters.q, mode: 'insensitive' } } } },
      ];
    }
    if (filters.status) {
      if (!(Object.values(SupplierStatus) as string[]).includes(filters.status)) {
        throw new BadRequestException('وضعیت تأمین‌کننده نامعتبر است');
      }
      where.status = filters.status as SupplierStatus;
    }

    const orderBy = buildOrderBy(filters.sort, SUPPLIER_SORT_COLUMNS, [{ name: 'asc' }, { id: 'asc' }], [{ id: 'asc' }]);
    if (!pagination) return (await this.prisma.supplier.findMany({ where, orderBy, include: LIST_INCLUDE })).map((row) => flattenTypes(withoutLegacyBank(row)));

    const [items, total] = await Promise.all([
      // id as a tiebreaker keeps page boundaries stable.
      this.prisma.supplier.findMany({ where, orderBy, include: LIST_INCLUDE, ...toSkipTake(pagination) }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items: items.map((row) => flattenTypes(withoutLegacyBank(row))), total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const supplier = await this.findRaw(id);
    const [bankAccounts, types, goods] = await Promise.all([
      this.prisma.supplierBankAccount.findMany({ where: { supplierId: id }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] }),
      this.prisma.supplierPurchaseType.findMany({ where: { supplierId: id }, select: { purchaseType: { select: { id: true, code: true, nameFa: true, isActive: true } } } }),
      this.prisma.supplierGood.findMany({ where: { supplierId: id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true, note: true } }),
    ]);
    return { ...withoutLegacyBank(supplier), bankAccounts, purchaseTypes: types.map((link) => link.purchaseType), goods };
  }

  private async findRaw(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
    return supplier;
  }

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('SUP', (startsWith) => this.prisma.supplier.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreateSupplierDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.name);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId);
    await this.ensurePurchaseTypesUsable(dto.purchaseTypeIds);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supplier.create({
        data: {
          ...partyData(dto),
          purchaseTypes: { create: dto.purchaseTypeIds.map((purchaseTypeId) => ({ purchaseTypeId })) },
          goods: { create: dto.goods.map((good, index) => ({ name: good.name, note: good.note ?? null, sortOrder: index + 1 })) },
          ...(dto.firstBankAccount ? { bankAccounts: { create: { ...dto.firstBankAccount, isDefault: true } } } : {}),
        },
      });
      await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_CREATED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: row.id, details: row.code }, tx);
      return row;
    });
    return this.get(created.id);
  }

  // Full replace (an omitted optional field is cleared). Status rides on the
  // same call; the identity rule only applies while the status is `active`
  // (supplier.dto.ts), so an old incomplete record can still be deactivated.
  async update(id: number, dto: UpdateSupplierDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.findRaw(id);
    await this.ensureUnique(dto.code, dto.name, id);
    if (dto.nationalId) await this.ensureUniqueNationalId(dto.nationalId, id);
    await this.ensurePurchaseTypesUsable(dto.purchaseTypeIds, id);
    const data = { ...partyData(dto), status: dto.status };
    const changes = diffChanges(existing, data, AUDITED_SUPPLIER_FIELDS, { masked: MASKED_SUPPLIER_FIELDS });
    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data });
      await tx.supplierPurchaseType.deleteMany({ where: { supplierId: id } });
      await tx.supplierPurchaseType.createMany({ data: dto.purchaseTypeIds.map((purchaseTypeId) => ({ supplierId: id, purchaseTypeId })) });
      await tx.supplierGood.deleteMany({ where: { supplierId: id } });
      await tx.supplierGood.createMany({ data: dto.goods.map((good, index) => ({ supplierId: id, name: good.name, note: good.note ?? null, sortOrder: index + 1 })) });
      await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_UPDATED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: id, details: existing.code, changes }, tx);
    });
    return this.get(id);
  }

  async remove(id: number) {
    await this.findRaw(id);
    const purchaseCount = await this.prisma.purchase.count({ where: { supplierId: id } });
    if (purchaseCount > 0) {
      throw new ConflictException('این تأمین‌کننده دارای سابقه خرید است و قابل حذف نیست.');
    }
    // Bank accounts are child data of the supplier, not history: they go with it.
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierBankAccount.deleteMany({ where: { supplierId: id } });
      await tx.supplier.delete({ where: { id } });
    });
    return { success: true };
  }

  // Read-only "exists and is usable" lookup on Purchase Types (documented
  // rule-11 exception). A type the supplier already has stays allowed even if
  // it was deactivated since (an unchanged link isn't an error).
  private async ensurePurchaseTypesUsable(ids: number[], supplierId?: number) {
    if (ids.length === 0) return;
    const [types, existing] = await Promise.all([
      this.prisma.purchaseType.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } }),
      supplierId ? this.prisma.supplierPurchaseType.findMany({ where: { supplierId }, select: { purchaseTypeId: true } }) : Promise.resolve([]),
    ]);
    const kept = new Set(existing.map((link) => link.purchaseTypeId));
    const byId = new Map(types.map((type) => [type.id, type]));
    for (const id of ids) {
      const type = byId.get(id);
      if (!type) throw new ConflictException('نوع خرید انتخاب‌شده معتبر نیست');
      if (!type.isActive && !kept.has(id)) throw new ConflictException('نوع خرید انتخاب‌شده غیرفعال است');
    }
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
