import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { clearSessionAccessCache } from '../session-access';
import { SessionAuthGuard } from './session-auth.guard';

// This guard is the whole system's "must be logged in" gate (session-based
// auth, not JWT — see CLAUDE.md's stack conventions). A request with no
// session/userId must never reach any handler behind it, and (security review
// H1) a session whose account was disabled or deleted must stop working at once.

function contextWithRequest(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ACTIVE',
    roleId: 2,
    role: { permissions: [{ permission: { name: 'reports.view' } }] },
    permissions: [],
    ...overrides,
  };
}

function setup(user: unknown) {
  clearSessionAccessCache();
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  return { prisma, guard: new SessionAuthGuard(prisma as never) };
}

function sessionWith(data: Record<string, unknown>) {
  return { ...data, destroy: jest.fn((callback: () => void) => callback()) };
}

describe('SessionAuthGuard', () => {
  it('allows a request that carries a logged-in session of an active account', async () => {
    const { guard } = setup(userRow());
    await expect(guard.canActivate(contextWithRequest({ session: sessionWith({ userId: 1, roleId: 2, permissions: ['reports.view'] }) }))).resolves.toBe(true);
  });

  it('rejects a request with no session at all', async () => {
    const { guard, prisma } = setup(userRow());
    await expect(guard.canActivate(contextWithRequest({ session: undefined }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request with a session object but no userId (never logged in / logged out)', async () => {
    const { guard } = setup(userRow());
    await expect(guard.canActivate(contextWithRequest({ session: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cuts off a session whose account was disabled or locked, and destroys it', async () => {
    for (const status of ['DISABLED', 'LOCKED']) {
      const { guard } = setup(userRow({ status }));
      const session = sessionWith({ userId: 1, roleId: 2, permissions: ['reports.view'] });
      await expect(guard.canActivate(contextWithRequest({ session }))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(session.destroy).toHaveBeenCalled();
    }
  });

  it('cuts off a session whose account no longer exists', async () => {
    const { guard } = setup(null);
    const session = sessionWith({ userId: 9, permissions: [] });
    await expect(guard.canActivate(contextWithRequest({ session }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session.destroy).toHaveBeenCalled();
  });

  it('refreshes the permissions in the session from the database (role + individual grants), no re-login needed', async () => {
    const { guard } = setup(userRow({ permissions: [{ permission: { name: 'letters.use' } }] }));
    const session = sessionWith({ userId: 1, roleId: 1, permissions: ['users.create', 'reports.view'] });
    await guard.canActivate(contextWithRequest({ session }));
    expect([...(session as { permissions: string[] }).permissions].sort()).toEqual(['letters.use', 'reports.view']);
    expect((session as { roleId: number }).roleId).toBe(2);
  });

  it('asks the database at most once per few seconds per user (cache), and again after clearSessionAccessCache()', async () => {
    const { guard, prisma } = setup(userRow());
    const request = () => contextWithRequest({ session: sessionWith({ userId: 1, roleId: 2, permissions: ['reports.view'] }) });
    await guard.canActivate(request());
    await guard.canActivate(request());
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    clearSessionAccessCache();
    await guard.canActivate(request());
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
