import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { MASKED_AUDIT_VALUE } from '../audit/audit.service';
import { CUSTOMER_POSSIBLE_DUPLICATE } from './customers.service';
import { buildCustomersService, createPrismaMock, detailRow, validCreateDto, VERSION, type PrismaMock } from './customers.spec-helpers';

function mockActiveReferences(prisma: PrismaMock) {
  prisma.customerGroup.findUnique.mockResolvedValue({ id: 1, isActive: true });
  prisma.territory.findUnique.mockResolvedValue({ id: 2, isActive: true });
}

async function conflictBody(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse() as Record<string, any>;
  }
  throw new Error('expected a ConflictException');
}

describe('CustomersService', () => {
  describe('list', () => {
    it('hides ARCHIVED customers by default and returns a plain array without pagination', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findMany.mockResolvedValue([
        { id: 1, name: 'الف', nationalId: '10101010101', legacyCustomerType: 'retail', legacyAddress: null, legacyNote: null, addresses: [], notes: [], financialProfile: { creditHold: false } },
      ]);

      const result = (await service.list()) as any[];

      const args = prisma.customer.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ AND: [{ status: { notIn: ['ARCHIVED'] } }] });
      expect(prisma.customer.count).not.toHaveBeenCalled();
      expect(result[0]).toMatchObject({ id: 1, defaultCity: null, hasPinnedWarning: false, creditHold: false });
      // Legacy safety-net columns are never sent to the client.
      expect(result[0]).not.toHaveProperty('legacyCustomerType');
      expect(result[0]).not.toHaveProperty('legacyAddress');
      expect(result[0]).not.toHaveProperty('nationalId');
    });

    it('status=ALL includes archived; an explicit status/group/territory/kind filters exactly', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);

      await service.list({ status: 'ALL' });
      expect(prisma.customer.findMany.mock.calls[0][0].where).toEqual({});

      await service.list({ status: 'ARCHIVED', customerGroupId: 1, territoryId: 2, customerKind: 'INDIVIDUAL' });
      expect(prisma.customer.findMany.mock.calls[1][0].where).toEqual({
        AND: [{ status: 'ARCHIVED' }, { customerGroupId: 1 }, { territoryId: 2 }, { customerKind: 'INDIVIDUAL' }],
      });
    });

    it('derives defaultCity (DELIVERY default first), the pinned-warning flag and credit hold', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 1,
          addresses: [{ city: 'کرج', addressType: 'BILLING' }, { city: 'تهران', addressType: 'DELIVERY' }],
          notes: [{ id: 9 }],
          financialProfile: { creditHold: true },
        },
      ]);

      const [row] = (await service.list()) as any[];
      expect(row).toMatchObject({ defaultCity: 'تهران', hasPinnedWarning: true, creditHold: true });
      expect(row).not.toHaveProperty('addresses');
      expect(row).not.toHaveProperty('financialProfile');
    });

    it('a search runs the normalized raw-SQL id lookup and restricts to those ids', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.$queryRaw.mockResolvedValue([{ id: 3 }, { id: 8 }]);

      await service.list({ q: 'علي ۱۲' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Tagged template: (strings, ...values). ي→ی, ۱۲→12, space removed —
      // matched as a bound LIKE parameter, never spliced into the SQL.
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain('%علی12%');
      expect(prisma.customer.findMany.mock.calls[0][0].where.AND[0]).toEqual({ id: { in: [3, 8] } });
    });

    it('a query that normalizes to nothing applies no search filter', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      await service.list({ q: '‌' });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('escapes LIKE wildcards in the search text', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      await service.list({ q: '50%_off' });
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain('%50\\%\\_off%');
    });

    it('returns one page plus the total when paginated', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.count.mockResolvedValue(45);

      await expect(service.list({}, { page: 3, pageSize: 20 })).resolves.toEqual({ items: [], total: 45, page: 3, pageSize: 20 });
      expect(prisma.customer.findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
    });
  });

  describe('get', () => {
    it('returns the detail without legacy columns or the raw financial profile, with a two-flag financial summary', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ ...detailRow, financialProfile: { creditHold: true, paymentTermId: 4 } });

      const result = await service.get(5);

      expect(result.financialSummary).toEqual({ creditHold: true, hasPaymentTerm: true });
      expect(result).not.toHaveProperty('financialProfile');
      expect(result).not.toHaveProperty('legacyCustomerType');
    });

    it('404s for an unknown id', async () => {
      const prisma = createPrismaMock();
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(buildCustomersService(prisma).get(99)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('masks nationalId for a caller without customers.manage/customers.finance, and shows it in full otherwise', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ ...detailRow, nationalId: '10101010101' });

      const masked = await service.get(5, { canViewSensitive: false });
      expect(masked.nationalId).toBe(MASKED_AUDIT_VALUE);

      const full = await service.get(5, { canViewSensitive: true });
      expect(full.nationalId).toBe('10101010101');
    });

    it('leaves a null nationalId as null regardless of permission', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ ...detailRow, nationalId: null });

      const result = await service.get(5, { canViewSensitive: false });
      expect(result.nationalId).toBeNull();
    });
  });

  describe('create', () => {
    it('generates CUS-<id> (placeholder-then-fix), creates the empty financial profile, and audits — in one transaction', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.create.mockResolvedValue({ id: 75 });
      prisma.customer.findUnique.mockResolvedValue({ ...detailRow, id: 75 });

      await service.create(validCreateDto as never, 7, '127.0.0.1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = prisma.customer.create.mock.calls[0][0].data;
      expect(data.customerNumber).toMatch(/^PENDING-/);
      expect(data.status).toBe('ACTIVE');
      expect(data.createdByUserId).toBe(7);
      expect(data.financialProfile).toEqual({ create: {} });
      expect(data).not.toHaveProperty('addresses');
      expect(data).not.toHaveProperty('contacts');
      expect(prisma.customer.update).toHaveBeenCalledWith({ where: { id: 75 }, data: { customerNumber: 'CUS-000075' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 7, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: '75', details: 'CUS-000075' }),
      });
    });

    it('saves the optional first address as default and the first contact as primary', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.create.mockResolvedValue({ id: 75 });
      prisma.customer.findUnique.mockResolvedValue(detailRow);

      await service.create({
        ...validCreateDto,
        firstAddress: { addressType: 'DELIVERY', addressLine: 'خیابان آزادی' },
        firstContact: { name: 'آقای احمدی' },
      } as never);

      const data = prisma.customer.create.mock.calls[0][0].data;
      expect(data.addresses).toEqual({ create: { addressType: 'DELIVERY', addressLine: 'خیابان آزادی', isDefault: true } });
      expect(data.contacts).toEqual({ create: { name: 'آقای احمدی', isPrimary: true } });
    });

    it('hard-blocks an exact nationalId match (409), even with acknowledgeDuplicates', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.findUnique.mockResolvedValue({ id: 3, customerNumber: 'CUS-000003' });

      await expect(
        service.create({ ...validCreateDto, nationalId: '10101010101', acknowledgeDuplicates: true } as never),
      ).rejects.toThrow('مشتری دیگری (CUS-000003) با همین شناسه/کد ملی ثبت شده است');
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('a same-name or same-phone match is a structured soft-warning 409 listing the candidates', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.$queryRaw.mockResolvedValue([
        { id: 3, name_match: true, phone_match: false },
        { id: 4, name_match: false, phone_match: true },
      ]);
      prisma.customer.findMany.mockResolvedValue([
        { id: 3, customerNumber: 'CUS-000003', name: 'شرکت نمونه', status: 'ACTIVE' },
        { id: 4, customerNumber: 'CUS-000004', name: 'دیگری', status: 'ARCHIVED' },
      ]);

      const body = await conflictBody(service.create(validCreateDto as never));

      expect(body.code).toBe(CUSTOMER_POSSIBLE_DUPLICATE);
      expect(body.details.candidates).toEqual([
        { id: 3, customerNumber: 'CUS-000003', name: 'شرکت نمونه', status: 'ACTIVE', matchedOn: ['name'] },
        { id: 4, customerNumber: 'CUS-000004', name: 'دیگری', status: 'ARCHIVED', matchedOn: ['phone'] },
      ]);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    // Regression for the replaced CustomersService.ensureUnique(): a duplicate
    // name used to be a hard block; it is now allowed once acknowledged.
    it('creates despite a name/phone match when acknowledgeDuplicates is true, without even querying for candidates', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.create.mockResolvedValue({ id: 76 });
      prisma.customer.findUnique.mockResolvedValue(detailRow);

      await service.create({ ...validCreateDto, acknowledgeDuplicates: true } as never, 1);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.customer.create).toHaveBeenCalled();
      expect(prisma.auditLog.create.mock.calls[0][0].data.details).toContain('با تأیید هشدار مشتری مشابه');
    });

    it('rejects an inactive customer group or territory', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customerGroup.findUnique.mockResolvedValue({ id: 1, isActive: false });
      await expect(service.create(validCreateDto as never)).rejects.toThrow('گروه مشتری انتخاب‌شده معتبر یا فعال نیست');

      prisma.customerGroup.findUnique.mockResolvedValue({ id: 1, isActive: true });
      prisma.territory.findUnique.mockResolvedValue(null);
      await expect(service.create({ ...validCreateDto, territoryId: 2 } as never)).rejects.toThrow('منطقهٔ فروش انتخاب‌شده معتبر یا فعال نیست');
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('turns a racing national_id unique violation into a Persian 409', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x', meta: { target: ['national_id'] } }),
      );

      await expect(service.create({ ...validCreateDto, nationalId: '10101010101' } as never)).rejects.toThrow('مشتری دیگری با همین شناسه/کد ملی ثبت شده است');
    });
  });

  describe('update', () => {
    const existing = {
      id: 5,
      customerNumber: 'CUS-000005',
      customerKind: 'ORGANIZATION',
      name: 'شرکت نمونه',
      legalName: null,
      nationalId: '11111111111',
      economicCode: null,
      phone: '02112345678',
      email: 'a@b.com',
      customerGroupId: 1,
      territoryId: null,
      updatedAt: VERSION,
    };
    const dto = { ...validCreateDto, nationalId: '22222222222', legalName: 'شرکت نمونه سهامی خاص', updatedAt: VERSION };

    it('compare-and-sets on updatedAt, clears omitted optionals, and audits field changes with nationalId masked', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.findUnique
        .mockResolvedValueOnce(existing) // findRaw
        .mockResolvedValueOnce(null) // nationalId free
        .mockResolvedValueOnce(detailRow); // get()

      await service.update(5, dto as never, 3);

      expect(prisma.customer.updateMany).toHaveBeenCalledWith({ where: { id: 5, updatedAt: VERSION }, data: { updatedAt: expect.any(Date) } });
      expect(prisma.customer.update.mock.calls[0][0].data).toMatchObject({ email: null, economicCode: null, territoryId: null, legalName: 'شرکت نمونه سهامی خاص' });
      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('CUSTOMER_UPDATED');
      expect(audit.changes).toEqual([
        { field: 'legalName', from: null, to: 'شرکت نمونه سهامی خاص' },
        { field: 'nationalId', from: MASKED_AUDIT_VALUE, to: MASKED_AUDIT_VALUE },
      ]);
      expect(JSON.stringify(audit)).not.toContain('22222222222');
      expect(JSON.stringify(audit)).not.toContain('11111111111');
    });

    it('a stale updatedAt is a RECORD_MODIFIED 409 before anything is written', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ ...existing, updatedAt: new Date('2026-02-02') });

      const body = await conflictBody(service.update(5, dto as never));
      expect(body.code).toBe(RECORD_MODIFIED_CODE);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('a lost compare-and-set race inside the transaction is also RECORD_MODIFIED', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      mockActiveReferences(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      prisma.customer.updateMany.mockResolvedValue({ count: 0 });

      const body = await conflictBody(service.update(5, dto as never));
      expect(body.code).toBe(RECORD_MODIFIED_CODE);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('keeps a since-deactivated group it already has; only a changed group is re-checked', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customerGroup.findUnique.mockResolvedValue({ id: 1, isActive: false });
      prisma.customer.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(detailRow);

      await service.update(5, { ...dto, nationalId: existing.nationalId } as never);
      expect(prisma.customerGroup.findUnique).not.toHaveBeenCalled();
    });

    it('hard-blocks changing nationalId to one another customer has', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce({ id: 9, customerNumber: 'CUS-000009' });

      await expect(service.update(5, dto as never)).rejects.toThrow('CUS-000009');
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    const active = { id: 5, status: 'ACTIVE', statusReason: null, updatedAt: VERSION };

    it('suspends with a reason, stamps statusChangedAt, and audits the change', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(active).mockResolvedValueOnce(detailRow);

      await service.changeStatus(5, { status: 'SUSPENDED', reason: 'بدهی معوق', updatedAt: VERSION }, { canArchive: false }, 2);

      expect(prisma.customer.updateMany).toHaveBeenCalledWith({ where: { id: 5, updatedAt: VERSION }, data: { updatedAt: expect.any(Date) } });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: 'SUSPENDED', statusReason: 'بدهی معوق', statusChangedAt: expect.any(Date) },
      });
      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('CUSTOMER_STATUS_CHANGED');
      expect(audit.changes).toEqual([
        { field: 'status', from: 'ACTIVE', to: 'SUSPENDED' },
        { field: 'statusReason', from: null, to: 'بدهی معوق' },
      ]);
    });

    it('archiving or unarchiving requires customers.archive (403 otherwise)', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(active);
      await expect(
        service.changeStatus(5, { status: 'ARCHIVED', reason: 'تعطیل', updatedAt: VERSION }, { canArchive: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prisma.customer.findUnique.mockResolvedValueOnce({ ...active, status: 'ARCHIVED' });
      await expect(service.changeStatus(5, { status: 'ACTIVE', updatedAt: VERSION }, { canArchive: false })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('archive / unarchive with customers.archive are audited as their own actions', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(active).mockResolvedValueOnce(detailRow);
      await service.changeStatus(5, { status: 'ARCHIVED', reason: 'تعطیل', updatedAt: VERSION }, { canArchive: true });
      prisma.customer.findUnique.mockResolvedValueOnce({ ...active, status: 'ARCHIVED' }).mockResolvedValueOnce(detailRow);
      await service.changeStatus(5, { status: 'ACTIVE', updatedAt: VERSION }, { canArchive: true });

      expect(prisma.auditLog.create.mock.calls.map((call: any[]) => call[0].data.action)).toEqual(['CUSTOMER_ARCHIVED', 'CUSTOMER_UNARCHIVED']);
    });

    it('a move to the same status is refused', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce(active);
      await expect(service.changeStatus(5, { status: 'ACTIVE', updatedAt: VERSION }, { canArchive: true })).rejects.toThrow('از «فعال» به «فعال» مجاز نیست');
    });

    it('a stale version or a lost race is RECORD_MODIFIED', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValueOnce({ ...active, updatedAt: new Date('2026-03-03') });
      expect((await conflictBody(service.changeStatus(5, { status: 'INACTIVE', updatedAt: VERSION }, { canArchive: false }))).code).toBe(RECORD_MODIFIED_CODE);

      prisma.customer.findUnique.mockResolvedValueOnce(active);
      prisma.customer.updateMany.mockResolvedValue({ count: 0 });
      expect((await conflictBody(service.changeStatus(5, { status: 'INACTIVE', updatedAt: VERSION }, { canArchive: false }))).code).toBe(RECORD_MODIFIED_CODE);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const counts = { contacts: 0, addresses: 0, notes: 0, documents: 0, complaints: 0 };

    it('deletes a customer with no child records (and its financial profile), and audits', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ id: 5, customerNumber: 'CUS-000005', _count: counts });

      await expect(service.remove(5, 1)).resolves.toEqual({ success: true });
      expect(prisma.customerFinancialProfile.deleteMany).toHaveBeenCalledWith({ where: { customerId: 5 } });
      expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_DELETED', entityId: '5', details: 'CUS-000005' }) });
    });

    it.each(['contacts', 'addresses', 'notes', 'documents', 'complaints'])('refuses when the customer has %s — archive instead', async (child) => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ id: 5, _count: { ...counts, [child]: 1 } });

      await expect(service.remove(5)).rejects.toThrow('بایگانی کنید');
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });

    it('turns the sales-order FK violation (P2003) into a Persian 409, not a raw 500', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ id: 5, customerNumber: 'CUS-000005', _count: counts });
      prisma.customer.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }));

      await expect(service.remove(5, 1)).rejects.toThrow('اسناد فروش');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('404s for an unknown customer', async () => {
      const prisma = createPrismaMock();
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(buildCustomersService(prisma).remove(9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('history', () => {
    it('reads the customer\'s audit entries; financial diffs are hidden without customers.finance', async () => {
      const prisma = createPrismaMock();
      const service = buildCustomersService(prisma);
      prisma.customer.findUnique.mockResolvedValue({ id: 5 });
      const entries = [
        { id: 2, action: 'CUSTOMER_FINANCIAL_UPDATED', changes: [{ field: 'creditLimit', from: null, to: '1000' }] },
        { id: 1, action: 'CUSTOMER_UPDATED', changes: [{ field: 'legalName', from: null, to: 'x' }] },
      ];
      prisma.auditLog.findMany.mockResolvedValue(entries);

      const hidden = await service.history(5, { canViewFinance: false });
      expect(hidden[0].changes).toBeNull();
      expect(hidden[1].changes).toEqual(entries[1].changes);
      expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({ entityType: 'Customer', entityId: '5' });

      const shown = await service.history(5, { canViewFinance: true });
      expect(shown[0].changes).toEqual(entries[0].changes);
    });
  });
});
