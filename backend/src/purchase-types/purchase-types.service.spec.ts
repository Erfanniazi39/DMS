import { ConflictException } from '@nestjs/common';
import { PurchaseTypesService } from './purchase-types.service';

// PurchaseType is mostly seeded master data (see the service's own header
// comment) — create() only backs the inline "+ add purchase type"
// affordance on the Purchase form. The one business rule that matters here
// is the duplicate-name/code rejection documented as a fixed bug in
// project-knowledge-archive.md §9 ("Duplicate PurchaseType.nameFa values
// could previously be created...").

function createPrismaMock() {
  return {
    purchaseType: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
  };
}

describe('PurchaseTypesService', () => {
  it('lists only active purchase types, ordered by sortOrder', async () => {
    const prisma = createPrismaMock();
    const service = new PurchaseTypesService(prisma as never);
    const rows = [{ id: 1, code: 'RAW', nameFa: 'مواد اولیه', sortOrder: 0 }];
    (prisma as any).purchaseType.findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);
    expect((prisma as any).purchaseType.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  it('creates a new purchase type appended after the current highest sortOrder', async () => {
    const prisma = createPrismaMock();
    const service = new PurchaseTypesService(prisma as never);
    (prisma as any).purchaseType.findFirst.mockResolvedValue(null);
    (prisma as any).purchaseType.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
    (prisma as any).purchaseType.create.mockResolvedValue({ id: 9, code: 'NEW', nameFa: 'جدید', sortOrder: 5 });

    const result = await service.create({ code: 'NEW', nameFa: 'جدید', nameEn: 'New' } as never);

    expect(result.sortOrder).toBe(5);
    expect((prisma as any).purchaseType.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'NEW', nameFa: 'جدید', sortOrder: 5 }) }),
    );
  });

  it('starts sortOrder at 0 when no purchase type exists yet', async () => {
    const prisma = createPrismaMock();
    const service = new PurchaseTypesService(prisma as never);
    (prisma as any).purchaseType.findFirst.mockResolvedValue(null);
    (prisma as any).purchaseType.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    (prisma as any).purchaseType.create.mockResolvedValue({ id: 1, sortOrder: 0 });

    await service.create({ code: 'FIRST', nameFa: 'اول', nameEn: 'First' } as never);

    expect((prisma as any).purchaseType.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 0 }) }),
    );
  });

  it('rejects creating a purchase type with a duplicate code', async () => {
    const prisma = createPrismaMock();
    const service = new PurchaseTypesService(prisma as never);
    (prisma as any).purchaseType.findFirst.mockResolvedValue({ code: 'RAW', nameFa: 'چیز دیگر' });

    await expect(
      service.create({ code: 'RAW', nameFa: 'مواد جدید', nameEn: 'New Raw' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).purchaseType.create).not.toHaveBeenCalled();
  });

  it('rejects creating a purchase type with a duplicate Persian name, even with a different code', async () => {
    const prisma = createPrismaMock();
    const service = new PurchaseTypesService(prisma as never);
    (prisma as any).purchaseType.findFirst.mockResolvedValue({ code: 'OTHERCODE', nameFa: 'مواد اولیه' });

    await expect(
      service.create({ code: 'NEWCODE', nameFa: 'مواد اولیه', nameEn: 'Raw Material' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).purchaseType.create).not.toHaveBeenCalled();
    expect((prisma as any).purchaseType.aggregate).not.toHaveBeenCalled();
  });
});
