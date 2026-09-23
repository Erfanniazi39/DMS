import { ConflictException, NotFoundException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

function createPrismaMock() {
  return {
    department: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: { count: jest.fn() },
  } as never;
}

describe('DepartmentsService', () => {
  it('lists departments with status and notes', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    const rows = [{ id: 1, code: 'MODIRIAT', name: 'مدیریت', status: 'active', note: null }];
    (prisma as any).department.findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);
    expect((prisma as any).department.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
  });

  it('rejects duplicate code or name without creating a department', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    (prisma as any).department.findFirst.mockResolvedValue({ code: 'PURCHASE', name: 'خرید' });

    await expect(service.create({ code: 'PURCHASE', name: 'خرید' })).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).department.create).not.toHaveBeenCalled();
  });

  it('updates a department and its status while preserving the same record', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    const existing = { id: 2, code: 'PURCHASE', name: 'خرید', status: 'active', note: null };
    const updated = { ...existing, status: 'inactive', note: 'غیرفعال موقت' };
    (prisma as any).department.findUnique.mockResolvedValue(existing);
    (prisma as any).department.findFirst.mockResolvedValue(null);
    (prisma as any).department.update.mockResolvedValue(updated);

    await expect(service.update(2, { code: 'PURCHASE', name: 'خرید', status: 'inactive', note: 'غیرفعال موقت' })).resolves.toEqual(updated);
    expect((prisma as any).department.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ status: 'inactive' }) }));
  });

  it('reports a missing department without modifying data', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    (prisma as any).department.findUnique.mockResolvedValue(null);

    await expect(service.update(999, { code: 'UNKNOWN', name: 'ناموجود', status: 'active', note: '' })).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as any).department.update).not.toHaveBeenCalled();
  });

  it('rejects deleting a department used by an employee', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 1 });
    (prisma as any).employee.count.mockResolvedValue(1);

    await expect(service.remove(1)).rejects.toThrow('این دپارتمان دارای کارمند است و قابل حذف نیست.');
    expect((prisma as any).department.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused department', async () => {
    const prisma = createPrismaMock();
    const service = new DepartmentsService(prisma as never);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2 });
    (prisma as any).employee.count.mockResolvedValue(0);

    await expect(service.remove(2)).resolves.toEqual({ success: true });
    expect((prisma as any).department.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
});
