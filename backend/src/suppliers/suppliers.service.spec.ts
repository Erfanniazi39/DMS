import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { parsePagination } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { createSupplierSchema } from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';

function build(prisma: unknown) {
  return new SuppliersService(prisma as never, new AuditService(prisma as never));
}

function createPrismaMock() {
  const mock = {
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
    supplierBankAccount: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    supplierPurchaseType: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
    supplierGood: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
    purchaseType: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() },
  };
  // Transactions just invoke the callback with the mock itself.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock as never;
}

describe('SuppliersService', () => {
  it('lists suppliers ordered by name', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    const rows = [{ id: 1, code: 'SUP1', name: 'تأمین‌کننده یک', status: 'active', bankName: 'legacy', bankAccountNumber: '1', bankShebaNumber: 'x' }];
    (prisma as any).supplier.findMany.mockResolvedValue(rows);

    // The legacy bank_* columns are never sent to the client.
    await expect(service.list()).resolves.toEqual([{ id: 1, code: 'SUP1', name: 'تأمین‌کننده یک', status: 'active', purchaseTypes: [] }]);
    expect((prisma as any).supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
  });

  // --- Pagination (opt-in; the plain-array shape above stays the default) ---

  it('returns one page plus the total matching count when paginated', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    const pageRows = [{ id: 21, code: 'SUP21', name: 'ت ۲۱' }];
    (prisma as any).supplier.findMany.mockResolvedValue(pageRows);
    (prisma as any).supplier.count.mockResolvedValue(45);

    await expect(service.list({}, { page: 3, pageSize: 20 })).resolves.toEqual({ items: [{ ...pageRows[0], purchaseTypes: [] }], total: 45, page: 3, pageSize: 20 });
    // Page 3 of 20 → rows 41..60 → skip 40, take 20.
    expect((prisma as any).supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('applies the same search/status filter to both the page query and the total count', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
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
    const service = build(prisma);
    (prisma as any).supplier.findMany.mockResolvedValue([]);

    await expect(service.list()).resolves.toEqual([]);
    const args = (prisma as any).supplier.findMany.mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect((prisma as any).supplier.count).not.toHaveBeenCalled();
  });

  it('rejects an unknown status filter instead of passing it to the database', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);

    await expect(service.list({ status: 'bogus' })).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).supplier.findMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate code or name without creating a supplier', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findFirst.mockResolvedValue({ code: 'SUP1', name: 'تأمین‌کننده یک' });

    await expect(service.create({ code: 'SUP1', name: 'تأمین‌کننده یک' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).supplier.create).not.toHaveBeenCalled();
  });

  it('updates a supplier and its status while preserving the same record', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    const existing = { id: 2, code: 'SUP2', name: 'تأمین‌کننده دو', status: 'active' };
    const updated = { ...existing, status: 'inactive' };
    (prisma as any).supplier.findUnique.mockResolvedValue(existing);
    (prisma as any).supplier.findFirst.mockResolvedValue(null);
    (prisma as any).supplier.update.mockResolvedValue(updated);
    (prisma as any).supplier.findUnique.mockResolvedValueOnce(existing).mockResolvedValue(updated);

    await expect(
      service.update(2, { code: 'SUP2', name: 'تأمین‌کننده دو', status: 'inactive', purchaseTypeIds: [], goods: [] } as never, 1),
    ).resolves.toMatchObject({ id: 2, status: 'inactive', bankAccounts: [] });
    expect((prisma as any).supplier.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ status: 'inactive', phone: null }) }));
    // Audited, with the status change as a field diff.
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'SUPPLIER_UPDATED', entityId: '2' }) });
  });

  it('reports a missing supplier without modifying data', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findUnique.mockResolvedValue(null);

    await expect(service.update(999, { code: 'UNKNOWN', name: 'ناموجود', status: 'active' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((prisma as any).supplier.update).not.toHaveBeenCalled();
  });

  it('deletes an existing supplier with no purchase history', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 2 });
    (prisma as any).purchase.count.mockResolvedValue(0);

    await expect(service.remove(2)).resolves.toEqual({ success: true });
    expect((prisma as any).purchase.count).toHaveBeenCalledWith({ where: { supplierId: 2 } });
    expect((prisma as any).supplierBankAccount.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 2 } });
    expect((prisma as any).supplier.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it('rejects deleting a supplier that still has purchase history', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 2 });
    (prisma as any).purchase.count.mockResolvedValue(3);

    await expect(service.remove(2)).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).supplier.delete).not.toHaveBeenCalled();
  });
});

describe('SuppliersService — column sorting', () => {
  it('orders by the requested whitelisted column with an id tie-break, for the page query', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findMany.mockResolvedValue([]);
    (prisma as any).supplier.count.mockResolvedValue(0);

    await service.list({ sort: { sortBy: 'phone', sortDir: 'desc' } }, { page: 2, pageSize: 20 });

    expect((prisma as any).supplier.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ phone: 'desc' }, { id: 'asc' }], skip: 20, take: 20 });
  });

  it('rejects a column that is not sortable instead of passing it to the database', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    await expect(service.list({ sort: { sortBy: 'nationalId', sortDir: 'asc' } })).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma as any).supplier.findMany).not.toHaveBeenCalled();
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

