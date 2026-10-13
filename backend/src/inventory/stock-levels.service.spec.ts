import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { StockLevelsService } from './stock-levels.service';
import type { UpsertStockLevelDto } from './dto/stock-level.dto';

function createPrismaMock() {
  return {
    itemStockLevel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    inventoryLocation: {
      findFirst: jest.fn().mockResolvedValue({ id: 1, code: 'MAIN', isActive: true, isDefault: true }),
      findUnique: jest.fn().mockResolvedValue({ isActive: true }),
    },
    item: {
      findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'active', name: 'کالا ۱' }),
    },
    auditLog: { create: jest.fn() },
  };
}

function build(prisma: ReturnType<typeof createPrismaMock>) {
  return new StockLevelsService(prisma as never, new InventoryService(prisma as never, new AuditService(prisma as never)), new AuditService(prisma as never));
}

const savedLevel = {
  id: 10,
  itemId: 1,
  locationId: 1,
  minQty: new Prisma.Decimal(5),
  reorderQty: new Prisma.Decimal(20),
  maxQty: new Prisma.Decimal(50),
  note: null,
  item: { id: 1, code: 'ITM1', name: 'کالا ۱' },
  location: { id: 1, code: 'MAIN', name: 'انبار مرکزی' },
};

const baseDto: UpsertStockLevelDto = { itemId: 1, minQty: 5, reorderQty: 20, maxQty: 50 } as UpsertStockLevelDto;

describe('StockLevelsService', () => {
  describe('upsert', () => {
    it('creates a new threshold at the default location when locationId is omitted, and audits it', async () => {
      const prisma = createPrismaMock();
      prisma.itemStockLevel.findUnique.mockResolvedValue(null);
      prisma.itemStockLevel.upsert.mockResolvedValue(savedLevel);

      await build(prisma).upsert(baseDto, 7);

      expect(prisma.itemStockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId_locationId: { itemId: 1, locationId: 1 } },
          create: expect.objectContaining({ itemId: 1, locationId: 1, minQty: 5, reorderQty: 20, maxQty: 50 }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ITEM_STOCK_LEVEL_CREATED', entityId: '10' }) }),
      );
    });

    it('updates an existing threshold (not create) and records the field-level change', async () => {
      const prisma = createPrismaMock();
      prisma.itemStockLevel.findUnique.mockResolvedValue({ ...savedLevel, minQty: new Prisma.Decimal(2) });
      prisma.itemStockLevel.upsert.mockResolvedValue(savedLevel);

      await build(prisma).upsert(baseDto, 7);

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ITEM_STOCK_LEVEL_UPDATED' }) }),
      );
    });

    it('rejects an inactive item', async () => {
      const prisma = createPrismaMock();
      prisma.item.findUnique.mockResolvedValue({ id: 1, status: 'inactive', name: 'کالای غیرفعال' });
      await expect(build(prisma).upsert(baseDto, 7)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.itemStockLevel.upsert).not.toHaveBeenCalled();
    });

    it('rejects a missing or inactive location', async () => {
      const prisma = createPrismaMock();
      prisma.inventoryLocation.findUnique.mockResolvedValue(null);
      await expect(build(prisma).upsert({ ...baseDto, locationId: 99 }, 7)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('deletes the threshold and audits it', async () => {
      const prisma = createPrismaMock();
      prisma.itemStockLevel.findUnique.mockResolvedValue(savedLevel);
      await build(prisma).remove(10, 7);
      expect(prisma.itemStockLevel.delete).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ITEM_STOCK_LEVEL_DELETED', entityId: '10' }) }),
      );
    });

    it('reports a missing threshold clearly', async () => {
      const prisma = createPrismaMock();
      prisma.itemStockLevel.findUnique.mockResolvedValue(null);
      await expect(build(prisma).remove(999, 7)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('DTO validation (B14 — mirrors the two DB CHECK constraints)', () => {
    it('rejects a negative minQty', async () => {
      const { upsertStockLevelSchema } = await import('./dto/stock-level.dto');
      expect(upsertStockLevelSchema.safeParse({ itemId: 1, minQty: -1 }).success).toBe(false);
    });

    it('rejects maxQty below minQty', async () => {
      const { upsertStockLevelSchema } = await import('./dto/stock-level.dto');
      expect(upsertStockLevelSchema.safeParse({ itemId: 1, minQty: 10, maxQty: 5 }).success).toBe(false);
    });

    it('accepts minQty = 0 and maxQty = minQty', async () => {
      const { upsertStockLevelSchema } = await import('./dto/stock-level.dto');
      expect(upsertStockLevelSchema.safeParse({ itemId: 1, minQty: 0 }).success).toBe(true);
      expect(upsertStockLevelSchema.safeParse({ itemId: 1, minQty: 10, maxQty: 10 }).success).toBe(true);
    });
  });
});
