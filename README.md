# Distribution Software System (Business System)

Internal, Persian-language (RTL) business-management web application for **Alish
Automation**. It replaces paper-based tracking of company operations with
structured historical data, so the data can later be analyzed through
dashboards, reports, and charts.

**This file is written for whoever (human or AI agent) picks this project up
next.** Read it before making changes — it describes what actually exists
today, not just what was originally planned, and the two can differ because
this project has been worked on from more than one session/tool over time.

---

## 1. Purpose and guiding principles

The system tracks the company's business activities as structured historical
data (purchases, sales, inventory movements, master data) and later exposes
that data through dashboards and reports. It is **not** just a CRUD app —
historical accuracy and traceability matter, because the data feeds analysis
later.

Principles that have governed every decision so far, and should keep governing
future ones:

- Don't over-engineer. Don't invent business rules that haven't been given.
- Keep the architecture a **modular monolith** (not microservices).
- Preserve historical data — never silently overwrite a running total without
  recording the event that caused the change (e.g. stock balances must come
  from a movement ledger, not an in-place update).
- When a requirement is explicitly marked open/undecided, build the
  surrounding structure without guessing at the missing rule.
- Ask the user only when a decision is genuinely blocking; otherwise make the
  minimal-diff change and move on.
- **Never delete or silently reset existing user accounts, passwords, roles,
  statuses, or employee records.** Schema changes that affect existing data
  must go through a reviewed Prisma migration, not a reset.

## 2. Tech stack (as actually installed, not just planned)

**Frontend** (`frontend/`): Next.js 16 (App Router), React 19, TypeScript,
Tailwind CSS v4, shadcn/ui using the `@base-ui/react` primitive library (not
Radix), `lucide-react` icons, Vazirmatn font. `echarts` + `echarts-for-react`
are installed as dependencies but **not yet wired into any page** — the
dashboard currently shows empty states, no chart has been built yet.

**Backend** (`backend/`): NestJS, TypeScript, REST (no GraphQL), Zod for
request validation via a custom `ZodValidationPipe`, Prisma ORM.

**Database**: PostgreSQL 16 (via Docker Compose locally), Prisma migrations.

**Auth**: session-based (`express-session` + `connect-pg-simple`, cookie name
`connect.sid`, session rows in a `user_sessions` table), Argon2id password
hashing, role-based + per-user permission overrides (see §6).

**Prisma is deliberately pinned to v6** (`"prisma": "^6.19.3"`). Newer Prisma
CLI versions pivoted to a hosted "Prisma Platform" workflow that doesn't fit a
self-hosted Postgres setup — don't upgrade past v6 without checking that the
classic `migrate`/`generate`/`db` commands still work the same way.

## 3. Repository layout

```
Distribution software system/
├── backend/                  NestJS app (see §5 for module map)
├── frontend/                 Next.js app (see §7 for route map)
├── database/                 reserved, not used yet
├── docs/                     reserved, not used yet
├── database_plan.txt         data-model reference doc, mirrors an external
│                             diagram; treat as background reading, not as
│                             more authoritative than this README or the
│                             actual Prisma schema
├── docker-compose.yml        local Postgres service only
├── .env / .env.example       Docker Compose vars (POSTGRES_USER/PASSWORD/DB/PORT)
└── README.md                 this file
```

`backend/.env` (not committed) holds `DATABASE_URL`, `PORT` (3001), and
`SESSION_SECRET`. Change `SESSION_SECRET` and the Postgres credentials before
any shared/production deployment — the checked-in defaults are for local dev
only.

## 4. Business-domain status: built vs. planned

The full intended domain has four areas: **Master Data**, **Transaction**
(Purchases/Sales), **Users & Access**, **Inventory**. Only part of this
exists today:

| Area | Status |
|---|---|
| Users & Access (User, Role, Permission, UserPermission, AuditLog foundation) | **Built** |
| Master Data — Employee, Department | **Built** |
| Master Data — Supplier, Customer, Unit, Item, Item Category | **Not started** |
| Transaction — Purchases (Purchase, PurchaseItem, PurchasePayment, PurchaseDocument, statuses) | **Not started** |
| Transaction — Sales (Sales, SalesItem, SalesPayment, SalesDocument, statuses) | **Not started** |
| Inventory (Stock, StockMovement, InventoryLocation) | **Not started** |
| Dashboard/analytics | **Skeleton only** — layout and empty states exist, no real charts or data yet |

The frontend's admin sidebar (`admin/layout.tsx`) already lists nav items for
several unbuilt areas (خریدها/purchases, فروش/sales, تأمین‌کنندگان/suppliers,
مشتریان/customers, کالاها/products, دسته‌بندی کالاها/product-categories,
واحدها/units, گزارش‌ها/reports) gated behind permissions like
`purchases.manage`, `customers.manage`, `products.manage`, `inventory.view`.
**Some of these permission strings don't exist in the actual permission
catalog** (`backend/src/access/access.service.ts` → `PERMISSION_CATALOG`), so
those nav items are currently unreachable for any role. That's a pre-existing
inconsistency, not something later work broke — worth fixing whenever those
modules are actually built, not before.

