import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

function createPrismaMock() {
  return {
    supplier: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as never;
}

describe('SuppliersService', () => {
  it('lists suppliers ordered by name', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    const rows = [{ id: 1, code: 'SUP1', name: 'تأمین‌کننده یک', status: 'active' }];
    (prisma as any).supplier.findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);
    expect((prisma as any).supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
  });

  it('rejects duplicate code or name without creating a supplier', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findFirst.mockResolvedValue({ code: 'SUP1', name: 'تأمین‌کننده یک' });

    await expect(service.create({ code: 'SUP1', name: 'تأمین‌کننده یک' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).supplier.create).not.toHaveBeenCalled();
  });

  it('updates a supplier and its status while preserving the same record', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    const existing = { id: 2, code: 'SUP2', name: 'تأمین‌کننده دو', status: 'active' };
    const updated = { ...existing, status: 'inactive' };
    (prisma as any).supplier.findUnique.mockResolvedValue(existing);
    (prisma as any).supplier.findFirst.mockResolvedValue(null);
    (prisma as any).supplier.update.mockResolvedValue(updated);

    await expect(
      service.update(2, { code: 'SUP2', name: 'تأمین‌کننده دو', status: 'inactive' } as never),
    ).resolves.toEqual(updated);
    expect((prisma as any).supplier.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ status: 'inactive' }) }));
  });

  it('reports a missing supplier without modifying data', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findUnique.mockResolvedValue(null);

    await expect(service.update(999, { code: 'UNKNOWN', name: 'ناموجود', status: 'active' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((prisma as any).supplier.update).not.toHaveBeenCalled();
  });

  it('deletes an existing supplier', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 2 });

    await expect(service.remove(2)).resolves.toEqual({ success: true });
    expect((prisma as any).supplier.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
});
