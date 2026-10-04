import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '@prisma/client';
import { createItemSchema, updateItemSchema } from './dto/item.dto';
import { ItemsService } from './items.service';

function createPrismaMock() {
  return {
    item: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // create()/update() check the chosen category and unit exist and are
    // active — stubbed as active by default in every test.
    itemCategory: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    unit: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    auditLog: { create: jest.fn() },
  } as never;
}

const baseDto = { code: 'ITM1', name: 'شیر پاستوریزه', categoryId: 1, unitId: 2, status: 'active' as const };

describe('ItemsService', () => {
  describe('list', () => {
    it('lists items ordered by name, with category and unit included', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      const rows = [{ id: 1, code: 'ITM1', name: 'شیر' }];
      (prisma as any).item.findMany.mockResolvedValue(rows);

      await expect(service.list()).resolves.toEqual(rows);
      const args = (prisma as any).item.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ name: 'asc' });
      expect(args.include.category).toBeDefined();
      expect(args.include.unit).toBeDefined();
    });

    it('returns one page plus the total matching count when paginated', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      const pageRows = [{ id: 21 }];
      (prisma as any).item.findMany.mockResolvedValue(pageRows);
      (prisma as any).item.count.mockResolvedValue(45);

      await expect(service.list({}, { page: 3, pageSize: 20 })).resolves.toEqual({ items: pageRows, total: 45, page: 3, pageSize: 20 });
      expect((prisma as any).item.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
    });

    it('applies the same search/status/category filter to both the page query and the total count', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findMany.mockResolvedValue([]);
      (prisma as any).item.count.mockResolvedValue(0);

      await service.list({ q: 'شیر', status: 'inactive', categoryId: '3' }, { page: 1, pageSize: 20 });

      const findWhere = (prisma as any).item.findMany.mock.calls[0][0].where;
      expect(findWhere.status).toBe('inactive');
      expect(findWhere.categoryId).toBe(3);
      expect(findWhere.OR).toEqual(expect.arrayContaining([{ name: { contains: 'شیر', mode: 'insensitive' } }]));
      expect((prisma as any).item.count).toHaveBeenCalledWith({ where: findWhere });
    });

    it('keeps the plain full-array response (no skip/take, no count) when not paginated', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findMany.mockResolvedValue([]);

      await service.list();
      const args = (prisma as any).item.findMany.mock.calls[0][0];
      expect(args.skip).toBeUndefined();
      expect(args.take).toBeUndefined();
      expect((prisma as any).item.count).not.toHaveBeenCalled();
    });

    it('rejects an unknown status or a malformed categoryId filter', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));

      await expect(service.list({ status: 'blacklisted' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.list({ categoryId: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).item.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates an item and writes an ITEM_CREATED audit entry', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).item.create.mockResolvedValue({ id: 7, code: 'ITM1' });

      await expect(service.create(baseDto, 3, '127.0.0.1')).resolves.toEqual({ id: 7, code: 'ITM1' });
      expect((prisma as any).item.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'ITM1', categoryId: 1, unitId: 2, status: 'active' }) }),
      );
      expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ITEM_CREATED', entityType: 'Item', entityId: '7', userId: 3, ipAddress: '127.0.0.1' }),
      });
    });

    it('rejects a duplicate code', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue({ code: 'ITM1', name: 'چیز دیگر' });

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).item.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name, even with a different code', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue({ code: 'OTHER', name: 'شیر پاستوریزه' });

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).item.create).not.toHaveBeenCalled();
    });

    it('checks uniqueness against both code and name, with no id exclusion', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).item.create.mockResolvedValue({ id: 1, code: 'ITM1' });

      await service.create(baseDto);

      const where = (prisma as any).item.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ code: 'ITM1' }, { name: 'شیر پاستوریزه' }]);
      expect(where.NOT).toBeUndefined();
    });

    it('rejects a missing or inactive category', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ isActive: false });

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).item.create).not.toHaveBeenCalled();
    });

    it('rejects a missing or inactive unit', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).unit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ isActive: false });

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).item.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates every editable field, clears omitted optional text, and audits', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 4, categoryId: 1, unitId: 2 });
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).item.update.mockResolvedValue({ id: 4, code: 'ITM1' });

      await service.update(4, { ...baseDto, status: 'inactive' }, 3);

      expect((prisma as any).item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 4 },
          data: expect.objectContaining({ status: 'inactive', description: null, note: null }),
        }),
      );
      const where = (prisma as any).item.findFirst.mock.calls[0][0].where;
      expect(where.NOT).toEqual({ id: 4 });
      expect((prisma as any).auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ITEM_UPDATED', entityId: '4' }) });
    });

    it('lets an item keep a category/unit that has since been deactivated', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 4, categoryId: 1, unitId: 2 });
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ isActive: false });
      (prisma as any).unit.findUnique.mockResolvedValue({ isActive: false });
      (prisma as any).item.update.mockResolvedValue({ id: 4, code: 'ITM1' });

      await expect(service.update(4, baseDto)).resolves.toBeDefined();
    });

    it('rejects switching to a different, inactive category', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 4, categoryId: 9, unitId: 2 });
      (prisma as any).item.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ isActive: false });

      await expect(service.update(4, baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).item.update).not.toHaveBeenCalled();
    });

    it('rejects changing the name to one used by another item', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 4, categoryId: 1, unitId: 2 });
      (prisma as any).item.findFirst.mockResolvedValue({ code: 'OTHER', name: 'شیر پاستوریزه' });

      await expect(service.update(4, baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).item.update).not.toHaveBeenCalled();
    });

    it('reports a missing item without modifying data', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue(null);

      await expect(service.update(999, baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma as any).item.update).not.toHaveBeenCalled();
      expect((prisma as any).auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing item and writes an ITEM_DELETED audit entry carrying its code', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 2, code: 'ITM2' });

      await expect(service.remove(2, 3)).resolves.toEqual({ success: true });
      expect((prisma as any).item.delete).toHaveBeenCalledWith({ where: { id: 2 } });
      expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ITEM_DELETED', entityId: '2', details: 'ITM2' }),
      });
    });

    it('turns a foreign-key restriction into a Conflict instead of a 500', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue({ id: 2, code: 'ITM2' });
      (prisma as any).item.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
      );

      await expect(service.remove(2)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).auditLog.create).not.toHaveBeenCalled();
    });

    it('reports a missing item', async () => {
      const prisma = createPrismaMock();
      const service = new ItemsService(prisma as never, new AuditService(prisma as never));
      (prisma as any).item.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma as any).item.delete).not.toHaveBeenCalled();
    });
  });

  describe('DTO validation', () => {
    it('defaults status to active on create and treats blank optional text as omitted', () => {
      const parsed = createItemSchema.parse({ code: ' ITM1 ', name: 'شیر', categoryId: 1, unitId: 2, description: '  ', note: '' });
      expect(parsed).toEqual({ code: 'ITM1', name: 'شیر', categoryId: 1, unitId: 2, status: 'active' });
    });

    it('requires category and unit as positive integers', () => {
      const base = { code: 'ITM1', name: 'شیر' };
      expect(createItemSchema.safeParse({ ...base, unitId: 2 }).success).toBe(false);
      expect(createItemSchema.safeParse({ ...base, categoryId: 1 }).success).toBe(false);
      expect(createItemSchema.safeParse({ ...base, categoryId: 0, unitId: 2 }).success).toBe(false);
    });

    it('requires a valid status on update', () => {
      const base = { code: 'ITM1', name: 'شیر', categoryId: 1, unitId: 2 };
      expect(updateItemSchema.safeParse(base).success).toBe(false);
      expect(updateItemSchema.safeParse({ ...base, status: 'blacklisted' }).success).toBe(false);
      expect(updateItemSchema.safeParse({ ...base, status: 'inactive' }).success).toBe(true);
    });
  });
});
