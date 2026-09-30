import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { parsePagination } from '../common/pagination';
import { SuppliersService } from './suppliers.service';

function createPrismaMock() {
  return {
    supplier: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // remove() guards against deleting a supplier that still has purchase
    // history (see SuppliersService.remove()) — every test that reaches
    // that guard needs this stubbed, even ones not specifically about it.
    purchase: {
      count: jest.fn(),
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

  // --- Pagination (opt-in; the plain-array shape above stays the default) ---

  it('returns one page plus the total matching count when paginated', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    const pageRows = [{ id: 21, code: 'SUP21', name: 'ت ۲۱' }];
    (prisma as any).supplier.findMany.mockResolvedValue(pageRows);
    (prisma as any).supplier.count.mockResolvedValue(45);

    await expect(service.list({}, { page: 3, pageSize: 20 })).resolves.toEqual({ items: pageRows, total: 45, page: 3, pageSize: 20 });
    // Page 3 of 20 → rows 41..60 → skip 40, take 20.
    expect((prisma as any).supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('applies the same search/status filter to both the page query and the total count', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findMany.mockResolvedValue([]);
    (prisma as any).supplier.count.mockResolvedValue(0);

    await service.list({ q: 'شیر', status: 'active' }, { page: 1, pageSize: 20 });

    const findWhere = (prisma as any).supplier.findMany.mock.calls[0][0].where;
    expect(findWhere.status).toBe('active');
    expect(findWhere.OR).toEqual(expect.arrayContaining([{ name: { contains: 'شیر', mode: 'insensitive' } }]));
    expect((prisma as any).supplier.count).toHaveBeenCalledWith({ where: findWhere });
    expect((prisma as any).supplier.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
  });

  it('keeps the plain full-array response (no skip/take, no count) when not paginated', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findMany.mockResolvedValue([]);

    await expect(service.list()).resolves.toEqual([]);
    const args = (prisma as any).supplier.findMany.mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect((prisma as any).supplier.count).not.toHaveBeenCalled();
  });

  it('rejects an unknown status filter instead of passing it to the database', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);

    await expect(service.list({ status: 'bogus' })).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).supplier.findMany).not.toHaveBeenCalled();
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

  it('deletes an existing supplier with no purchase history', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 2 });
    (prisma as any).purchase.count.mockResolvedValue(0);

    await expect(service.remove(2)).resolves.toEqual({ success: true });
    expect((prisma as any).purchase.count).toHaveBeenCalledWith({ where: { supplierId: 2 } });
    expect((prisma as any).supplier.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it('rejects deleting a supplier that still has purchase history', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as never);
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 2 });
    (prisma as any).purchase.count.mockResolvedValue(3);

    await expect(service.remove(2)).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).supplier.delete).not.toHaveBeenCalled();
  });
});

describe('parsePagination', () => {
  it('is opt-in: returns undefined when neither page nor pageSize is given', () => {
    expect(parsePagination(undefined, undefined)).toBeUndefined();
  });

  it('defaults to page 1 and pageSize 20', () => {
    expect(parsePagination('', undefined)).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(undefined, '10')).toEqual({ page: 1, pageSize: 10 });
    expect(parsePagination('4', undefined)).toEqual({ page: 4, pageSize: 20 });
  });

  it('rejects non-integer, zero/negative pages and out-of-range page sizes', () => {
    expect(() => parsePagination('0', undefined)).toThrow(BadRequestException);
    expect(() => parsePagination('abc', undefined)).toThrow(BadRequestException);
    expect(() => parsePagination('1.5', undefined)).toThrow(BadRequestException);
    expect(() => parsePagination('1', '0')).toThrow(BadRequestException);
    expect(() => parsePagination('1', '101')).toThrow(BadRequestException);
  });
});
