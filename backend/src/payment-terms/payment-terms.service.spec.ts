import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { createPaymentTermSchema, updatePaymentTermSchema } from './dto/payment-term.dto';
import { ensureActivePaymentTerm } from './payment-term-rules';
import { PaymentTermsService } from './payment-terms.service';

function createPrismaMock() {
  return {
    paymentTerm: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
}

function build(prisma: ReturnType<typeof createPrismaMock>) {
  return new PaymentTermsService(prisma as never, new AuditService(prisma as never));
}

const dto = { code: 'net45', nameEn: 'Net 45', nameFa: '۴۵ روزه', dueDays: 45, isActive: true };

describe('PaymentTermsService', () => {
  it('list() returns only active terms ordered by sortOrder', async () => {
    const prisma = createPrismaMock();
    prisma.paymentTerm.findMany.mockResolvedValue([]);
    await build(prisma).list();
    expect(prisma.paymentTerm.findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  });

  it('create() stores dueDays, appends sortOrder and writes an audit entry', async () => {
    const prisma = createPrismaMock();
    prisma.paymentTerm.findFirst.mockResolvedValue(null);
    prisma.paymentTerm.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
    prisma.paymentTerm.create.mockResolvedValue({ id: 5, code: 'net45' });

    await build(prisma).create(dto, 2);

    expect(prisma.paymentTerm.create).toHaveBeenCalledWith({ data: { ...dto, sortOrder: 4 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PAYMENT_TERM_CREATED', entityType: 'PaymentTerm', entityId: '5' }) });
  });

  it('create() rejects a duplicate code', async () => {
    const prisma = createPrismaMock();
    prisma.paymentTerm.findFirst.mockResolvedValue({ code: 'net45', nameFa: 'x' });
    await expect(build(prisma).create(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  it('update() replaces every editable field and audits; unknown id is NotFound', async () => {
    const prisma = createPrismaMock();
    prisma.paymentTerm.findUnique.mockResolvedValueOnce({ id: 3 });
    prisma.paymentTerm.findFirst.mockResolvedValue(null);
    prisma.paymentTerm.update.mockResolvedValue({ id: 3, code: 'net45' });

    await build(prisma).update(3, { ...dto, sortOrder: 1 });
    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { ...dto, sortOrder: 1 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PAYMENT_TERM_UPDATED', entityId: '3' }) });

    prisma.paymentTerm.findUnique.mockResolvedValueOnce(null);
    await expect(build(prisma).update(99, { ...dto, sortOrder: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DTO: dueDays must be a non-negative integer', () => {
    expect(createPaymentTermSchema.safeParse({ ...dto, dueDays: -1 }).success).toBe(false);
    expect(createPaymentTermSchema.safeParse({ ...dto, dueDays: 1.5 }).success).toBe(false);
    expect(createPaymentTermSchema.safeParse({ ...dto, dueDays: '7' }).success).toBe(false);
    expect(createPaymentTermSchema.safeParse(dto).success).toBe(true);
    expect(updatePaymentTermSchema.safeParse(dto).success).toBe(false);
  });
});

describe('ensureActivePaymentTerm', () => {
  it('rejects a missing or inactive term', async () => {
    const db = { paymentTerm: { findUnique: jest.fn() } };
    db.paymentTerm.findUnique.mockResolvedValueOnce({ id: 1, isActive: true });
    await expect(ensureActivePaymentTerm(db as never, 1)).resolves.toBeUndefined();
    db.paymentTerm.findUnique.mockResolvedValueOnce({ id: 1, isActive: false });
    await expect(ensureActivePaymentTerm(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
    db.paymentTerm.findUnique.mockResolvedValueOnce(null);
    await expect(ensureActivePaymentTerm(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
  });
});
