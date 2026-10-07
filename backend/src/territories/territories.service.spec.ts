import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { createTerritorySchema, updateTerritorySchema } from './dto/territory.dto';
import { ensureActiveTerritory } from './territory-rules';
import { TerritoriesService } from './territories.service';

// Same shape as item-categories.service.spec.ts, plus audit entries and the
// ensureActiveTerritory() rule used by CustomersService.

function createPrismaMock() {
  return {
    territory: {
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
  return new TerritoriesService(prisma as never, new AuditService(prisma as never));
}

describe('TerritoriesService', () => {
  it('list() returns only active territories ordered by sortOrder', async () => {
    const prisma = createPrismaMock();
    prisma.territory.findMany.mockResolvedValue([]);
    await build(prisma).list();
    expect(prisma.territory.findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  });

  it('listAll() returns every territory including inactive ones', async () => {
    const prisma = createPrismaMock();
    prisma.territory.findMany.mockResolvedValue([]);
    await build(prisma).listAll();
    const args = prisma.territory.findMany.mock.calls[0][0];
    expect(args.where).toBeUndefined();
    expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { id: 'asc' }]);
  });

  it('create() appends after the highest sortOrder and writes an audit entry', async () => {
    const prisma = createPrismaMock();
    prisma.territory.findFirst.mockResolvedValue(null);
    prisma.territory.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
    prisma.territory.create.mockResolvedValue({ id: 5, code: 'north' });

    await build(prisma).create({ code: 'north', nameEn: 'North', nameFa: 'شمال', isActive: true }, 9);

    expect(prisma.territory.create).toHaveBeenCalledWith({ data: { code: 'north', nameEn: 'North', nameFa: 'شمال', isActive: true, sortOrder: 4 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 9, action: 'TERRITORY_CREATED', entityType: 'Territory', entityId: '5' }),
    });
  });

  it('create() rejects a duplicate code or Persian name', async () => {
    const prisma = createPrismaMock();
    prisma.territory.findFirst.mockResolvedValue({ code: 'tehran', nameFa: 'x' });
    await expect(build(prisma).create({ code: 'tehran', nameEn: 'R', nameFa: 'y', isActive: true })).rejects.toBeInstanceOf(ConflictException);
    prisma.territory.findFirst.mockResolvedValue({ code: 'other', nameFa: 'تهران' });
    await expect(build(prisma).create({ code: 'r2', nameEn: 'R', nameFa: 'تهران', isActive: true })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.territory.create).not.toHaveBeenCalled();
  });

  it('update() excludes itself from the uniqueness check and can deactivate', async () => {
    const prisma = createPrismaMock();
    const dto = { code: 'tehran', nameEn: 'Tehran', nameFa: 'تهران', isActive: false, sortOrder: 0 };
    prisma.territory.findUnique.mockResolvedValue({ id: 1 });
    prisma.territory.findFirst.mockResolvedValue(null);
    prisma.territory.update.mockResolvedValue({ id: 1, ...dto });

    await build(prisma).update(1, dto);

    expect(prisma.territory.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 1 });
    expect(prisma.territory.update).toHaveBeenCalledWith({ where: { id: 1 }, data: dto });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'TERRITORY_UPDATED', entityId: '1' }) });
  });

  it('update() throws NotFound for an unknown id', async () => {
    const prisma = createPrismaMock();
    prisma.territory.findUnique.mockResolvedValue(null);
    await expect(build(prisma).update(99, { code: 'a', nameEn: 'a', nameFa: 'a', isActive: true, sortOrder: 0 })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.territory.update).not.toHaveBeenCalled();
  });

  it('DTO: defaults isActive to true on create and requires sortOrder on update', () => {
    expect(createTerritorySchema.parse({ code: ' north ', nameEn: 'North', nameFa: 'شمال' })).toEqual({ code: 'north', nameEn: 'North', nameFa: 'شمال', isActive: true });
    expect(updateTerritorySchema.safeParse({ code: 'north', nameEn: 'North', nameFa: 'شمال', isActive: true }).success).toBe(false);
  });
});

describe('ensureActiveTerritory', () => {
  it('passes for an active territory and rejects a missing or inactive one', async () => {
    const db = { territory: { findUnique: jest.fn() } };
    db.territory.findUnique.mockResolvedValueOnce({ id: 1, isActive: true });
    await expect(ensureActiveTerritory(db as never, 1)).resolves.toBeUndefined();
    db.territory.findUnique.mockResolvedValueOnce({ id: 1, isActive: false });
    await expect(ensureActiveTerritory(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
    db.territory.findUnique.mockResolvedValueOnce(null);
    await expect(ensureActiveTerritory(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
  });
});
