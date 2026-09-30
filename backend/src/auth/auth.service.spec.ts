import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

// Covers login-attempt outcomes (the discriminated LoginAttemptResult union
// that lets the controller show locked/disabled users their real reason —
// see the type's own comment and project-knowledge-archive.md §5), and
// effective-permission derivation for the session.

jest.mock('argon2');

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

const baseUser = {
  id: 1,
  username: 'admin',
  passwordHash: 'hash',
  status: 'ACTIVE',
  roleId: 1,
  role: {
    name: 'ADMIN',
    permissions: [{ permission: { name: 'users.create' } }, { permission: { name: 'purchases.manage' } }],
  },
  permissions: [{ permission: { name: 'purchases.manage' } }, { permission: { name: 'reports.view' } }],
};

describe('AuthService', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports "not_found" for a username that does not exist, without checking any password', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue(null);

    const result = await service.attemptLogin('nobody', 'whatever');

    expect(result).toEqual({ status: 'not_found' });
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  it('reports "locked" for a locked account, without checking the password', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue({ ...baseUser, status: 'LOCKED' });

    const result = await service.attemptLogin('admin', 'whatever');

    expect(result).toEqual({ status: 'locked' });
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  it('reports "disabled" for a disabled account, without checking the password', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue({ ...baseUser, status: 'DISABLED' });

    const result = await service.attemptLogin('admin', 'whatever');

    expect(result).toEqual({ status: 'disabled' });
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  it('reports "invalid_password" for an active account with a wrong password', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue(baseUser);
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    const result = await service.attemptLogin('admin', 'wrong-password');

    expect(result).toEqual({ status: 'invalid_password' });
  });

  it('reports "ok" with the full user for a correct password on an active account', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue(baseUser);
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    const result = await service.attemptLogin('admin', 'correct-password');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.user).toBe(baseUser);
  });

  it('de-duplicates permission names that come from both the role and the user\'s own extra grants', () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    const names = service.getPermissionNames(baseUser as never);

    expect(names).toEqual(['users.create', 'purchases.manage', 'reports.view']);
  });

  it('records the login timestamp for the given user id only', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    await service.recordLogin(1);

    expect((prisma as any).user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );
  });

  it('writes an audit log entry with a null userId for an anonymous/failed-login event', async () => {
    const prisma = createPrismaMock();
    const service = new AuthService(prisma as never);

    await service.writeAuditLog(null, 'LOGIN_FAILED:admin:invalid_password', '127.0.0.1');

    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
      data: { userId: undefined, action: 'LOGIN_FAILED:admin:invalid_password', ipAddress: '127.0.0.1' },
    });
  });
});
