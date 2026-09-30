import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

// This is the enforcement half of @RequirePermissions(...): a user missing
// even one required permission must be refused (403), and a route with no
// @RequirePermissions at all (required === undefined/[]) is open to any
// authenticated user. Every permission-gated business rule in this system
// (e.g. purchases.manage, users.create) ultimately relies on this guard
// actually blocking, so it's tested directly rather than only indirectly
// through e2e flows.

function contextWithPermissions(permissions: string[] | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ session: { permissions } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function reflectorReturning(required: string[] | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('PermissionsGuard', () => {
  it('allows any authenticated user through when the route requires no specific permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextWithPermissions([]))).toBe(true);
  });

  it('allows a user whose session carries all of the required permissions', () => {
    const guard = new PermissionsGuard(reflectorReturning(['purchases.manage']));
    expect(guard.canActivate(contextWithPermissions(['purchases.manage', 'reports.view']))).toBe(true);
  });

  it('rejects a user missing the single required permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['purchases.manage']));
    expect(() => guard.canActivate(contextWithPermissions(['reports.view']))).toThrow(ForbiddenException);
  });

  it('rejects a user who has some, but not all, of several required permissions', () => {
    const guard = new PermissionsGuard(reflectorReturning(['purchases.manage', 'purchases.edit']));
    expect(() => guard.canActivate(contextWithPermissions(['purchases.manage']))).toThrow(ForbiddenException);
  });

  it('rejects a request with no permissions on the session at all', () => {
    const guard = new PermissionsGuard(reflectorReturning(['purchases.manage']));
    expect(() => guard.canActivate(contextWithPermissions(undefined))).toThrow(ForbiddenException);
  });
});
