import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { CustomerFinancialService } from './customer-financial.service';
import { buildAudit, createPrismaMock, VERSION, type PrismaMock } from './customers.spec-helpers';

function build(prisma: PrismaMock) {
  return new CustomerFinancialService(prisma as never, buildAudit(prisma));
}

const emptyProfile = { id: 1, customerId: 5, paymentTermId: null, preferredPaymentMethod: null, creditLimit: null, creditHold: false, creditHoldReason: null, updatedAt: VERSION };

describe('CustomerFinancialService', () => {
  it('get() returns the profile with its payment term; 404 for an unknown customer', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 5 });
    prisma.customerFinancialProfile.findUnique.mockResolvedValue(emptyProfile);
    await expect(build(prisma).get(5)).resolves.toEqual(emptyProfile);
    expect(prisma.customerFinancialProfile.findUnique).toHaveBeenCalledWith({ where: { customerId: 5 }, include: { paymentTerm: true } });

    prisma.customer.findUnique.mockResolvedValueOnce(null);
    await expect(build(prisma).get(9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update() replaces the policy under an optimistic lock and audits every changed field old -> new', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerFinancialProfile.findUnique.mockResolvedValue({ ...emptyProfile, creditLimit: new Prisma.Decimal(1000) });
    prisma.paymentTerm.findUnique.mockResolvedValue({ id: 3, isActive: true });
    prisma.customerFinancialProfile.upsert.mockResolvedValue({ id: 1 });

    await build(prisma).update(5, { paymentTermId: 3, creditLimit: 5000000, creditHold: true, creditHoldReason: 'چک برگشتی', updatedAt: VERSION }, 4);

    expect(prisma.customerFinancialProfile.updateMany).toHaveBeenCalledWith({ where: { id: 1, updatedAt: VERSION }, data: { updatedAt: expect.any(Date) } });
    const upsert = prisma.customerFinancialProfile.upsert.mock.calls[0][0];
    expect(upsert.update).toEqual({ paymentTermId: 3, preferredPaymentMethod: null, creditLimit: 5000000, creditHold: true, creditHoldReason: 'چک برگشتی' });
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'CUSTOMER_FINANCIAL_UPDATED', entityType: 'Customer', entityId: '5' });
    expect(audit.changes).toEqual([
      { field: 'paymentTermId', from: null, to: 3 },
      { field: 'creditLimit', from: '1000', to: 5000000 },
      { field: 'creditHold', from: false, to: true },
      { field: 'creditHoldReason', from: null, to: 'چک برگشتی' },
    ]);
  });

  it('rejects an inactive payment term only when newly chosen', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerFinancialProfile.findUnique.mockResolvedValue(emptyProfile);
    prisma.paymentTerm.findUnique.mockResolvedValue({ id: 3, isActive: false });
    await expect(build(prisma).update(5, { paymentTermId: 3, creditHold: false, updatedAt: VERSION }, 4)).rejects.toBeInstanceOf(ConflictException);

    prisma.customerFinancialProfile.findUnique.mockResolvedValue({ ...emptyProfile, paymentTermId: 3 });
    prisma.customerFinancialProfile.upsert.mockResolvedValue({ id: 1 });
    await build(prisma).update(5, { paymentTermId: 3, creditHold: false, updatedAt: VERSION }, 4);
    expect(prisma.paymentTerm.findUnique).toHaveBeenCalledTimes(1);
  });

  it('a stale updatedAt is RECORD_MODIFIED and nothing is written', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerFinancialProfile.findUnique.mockResolvedValue({ ...emptyProfile, updatedAt: new Date('2026-05-05') });
    await expect(build(prisma).update(5, { creditHold: true, updatedAt: VERSION }, 4)).rejects.toMatchObject({
      response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
    });
    expect(prisma.customerFinancialProfile.upsert).not.toHaveBeenCalled();
  });
});
