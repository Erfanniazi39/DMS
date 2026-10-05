# Auth + Access modules (backend)

This is the primary doc for both `src/auth/` (sessions, guards) and `src/access/` (roles,
permissions). `src/access/README.md` points here. Background:
`docs/project-knowledge-archive.md` §2.2 and §15.4.

## Session-based auth (not JWT)

- `express-session` + `connect-pg-simple` are configured in `main.ts`. The store table `user_sessions` is `@@ignore`d in Prisma, so drift on it is expected. The cookie is httpOnly and lasts 8 hours.
- `auth.controller.ts`: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Login writes `userId`, `username`, `roleId`, and `permissions` into the session (`session.types.ts`).
- `auth.service.ts`: `attemptLogin()` returns a discriminated result (not_found / invalid_password / locked / disabled / ok). `getPermissionNames()` merges role permissions with per-user extra permissions. Wrong username and wrong password deliberately share one message.

## Guarding a route

```ts
@UseGuards(SessionAuthGuard, PermissionsGuard)   // both, usually at controller level
@RequirePermissions('purchases.view')            // per handler (or controller)
```

- `guards/session-auth.guard.ts`: no `session.userId` returns 401.
- `guards/permissions.guard.ts`: every permission listed in `@RequirePermissions` must be in `session.permissions`, otherwise it returns 403. A route with no `@RequirePermissions` is open to any logged-in user.
- `decorators/permissions.decorator.ts`: `@RequirePermissions(...)`.
- `zod-validation.pipe.ts` here is only a re-export. The real pipe is `common/zod-validation.pipe.ts`.

## Permissions: `PERMISSION_CATALOG`

`access/access.service.ts` exports `PERMISSION_CATALOG` (code, Persian label, module). A
permission **must exist there before it is referenced anywhere**: backend
`@RequirePermissions`, frontend nav or guards. To add one:

1. Add it to `PERMISSION_CATALOG`.
2. Add it to the permission list and role grants in `prisma/seed.ts`. The seed keeps its own list.
3. Use the same code string in the backend and the frontend.

`access.controller.ts` (`/access/roles`, `/access/permissions`,
`/access/user-permissions`) is gated on `users.create`, and so is `users/` itself.

## Session-cached permissions (gotcha)

Permissions are **copied into the session at login and never re-read**. After a role or
permission change, affected users, including your own browser session, must log out and
back in. Otherwise they get stale 403s or keep access they should have lost.

## User and Employee are separate (CLAUDE.md rule 1)

`User` (login account, this module and `users/`) and `Employee` (HR master data) have
**no relation in either direction, ever**. Do not add an FK, a lookup, or a join between
them. This was built once, rejected, and reverted.

## Audit

Login, logout, and failed logins are written through the global `AuditService.log()`
with no entityType. Dashboard's activity feed excludes them on purpose.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- auth access users   # guards, auth.service, access.service, user DTOs
npm run test:e2e                # test/user-management.e2e-spec.ts
```
