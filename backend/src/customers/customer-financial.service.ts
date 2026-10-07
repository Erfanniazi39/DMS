import { Injectable } from '@nestjs/common';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { ensureActivePaymentTerm } from '../payment-terms/payment-term-rules';
import { ensureCustomerExists } from './customer-rules';
import type { UpdateCustomerFinancialDto } from './dto/customer.dto';

// Every field of the profile is audited old -> new (business decision
// 2026-10-06).
const AUDITED_FINANCIAL_FIELDS = ['paymentTermId', 'preferredPaymentMethod', 'creditLimit', 'creditHold', 'creditHoldReason'] as const;

const financialInclude = { paymentTerm: true } as const;

// A customer's credit/payment POLICY — payment term, preferred payment
// method, credit limit, credit hold. Read and written only under
// customers.finance (separate from customers.manage, decision 6). No
// balance: balances belong to the future Sales/finance modules.
//
// Every customer gets an empty profile at creation (CustomersService.create()
// and the add_customer_module migration); get()/update() still tolerate a
// missing row defensively.
@Injectable()
export class CustomerFinancialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(customerId: number) {
    await ensureCustomerExists(this.prisma, customerId);
    const profile = await this.prisma.customerFinancialProfile.findUnique({ where: { customerId }, include: financialInclude });
    return (
      profile ?? {
        id: null,
        customerId,
        paymentTermId: null,
        paymentTerm: null,
        preferredPaymentMethod: null,
        creditLimit: null,
        creditHold: false,
        creditHoldReason: null,
        updatedAt: null,
      }
    );
  }

  // Full replace of the policy (omitted optional fields are cleared), with
  // the same optimistic lock as Purchase: dto.updatedAt must match.
  async update(customerId: number, dto: UpdateCustomerFinancialDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    const existing = await this.prisma.customerFinancialProfile.findUnique({ where: { customerId } });
    if (existing && !isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    if (dto.paymentTermId && dto.paymentTermId !== existing?.paymentTermId) await ensureActivePaymentTerm(this.prisma, dto.paymentTermId);

    const data = {
      paymentTermId: dto.paymentTermId ?? null,
      preferredPaymentMethod: dto.preferredPaymentMethod ?? null,
      creditLimit: dto.creditLimit ?? null,
      creditHold: dto.creditHold,
      creditHoldReason: dto.creditHoldReason ?? null,
    };
    const before = existing ?? { paymentTermId: null, preferredPaymentMethod: null, creditLimit: null, creditHold: false, creditHoldReason: null };
    const changes = diffChanges(before, data, AUDITED_FINANCIAL_FIELDS);

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        const claimed = await tx.customerFinancialProfile.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
        if (claimed.count !== 1) throw recordModifiedConflict();
      }
      const profile = await tx.customerFinancialProfile.upsert({
        where: { customerId },
        create: { customerId, ...data },
        update: data,
        include: financialInclude,
      });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_FINANCIAL_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, changes }, tx);
      return profile;
    });
  }
}
