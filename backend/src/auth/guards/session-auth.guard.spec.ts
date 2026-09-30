import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';

// This guard is the whole system's "must be logged in" gate (session-based
// auth, not JWT — see CLAUDE.md's stack conventions). A request with no
// session/userId must never reach any handler behind it.

function contextWithSession(session: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ session }),
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  it('allows a request that carries a logged-in session', () => {
    const guard = new SessionAuthGuard();
    expect(guard.canActivate(contextWithSession({ userId: 1 }))).toBe(true);
  });

  it('rejects a request with no session at all', () => {
    const guard = new SessionAuthGuard();
    expect(() => guard.canActivate(contextWithSession(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a request with a session object but no userId (never logged in / logged out)', () => {
    const guard = new SessionAuthGuard();
    expect(() => guard.canActivate(contextWithSession({}))).toThrow(UnauthorizedException);
  });
});