**Do not build Production, the real Sales workflow, or the
StockMovement.reference_type/reference_id design** without first confirming
the business rule with the user — these are explicitly open per the original
spec and must not be guessed at.

## 5. Backend structure

NestJS modules, each `Controller` + `Service` (+ `dto/` folder where there's
input validation):

| Module | Routes | Notes |
|---|---|---|
| `auth` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session-based; sets `req.session.userId/username/roleId/permissions` |
| `users` | `POST /users`, `GET /users` | Independent User accounts — see §6 |
| `employees` | `GET /employees`, `GET /employees/:id`, `POST /employees`, `PATCH /employees/:id` | Master Data only — never joined with User |
| `departments` | `GET/POST/PATCH/DELETE /departments`, `GET /departments/:id` | Delete blocked while any Employee references it |
| `access` | `GET/POST/PATCH /access/roles`, `GET /access/permissions`, `GET/PATCH /access/user-permissions` | Role/permission administration |
| `prisma` | — | Wraps `PrismaClient` as a Nest-injectable `PrismaService` |

Guards: `SessionAuthGuard` (must be logged in) and `PermissionsGuard` (must
hold the permission(s) named by the `@RequirePermissions(...)` decorator) are
applied per-controller or per-route. Validation is done with Zod schemas
through `ZodValidationPipe`, not `class-validator`.

## 6. Users & Access model — read this before touching User or Employee

**`User` and `Employee` are fully independent. There is no relationship
between them at all.** This was deliberately corrected after an earlier
implementation had `User.employeeId` as a required 1:1 link — that link was
removed by explicit request (migration `decouple_user_from_employee`) and
**must not be reintroduced** without a new, explicit instruction to do so.

- `User` — a login account: `username`, `passwordHash`, `email` (optional),
  `phone` (optional), `role`, `status` (`ACTIVE`/`DISABLED`/`LOCKED`),
  `createdAt`, `lastLoginAt`. Creating a User never creates or requires an
  Employee.
- `Employee` — a Master Data business record: `code`, `firstName`,
  `lastName`, `department`, `position`, `phone`, `email`, `hireDate`,
  `status` (`active`/`on_leave`/`terminated`), `note`. Creating an Employee
  never creates or requires a User. Employee's only relation is to
  `Department`.
- Permissions come from two places, combined: the User's `Role` (via
  `RolePermission`) and optional extra grants directly on the User (via
  `UserPermission`, added after the original spec — a legitimate additive
  feature, not something to remove).
- Roles seeded: `ADMIN`, `DATA_OPERATOR`, `PURCHASE_MANAGER`,
  `SALES_MANAGER`, `VIEWER` (`SALES_MANAGER` was added later; the original
  spec only listed the first four).
- Permissions seeded: `users.create`, `users.disable`, `suppliers.manage`,
  `employees.manage`, `purchases.manage`, `purchases.edit`, `sales.manage`,
  `sales.edit`, `documents.upload`, `reports.view`.

Full authoritative field-level detail (including the not-yet-built
Purchases/Sales/Inventory tables) is in `database_plan.txt` at the repo root.

## 7. Frontend structure

- `app/layout.tsx` — root layout: `<html lang="fa" dir="rtl">`, Vazirmatn font.
- `app/page.tsx` — home page, intentionally minimal; redirects to `/login` if not authenticated.
- `app/login/page.tsx` — Persian login form, posts to `/api/auth/login`.
- `app/admin/layout.tsx` — the actual app shell: header, permission-filtered sidebar nav, user menu, logout. Wraps every `/admin/*` route and exposes the logged-in user via `useAdminUser()`.
- `app/admin/page.tsx` — dashboard skeleton (KPI cards, empty-state chart/activity panels — no real data wired up yet).
- `app/admin/employees/page.tsx` — Employee CRUD (list + inline create/edit form). Shows only Employee fields — no User/account column.
- `app/admin/departments/page.tsx` — Department CRUD, including activate/deactivate and delete-if-unused.
- `app/admin/users/page.tsx` — User list (وضعیت, نام کاربری, ایمیل, شماره تلفن, نقش, آخرین ورود, وضعیت حساب, اقدامات). No Employee data.
- `app/admin/add-users/page.tsx` — create-user form: نام کاربری, رمز عبور, ایمیل, شماره تلفن, نقش, وضعیت حساب. No Employee field.
- `app/admin/roles/page.tsx` (+ `components/admin/permissions-section.tsx`, `components/admin/user-permissions-section.tsx`) — role/permission administration, three sections on one scrollable page (`/admin/permissions` and `/admin/user-permissions` are just anchor-scroll redirects into this page, kept as separate routes for direct linking).
- `app/admin/user-activity/page.tsx` — stub ("this section is under development"), not implemented.
- `lib/api.ts` — `apiFetch()` helper: prefixes `/api`, sends cookies, throws a typed `ApiError`.
- `next.config.ts` — rewrites `/api/:path*` → `http://localhost:3001/:path*`, which is why the frontend and backend appear same-origin to the browser (needed for the session cookie) and why the pattern mirrors the intended Nginx reverse-proxy setup in production.
- Color tokens live entirely in `app/globals.css` as CSS variables mapped through a Tailwind v4 `@theme inline` block — never hard-code a color in a component; add a token instead.

