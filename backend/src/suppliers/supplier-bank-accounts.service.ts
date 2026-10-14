import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import type { SupplierBankAccountDto } from './dto/supplier.dto';

// A supplier's bank accounts. At most one isDefault account per supplier:
// setting a new default unsets the previous one in the same transaction.
// Audited under the supplier (bank + last 4 digits only — a changed supplier
// bank account is the classic way to redirect a payment, so it is logged).
@Injectable()
export class SupplierBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(supplierId: number, dto: SupplierBankAccountDto, userId: number | null, ipAddress?: string) {
    await this.ensureSupplierExists(supplierId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.supplierBankAccount.updateMany({ where: { supplierId, isDefault: true }, data: { isDefault: false } });
      const account = await tx.supplierBankAccount.create({ data: { supplierId, ...dto } });
      await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_BANK_ACCOUNT_ADDED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: supplierId, details: describe(account) }, tx);
      return account;
    });
  }

  // Full replace: omitted optional fields are cleared.
  async update(supplierId: number, accountId: number, dto: SupplierBankAccountDto, userId: number | null, ipAddress?: string) {
    await this.findOwned(supplierId, accountId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.supplierBankAccount.updateMany({ where: { supplierId, isDefault: true, NOT: { id: accountId } }, data: { isDefault: false } });
      }
      const account = await tx.supplierBankAccount.update({
        where: { id: accountId },
        data: {
          bankName: dto.bankName ?? null,
          accountNumber: dto.accountNumber ?? null,
          shebaNumber: dto.shebaNumber ?? null,
          accountHolderName: dto.accountHolderName ?? null,
          isDefault: dto.isDefault,
          isActive: dto.isActive,
          note: dto.note ?? null,
        },
      });
      await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_BANK_ACCOUNT_UPDATED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: supplierId, details: describe(account) }, tx);
      return account;
    });
  }

  async remove(supplierId: number, accountId: number, userId: number | null, ipAddress?: string) {
    const account = await this.findOwned(supplierId, accountId);
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierBankAccount.delete({ where: { id: accountId } });
      await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_BANK_ACCOUNT_REMOVED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: supplierId, details: describe(account) }, tx);
    });
    return { success: true };
  }

  private async ensureSupplierExists(supplierId: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
  }

  private async findOwned(supplierId: number, accountId: number) {
    const account = await this.prisma.supplierBankAccount.findFirst({ where: { id: accountId, supplierId } });
    if (!account) throw new NotFoundException('حساب بانکی پیدا نشد');
    return account;
  }
}

function describe(account: { bankName: string | null; accountNumber: string | null; shebaNumber: string | null }) {
  const tail = (account.shebaNumber ?? account.accountNumber ?? '').slice(-4);
  return `${account.bankName ?? 'بدون نام بانک'} …${tail}`;
}
