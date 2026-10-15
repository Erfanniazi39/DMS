import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { suggestNextCode } from '../common/next-code';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges, masterDataUpdateAction } from '../audit/audit.service';
import type { CreatePaymentTermDto, UpdatePaymentTermDto } from './dto/payment-term.dto';

// Mirrors CustomerGroupsService (itself a copy of ItemCategoriesService),
// plus dueDays. list() = active only, for the financial-profile dropdown;
// listAll()/create()/update() back the /payment-terms page. No delete —
// retire a term with isActive=false. Create/update are audited
// (AUDIT_ENTITY.PAYMENT_TERM).
@Injectable()
export class PaymentTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.paymentTerm.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.paymentTerm.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  // The suggested code for the create form (PREFIX-000001, editable there).
  nextCode() {
    return suggestNextCode('PTM', (startsWith) => this.prisma.paymentTerm.findMany({ where: { code: { startsWith } }, select: { code: true } }));
  }

  async create(dto: CreatePaymentTermDto, userId: number | null = null, ipAddress?: string) {
    await this.ensureUnique(dto.code, dto.nameFa);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const { _max } = await this.prisma.paymentTerm.aggregate({ _max: { sortOrder: true } });
      sortOrder = (_max.sortOrder ?? 0) + 1;
    }

    const created = await this.prisma.paymentTerm.create({
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, dueDays: dto.dueDays, isActive: dto.isActive, sortOrder },
    });
    await this.audit.log({ userId, ipAddress, action: 'PAYMENT_TERM_CREATED', entityType: AUDIT_ENTITY.PAYMENT_TERM, entityId: created.id, details: created.code });
    return created;
  }

  async update(id: number, dto: UpdatePaymentTermDto, userId: number | null = null, ipAddress?: string) {
    const existing = await this.prisma.paymentTerm.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('شرایط پرداخت پیدا نشد');

    await this.ensureUnique(dto.code, dto.nameFa, id);

    const updated = await this.prisma.paymentTerm.update({
      where: { id },
      data: { code: dto.code, nameEn: dto.nameEn, nameFa: dto.nameFa, dueDays: dto.dueDays, isActive: dto.isActive, sortOrder: dto.sortOrder },
    });
    const changes = diffChanges(existing, updated, ['code', 'nameEn', 'nameFa', 'dueDays', 'isActive', 'sortOrder']);
    if (changes.length > 0) {
      const action = masterDataUpdateAction('PAYMENT_TERM', changes, 'isActive', updated.isActive);
      await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PAYMENT_TERM, entityId: id, details: updated.code, changes });
    }
    return updated;
  }

  private async ensureUnique(code: string, nameFa: string, excludedId?: number) {
    const duplicate = await this.prisma.paymentTerm.findFirst({
      where: {
        OR: [{ code }, { nameFa }],
        ...(excludedId !== undefined ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, nameFa: true },
    });
    if (duplicate?.code === code) throw new ConflictException('این کد قبلاً برای شرایط پرداخت دیگری استفاده شده است');
    if (duplicate?.nameFa === nameFa) throw new ConflictException('شرایط پرداخت با این نام فارسی از قبل وجود دارد');
  }
}
