# DMS backend (NestJS + Prisma 6 + Zod)

Navigation aid for the backend. Hard rules live in the repo-root `CLAUDE.md`. Module
history and business rules live in `docs/project-knowledge-archive.md`. Both files are
local-only (gitignored). Read them before any non-trivial change.

## Module map (`src/`)

Each folder is one NestJS module with `*.controller.ts`, `*.service.ts`, `dto/` and
`*.spec.ts`. They are all registered in `app.module.ts`.

- `prisma/`: `PrismaService` (global).
- `audit/`: `AuditService` (global). `log()` is the single writer for `AuditLog`, and `listRecent()` reads activity feeds.
- `auth/`: session login/logout/me, `SessionAuthGuard`, `PermissionsGuard`, `@RequirePermissions`. See `src/auth/README.md`.
- `access/`: roles, permissions, `PERMISSION_CATALOG`. Also covered by `src/auth/README.md`.
- `users/`: user accounts. These have no relation to Employee (CLAUDE.md rule 1).
- `departments/`: departments, plus `department-rules.ts` (`ACTIVE_DEPARTMENT_STATUS`).
- `employees/`: employee master data and photo/contract uploads. See `src/employees/README.md`.
- `suppliers/`, `customers/`, `items/`, `item-categories/`, `purchase-types/`: master data.
- `units/`: units of measure, plus `unit-rules.ts` (`ACTIVE_UNIT_WHERE`, `ensureActiveUnits`).
- `purchases/`: purchase lifecycle, payments, documents, returns. See `src/purchases/README.md`.
- `purchase-requests/`: purchase requests and their auto-status. See `src/purchase-requests/README.md`.
- `dashboard/`: read-only analytics. See `src/dashboard/README.md`.

`main.ts` sets up the session store (`connect-pg-simple`, table `user_sessions`), creates
`uploads/employees` and `uploads/purchases`, and statically serves `/uploads/employees` only.

## `src/common/`: shared, DI-free helpers

- `zod-validation.pipe.ts`: `ZodValidationPipe`, used on every module's bodies and queries. `auth/zod-validation.pipe.ts` is a re-export kept for older imports. New code should import from `common/`.
- `zod-fields.ts`: strict field builders (`requiredMoney`, `requiredQuantity`, `requiredBusinessDate`, `optionalTrimmedString`, `emptyToUndefined`, `enumField`, ...) and column bounds (`MAX_MONEY`, `MAX_QUANTITY`). Use these instead of bare `z.coerce.*`.
- `optimistic-lock.ts`: `recordModifiedConflict()` (409 `RECORD_MODIFIED`) and `isSameVersion()`. Purchases and Purchase Requests full-record PATCHes use them.
- `file-signature.ts`: `matchesFileSignature()`, a magic-byte check for PDF/PNG/JPEG. Purchase documents use it. Employee uploads do not use it yet.
- `pagination.ts`: `parsePagination()` makes pagination opt-in. Without `page`/`pageSize` the request returns a plain array; with them it returns `{ items, total, page, pageSize }`. `MAX_PAGE_SIZE` is 100.

Cross-module "rule files" (`purchases/purchase-rules.ts`,
`purchase-requests/purchase-request-rules.ts`, `departments/department-rules.ts`,
`units/unit-rules.ts`) are pure values with no DI. Import them instead of re-deriving
another module's rule (CLAUDE.md rule 11).

## Commands (run from `backend/`)

```bash
npm run start:dev                 # http://localhost:3001 (Postgres via `docker compose up`)
npm run build
npm test                          # all unit specs
npm test -- purchases             # one module's specs (Jest path pattern)
npm run test:e2e                  # test/*.e2e-spec.ts
```

**Node 24 is required for `npm test`** (`.nvmrc` pins 24). On Node 22, Jest fails with
"Must use import to load ES Module". That is an environment problem, not a test failure.
Workaround: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH npm test`.

## Database / migrations

- Prisma is **pinned to major version 6**. Do not upgrade (see CLAUDE.md rule 4).
- Schema: `prisma/schema.prisma`. Seed: `prisma/seed.ts`, which has its own permission list. Keep it in sync with `PERMISSION_CATALOG`.
- Before creating a migration, run `npx prisma migrate status`. Then run `npx prisma migrate dev --name <snake_case>`, one migration at a time.
- **Never** run `prisma migrate reset`, `db push --force-reset`, or any DROP without explicit user confirmation right beforehand. This is real data.
- Drift on `user_sessions` is expected: it is `@@ignore`d and owned by `connect-pg-simple`. Do not "fix" it by resetting.
