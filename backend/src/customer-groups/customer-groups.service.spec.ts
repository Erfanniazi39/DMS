import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { createCustomerGroupSchema, updateCustomerGroupSchema } from './dto/customer-group.dto';
import { ensureActiveCustomerGroup } from './customer-group-rules';
import { CustomerGroupsService } from './customer-groups.service';

// Same shape as item-categories.service.spec.ts, plus audit entries and the
// ensureActiveCustomerGroup() rule used by CustomersService.

function createPrismaMock() {
  return {
    customerGroup: {
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
  return new CustomerGroupsService(prisma as never, new AuditService(prisma as never));
}

describe('CustomerGroupsService', () => {
  it('list() returns only active groups ordered by sortOrder', async () => {
    const prisma = createPrismaMock();
    prisma.customerGroup.findMany.mockResolvedValue([]);
    await build(prisma).list();
    expect(prisma.customerGroup.findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  });

  it('listAll() returns every group including inactive ones', async () => {
    const prisma = createPrismaMock();
    prisma.customerGroup.findMany.mockResolvedValue([]);
    await build(prisma).listAll();
    const args = prisma.customerGroup.findMany.mock.calls[0][0];
    expect(args.where).toBeUndefined();
    expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { id: 'asc' }]);
  });

  it('create() appends after the highest sortOrder and writes an audit entry', async () => {
    const prisma = createPrismaMock();
    prisma.customerGroup.findFirst.mockResolvedValue(null);
    prisma.customerGroup.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
    prisma.customerGroup.create.mockResolvedValue({ id: 5, code: 'vip' });

    await build(prisma).create({ code: 'vip', nameEn: 'VIP', nameFa: 'ویژه', isActive: true }, 9);

    expect(prisma.customerGroup.create).toHaveBeenCalledWith({ data: { code: 'vip', nameEn: 'VIP', nameFa: 'ویژه', isActive: true, sortOrder: 4 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 9, action: 'CUSTOMER_GROUP_CREATED', entityType: 'CustomerGroup', entityId: '5' }),
    });
  });

  it('create() rejects a duplicate code or Persian name', async () => {
    const prisma = createPrismaMock();
    prisma.customerGroup.findFirst.mockResolvedValue({ code: 'retail', nameFa: 'x' });
    await expect(build(prisma).create({ code: 'retail', nameEn: 'R', nameFa: 'y', isActive: true })).rejects.toBeInstanceOf(ConflictException);
    prisma.customerGroup.findFirst.mockResolvedValue({ code: 'other', nameFa: 'خرده‌فروشی' });
    await expect(build(prisma).create({ code: 'r2', nameEn: 'R', nameFa: 'خرده‌فروشی', isActive: true })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.customerGroup.create).not.toHaveBeenCalled();
  });

  it('update() excludes itself from the uniqueness check and can deactivate', async () => {
    const prisma = createPrismaMock();
    const dto = { code: 'retail', nameEn: 'Retail', nameFa: 'خرده‌فروشی', isActive: false, sortOrder: 0 };
    prisma.customerGroup.findUnique.mockResolvedValue({ id: 1 });
    prisma.customerGroup.findFirst.mockResolvedValue(null);
    prisma.customerGroup.update.mockResolvedValue({ id: 1, ...dto });

    await build(prisma).update(1, dto);

    expect(prisma.customerGroup.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 1 });
    expect(prisma.customerGroup.update).toHaveBeenCalledWith({ where: { id: 1 }, data: dto });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_GROUP_UPDATED', entityId: '1' }) });
  });

  it('update() throws NotFound for an unknown id', async () => {
    const prisma = createPrismaMock();
    prisma.customerGroup.findUnique.mockResolvedValue(null);
    await expect(build(prisma).update(99, { code: 'a', nameEn: 'a', nameFa: 'a', isActive: true, sortOrder: 0 })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerGroup.update).not.toHaveBeenCalled();
  });

  it('DTO: defaults isActive to true on create and requires sortOrder on update', () => {
    expect(createCustomerGroupSchema.parse({ code: ' vip ', nameEn: 'VIP', nameFa: 'ویژه' })).toEqual({ code: 'vip', nameEn: 'VIP', nameFa: 'ویژه', isActive: true });
    expect(updateCustomerGroupSchema.safeParse({ code: 'vip', nameEn: 'VIP', nameFa: 'ویژه', isActive: true }).success).toBe(false);
  });
});

describe('ensureActiveCustomerGroup', () => {
  it('passes for an active group and rejects a missing or inactive one', async () => {
    const db = { customerGroup: { findUnique: jest.fn() } };
    db.customerGroup.findUnique.mockResolvedValueOnce({ id: 1, isActive: true });
    await expect(ensureActiveCustomerGroup(db as never, 1)).resolves.toBeUndefined();
    db.customerGroup.findUnique.mockResolvedValueOnce({ id: 1, isActive: false });
    await expect(ensureActiveCustomerGroup(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
    db.customerGroup.findUnique.mockResolvedValueOnce(null);
    await expect(ensureActiveCustomerGroup(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
  });
});
