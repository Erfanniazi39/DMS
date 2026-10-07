import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CustomerAddressDto } from './dto/customer.dto';

// A customer's addresses. At most one isDefault address per addressType per
// customer (one default BILLING, one default DELIVERY, ...): setting a new
// default unsets the previous default of that type in the same transaction.
// Audited under the customer (action-only entries, no field diff).
@Injectable()
export class CustomerAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: number, dto: CustomerAddressDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({ where: { customerId, addressType: dto.addressType, isDefault: true }, data: { isDefault: false } });
      }
      const address = await tx.customerAddress.create({ data: { customerId, ...dto } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_ADDRESS_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: address.addressType }, tx);
      return address;
    });
  }

  // Full replace: omitted optional fields are cleared. If the type changes,
  // the default-uniqueness rule applies to the NEW type.
  async update(customerId: number, addressId: number, dto: CustomerAddressDto, userId: number | null, ipAddress?: string) {
    await this.findOwned(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, addressType: dto.addressType, isDefault: true, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }
      const address = await tx.customerAddress.update({
        where: { id: addressId },
        data: {
          addressType: dto.addressType,
          label: dto.label ?? null,
          province: dto.province ?? null,
          city: dto.city ?? null,
          addressLine: dto.addressLine,
          postalCode: dto.postalCode ?? null,
          phone: dto.phone ?? null,
          deliveryInstructions: dto.deliveryInstructions ?? null,
          isDefault: dto.isDefault,
          isActive: dto.isActive,
        },
      });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_ADDRESS_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: address.addressType }, tx);
      return address;
    });
  }

  async remove(customerId: number, addressId: number, userId: number | null, ipAddress?: string) {
    const address = await this.findOwned(customerId, addressId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_ADDRESS_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: address.addressType }, tx);
    });
    return { success: true };
  }

  private async findOwned(customerId: number, addressId: number) {
    const address = await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!address) throw new NotFoundException('آدرس پیدا نشد');
    return address;
  }
}
