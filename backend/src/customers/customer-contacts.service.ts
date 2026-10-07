import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CustomerContactDto } from './dto/customer.dto';

// A customer's contact persons. At most one isPrimary contact per customer:
// marking one primary unsets the previous primary in the same transaction.
// Audited under the customer (action-only entries, no field diff).
@Injectable()
export class CustomerContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: number, dto: CustomerContactDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) await tx.customerContact.updateMany({ where: { customerId, isPrimary: true }, data: { isPrimary: false } });
      const contact = await tx.customerContact.create({ data: { customerId, ...dto } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_CONTACT_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: contact.name }, tx);
      return contact;
    });
  }

  // Full replace: omitted optional fields are cleared.
  async update(customerId: number, contactId: number, dto: CustomerContactDto, userId: number | null, ipAddress?: string) {
    await this.findOwned(customerId, contactId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.customerContact.updateMany({ where: { customerId, isPrimary: true, NOT: { id: contactId } }, data: { isPrimary: false } });
      }
      const contact = await tx.customerContact.update({
        where: { id: contactId },
        data: {
          name: dto.name,
          roleTitle: dto.roleTitle ?? null,
          mobile: dto.mobile ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          isPrimary: dto.isPrimary,
          isActive: dto.isActive,
          note: dto.note ?? null,
        },
      });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_CONTACT_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: contact.name }, tx);
      return contact;
    });
  }

  async remove(customerId: number, contactId: number, userId: number | null, ipAddress?: string) {
    const contact = await this.findOwned(customerId, contactId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerContact.delete({ where: { id: contactId } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_CONTACT_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: contact.name }, tx);
    });
    return { success: true };
  }

  private async findOwned(customerId: number, contactId: number) {
    const contact = await this.prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
    if (!contact) throw new NotFoundException('مخاطب پیدا نشد');
    return contact;
  }
}
