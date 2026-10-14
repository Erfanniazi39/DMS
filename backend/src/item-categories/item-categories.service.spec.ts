import { ConflictException, NotFoundException } from '@nestjs/common';
import { createItemCategorySchema, updateItemCategorySchema } from './dto/item-category.dto';
import { ItemCategoriesService } from './item-categories.service';

// list() backs the Item form category dropdown (active
// only); listAll()/create()/update() back the /item-categories page. The
// duplicate code / Persian-name rejection mirrors PurchaseTypesService —
// see project-knowledge-archive.md §9 for the bug that rule came from.

function createPrismaMock() {
  return {
    itemCategory: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
  };
}

describe('ItemCategoriesService', () => {
  describe('list (active only, for the Item-form dropdown)', () => {
    it('lists only active categories, ordered by sortOrder', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      const rows = [
        { id: 1, code: 'KG', nameFa: 'کیلوگرم', sortOrder: 0, isActive: true },
        { id: 2, code: 'PCS', nameFa: 'عدد', sortOrder: 1, isActive: true },
      ];
      (prisma as any).itemCategory.findMany.mockResolvedValue(rows);

      await expect(service.list()).resolves.toEqual(rows);
      expect((prisma as any).itemCategory.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('returns an empty list rather than throwing when no active category exists', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findMany.mockResolvedValue([]);

      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe('listAll (admin page)', () => {
    it('lists every category including inactive ones, with no isActive filter', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      const rows = [
        { id: 1, code: 'kg', nameFa: 'کیلوگرم', sortOrder: 0, isActive: true },
        { id: 2, code: 'old', nameFa: 'قدیمی', sortOrder: 1, isActive: false },
      ];
      (prisma as any).itemCategory.findMany.mockResolvedValue(rows);

      await expect(service.listAll()).resolves.toEqual(rows);
      const args = (prisma as any).itemCategory.findMany.mock.calls[0][0];
      expect(args.where).toBeUndefined();
      expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { id: 'asc' }]);
    });
  });

  describe('create', () => {
    it('creates a category with the given sortOrder and isActive', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.create.mockResolvedValue({ id: 5 });

      await service.create({ code: 'crate', nameEn: 'Crate', nameFa: 'سبد', isActive: false, sortOrder: 7 });

      expect((prisma as any).itemCategory.aggregate).not.toHaveBeenCalled();
      expect((prisma as any).itemCategory.create).toHaveBeenCalledWith({
        data: { code: 'crate', nameEn: 'Crate', nameFa: 'سبد', isActive: false, sortOrder: 7 },
      });
    });

    it('appends after the current highest sortOrder when none is given', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.aggregate.mockResolvedValue({ _max: { sortOrder: 17 } });
      (prisma as any).itemCategory.create.mockResolvedValue({ id: 19 });

      await service.create({ code: 'crate', nameEn: 'Crate', nameFa: 'سبد', isActive: true });

      expect((prisma as any).itemCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sortOrder: 18 }) }),
      );
    });

    it('starts sortOrder at 1 when no category exists yet', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      (prisma as any).itemCategory.create.mockResolvedValue({ id: 1 });

      await service.create({ code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: true });

      expect((prisma as any).itemCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sortOrder: 1 }) }),
      );
    });

    it('rejects a duplicate code', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue({ code: 'kg', nameFa: 'چیز دیگر' });

      await expect(
        service.create({ code: 'kg', nameEn: 'Kilo', nameFa: 'کیلو', isActive: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).itemCategory.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate Persian name, even with a different code', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue({ code: 'kg', nameFa: 'کیلوگرم' });

      await expect(
        service.create({ code: 'kilo', nameEn: 'Kilo', nameFa: 'کیلوگرم', isActive: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).itemCategory.create).not.toHaveBeenCalled();
      expect((prisma as any).itemCategory.aggregate).not.toHaveBeenCalled();
    });

    it('checks uniqueness against both code and nameFa, with no id exclusion', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.create.mockResolvedValue({ id: 1 });

      await service.create({ code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: true, sortOrder: 0 });

      const where = (prisma as any).itemCategory.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ code: 'kg' }, { nameFa: 'کیلوگرم' }]);
      expect(where.NOT).toBeUndefined();
    });
  });

  describe('update', () => {
    const dto = { code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: false, sortOrder: 3 };

    it('updates every editable field, including deactivating the category', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ id: 4, code: 'kg' });
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.update.mockResolvedValue({ id: 4, ...dto });

      await expect(service.update(4, dto)).resolves.toEqual({ id: 4, ...dto });
      expect((prisma as any).itemCategory.update).toHaveBeenCalledWith({ where: { id: 4 }, data: dto });
    });

    it('excludes the category itself from the uniqueness check, so saving unchanged code/name works', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ id: 4 });
      (prisma as any).itemCategory.findFirst.mockResolvedValue(null);
      (prisma as any).itemCategory.update.mockResolvedValue({ id: 4 });

      await service.update(4, dto);

      const where = (prisma as any).itemCategory.findFirst.mock.calls[0][0].where;
      expect(where.NOT).toEqual({ id: 4 });
    });

    it('rejects changing the code to one used by another category', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ id: 4 });
      (prisma as any).itemCategory.findFirst.mockResolvedValue({ code: 'kg', nameFa: 'دیگر' });

      await expect(service.update(4, dto)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).itemCategory.update).not.toHaveBeenCalled();
    });

    it('rejects changing the Persian name to one used by another category', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findUnique.mockResolvedValue({ id: 4 });
      (prisma as any).itemCategory.findFirst.mockResolvedValue({ code: 'other', nameFa: 'کیلوگرم' });

      await expect(service.update(4, dto)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).itemCategory.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown category id', async () => {
      const prisma = createPrismaMock();
      const service = new ItemCategoriesService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).itemCategory.findUnique.mockResolvedValue(null);

      await expect(service.update(999, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma as any).itemCategory.findFirst).not.toHaveBeenCalled();
      expect((prisma as any).itemCategory.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    function build(category: unknown, itemCount: number) {
      const tx = { deletedRecord: { create: jest.fn().mockResolvedValue({}) }, itemCategory: { delete: jest.fn().mockResolvedValue({}) } };
      const prisma = {
        itemCategory: { findUnique: jest.fn().mockResolvedValue(category) },
        item: { count: jest.fn().mockResolvedValue(itemCount) },
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };
      return { service: new ItemCategoriesService(prisma as never, audit as never), tx, audit };
    }

    it('404s an unknown category and refuses one that items still use (nothing archived or deleted)', async () => {
      await expect(build(null, 0).service.remove(9, 1)).rejects.toBeInstanceOf(NotFoundException);
      const used = build({ id: 9, code: 'ICT-1' }, 3);
      await expect(used.service.remove(9, 1)).rejects.toBeInstanceOf(ConflictException);
      expect(used.tx.itemCategory.delete).not.toHaveBeenCalled();
      expect(used.tx.deletedRecord.create).not.toHaveBeenCalled();
    });

    it('archives a snapshot, deletes the category and audits it', async () => {
      const { service, tx, audit } = build({ id: 9, code: 'ICT-1', nameFa: 'شیر' }, 0);
      await service.remove(9, 1, '127.0.0.1');
      expect(tx.deletedRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityType: 'ItemCategory', entityId: 9, label: 'ICT-1' }) }));
      expect(tx.itemCategory.delete).toHaveBeenCalledWith({ where: { id: 9 } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ITEM_CATEGORY_DELETED', entityId: 9 }));
    });
  });

  describe('DTO validation', () => {
    it('defaults isActive to true and leaves sortOrder optional on create', () => {
      const parsed = createItemCategorySchema.parse({ code: ' kg ', nameEn: 'Kilogram', nameFa: 'کیلوگرم' });
      expect(parsed).toEqual({ code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: true });
    });

    it('rejects blank required fields', () => {
      expect(createItemCategorySchema.safeParse({ code: ' ', nameEn: 'x', nameFa: 'y' }).success).toBe(false);
      expect(createItemCategorySchema.safeParse({ code: 'x', nameEn: '', nameFa: 'y' }).success).toBe(false);
      expect(createItemCategorySchema.safeParse({ code: 'x', nameEn: 'y', nameFa: '' }).success).toBe(false);
    });

    it('requires a non-negative integer sortOrder on update', () => {
      const base = { code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: true };
      expect(updateItemCategorySchema.safeParse(base).success).toBe(false);
      expect(updateItemCategorySchema.safeParse({ ...base, sortOrder: -1 }).success).toBe(false);
      expect(updateItemCategorySchema.safeParse({ ...base, sortOrder: 1.5 }).success).toBe(false);
      expect(updateItemCategorySchema.safeParse({ ...base, sortOrder: 2 }).success).toBe(true);
    });
  });
});