## 8. Database

Current Prisma schema (`backend/prisma/schema.prisma`) — copy this exactly
when checking what's live; don't infer it from memory of the original spec:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum DepartmentStatus { active inactive }
enum EmployeeStatus { active on_leave terminated }
enum UserStatus { ACTIVE DISABLED LOCKED }

model Department {
  id        Int              @id @default(autoincrement())
  code      String           @unique
  name      String
  status    DepartmentStatus @default(active)
  note      String?
  employees Employee[]
  @@map("departments")
}

model Employee {
  id           Int            @id @default(autoincrement())
  code         String         @unique
  firstName    String         @map("first_name")
  lastName     String         @map("last_name")
  departmentId Int            @map("department_id")
  department   Department     @relation(fields: [departmentId], references: [id])
  position     String?
  phone        String?
  email        String?
  hireDate     DateTime?      @map("hire_date")
  status       EmployeeStatus @default(active)
  note         String?
  @@map("employees")
}

model Role {
  id          Int              @id @default(autoincrement())
  name        String           @unique
  users       User[]
  permissions RolePermission[]
  @@map("roles")
}

model Permission {
  id    Int              @id @default(autoincrement())
  name  String           @unique
  roles RolePermission[]
  users UserPermission[]
  @@map("permissions")
}

model RolePermission {
  roleId       Int        @map("role_id")
  permissionId Int        @map("permission_id")
  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])
  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model User {
  id           Int              @id @default(autoincrement())
  username     String           @unique
  passwordHash String           @map("password_hash")
  email        String?
  phone        String?
  roleId       Int              @map("role_id")
  role         Role             @relation(fields: [roleId], references: [id])
  status       UserStatus       @default(ACTIVE)
  createdAt    DateTime         @default(now()) @map("created_at")
  lastLoginAt  DateTime?        @map("last_login_at")
  auditLogs    AuditLog[]
  permissions  UserPermission[]
  @@map("users")
}

model UserPermission {
  userId       Int        @map("user_id")
  permissionId Int        @map("permission_id")
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Restrict)
  @@id([userId, permissionId])
  @@map("user_permissions")
}

model AuditLog {
  id         Int      @id @default(autoincrement())
  userId     Int?     @map("user_id")
  user       User?    @relation(fields: [userId], references: [id])
  action     String
  entityType String?  @map("entity_type")
  entityId   String?  @map("entity_id")
  createdAt  DateTime @default(now()) @map("created_at")
  details    String?
  ipAddress  String?  @map("ip_address")
  @@map("audit_logs")
}

/// Managed entirely by connect-pg-simple (the express-session Postgres
/// store) at runtime — never created or altered by a Prisma migration.
/// Declared here, with @@ignore, only so Prisma recognizes the table and
/// stops reporting it as drift; no Prisma Client methods are generated
/// for it.
model user_sessions {
  sid    String   @id(map: "session_pkey") @db.VarChar
  sess   Json     @db.Json
  expire DateTime @db.Timestamp(6)
  @@index([expire], map: "IDX_session_expire")
  @@ignore
}
```

**Migration history** (`backend/prisma/migrations/`), oldest logical change
first:

1. `20260919101133_users_and_access` — initial User/Role/Permission/Employee/Department schema (User had a required `employeeId` at this point).
2. `20260920120000_user_permissions` — added `UserPermission` for per-user extra permission grants.
3. `20260920130000_baseline_user_sessions` — records that `user_sessions` already exists (created by `connect-pg-simple`, not Prisma); applied via `prisma migrate resolve --applied`, not by running its SQL.
4. `20260920110337_decouple_user_from_employee` — dropped `User.employeeId`/the FK/unique constraint, added `User.email`/`User.phone`. **Folder-name timestamp sorts before #2 and #3 even though it was applied after them in real time** — harmless (each migration's SQL is independent of the others), but don't assume folder-name order equals real chronological order when reading this history.

**If `prisma migrate dev` ever reports schema drift again**, check whether it's
about `user_sessions` before assuming something is broken — that table is
expected to look like drift to Prisma since it's not created via migrations.
Never resolve real drift by running `prisma migrate reset` without confirming
with the user first — it drops the entire `public` schema.

## 9. Installation / running locally

Prerequisites: Node.js 20+ (developed with v24.19.0), npm 10+, Docker Desktop
(WSL2 backend on Windows), Git.

```
# 1. Start Postgres
docker compose up -d

