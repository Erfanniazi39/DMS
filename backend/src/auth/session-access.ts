import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaService } from '../prisma/prisma.service';

// Session revocation & freshness (security review H1).
//
// A session used to be trusted for its whole 8-hour life: permissions were copied
// in at login and the account was never looked at again, so a disabled or
// demoted user kept working. Now every authenticated request re-checks, through
// a tiny in-process cache (CACHE_TTL_MS), that
//   - the account still exists and is ACTIVE (otherwise the session is destroyed
//     and the request is refused with 401), and
//   - the permissions in the session equal the account's CURRENT effective
//     permissions (role + individual grants) — they are refreshed in place, so a
//     permission change no longer needs a log-out/log-in.
// Services that change a user, a role or permissions call
// clearSessionAccessCache() so the change applies on the very next request.
// A password change additionally deletes the user's other stored sessions
// (revokeUserSessions) — the guard cannot see a password change.

const CACHE_TTL_MS = 5_000;

type Access = { status: string; roleId: number; permissions: string[] };
const cache = new Map<number, { at: number; value: Access | null }>();

export function clearSessionAccessCache() {
  cache.clear();
}

async function loadAccess(prisma: PrismaService, userId: number): Promise<Access | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      roleId: true,
      role: { select: { permissions: { select: { permission: { select: { name: true } } } } } },
      permissions: { select: { permission: { select: { name: true } } } },
    },
  });
  const value: Access | null = user
    ? {
        status: user.status,
        roleId: user.roleId,
        permissions: [...new Set([...user.role.permissions.map((row) => row.permission.name), ...user.permissions.map((row) => row.permission.name)])],
      }
    : null;
  cache.set(userId, { at: Date.now(), value });
  return value;
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}

// Throws 401 (and destroys the session) when the account is gone or not ACTIVE;
// otherwise keeps the session's permissions/role in step with the database.
export async function enforceSessionAccess(prisma: PrismaService, req: Request): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedException('ورود به سیستم الزامی است');
  const access = await loadAccess(prisma, userId);
  if (!access || access.status !== 'ACTIVE') {
    cache.delete(userId);
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    throw new UnauthorizedException('نشست شما پایان یافته است؛ دوباره وارد شوید');
  }
  if (!sameSet(access.permissions, req.session.permissions ?? [])) req.session.permissions = access.permissions;
  if (req.session.roleId !== access.roleId) req.session.roleId = access.roleId;
}

// Deletes the stored sessions (connect-pg-simple's user_sessions table, which
// Prisma deliberately does not manage) of the given users, optionally keeping one
// session id — the admin's own current session when they change their own password.
export async function revokeUserSessions(prisma: Pick<PrismaService, '$executeRaw'>, userIds: number[], exceptSid?: string) {
  if (userIds.length === 0) return;
  await prisma.$executeRaw`DELETE FROM user_sessions WHERE (sess->>'userId')::int = ANY(${userIds}::int[]) AND sid <> ${exceptSid ?? ''}`;
  clearSessionAccessCache();
}
