import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createCustomerSchema } from './dto/customer.dto';
import { CustomersService } from './customers.service';

function createPrismaMock() {
  return {
    customer: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  } as never;
}

const validDto = { code: 'CUS1', name: 'مشتری یک', customerType: 'retail', phone: '09120000000' } as const;

describe('CustomersService', () => {
  it('lists customers ordered by name', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    const rows = [{ id: 1, code: 'CUS1', name: 'مشتری یک', customerType: 'retail' }];
    (prisma as any).customer.findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);
    expect((prisma as any).customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    expect((prisma as any).customer.count).not.toHaveBeenCalled();
  });

  it('returns one page plus the total matching count when paginated', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    const pageRows = [{ id: 21, code: 'CUS21', name: 'م ۲۱' }];
    (prisma as any).customer.findMany.mockResolvedValue(pageRows);
    (prisma as any).customer.count.mockResolvedValue(45);

    await expect(service.list({ q: 'شیر' }, { page: 3, pageSize: 20 })).resolves.toEqual({ items: pageRows, total: 45, page: 3, pageSize: 20 });
    const args = (prisma as any).customer.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 40, take: 20 });
    expect((prisma as any).customer.count).toHaveBeenCalledWith({ where: args.where });
  });

  it('rejects an unknown customer type filter', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);

    await expect(service.list({ customerType: 'bogus' })).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).customer.findMany).not.toHaveBeenCalled();
  });

  it('creates a customer and writes an audit log entry', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    const created = { id: 5, ...validDto };
    (prisma as any).customer.findFirst.mockResolvedValue(null);
    (prisma as any).customer.create.mockResolvedValue(created);

    await expect(service.create(validDto as never, 7, '127.0.0.1')).resolves.toEqual(created);
    expect((prisma as any).customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ code: 'CUS1', customerType: 'retail' }) });
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 7, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: '5' }),
    });
  });

  it('rejects a duplicate code without creating a customer', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    (prisma as any).customer.findFirst.mockResolvedValue({ code: 'CUS1', name: 'دیگری' });

    await expect(service.create(validDto as never)).rejects.toThrow('کد مشتری قبلاً استفاده شده است');
    expect((prisma as any).customer.create).not.toHaveBeenCalled();
    expect((prisma as any).auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name without creating a customer', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    (prisma as any).customer.findFirst.mockResolvedValue({ code: 'OTHER', name: 'مشتری یک' });

    await expect(service.create(validDto as never)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(validDto as never)).rejects.toThrow('این نام قبلاً برای مشتری دیگری استفاده شده است');
    expect((prisma as any).customer.create).not.toHaveBeenCalled();
  });

  it('updates a customer, excluding itself from the uniqueness check, and clears omitted optional fields', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    const existing = { id: 2, ...validDto, email: 'a@b.com' };
    const updated = { ...existing, customerType: 'wholesale', email: null };
    (prisma as any).customer.findUnique.mockResolvedValue(existing);
    (prisma as any).customer.findFirst.mockResolvedValue(null);
    (prisma as any).customer.update.mockResolvedValue(updated);

    await expect(service.update(2, { ...validDto, customerType: 'wholesale' } as never)).resolves.toEqual(updated);
    expect((prisma as any).customer.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 2 });
    expect((prisma as any).customer.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({ customerType: 'wholesale', email: null, address: null, note: null }),
    });
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_UPDATED', entityId: '2' }) });
  });

  it('reports a missing customer without modifying data', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    (prisma as any).customer.findUnique.mockResolvedValue(null);

    await expect(service.update(999, validDto as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as any).customer.update).not.toHaveBeenCalled();
    expect((prisma as any).customer.delete).not.toHaveBeenCalled();
  });

  it('deletes an existing customer and writes an audit log entry', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as never);
    (prisma as any).customer.findUnique.mockResolvedValue({ id: 2, code: 'CUS2' });

    await expect(service.remove(2)).resolves.toEqual({ success: true });
    expect((prisma as any).customer.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_DELETED', entityId: '2' }) });
  });
});

describe('createCustomerSchema', () => {
  it('accepts a valid customer and treats empty optional fields as omitted', () => {
    const parsed = createCustomerSchema.parse({ ...validDto, email: '', address: '  ', note: '' });
    expect(parsed.email).toBeUndefined();
    expect(parsed.address).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });

  it('rejects an invalid email, invalid phone, missing phone and unknown customer type', () => {
    expect(createCustomerSchema.safeParse({ ...validDto, email: 'not-an-email' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validDto, phone: '12ab' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validDto, phone: '' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validDto, customerType: 'vip' }).success).toBe(false);
  });
});