# 2. Backend
cd backend
npm install
npx prisma generate
npx prisma migrate deploy      # applies all migrations in order
npx ts-node prisma/seed.ts     # first time only — creates roles/permissions/admin user
npm run start:dev              # http://localhost:3001

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

The seed script prints a randomly generated `admin` password once — save it
immediately. If it's lost, recover it with:

```
cd backend
npx ts-node prisma/reset-password.ts admin
```

Two test-data scripts also exist in `backend/scripts/` (see §10).

## 10. Test scripts

- `backend/scripts/create-test-users.ts` — creates N users through the real
  `POST /users` API (no browser needed). Usage:
  `npx ts-node scripts/create-test-users.ts <admin-username> <admin-password> [startIndex] [count]`
  (defaults: startIndex 1, count 50). Safe to re-run — existing usernames are
  skipped, never overwritten.
- `backend/scripts/create-test-users-browser.ts` — same thing but visibly,
  driving the system's installed Edge browser (via Playwright's `channel:
  'msedge'`, so no extra browser download is needed — Playwright's own
  Chromium download is geo-blocked from this network). Same usage/arguments.
  Requires `npm install -D playwright` once; does **not** need `npx
  playwright install`.

Both create users with password `123456789`, usernames `userNNN`, emails
`userNNN@example.com`, roles cycling through all five roles, and never touch
the Employee table.

## 11. Known quirks worth knowing before you dig in

- **Two parallel work streams built this repo.** The original Cowork session
  built the Phase 1 foundation and the initial auth/theme; a substantial
  amount of what exists now (the Access module, per-user permission
  overrides, the Employees module, the dashboard shell, the roles/permissions
  UI) was added by a different tool/session in the same working copy. Don't
  assume a file's current content matches an earlier description of it —
  always re-read the file before editing.
- shadcn/ui here uses `@base-ui/react`, not Radix — don't assume Radix APIs
  when touching `components/ui/*`.
- Tailwind v4: all colors are CSS variables in `app/globals.css`, mapped to
  utilities via `@theme inline`. Add a token there before using a new color
  anywhere.
- TypeScript `isolatedModules` + `emitDecoratorMetadata` means a type used
  only in a decorated method parameter (e.g. `@Body() body: SomeDto`) needs a
  separate `import type { SomeDto }` — mixing it into a normal `import` can
  produce a TS1272 build error.
- On Windows, never write a `.ts`/`.prisma` file with PowerShell's
  `Set-Content -Encoding UTF8` — it adds a BOM that breaks the TypeScript/
  Prisma parsers. Use `[System.IO.File]::WriteAllText(path, content)`.
- Docker Desktop's virtual disk was relocated to `D:\DockerData` (Settings →
  Resources → Advanced) because the default location ran out of space on C:.

## 12. Last updated

**2026-09-20.** Recent milestones, newest first:

- Wrote `backend/scripts/create-test-users.ts` and
  `create-test-users-browser.ts` for batch-creating test users (API-based and
  visible-browser-based); both verified working (50 users each, cycling all
  five roles).
- Corrected the User/Employee architecture: removed the required
  `User.employeeId` 1:1 link entirely (migration
  `decouple_user_from_employee`), added `User.email`/`User.phone`, updated
  every backend/frontend spot that had joined User with Employee data
  (`auth`, `users`, `access`, `employees` modules; `add-users`, `users`,
  `employees` pages; `user-permissions-section` component). No existing user,
  employee, password, role, or status was deleted or reset in the process.
  Verified via updated/added Jest specs and a live migration against the dev
  database (2 pre-existing users had their now-removed `employee_id` link
  value dropped; no rows were deleted).
- Baselined the pre-existing `connect-pg-simple` `user_sessions` table into
  Prisma's migration history (migration `baseline_user_sessions`) so future
  `prisma migrate dev` runs stop reporting it as drift.
- Applied an explicit business-palette color theme across the frontend
  (`app/globals.css` tokens) — functionality/layout/business logic
  intentionally untouched in that pass.
- Phase 1 (repo scaffolding, Next.js + NestJS + Postgres + Prisma + Docker +
  Git) and initial Phase 2 (login, empty home page, admin-creates-users,
  session auth) completed and verified earlier.

When you finish a unit of work on this project, **update this section** (and
any other section your change affects) rather than leaving this file to go
stale — that's the whole point of it existing.
