import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { createProductionOutputSchema } from './dto/production-output.dto';
import {
  ADJ_DATE,
  balanceOf,
  buildProductionOutputsService,
  createInventoryDb,
  seedBatch,
  setItemKind,
  trackItem,
  VERSION,
  type InventoryDb,
} from './inventory.spec-helpers';
import { ProductionOutputsController } from './production-outputs.controller';

// ProductionOutputsService (Inventory batch I5, build plan §5.11) — DRAFT
// CRUD and DRAFT → POSTED (PRODUCTION_OUTPUT ON_HAND +q at the line's
// batch). FINISHED_GOOD lines only; no BOM/raw-material consumption.

const COST = { canViewCost: true };
const NO_COST = { canViewCost: false };
const MS_PER_DAY = 86_400_000;

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 201,
    lineNo: 1,
    itemId: 1,
    quantity: new Prisma.Decimal(120),
    unitCost: new Prisma.Decimal(18000),
    costIsEstimated: true,
    batchNumber: null,
    productionDate: null,
    expiryDate: null,
    batchId: null,
    note: null,
    ...overrides,
  };
}

function draftOutput(overrides: Record<string, unknown> = {}) {
  return {
    id: 60,
    outputNumber: null,
    locationId: 1,
    location: { isActive: true },
    productionDate: ADJ_DATE,
    producedByEmployeeId: null,
    status: 'DRAFT',
    note: null,
    postedByUserId: null,
    postedAt: null,
    updatedAt: VERSION,
    items: [line()],
    ...overrides,
  };
}

function mockOutput(db: InventoryDb, output: any = draftOutput()) {
  let current: any = output;
  db.productionOutput.findUnique.mockImplementation(async () => current);
  db.productionOutput.update.mockImplementation(async ({ data }: any) => {
    const { items: _nested, ...scalars } = data;
    current = { ...current, ...scalars };
    return current;
  });
  db.productionOutputItem.update.mockImplementation(async ({ where, data }: any) => {
    current = { ...current, items: current.items.map((row: any) => (row.id === where.id ? { ...row, ...data } : row)) };
    return current.items.find((row: any) => row.id === where.id);
  });
  return () => current;
}

const createDto = { productionDate: ADJ_DATE, items: [{ itemId: 1, quantity: 120 }] };

