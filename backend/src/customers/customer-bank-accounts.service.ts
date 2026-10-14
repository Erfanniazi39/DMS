import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CustomerBankAccountDto } from './dto/customer.dto';

// A customer's bank accounts. At most one isDefault account per customer:
// setting a new default unsets the previous one in the same transaction.
// Audited under the customer (action-only; details = bank + last 4 digits —
// never the full account/Sheba number).
@Injectable()
export class CustomerBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: number, dto: CustomerBankAccountDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.customerBankAccount.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      const account = await tx.customerBankAccount.create({ data: { customerId, ...dto } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_BANK_ACCOUNT_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: describe(account) }, tx);
      return account;
    });
  }

  // Full replace: omitted optional fields are cleared.
  async update(customerId: number, accountId: number, dto: CustomerBankAccountDto, userId: number | null, ipAddress?: string) {
    await this.findOwned(customerId, accountId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerBankAccount.updateMany({ where: { customerId, isDefault: true, NOT: { id: accountId } }, data: { isDefault: false } });
      }
      const account = await tx.customerBankAccount.update({
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
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_BANK_ACCOUNT_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: describe(account) }, tx);
      return account;
    });
  }

  async remove(customerId: number, accountId: number, userId: number | null, ipAddress?: string) {
    const account = await this.findOwned(customerId, accountId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerBankAccount.delete({ where: { id: accountId } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_BANK_ACCOUNT_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: describe(account) }, tx);
    });
    return { success: true };
  }

  private async findOwned(customerId: number, accountId: number) {
    const account = await this.prisma.customerBankAccount.findFirst({ where: { id: accountId, customerId } });
    if (!account) throw new NotFoundException('حساب بانکی پیدا نشد');
    return account;
  }
}

function describe(account: { bankName: string | null; accountNumber: string | null; shebaNumber: string | null }) {
  const tail = (account.shebaNumber ?? account.accountNumber ?? '').slice(-4);
  return `${account.bankName ?? 'بدون نام بانک'} …${tail}`;
}
