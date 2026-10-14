import { Prisma } from '@prisma/client';
import { archiveDeletedRecord, retentionDays, toSnapshot } from './deleted-records';
import { DeletedRecordsService } from './deleted-records.service';

describe('deleted-records snapshots', () => {
  it('serialises Decimals/Dates and masks sensitive keys at any depth', () => {
    const snapshot = toSnapshot({
      id: 1,
      nationalId: '0012345678',
      total: new Prisma.Decimal('12.50'),
      when: new Date('2026-10-13T00:00:00.000Z'),
      nested: { shebaNumber: 'IR000', note: null, nationalId: null },
    });
    expect(snapshot).toEqual({ id: 1, nationalId: '***', total: '12.5', when: '2026-10-13T00:00:00.000Z', nested: { shebaNumber: '***', note: null, nationalId: null } });
  });

  it('writes the snapshot with a 90-day expiry by default, honouring DMS_DELETED_RECORD_RETENTION_DAYS', async () => {
    const create = jest.fn();
    await archiveDeletedRecord({ deletedRecord: { create } } as never, { entityType: 'Purchase', entityId: 5, label: 'PUR-000005', record: { id: 5 }, userId: 2 });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ entityType: 'Purchase', entityId: 5, label: 'PUR-000005', deletedByUserId: 2, snapshot: { id: 5 } });
    expect(Math.round((data.expiresAt.getTime() - data.deletedAt.getTime()) / 86_400_000)).toBe(90);

    process.env.DMS_DELETED_RECORD_RETENTION_DAYS = '30';
    expect(retentionDays()).toBe(30);
    process.env.DMS_DELETED_RECORD_RETENTION_DAYS = 'abc';
    expect(retentionDays()).toBe(90);
    delete process.env.DMS_DELETED_RECORD_RETENTION_DAYS;
  });

  it('purges only expired rows and lists/reads only unexpired ones', async () => {
    const prisma = {
      deletedRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }), count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new DeletedRecordsService(prisma as never);
    const now = new Date('2026-10-13');
    await expect(service.purgeExpired(now)).resolves.toBe(3);
    expect(prisma.deletedRecord.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
    await service.list({ page: 1, pageSize: 20 });
    expect(prisma.deletedRecord.findMany.mock.calls[0][0].where.expiresAt).toHaveProperty("gt");
    await expect(service.get(9)).rejects.toThrow();
  });
});