describe('ProductionOutputsService', () => {
  describe('create', () => {
    it('creates a DRAFT with no number, numbers lines, audits, never touches stock', async () => {
      const db = createInventoryDb();
      db.productionOutput.create.mockResolvedValue({ id: 60, items: [] });

      await buildProductionOutputsService(db).create({ ...createDto, producedByEmployeeId: 9 } as never, NO_COST, 3, '127.0.0.1');

      const data = db.productionOutput.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'DRAFT', locationId: 1, productionDate: ADJ_DATE, producedByEmployeeId: 9, createdByUserId: 3 }));
      expect(data.outputNumber).toBeUndefined();
      expect(data.items.create).toEqual([expect.objectContaining({ lineNo: 1, itemId: 1, quantity: 120, unitCost: null, costIsEstimated: false })]);
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PRODUCTION_OUTPUT_CREATED', entityType: 'ProductionOutput', entityId: '60' }) });
      expect(db.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('rejects a RAW_MATERIAL or PACKAGING line — production output is FINISHED_GOOD only', async () => {
      const db = createInventoryDb();
      setItemKind(db, 2, 'RAW_MATERIAL');
      setItemKind(db, 3, 'PACKAGING');
      const service = buildProductionOutputsService(db);
      for (const itemId of [2, 3]) {
        await expect(service.create({ ...createDto, items: [{ itemId, quantity: 1 }] } as never, NO_COST, 3)).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'ITEM_KIND_NOT_ALLOWED' }),
        });
      }
      expect(db.productionOutput.create).not.toHaveBeenCalled();
    });

    it('cost (B15): refused without inventory.cost (unitCost or the estimated flag), stored with it', async () => {
      const db = createInventoryDb();
      db.productionOutput.create.mockResolvedValue({ id: 60, items: [] });
      const service = buildProductionOutputsService(db);
      const withCost = { ...createDto, items: [{ itemId: 1, quantity: 120, unitCost: 18000, costIsEstimated: true }] };

      await expect(service.create(withCost as never, NO_COST, 3)).rejects.toBeInstanceOf(ForbiddenException);
      await service.create(withCost as never, COST, 3);
      expect(db.productionOutput.create.mock.calls[0][0].data.items.create[0]).toEqual(expect.objectContaining({ unitCost: 18000, costIsEstimated: true }));
    });

    it('rejects an unknown or inactive employee', async () => {
      const db = createInventoryDb();
      const service = buildProductionOutputsService(db);
      db.employee.findUnique.mockResolvedValueOnce(null);
      await expect(service.create({ ...createDto, producedByEmployeeId: 9 } as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);
      db.employee.findUnique.mockResolvedValueOnce({ id: 9, status: 'terminated' });
      await expect(service.create({ ...createDto, producedByEmployeeId: 9 } as never, NO_COST, 3)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('DTO: costIsEstimated without a unitCost is rejected', () => {
      expect(createProductionOutputSchema.safeParse({ ...createDto, items: [{ itemId: 1, quantity: 1, costIsEstimated: true }] }).success).toBe(false);
      expect(createProductionOutputSchema.safeParse({ ...createDto, items: [{ itemId: 1, quantity: 1, unitCost: 100, costIsEstimated: true }] }).success).toBe(true);
    });
  });

  describe('get / update', () => {
    it('masks unitCost and costIsEstimated without inventory.cost', async () => {
      const db = createInventoryDb();
      mockOutput(db);
      const masked: any = await buildProductionOutputsService(db).get(60, NO_COST);
      expect(masked.items[0]).not.toHaveProperty('unitCost');
      expect(masked.items[0]).not.toHaveProperty('costIsEstimated');
      const full: any = await buildProductionOutputsService(db).get(60, COST);
      expect(full.items[0].unitCost.toString()).toBe('18000');
    });

    it('a non-cost editor keeps the previous cost fields of the same item at the same position', async () => {
      const db = createInventoryDb();
      mockOutput(db);
      await buildProductionOutputsService(db).update(60, { ...createDto, updatedAt: VERSION, items: [{ itemId: 1, quantity: 100 }] } as never, NO_COST, 3);
      expect(db.productionOutput.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 60, updatedAt: VERSION, status: 'DRAFT' } }));
      expect(db.productionOutput.update.mock.calls[0][0].data.items.create[0]).toEqual(expect.objectContaining({ quantity: 100, unitCost: 18000, costIsEstimated: true }));
    });

    it('refuses to edit or delete a POSTED output', async () => {
      const db = createInventoryDb();
      mockOutput(db, draftOutput({ status: 'POSTED', outputNumber: 'PRD-1405-000001' }));
      const service = buildProductionOutputsService(db);
      await expect(service.update(60, { ...createDto, updatedAt: VERSION } as never, COST, 3)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(60, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.productionOutputItem.deleteMany).not.toHaveBeenCalled();
      expect(db.productionOutput.delete).not.toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('locks, claims PRD-1405-000001, writes PRODUCTION_OUTPUT ON_HAND +q with unitCost, marks POSTED, audits', async () => {
      const db = createInventoryDb();
      mockOutput(db);

      const result: any = await buildProductionOutputsService(db).post(60, VERSION, COST, 3, '127.0.0.1');

      expect((db.$queryRaw.mock.calls[0][0] as string[]).join('?')).toContain('FROM production_outputs WHERE id = ? FOR UPDATE');
      expect(result).toEqual(expect.objectContaining({ status: 'POSTED', outputNumber: 'PRD-1405-000001', postedByUserId: 3 }));
      expect(balanceOf(db, 1)).toEqual({ onHand: '120', reserved: '0', qc: '0' });
      expect(db.state.movements).toEqual([
        expect.objectContaining({
          itemId: 1,
          bucket: 'ON_HAND',
          movementType: 'PRODUCTION_OUTPUT',
          referenceType: 'PRODUCTION_OUTPUT',
          referenceId: 60,
          referenceLineId: 201,
          referenceNumber: 'PRD-1405-000001',
          movementDate: ADJ_DATE,
          createdByUserId: 3,
        }),
      ]);
      expect(db.state.movements[0].unitCost.toString()).toBe('18000');
      expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PRODUCTION_OUTPUT_POSTED', details: expect.stringContaining('PRD-1405-000001') }) });
    });

    it('batch-tracked finished good: creates the batch, defaults its production date to the header and derives expiry from shelf life', async () => {
      const db = createInventoryDb();
      trackItem(db, 1, { expiryRequired: true, shelfLifeDays: 21 });
      const current = mockOutput(db, draftOutput({ items: [line({ batchNumber: 'P-۷۷' })] }));

      await buildProductionOutputsService(db).post(60, VERSION, COST, 3);

      expect(db.state.batches).toEqual([
        expect.objectContaining({ id: 1, itemId: 1, batchNumber: 'P-77', productionDate: ADJ_DATE, expiryDate: new Date(ADJ_DATE.getTime() + 21 * MS_PER_DAY) }),
      ]);
      expect(db.state.movements[0].batchId).toBe(1);
      expect(db.state.batchBalances[0].onHand.toString()).toBe('120');
      expect(current().items[0]).toEqual(expect.objectContaining({ batchId: 1, batchNumber: 'P-77' }));
    });

    it('matches an existing lot of the same item instead of creating a second one', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      seedBatch(db, { itemId: 1, batchNumber: 'P-1', productionDate: ADJ_DATE, onHand: 0 });
      mockOutput(db, draftOutput({ items: [line({ batchNumber: 'P-1' })] }));
      await buildProductionOutputsService(db).post(60, VERSION, COST, 3);
      expect(db.state.batches).toHaveLength(1);
      expect(db.state.movements[0].batchId).toBe(1);
    });

    it('rejects at posting a line whose item is no longer FINISHED_GOOD — nothing written, no number burned', async () => {
      const db = createInventoryDb();
      setItemKind(db, 1, 'RAW_MATERIAL');
      mockOutput(db);
      await expect(buildProductionOutputsService(db).post(60, VERSION, COST, 3)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ITEM_KIND_NOT_ALLOWED' }),
      });
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });

    it('rejects at posting a tracked item without a lot number (converted after the draft was saved)', async () => {
      const db = createInventoryDb();
      trackItem(db, 1);
      mockOutput(db);
      await expect(buildProductionOutputsService(db).post(60, VERSION, COST, 3)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.sequences.size).toBe(0);
    });

    it('refuses an already-POSTED output, a stale version and an inactive location', async () => {
      const db = createInventoryDb();
      const service = buildProductionOutputsService(db);
      mockOutput(db, draftOutput({ status: 'POSTED', outputNumber: 'PRD-1405-000001' }));
      await expect(service.post(60, VERSION, COST, 3)).rejects.toBeInstanceOf(ConflictException);

      mockOutput(db);
      await expect(service.post(60, new Date('2020-01-01'), COST, 3)).rejects.toMatchObject({ response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }) });

      mockOutput(db, draftOutput({ location: { isActive: false } }));
      await expect(service.post(60, VERSION, COST, 3)).rejects.toBeInstanceOf(ConflictException);
      expect(db.state.movements).toHaveLength(0);
    });

    it('two outputs posted one after another get consecutive numbers', async () => {
      const db = createInventoryDb();
      const service = buildProductionOutputsService(db);
      mockOutput(db);
      await service.post(60, VERSION, COST, 3);
      mockOutput(db, draftOutput({ id: 61, items: [line({ id: 211 })] }));
      const second: any = await service.post(61, VERSION, COST, 3);
      expect(second.outputNumber).toBe('PRD-1405-000002');
      expect(balanceOf(db, 1)?.onHand).toBe('240');
    });
  });
});

describe('ProductionOutputsController — permission gates (I5)', () => {
  const proto = ProductionOutputsController.prototype;
  it('reads need inventory.view; writes and the form pickers need inventory.receive', () => {
    for (const method of [proto.list, proto.get]) expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.view']);
    for (const method of [proto.create, proto.update, proto.post, proto.remove, proto.formOptions]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['inventory.receive']);
    }
  });
});