describe('SuppliersService — party master data', () => {
  it('create stores the first bank account as default, audits, and returns the detail without legacy bank columns', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findFirst.mockResolvedValue(null);
    (prisma as any).supplier.create.mockResolvedValue({ id: 9, code: 'S9' });
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 9, code: 'S9', bankName: 'legacy' });

    const result = await service.create(
      { code: 'S9', name: 'n', supplierKind: 'ORGANIZATION', purchaseTypeIds: [], goods: [], firstBankAccount: { bankName: 'ملی', accountNumber: '1' } } as never,
      1,
    );
    const data = (prisma as any).supplier.create.mock.calls[0][0].data;
    expect(data.bankAccounts).toEqual({ create: { bankName: 'ملی', accountNumber: '1', isDefault: true } });
    expect(data).toMatchObject({ supplierKind: 'ORGANIZATION', nationalId: null, country: null });
    expect(result).not.toHaveProperty('bankName');
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'SUPPLIER_CREATED', entityId: '9' }) });
  });
});

describe('SuppliersService — purchase types and supplied goods', () => {
  it('create stores the purchase types and the ordered goods list; update replaces both', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findFirst.mockResolvedValue(null);
    (prisma as any).purchaseType.findMany.mockResolvedValue([{ id: 3, isActive: true }, { id: 4, isActive: true }]);
    (prisma as any).supplier.create.mockResolvedValue({ id: 9, code: 'S9' });
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 9, code: 'S9' });

    await service.create({ code: 'S9', name: 'n', purchaseTypeIds: [3, 4], goods: [{ name: 'شیر خام' }, { name: 'کارتن', note: '۱۲تایی' }] } as never, 1);
    const data = (prisma as any).supplier.create.mock.calls[0][0].data;
    expect(data.purchaseTypes).toEqual({ create: [{ purchaseTypeId: 3 }, { purchaseTypeId: 4 }] });
    expect(data.goods).toEqual({ create: [{ name: 'شیر خام', note: null, sortOrder: 1 }, { name: 'کارتن', note: '۱۲تایی', sortOrder: 2 }] });

    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 9, code: 'S9', name: 'n', status: 'active' });
    await service.update(9, { code: 'S9', name: 'n', status: 'active', purchaseTypeIds: [4], goods: [{ name: 'جدید' }] } as never, 1);
    expect((prisma as any).supplierPurchaseType.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 9 } });
    expect((prisma as any).supplierPurchaseType.createMany).toHaveBeenCalledWith({ data: [{ supplierId: 9, purchaseTypeId: 4 }] });
    expect((prisma as any).supplierGood.createMany).toHaveBeenCalledWith({ data: [{ supplierId: 9, name: 'جدید', note: null, sortOrder: 1 }] });
  });

  it('rejects an unknown or inactive purchase type, but keeps one the supplier already has', async () => {
    const prisma = createPrismaMock();
    const service = build(prisma);
    (prisma as any).supplier.findFirst.mockResolvedValue(null);
    (prisma as any).purchaseType.findMany.mockResolvedValue([{ id: 3, isActive: true }]);
    await expect(service.create({ code: 'S', name: 'n', purchaseTypeIds: [3, 99], goods: [] } as never)).rejects.toBeInstanceOf(ConflictException);

    (prisma as any).purchaseType.findMany.mockResolvedValue([{ id: 3, isActive: false }]);
    await expect(service.create({ code: 'S', name: 'n', purchaseTypeIds: [3], goods: [] } as never)).rejects.toBeInstanceOf(ConflictException);

    // Update where the supplier already has the (now inactive) type: allowed.
    (prisma as any).supplier.findUnique.mockResolvedValue({ id: 5, code: 'S', name: 'n', status: 'active' });
    (prisma as any).supplierPurchaseType.findMany.mockResolvedValue([{ purchaseTypeId: 3 }]);
    await expect(service.update(5, { code: 'S', name: 'n', status: 'active', purchaseTypeIds: [3], goods: [] } as never)).resolves.toBeDefined();
  });

  it('DTO: purchaseTypeIds default to [] and de-duplicate; goods need a name', () => {
    const base = { code: 'S', name: 'n', supplierKind: 'ORGANIZATION', nationalId: '10101010101', economicCode: '411234567890' };
    const parsed = createSupplierSchema.parse(base);
    expect(parsed.purchaseTypeIds).toEqual([]);
    expect(parsed.goods).toEqual([]);
    expect(createSupplierSchema.parse({ ...base, purchaseTypeIds: [2, 2, 5] }).purchaseTypeIds).toEqual([2, 5]);
    expect(createSupplierSchema.safeParse({ ...base, goods: [{ name: '  ' }] }).success).toBe(false);
  });
});
