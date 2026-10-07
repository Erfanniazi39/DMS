import { Prisma } from '@prisma/client';
import { AuditService, MASKED_AUDIT_VALUE, diffChanges } from './audit.service';

// The single AUDIT_LOG writer — rows must stay exactly what the old
// per-module writeAuditLog() helpers produced.

function createPrismaMock() {
  return { auditLog: { create: jest.fn(), findMany: jest.fn() } };
}

describe('AuditService', () => {
  it('writes an entity entry with the entity id as a string, plus details and ip', async () => {
    const prisma = createPrismaMock();
    const service = new AuditService(prisma as never);

    await service.log({ userId: 9, ipAddress: '127.0.0.1', action: 'PURCHASE_DELETED', entityType: 'Purchase', entityId: 12, details: 'PUR-000012' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 9,
        action: 'PURCHASE_DELETED',
        entityType: 'Purchase',
        entityId: '12',
        details: 'PUR-000012',
        ipAddress: '127.0.0.1',
      },
    });
  });

  // Moved from auth.service.spec.ts along with AuthService.writeAuditLog().
  it('writes an audit log entry with a null userId for an anonymous/failed-login event', async () => {
    const prisma = createPrismaMock();
    const service = new AuditService(prisma as never);

    await service.log({ userId: null, action: 'LOGIN_FAILED:admin:invalid_password', ipAddress: '127.0.0.1' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: undefined, action: 'LOGIN_FAILED:admin:invalid_password', ipAddress: '127.0.0.1' },
    });
    // No entity columns at all for auth events.
    expect(prisma.auditLog.create.mock.calls[0][0].data).not.toHaveProperty('entityType');
    expect(prisma.auditLog.create.mock.calls[0][0].data).not.toHaveProperty('entityId');
  });

  it('listRecent filters by entity type, newest first, limited, and never selects ipAddress', async () => {
    const prisma = createPrismaMock();
    const service = new AuditService(prisma as never);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.listRecent({ entityTypes: ['Purchase', 'PurchaseRequest'], limit: 10 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: { in: ['Purchase', 'PurchaseRequest'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
    );
    expect(prisma.auditLog.findMany.mock.calls[0][0].select).not.toHaveProperty('ipAddress');
  });

  it('writes field-level changes only when given a non-empty array', async () => {
    const prisma = createPrismaMock();
    const service = new AuditService(prisma as never);

    await service.log({ userId: 1, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: 3, changes: [{ field: 'legalName', from: 'a', to: 'b' }] });
    await service.log({ userId: 1, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: 3, changes: [] });

    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual([{ field: 'legalName', from: 'a', to: 'b' }]);
    expect(prisma.auditLog.create.mock.calls[1][0].data).not.toHaveProperty('changes');
  });

  it('listForEntity reads one record\'s history newest first, with changes, never ipAddress', async () => {
    const prisma = createPrismaMock();
    const service = new AuditService(prisma as never);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.listForEntity('Customer', 7);

    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ entityType: 'Customer', entityId: '7' });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.select.changes).toBe(true);
    expect(args.select).not.toHaveProperty('ipAddress');
  });
});

describe('diffChanges', () => {
  it('lists only changed fields, normalizing undefined/null, dates and decimals', () => {
    const changes = diffChanges(
      { a: 'x', b: null, c: new Date('2026-01-01T00:00:00Z'), d: new Prisma.Decimal(100) },
      { a: 'x', b: undefined, c: new Date('2026-01-02T00:00:00Z'), d: new Prisma.Decimal(200) },
      ['a', 'b', 'c', 'd'],
    );
    expect(changes).toEqual([
      { field: 'c', from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
      { field: 'd', from: '100', to: '200' },
    ]);
  });

  it('never records the value of a masked field — only that it changed', () => {
    expect(diffChanges({ nationalId: null }, { nationalId: '0012345678' }, ['nationalId'], { masked: ['nationalId'] })).toEqual([
      { field: 'nationalId', from: null, to: MASKED_AUDIT_VALUE },
    ]);
    expect(diffChanges({ nationalId: '1111111111' }, { nationalId: '2222222222' }, ['nationalId'], { masked: ['nationalId'] })).toEqual([
      { field: 'nationalId', from: MASKED_AUDIT_VALUE, to: MASKED_AUDIT_VALUE },
    ]);
  });
});
