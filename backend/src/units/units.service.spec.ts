import { UnitsService } from './units.service';

// Unit is read-only seeded master data for now (see the service's own
// header comment) — list() is the entire surface area today.

function createPrismaMock() {
  return {
    unit: { findMany: jest.fn() },
  };
}

describe('UnitsService', () => {
  it('lists only active units, ordered by sortOrder', async () => {
    const prisma = createPrismaMock();
    const service = new UnitsService(prisma as never);
    const rows = [
      { id: 1, code: 'KG', nameFa: 'کیلوگرم', sortOrder: 0, isActive: true },
      { id: 2, code: 'PCS', nameFa: 'عدد', sortOrder: 1, isActive: true },
    ];
    (prisma as any).unit.findMany.mockResolvedValue(rows);

    await expect(service.list()).resolves.toEqual(rows);
    expect((prisma as any).unit.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  it('returns an empty list rather than throwing when no active unit exists', async () => {
    const prisma = createPrismaMock();
    const service = new UnitsService(prisma as never);
    (prisma as any).unit.findMany.mockResolvedValue([]);

    await expect(service.list()).resolves.toEqual([]);
  });
});
