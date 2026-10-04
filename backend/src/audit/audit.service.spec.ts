import { AuditService } from './audit.service';

// The single AUDIT_LOG writer — rows must stay exactly what the old
// per-module writeAuditLog() helpers produced.

function createPrismaMock() {
  return { auditLog: { create: jest.fn() } };
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
});
