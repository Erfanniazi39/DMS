import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CreatePurchaseDto, UpdatePurchaseDto } from './dto/purchase.dto';
import {
  baseItems,
  buildPurchasesService,
  createPrismaMock,
  createPurchaseRequestsServiceMock,
  fullGet,
  mockActiveMasterData,
  VERSION,
  type PrismaMock,
} from './purchases.spec-helpers';

// Covers the "Professionalize the Purchase module" architecture task —
// Purchase Request is optional, historical imports never fabricate a
// department/buyer/request, payment status is always derived (never set
// directly), and every listed business event writes one AUDIT_LOG row.
//
// This file: the purchase lifecycle (PurchasesService — list/get/create/
// update/remove). Payments, documents and returns have their own specs
// (purchase-payments/-documents/-returns.service.spec.ts); shared fixtures
// live in purchases.spec-helpers.ts.

describe('PurchasesService', () => {
  // --- 1 & 4. Create Purchase without / with a Purchase Request ----------

  it('creates a Purchase without a Purchase Request (most purchases have none)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5, purchaseNumber: 'PUR-000005', purchaseRequestId: null });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result).toEqual({ id: 5, purchaseNumber: 'PUR-000005', purchaseRequestId: null });
    expect(prisma.purchaseRequest.findUnique).not.toHaveBeenCalled();
    const createData = prisma.purchase.create.mock.calls[0][0].data;
    expect(createData.purchaseRequestId).toBeUndefined();
    expect(createData.sourceType).toBe('OPERATIONAL');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_CREATED', entityId: '5' }) }),
    );
  });

  it('creates a Purchase linked to an existing Purchase Request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6, purchaseNumber: 'PUR-000006', purchaseRequestId: 7 });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: baseItems,
    } as never;

    const result = await service.create(dto, 9, '127.0.0.1');

    expect(result.purchaseRequestId).toBe(7);
    expect(prisma.purchaseRequest.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(prisma.purchase.create.mock.calls[0][0].data.purchaseRequestId).toBe(7);
    // Creating a Purchase against a request lets the request re-derive its
    // own purchasing progress — see PurchaseRequestsService.recomputeStatus().
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
  });

  // --- Purchase Request → Purchase integration ----------------------------

  it('links a Purchase item to the specific Purchase Request item it fulfills, after validating it belongs to the same request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
    prisma.purchaseRequestItem.count.mockResolvedValue(1);
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6, purchaseNumber: 'PUR-000006', purchaseRequestId: 7 });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: [{ ...baseItems[0], quantity: 300 as never, purchaseRequestItemId: 55 }],
    } as never;

    await service.create(dto, 9, '127.0.0.1');

    expect(prisma.purchaseRequestItem.count).toHaveBeenCalledWith({ where: { id: { in: [55] }, purchaseRequestId: 7 } });
    expect(prisma.purchase.create.mock.calls[0][0].data.items.create[0].purchaseRequestItemId).toBe(55);
  });

  it('rejects a Purchase item whose purchaseRequestItemId does not belong to the request it is being attached to', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'APPROVED' });
    // The item exists, but not under request 7 — count comes back short.
    prisma.purchaseRequestItem.count.mockResolvedValue(0);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 7,
      note: undefined,
      items: [{ ...baseItems[0], purchaseRequestItemId: 999 }],
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('rejects a Purchase item that names a Purchase Request item without the Purchase itself being linked to any request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: undefined,
      note: undefined,
      items: [{ ...baseItems[0], purchaseRequestItemId: 55 }],
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    // The failure is specifically the item-link check, not some other
    // validator that happened to also throw — no lookup for a request item
    // that could never be valid without a purchaseRequestId was even made.
    expect(prisma.purchaseRequestItem.count).not.toHaveBeenCalled();
  });

  it('recomputes both the old and the new Purchase Request when editing a Purchase moves it from one request to another', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    const existing = {
      id: 8,
      status: 'CONFIRMED',
      paidAmount: 0,
      updatedAt: VERSION,
      purchaseType: {},
      requesterDepartment: null,
      buyerEmployee: null,
      purchaseRequest: { id: 7, requestNumber: 'REQ-000007' },
      supplier: {},
      items: [],
      payments: [],
      documents: [],
    };
    prisma.purchase.findUnique.mockResolvedValue(existing);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 12, status: 'APPROVED' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.update.mockResolvedValue({ id: 8, status: 'CONFIRMED', purchaseRequestId: 12 });

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      purchaseRequestId: 12,
      status: 'CONFIRMED' as never,
      updatedAt: VERSION,
      note: undefined,
      items: baseItems,
    } as never;

    await service.update(8, dto, 9, '127.0.0.1');

    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(12, 9, '127.0.0.1');
  });

  it('recomputes the linked Purchase Request after a Purchase is removed', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      purchaseRequestId: 7,
      _count: { payments: 0, documents: 0 },
    });

    await service.remove(8, 9, '127.0.0.1');

    expect(prisma.purchase.delete).toHaveBeenCalledWith({ where: { id: 8 } });
    expect(purchaseRequestsService.recomputeStatus).toHaveBeenCalledWith(7, 9, '127.0.0.1');
  });

  it('rejects a Purchase linked to a non-existent Purchase Request', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.department.findUnique.mockResolvedValue({ id: 2, status: 'active' });
    prisma.employee.findUnique.mockResolvedValue({ id: 3, status: 'active' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.purchaseRequest.findUnique.mockResolvedValue(null);

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2026-01-02') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      purchaseRequestId: 999,
      note: undefined,
      items: baseItems,
    } as never;

    await expect(service.create(dto, 9, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  // --- 5, 6 & 7. Historical purchases -------------------------------------

  it('creates a historical Purchase without a Purchase Request, department, or buyer — never fabricating any of them', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.create.mockResolvedValue({ id: 8 });
    prisma.purchase.update.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      sourceType: 'HISTORICAL_IMPORT',
      requesterDepartmentId: null,
      buyerEmployeeId: null,
      purchaseRequestId: null,
    });

    const dto: CreatePurchaseDto = {
      purchaseDate: new Date('2019-05-01') as never,
      purchaseTypeId: 1,
      sourceType: 'HISTORICAL_IMPORT' as never,
      requesterDepartmentId: undefined,
      buyerEmployeeId: undefined,
      supplierId: 4,
      purchaseRequestId: undefined,
      note: 'دیجیتال‌سازی سند کاغذی قدیمی',
      items: baseItems,
    } as never;

    const result = await service.create(dto, null, undefined);

    // Neither ensureDepartment nor ensureBuyerEmployee nor
    // ensurePurchaseRequest should even be consulted — nothing was fed a
    // fake id to validate.
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.findUnique).not.toHaveBeenCalled();
    const createData = prisma.purchase.create.mock.calls[0][0].data;
    expect(createData.requesterDepartmentId).toBeUndefined();
    expect(createData.buyerEmployeeId).toBeUndefined();
    expect(createData.sourceType).toBe('HISTORICAL_IMPORT');
    expect(result.sourceType).toBe('HISTORICAL_IMPORT');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'HISTORICAL_PURCHASE_IMPORTED' }) }),
    );
  });

  // --- 12. Audit logging on status change / cancellation -------------------

  it('logs PURCHASE_STATUS_CHANGED on a status change and PURCHASE_CANCELLED when cancelled, but never both for one update', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    const existing = {
      id: 8,
      status: 'CONFIRMED',
      paidAmount: 0,
      updatedAt: VERSION,
      purchaseType: {},
      requesterDepartment: null,
      buyerEmployee: null,
      purchaseRequest: null,
      supplier: {},
      items: [],
      payments: [],
      documents: [],
    };
    prisma.purchase.findUnique.mockResolvedValue(existing);
    prisma.purchaseType.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'active' });
    prisma.unit.count.mockResolvedValue(1);
    prisma.purchase.update.mockResolvedValue({ id: 8, status: 'RECEIVED' });

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      status: 'RECEIVED' as never,
      updatedAt: VERSION,
      note: undefined,
      items: baseItems,
    } as never;

    await service.update(8, dto, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_STATUS_CHANGED' }) }),
    );

    prisma.auditLog.create.mockClear();
    await service.update(8, { ...dto, status: 'CANCELLED' as never }, 9, '127.0.0.1');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_CANCELLED' }) }),
    );
  });

  it('refuses to edit a Purchase that has returns (its items would be recreated out from under them)', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, updatedAt: VERSION, purchaseRequest: null });
    prisma.purchaseReturn.count.mockResolvedValue(1);

    const dto: UpdatePurchaseDto = {
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      supplierId: 4,
      status: 'CLOSED' as never,
      updatedAt: VERSION,
      note: undefined,
      items: baseItems,
    } as never;

    await expect(service.update(8, dto, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a Purchase that has returns', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8,
      purchaseNumber: 'PUR-000008',
      purchaseRequestId: null,
      _count: { payments: 0, documents: 0, returns: 1 },
    });

    await expect(service.remove(8, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.delete).not.toHaveBeenCalled();
  });

  // --- 13 & 14. Reporting across historical + operational purchases -------

  it('lists both operational and historical purchases together when no sourceType filter is given (single Purchase table)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchase.findMany.mockResolvedValue([]);

    await service.list({});

    const whereArg = prisma.purchase.findMany.mock.calls[0][0].where;
    expect(whereArg.sourceType).toBeUndefined();
  });

  it('filters the purchase list by sourceType when requested (reports: all / operational / historical)', async () => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchase.findMany.mockResolvedValue([]);

    await service.list({ sourceType: 'HISTORICAL_IMPORT' });

    const whereArg = prisma.purchase.findMany.mock.calls[0][0].where;
    expect(whereArg.sourceType).toBe('HISTORICAL_IMPORT');
  });

  // --- Pagination (opt-in; plain array stays the default) -----------------

  it('returns one page of purchases plus the total matching count, keeping order and filters', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    const pageRows = [{ id: 30 }, { id: 29 }];
    prisma.purchase.findMany.mockResolvedValue(pageRows);
    prisma.purchase.count.mockResolvedValue(42);

    await expect(service.list({ status: 'DRAFT' }, { page: 2, pageSize: 20 })).resolves.toEqual({
      items: pageRows,
      total: 42,
      page: 2,
      pageSize: 20,
    });

    const findArgs = prisma.purchase.findMany.mock.calls[0][0];
    expect(findArgs).toMatchObject({ skip: 20, take: 20, orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }] });
    expect(findArgs.where.status).toBe('DRAFT');
    // Total is counted over the same filter, not the whole table.
    expect(prisma.purchase.count).toHaveBeenCalledWith({ where: findArgs.where });
  });

  it('returns the full plain array (no skip/take, no count) when pagination is not requested', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findMany.mockResolvedValue([{ id: 1 }]);

    await expect(service.list({})).resolves.toEqual([{ id: 1 }]);
    const findArgs = prisma.purchase.findMany.mock.calls[0][0];
    expect(findArgs.skip).toBeUndefined();
    expect(findArgs.take).toBeUndefined();
    expect(prisma.purchase.count).not.toHaveBeenCalled();
  });

  // --- 15. Existing Purchase records survive the migration -----------------

  it('backfills existing purchases with sourceType = OPERATIONAL and only relaxes department/buyer, touching nothing else', () => {
    const migrationPath = join(
      __dirname,
      '..',
      '..',
      'prisma',
      'migrations',
      '20260922150000_add_purchase_requests_and_source_type',
      'migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    // Every pre-existing row gets a real, non-null default — no purchase is
    // left with an unknown sourceType after the migration runs.
    expect(sql).toMatch(/ADD COLUMN "source_type" "PurchaseSourceType" NOT NULL DEFAULT 'OPERATIONAL'/);
    // purchase_request_id is added as nullable, never backfilled with a
    // fabricated request.
    expect(sql).toMatch(/ADD COLUMN "purchase_request_id" INTEGER;/);
    // Only these two columns lose their NOT NULL constraint — everything
    // else about the existing purchases table (purchaseNumber, items,
    // payments, documents, ...) is untouched by this migration.
    expect(sql).toMatch(/ALTER COLUMN "requester_department_id" DROP NOT NULL/);
    expect(sql).toMatch(/ALTER COLUMN "buyer_employee_id" DROP NOT NULL/);
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
  });

  // --- QA pass 2026-10-05: coverage gaps ------------------------------------

  const updateDto = (status: string, totalPrice: number): UpdatePurchaseDto =>
    ({
      purchaseDate: new Date('2026-01-01') as never,
      purchaseTypeId: 1,
      sourceType: 'OPERATIONAL' as never,
      requesterDepartmentId: 2,
      buyerEmployeeId: 3,
      supplierId: 4,
      status: status as never,
      updatedAt: VERSION,
      note: undefined,
      items: [{ name: 'شیر خام', quantity: 10 as never, unitId: 1, totalPrice: totalPrice as never }],
    }) as never;

  it.each([
    // [new item total, already paid, expected derived status]
    [20000000, 30000000, 'PAID'], // total lowered below what was paid
    [30000000, 30000000, 'PAID'], // exactly paid
    [30000001, 30000000, 'PARTIAL'], // total raised one Rial above paid
  ])('update(): re-derives paymentStatus from the new item total (%d) against the existing paidAmount (%d) → %s', async (total, paid, expected) => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: paid, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await service.update(8, updateDto('CONFIRMED', total), 9, undefined);

    const data = prisma.purchase.update.mock.calls[0][0].data;
    expect(data.totalAmount).toBe(total);
    expect(data.paymentStatus).toBe(expected);
    // paidAmount is owned by the payment recompute, never rewritten by an edit.
    expect(data).not.toHaveProperty('paidAmount');
  });

  it('create(): totalAmount is the sum of line totalPrice values — never quantity × unitPrice', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    mockActiveMasterData(prisma);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await service.create(
      {
        purchaseDate: new Date('2026-01-01') as never,
        purchaseTypeId: 1,
        sourceType: 'OPERATIONAL' as never,
        requesterDepartmentId: 2,
        buyerEmployeeId: 3,
        supplierId: 4,
        items: [
          // 10 × 1000 would be 10000, but a lump-sum discount was billed.
          { name: 'بطری پلاستیکی', quantity: 10 as never, unitId: 1, unitPrice: 1000 as never, totalPrice: 7500 as never },
          // No unit price at all — lump-sum line.
          { name: 'حمل شیر خام', quantity: 1 as never, unitId: 1, totalPrice: 2500 as never },
        ],
      } as never,
      9,
      undefined,
    );

    expect(prisma.purchase.create.mock.calls[0][0].data.totalAmount).toBe(10000);
    // The line items are stored exactly as entered — no recomputed totalPrice.
    expect(prisma.purchase.create.mock.calls[0][0].data.items.create[0].totalPrice).toBe(7500);
  });

  it.each([
    ['payments', { payments: 1, documents: 0, returns: 0 }],
    ['documents', { payments: 0, documents: 1, returns: 0 }],
  ])('refuses to delete a Purchase that has %s, without touching the row or the audit log', async (_label, counts) => {
    const prisma = createPrismaMock();
    const purchaseRequestsService = createPurchaseRequestsServiceMock();
    const service = buildPurchasesService(prisma, purchaseRequestsService);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, purchaseNumber: 'PUR-000008', purchaseRequestId: 7, _count: counts });

    await expect(service.remove(8, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.delete).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(purchaseRequestsService.recomputeStatus).not.toHaveBeenCalled();
  });

  it('logs PURCHASE_DELETED with the purchase number when an unencumbered purchase is removed', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, purchaseNumber: 'PUR-000008', purchaseRequestId: null, _count: { payments: 0, documents: 0, returns: 0 } });

    await service.remove(8, 9, '127.0.0.1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PURCHASE_DELETED', entityType: 'Purchase', entityId: '8', details: 'PUR-000008', userId: 9 }),
      }),
    );
  });

  // --- Regression tests for bugs found in QA 2026-10-05 --------------------
  // Originally `it.failing` (reproducing the bug); converted to plain `it`
  // once fixed so they stay in the suite permanently.

  it('KNOWN BUG: a purchase whose supplier was later deactivated can still be cancelled', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, supplierId: 4, ...fullGet });
    mockActiveMasterData(prisma);
    // Same supplier the purchase already had — it was blacklisted after the purchase was made.
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'blacklisted' });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await expect(service.update(8, updateDto('CANCELLED', 10000), 9, undefined)).resolves.toBeDefined();
  });

  it('KNOWN BUG: an inactive Unit is refused on a new purchase item', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    mockActiveMasterData(prisma);
    const units = [{ id: 1, isActive: false }];
    prisma.unit.count.mockImplementation(({ where }: { where: { id: { in: number[] }; isActive?: boolean } }) =>
      Promise.resolve(units.filter((u) => where.id.in.includes(u.id) && (where.isActive === undefined || u.isActive === where.isActive)).length),
    );
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await expect(
      service.create(
        {
          purchaseDate: new Date('2026-01-01') as never,
          purchaseTypeId: 1,
          sourceType: 'OPERATIONAL' as never,
          requesterDepartmentId: 2,
          buyerEmployeeId: 3,
          supplierId: 4,
          items: baseItems,
        } as never,
        9,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // --- More QA 2026-10-05 regression coverage ------------------------------

  it('get(): nested buyerEmployee/supplier expose display fields only (no national ID, salary, bank, contract path)', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, ...fullGet });

    await service.get(8);

    const include = prisma.purchase.findUnique.mock.calls[0][0].include;
    expect(include.supplier).toEqual({ select: { id: true, code: true, name: true } });
    expect(include.buyerEmployee).toEqual({
      select: { id: true, code: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
    });
  });

  it('create(): a line total sum beyond Decimal(15,0) is a 400, not a database 500', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    mockActiveMasterData(prisma);
    const line = { name: 'x', quantity: 1 as never, unitId: 1, totalPrice: 999_999_999_999_999 as never };

    await expect(
      service.create({ purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, items: [line, line] } as never, 9, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('update(): an unchanged purchase type / department / buyer is not re-validated, and units already on the purchase may stay even if deactivated', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({
      id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4,
      ...fullGet, items: [{ id: 1, unitId: 1 }],
    });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await service.update(8, updateDto('CANCELLED', 10000), 9, undefined);

    expect(prisma.purchaseType.findUnique).not.toHaveBeenCalled();
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
    expect(prisma.unit.count).not.toHaveBeenCalled();
  });

  it('update(): switching to a different, inactive supplier is still refused', async () => {
    const prisma = createPrismaMock();
    const service = buildPurchasesService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 99, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.supplier.findUnique.mockResolvedValue({ id: 4, status: 'blacklisted' });

    await expect(service.update(8, updateDto('CONFIRMED', 10000), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  // --- Business-owner decisions of 2026-10-05 -------------------------------

  const svc = (prisma: PrismaMock) => buildPurchasesService(prisma);

  // #5 Linking + overage confirmation
  const linkedCreateDto = (items: unknown[], extra: Record<string, unknown> = {}) =>
    ({ purchaseDate: new Date('2026-01-02'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, purchaseRequestId: 7, items, ...extra }) as never;

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED', 'COMPLETED'])('#5 refuses to link a new purchase to a %s request', async (status) => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status });

    await expect(svc(prisma).create(linkedCreateDto(baseItems), 9, undefined)).rejects.toThrow('خرید فقط به درخواست خرید «تأییدشده» یا «خرید جزئی» قابل اتصال است');
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('#5 an existing purchase keeps its (now COMPLETED) request on edit — only a new/changed link must be APPROVED/PARTIALLY_PURCHASED', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: 7, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'COMPLETED' });
    prisma.purchase.update.mockResolvedValue({ id: 8 });

    await expect(svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7 } as never, 9, undefined)).resolves.toBeDefined();

    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: null, ...fullGet });
    await expect(svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7 } as never, 9, undefined)).rejects.toBeInstanceOf(ConflictException);
  });

  function mockRequestLine(prisma: ReturnType<typeof createPrismaMock>, requested: number, purchasedElsewhere: number) {
    mockActiveMasterData(prisma);
    prisma.purchaseRequest.findUnique.mockResolvedValue({ id: 7, status: 'PARTIALLY_PURCHASED' });
    prisma.purchaseRequestItem.count.mockResolvedValue(1);
    prisma.purchaseRequestItem.findMany.mockResolvedValue([{ id: 55, name: 'شیر خام', quantity: requested }]);
    prisma.purchaseItem.groupBy.mockResolvedValue(purchasedElsewhere ? [{ purchaseRequestItemId: 55, _sum: { quantity: purchasedElsewhere } }] : []);
    prisma.purchase.create.mockResolvedValue({ id: 6 });
    prisma.purchase.update.mockResolvedValue({ id: 6 });
  }

  it('#5 buying more than the request line still needs is refused with a detectable PURCHASE_QUANTITY_EXCEEDS_REQUEST 409 listing each overage', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 60);
    const items = [{ ...baseItems[0], quantity: 50, purchaseRequestItemId: 55 }];

    const error = await svc(prisma).create(linkedCreateDto(items), 9, undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'PURCHASE_QUANTITY_EXCEEDS_REQUEST',
      details: { overages: [{ purchaseRequestItemId: 55, name: 'شیر خام', requested: 100, alreadyPurchased: 60, remaining: 40, purchasing: 50, excess: 10 }] },
    });
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('#5 the same overage is accepted once the user confirms it (confirmOverage: true); exactly the remaining quantity needs no confirmation', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 60);

    await expect(svc(prisma).create(linkedCreateDto([{ ...baseItems[0], quantity: 50, purchaseRequestItemId: 55 }], { confirmOverage: true }), 9, undefined)).resolves.toBeDefined();
    await expect(svc(prisma).create(linkedCreateDto([{ ...baseItems[0], quantity: 40, purchaseRequestItemId: 55 }]), 9, undefined)).resolves.toBeDefined();
  });

  it('#5 on update, the purchase being edited is excluded from "already purchased" (re-saving it never counts its own quantity twice)', async () => {
    const prisma = createPrismaMock();
    mockRequestLine(prisma, 100, 0);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, purchaseTypeId: 1, supplierId: 4, purchaseRequestId: 7, ...fullGet });

    await svc(prisma).update(8, { ...updateDto('CONFIRMED', 10000), purchaseRequestId: 7, items: [{ ...baseItems[0], quantity: 100, purchaseRequestItemId: 55 }] } as never, 9, undefined);

    expect(prisma.purchaseItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { purchaseRequestItemId: { in: [55] }, purchase: { status: { not: 'CANCELLED' }, id: { not: 8 } } } }),
    );
  });

  // #6 Zero total
  it('#6 refuses a purchase whose item totals sum to 0 (create and update)', async () => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    const zeroItems = [{ ...baseItems[0], totalPrice: 0 }];

    await expect(
      svc(prisma).create({ purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, items: zeroItems } as never, 9, undefined),
    ).rejects.toThrow('جمع مبلغ اقلام خرید باید بیشتر از صفر باشد');
    expect(prisma.purchase.create).not.toHaveBeenCalled();

    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet });
    await expect(svc(prisma).update(8, updateDto('CONFIRMED', 0), 9, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  // #10 Returns block cancelling too
  it('#10 a purchase with returns cannot be CANCELLED either (cancel goes through the same guarded update())', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'RECEIVED', paidAmount: 0, ...fullGet });
    prisma.purchaseReturn.count.mockResolvedValue(2);

    await expect(svc(prisma).update(8, updateDto('CANCELLED', 10000), 9, undefined)).rejects.toThrow(/برگشت به تأمین‌کننده ثبت شده است/);
    expect(prisma.purchase.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // #12 Optimistic locking
  it('#12 refuses an edit made against a stale version with a 409 RECORD_MODIFIED (never silently overwrites)', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet, updatedAt: new Date('2026-01-01T10:05:00.000Z') });
    mockActiveMasterData(prisma);

    const error = await svc(prisma).update(8, updateDto('CONFIRMED', 10000), 9, undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'RECORD_MODIFIED' });
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  it('#12 the version check is repeated atomically in the transaction (compare-and-set on updatedAt) — a save that lands in between loses', async () => {
    const prisma = createPrismaMock();
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, status: 'CONFIRMED', paidAmount: 0, ...fullGet });
    mockActiveMasterData(prisma);
    prisma.purchase.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc(prisma).update(8, updateDto('CONFIRMED', 10000), 9, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, updatedAt: VERSION } }));
    expect(prisma.purchaseItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  // --- New purchases default to CONFIRMED (business decision 2026-10-05) ---

  it.each(['CONFIRMED', 'DRAFT'])('create() writes the DTO\'s resolved status (%s) explicitly, never relying on the column default', async (status) => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    prisma.purchase.create.mockResolvedValue({ id: 5 });
    prisma.purchase.update.mockResolvedValue({ id: 5 });

    await svc(prisma).create(
      { purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, status, items: baseItems } as never,
      9,
      undefined,
    );

    expect(prisma.purchase.create.mock.calls[0][0].data.status).toBe(status);
  });

  it('create(): the zero-total rule still applies whatever creation status is chosen', async () => {
    const prisma = createPrismaMock();
    mockActiveMasterData(prisma);
    for (const status of ['CONFIRMED', 'DRAFT']) {
      await expect(
        svc(prisma).create(
          { purchaseDate: new Date('2026-01-01'), purchaseTypeId: 1, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, buyerEmployeeId: 3, supplierId: 4, status, items: [{ ...baseItems[0], totalPrice: 0 }] } as never,
          9,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });
});
