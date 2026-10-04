# Project Knowledge Archive — Distribution Software System (Business System)

**Compiled:** 2026-09-23, by Claude acting as project knowledge archivist, for handoff to a new multi-agent AI development team (Executive Advisor / Boss 2, Project Manager, Architect, Database Engineer, Backend Engineer, Frontend Engineer, QA, Security, DevOps, etc.).

**➤ Updated 2026-09-30 — read §15 (at the end of this document) FIRST.** A full day-long session built and verified a substantial amount of new work (Return-to-Vendor tracking, Dashboard wired to real data, Units/Customer/Item/Item Category master data, a routing restructure, a real security fix, pagination, and more), and resolved the migration-history risk that §4/§8/§9/§13 below flag as the top verification priority — that risk **no longer exists**, don't re-investigate it. §15 supersedes any part of §1–§14 it conflicts with; everything else below is still accurate deep history.

## How this document was compiled, and its limits (read this first)

This is raw extraction material, not a polished summary. It draws on three kinds of source, each labeled inline:

- **VERIFIED** — read directly from the actual project files during this compilation (schema.prisma, service/controller/DTO source, package.json, seed.ts, frontend pages, migration filenames, git internals). This is the strongest evidence available.
- **HISTORICAL** — carried over from prior conversation history with the previous developer (the user) across earlier sessions, including two project docs that already existed before this archive: `README.md` (in the repo root) and `claude/phase-1-foundation.md` (a Claude Project doc). These are treated as historical record, not re-verified line-by-line against the database itself.
- **PROPOSAL / ASSUMPTION / UNCERTAIN** — anything not confirmed either way. Marked explicitly, never presented as fact.

**Important limitation:** at the time of writing, the bridge to the user's development machine (`D:\work\Distribution software system`) was intermittently offline. The file contents below were read from a locally cached snapshot taken during earlier, successful connections in this same session (the most recent being the Purchases module redesign work, completed and verified on-device just before this archive was requested). That cache is believed current for everything **except**: (a) whatever the user changed by hand since, and (b) whether the duplicate migration folder mentioned in §4 was actually deleted as instructed. **The new team's first action should be to re-read the live repository (`git log`, `git status`, a fresh `schema.prisma`) rather than trusting this snapshot blindly for anything schema- or migration-related.**

Two pieces of existing project documentation are unusually good and should be read directly, not just through this archive: `README.md` (root) and `database_plan.txt` (root) — both are HISTORICAL/VERIFIED sources already written "for whoever picks this up next" and this archive quotes and cross-checks them extensively below rather than duplicating them wholesale.

**On the "~30% complete" figure:** the user has previously used this as a rough, informal estimate, not a measured metric. Per the instruction for this archive, it is not treated as exact. Section 2 gives a module-by-module inventory instead, from which a more defensible completion picture can be built if needed — but no single percentage is asserted here.

---

## 1. PROJECT OVERVIEW

**What it's intended to accomplish** — HISTORICAL, from the original project brief (attached to this Claude Project) and `README.md` §1:
A local, internal, Persian-language (RTL) web-based business-management system for a company (internally referred to as "Alish Automation" in `README.md`'s title, though the original brief did not name the company) that currently runs much of its operations on paper. The stated core purpose, in the original brief's own words, is to **"track the company's business activities as structured historical data, then visualize and analyze that data through dashboards, reports, tables, and graphs."** It is explicitly framed as not merely a CRUD app — historical accuracy and traceability matter because the data feeds later analysis.

**Business problem it solves** — HISTORICAL: replacing paper-based tracking of purchases, sales, inventory movements, and master data (suppliers, employees, customers, items) with structured digital records, while preserving enough history to support trend analysis (sales trends, purchase trends, stock trends, supplier/customer/employee analysis, payment analysis, period comparisons) once enough data exists.

**Intended users** — HISTORICAL: internal company employees (Persian-speaking), across roles that map to the seeded Role list — VERIFIED from `prisma/seed.ts` and `access.service.ts`: `ADMIN`, `DATA_OPERATOR`, `PURCHASE_MANAGER`, `SALES_MANAGER`, `VIEWER`. (`SALES_MANAGER` was added later than the original spec, which only listed four roles — HISTORICAL, per `README.md` §6.)

**Business processes covered, per the original spec (HISTORICAL, PROPOSAL for anything not yet built):**
- Master Data: Supplier, Employee, Department, Customer, Unit, Item, Item Category
- Transaction: Purchases (full lifecycle) and Sales (explicitly called "preliminary" in the original spec, to be validated against the real workflow later)
- Users & Access: authentication, roles, permissions, audit log
- Inventory: stock levels and stock movements

**Overall scope** — DECISION (original spec, reaffirmed in `README.md` §1): a **modular monolith**, not microservices. Frontend and backend logically separated (Next.js talking to a NestJS REST API), single PostgreSQL database, single Docker Compose deployment target.

**Intended MVP / first usable version** — HISTORICAL: the original spec defined an explicit phased build order (see §12 of the original brief, reproduced here for fidelity since it governs "what came first" reasoning):
1. Phase 1 — Project foundation (repo, frontend, backend, DB connection, Docker, Git) — **VERIFIED COMPLETE**, see §2 below and `claude/phase-1-foundation.md`.
2. Phase 2 — Database schema, migrations, seed data — **PARTIALLY COMPLETE**: Users & Access and Employee/Department are built; Supplier/Purchases/PurchaseRequests were added later (not in the original Phase 2 scope, added ahead of Master Data completion — see §6 "Rejected Approaches" is not the right word here, it's better described as **build-order deviation**, discussed in §6 below); Customer/Unit(partially)/Item/Item Category/Sales/Inventory schema not yet built.
3. Phase 3 — Auth & Users — **VERIFIED COMPLETE** (session-based, Argon2id, RBAC + per-user permission overrides, audit log foundation).
4. Phase 4 — Master Data CRUD (Suppliers, Employees, Departments, Customers, Units, Items, Item Categories) — **PARTIALLY COMPLETE**: Suppliers, Employees, Departments have full CRUD UIs; Units has a backend module but **no** admin frontend page (VERIFIED — no `admin/units` page exists); Customers, Items, Item Categories have neither backend nor frontend.
5. Phase 5 — Purchases — **VERIFIED COMPLETE** and substantially extended beyond the original spec (see §2, Purchases module and Purchase Requests, which was not in the original spec at all).
6. Phase 6 — Inventory — **NOT STARTED** (no backend module, no schema).
7. Phase 7 — Sales — **NOT STARTED** (no backend module, no schema, no frontend).
8. Phase 8 — Dashboard and Analytics — **SKELETON ONLY** (see §2).
9. Phase 9 — Production and advanced workflows — **explicitly deferred**, per the original spec, until the company's real production workflow is confirmed with the business owner. **NOT STARTED**, and per the original spec's own instruction, should not be started without that confirmation.

**Explicitly outside current scope** — DECISION (original spec, still standing, no evidence it was revisited):
- A Production transaction/workflow (the spec is explicit: "do not add a complex Production module now unless required by implementation" and "must first be discussed with the company owner").
- The real Sales workflow — what exists is called "preliminary" and is to be "validated with the company owner later."
- `StockMovement.reference_type`/`reference_id` as real foreign keys — deliberately left as a generic, unenforced type/id pair because "the valid reference types haven't been specified yet" (this is moot for now since Inventory isn't built at all, but the constraint on *how* to eventually build it stands).
- Public internet accessibility — the system is intended for the company's local network only, at least initially.
- Multi-level approval chains for Purchase/Purchase Request status changes — deliberately kept as a single-step status edit, not a workflow engine (DECISION, visible in code comments — VERIFIED).

**Original goals and major objectives** — HISTORICAL, restated from the original brief's own framing: don't over-engineer; don't invent business rules that haven't been given; keep the architecture modular so new modules can be added later; preserve historical data; ask for clarification only when a decision is genuinely blocking; when a requirement is marked open, build the surrounding structure without guessing the missing rule.

---

## 2. CURRENT PROJECT STATE

Status categories used below: **VERIFIED IMPLEMENTED**, **PARTIALLY IMPLEMENTED**, **DESIGNED BUT NOT IMPLEMENTED**, **PLANNED**, **UNKNOWN/UNCERTAIN**.

### 2.1 Project Foundation
- **Status:** VERIFIED IMPLEMENTED.
- **Purpose:** repo scaffolding, dev environment, Docker Postgres, Git.
- **Implemented:** Next.js 16 (Turbopack) frontend, NestJS backend (CJS), PostgreSQL 16-alpine via Docker Compose, Prisma 6 pinned deliberately (see §3), Git initialized. Verified working end-to-end at close of this phase per `claude/phase-1-foundation.md`: `docker compose up`, `prisma migrate dev`, `npm run start:dev` (backend on :3001), `npm run dev` (frontend on :3000).
- **Known limitations:** none carried forward as open issues; this phase was explicitly closed out.
- **Dependencies:** none (this is the base).

### 2.2 Users & Access
- **Status:** VERIFIED IMPLEMENTED (core), with one VERIFIED pre-existing inconsistency noted below.
- **Purpose:** authentication, authorization, role/permission administration, audit trail foundation.
- **Implemented (VERIFIED from `backend/src/auth`, `backend/src/access`, `backend/src/users`, `schema.prisma`):**
  - Session-based login (`POST /auth/login`, `POST /auth/logout`, `GET /auth/me`), Argon2id password hashing, `express-session` + `connect-pg-simple` (Postgres-backed sessions, table `user_sessions`, cookie `connect.sid`).
  - Login distinguishes *why* a login failed — not-found / invalid-password / locked / disabled — a DECISION made "per the company's request that locked/disabled users see the real reason instead of a generic credentials error" (VERIFIED, code comment in `auth.service.ts`).
  - `Role`, `Permission`, `RolePermission` (many-to-many), plus `UserPermission` — a per-user *additional* permission grant layered on top of role permissions. Effective permissions = role permissions ∪ user-specific permissions (VERIFIED, `access.service.ts`).
  - `SessionAuthGuard` (must be logged in) and `PermissionsGuard` (`@RequirePermissions(...)` decorator, must hold ALL listed permissions) as NestJS guards.
  - Seeded roles: `ADMIN`, `DATA_OPERATOR`, `PURCHASE_MANAGER`, `SALES_MANAGER`, `VIEWER`.
  - Seeded permission catalog (VERIFIED, exhaustive, from `access.service.ts` `PERMISSION_CATALOG` — this is the complete, actual list, nothing else exists): `users.create`, `users.disable`, `suppliers.manage`, `employees.manage`, `purchases.manage`, `purchases.edit`, `sales.manage`, `sales.edit`, `documents.upload`, `reports.view`.
  - `AuditLog` model exists (`userId`, `action`, `entityType`, `entityId`, `createdAt`, `details`, `ipAddress`) and is written to on login/logout (VERIFIED in `auth.service.ts`'s `writeAuditLog`) and on Purchase/PurchaseRequest create/update/delete (per prior-session summary — HISTORICAL, not re-read this pass).
- **Known bug/inconsistency (VERIFIED):** the frontend admin sidebar (`admin/layout.tsx`) and dashboard (`admin/page.tsx`) reference permission strings that **do not exist** in `PERMISSION_CATALOG`: `customers.manage`, `products.manage`, `inventory.view`. Any nav item or dashboard KPI gated behind one of these permissions is **permanently unreachable for every role**, because no user or role can ever be granted a permission that isn't in the catalog (`AccessService.findPermissions` rejects unknown codes). This is a pre-existing inconsistency (confirmed by both `README.md`'s own note and direct code inspection this session), not something recent work broke.
- **Technical debt / TODO:** `AuditLog.action`/`entityType`/`details` are intentionally loosely typed strings, not an enum — HISTORICAL/DECISION, "intentionally left open until the Purchases/Sales/Document workflow is finalized" (`database_plan.txt`). No taxonomy has been retroactively imposed even though Purchases now exists — UNCERTAIN whether this should happen now or stay open further.
- **Unresolved:** whether/how audit log entries are surfyaced anywhere in the UI — the "فعالیت کاربران" (User Activity) admin page exists as a route but is an explicit stub: VERIFIED, its content is literally "این بخش در حال توسعه است" (under development) per `README.md` §7 (not re-read directly this pass, but this matches the file being present with minimal content in the earlier directory listing).

### 2.3 Master Data — Employee & Department
- **Status:** VERIFIED IMPLEMENTED, and substantially extended beyond the original spec's field list.
- **Purpose:** Master Data records for company staff and organizational units.
- **Implemented (VERIFIED, `schema.prisma`, `employee.dto.ts`, `frontend/src/app/employees/page.tsx`):**
  - Department: `code` (unique), `name`, `status` (active/inactive), `note`. Full CRUD, delete blocked while any Employee references it (HISTORICAL, `README.md` §5, not re-verified this pass but consistent with `PROTECT`-style FK conventions used everywhere else).
  - Employee: far beyond the original spec's field list. Original spec fields (code, first/last name, department, position, phone, email, hire date, status, note) are all present, **plus** an extensive set of fields added later by explicit request, organized into "identity & family" (father's name, birth certificate number, marital status, children count, gender), "education" (education level enum, a free-text "below diploma grade" field required *only* when education level is `under_diploma` — a cross-field rule enforced in `employee.dto.ts`, VERIFIED), "employment & contract" (work location, working hours, contract type/dates, salary amount + salary period as two separate columns — a DECISION explicitly reasoned in a code comment: "an amount without knowing ماهانه/هفتگی/روزانه isn't meaningful data" — bank account number, and an uploaded contract document path), and "contact & other" (address).
  - Employee first/last/father names are validated against a Persian-letters-only regex (VERIFIED) — Latin letters, digits (Latin or Persian), and symbols are all rejected.
  - Employee code is server-generated (from department code + new id), never client-supplied (VERIFIED, code comment in `employee.dto.ts`).
  - National ID (کد ملی, exactly 10 digits) and mobile phone (exactly 11 digits) are **required** — DECISION, "the company asked for both to be mandatory going forward" (VERIFIED code comment) — meaning this was tightened after initial implementation, not part of the original spec.
  - Photo upload and contract-document upload both go through separate upload endpoints (not the create/update JSON body), stored as files on disk under `backend/uploads/employees/`, served statically — same pattern later reused for Purchase documents.
  - The Employee page lives at the **top-level route `/employees`**, not `/admin/employees` — VERIFIED, `/admin/employees` is a client-side redirect stub to `/employees` for backward compatibility with old links. This is intentional, not dead code or drift.
- **Frontend:** full list + inline create/edit form with sort/search (VERIFIED from file structure and partial read; sortable by department/name/age/tenure/status).
- **Known limitations:** none flagged as open in code; this module appears mature relative to the rest of the system.

### 2.4 Master Data — Supplier
- **Status:** VERIFIED IMPLEMENTED.
- **Implemented:** `code` (unique), `name`, `nationalId` (optional, unique when provided), `phone`, `email`, `address`, bank details split into three separate fields (`bankName`, `bankAccountNumber`, `bankShebaNumber` — a DECISION, deviating from the original spec's single free-text "bank_info" field; visible directly in a migration named `split_supplier_bank_info_add_national_id`), `status` (active/inactive/blacklisted), `note`. Full CRUD (`suppliers.controller.ts`/`.service.ts`, `admin/suppliers/page.tsx`).
- **Notable seed data (VERIFIED, `seed.ts`):** an "OTHER" catch-all Supplier (`code: 'OTHER'`, name "سایر") is seeded specifically so a purchase whose real supplier isn't in the system yet doesn't block data entry — DECISION with explicit reasoning preserved in a code comment: "Not a placeholder for 'unknown data': Note on the purchase can record who the real supplier was, and the purchase can be re-pointed at a proper Supplier later."
- **Known limitations:** none flagged as open.

### 2.5 Master Data — Unit
- **Status:** PARTIALLY IMPLEMENTED.
- **Implemented:** backend model and CRUD module (`units.controller.ts`/`.service.ts`) — `code` (unique), `nameEn`, `nameFa`, `isActive`, `sortOrder`. Consumed as a dropdown in Purchase/Purchase Request item forms.
- **Not implemented:** **no admin frontend page exists** to manage units (VERIFIED — no `admin/units/page.tsx` in the file tree, despite the sidebar nav listing a "واحدها" item pointing at `/admin/units` gated behind `products.manage`, which — see §2.2 — is also not a real permission, so this nav item is doubly unreachable). Units are currently seeded via `prisma/seed.ts` (18 units seeded, e.g. عدد/کیلوگرم/لیتر/کارتن) and, per a code comment in `seed.ts`, intended to be edited "directly here and rerun the seed" rather than through a UI, **by explicit instruction** at the time — DECISION, though it reads as a stopgap rather than a permanent choice (UNCERTAIN whether this is meant to stay this way).

### 2.6 Master Data — Customer, Item, Item Category
- **Status:** DESIGNED BUT NOT IMPLEMENTED (Customer, Item, Item Category all have a full field-level design in `database_plan.txt`, but zero backend/frontend code exists for any of them — VERIFIED absence of `customers`/`items`/`item-categories` modules or pages anywhere in the codebase).
- **Design on file (HISTORICAL/PROPOSAL, `database_plan.txt`):**
  - Customer: `code`, `name`, `customer_type` (retail/wholesale/distributor/other — **explicitly flagged in the plan itself as "proposed, confirm the list"**), `phone`, `email`, `address`, `note`. No Status or Bank Information fields "yet — held back by request until a later update" (this was an explicit instruction from the user, not an oversight).
  - Item: `code`, `name`, `category` (FK), `unit` (FK), `description`, `status` (proposed), `note`. Important business definition carried from the original spec: **Item represents products the company produces/sells — it is NOT a universal purchasing catalog.** This is *why* PurchaseItem is plain text rather than linked to Item (see §4 and §5).
  - Item Category: `code`, `nameEn`, `nameFa`, `isActive`, `sortOrder`.

### 2.7 Transaction — Purchases
- **Status:** VERIFIED IMPLEMENTED, and the most mature/heavily-worked module in the system — extended well beyond the original spec across multiple work sessions.
- **Implemented (VERIFIED, `schema.prisma`, `purchases.service.ts`, `purchase.dto.ts`, `admin/purchases/*`):**
  - `Purchase`, `PurchaseItem`, `PurchasePayment`, `PurchaseDocument`, `PurchaseType` (master data with an 11-value seed list: raw_material, food_ingredient, packaging, machinery, spare_parts, tools, accessories, transportation, office_supplies, maintenance, other).
  - Full status lifecycle: `PurchaseStatus` (DRAFT/CONFIRMED/RECEIVED/CLOSED/CANCELLED), `PurchasePaymentStatus` (UNPAID/PARTIAL/PAID) — payment status, total amount, and paid amount are all **derived and recomputed server-side** from items/payments, never set directly by the client (VERIFIED, code comment: "Persisted (not computed on every read) so the purchase list can filter/sort/display them without re-summing items and payments on every request").
  - `PurchaseSourceType` (`OPERATIONAL` vs `HISTORICAL_IMPORT`) — a DECISION distinguishing a purchase entered as it happens from an old paper record digitized later, **living in the same table** rather than a separate historical table specifically so reporting/analytics can span all years (VERIFIED, direct schema comment).
  - Requester model: **Requester Department only.** VERIFIED and important — `database_plan.txt`'s original design called for *two* nullable FKs (Requester Employee OR Requester Department, exactly one set). This was **explicitly simplified to Department-only** during actual implementation; Requester Employee was never modeled on Purchase. This is a real, confirmed deviation from the original written spec, not an oversight — flagged prominently in §6.
  - `PurchaseItem.name` is **plain text, not linked to Item** — by explicit instruction ("a company can buy things that aren't among the products it produces/sells"). `totalPrice` is stored independently, **not** enforced as quantity × unitPrice. `unitPrice` is optional (lump-sum/exception pricing); `totalPrice` is always required.
  - Purchase Payments and Documents: full CRUD (add/remove), with `PurchasePayment`/`PurchaseDocument` using `onDelete: Restrict` on the Purchase relation (a purchase with payments/documents can't itself be deleted — confirmed in code comments elsewhere in this session's history as an intentional guard, HISTORICAL).
  - Purchase numbering: server-generated sequential (`PUR-000001`), assigned right after row creation, never client-supplied.
  - A small "add purchase type inline" affordance exists on the Purchase form (Purchase Type is master data, but blocking users on a separate admin screen for it was avoided) — this previously allowed **duplicate `nameFa` values**, which was a real, confirmed bug, since fixed (`PurchaseTypesService.create()` now rejects a duplicate name), with a one-time cleanup script (`backend/scripts/merge-duplicate-purchase-types.ts`, VERIFIED, thoroughly commented) written to merge any duplicates that already existed in a real database before the fix. **Whether that cleanup script was ever actually run against the user's real data is UNCERTAIN** — its existence proves the bug was real and fixed at the code level, not that historical duplicate rows were cleaned up.
  - This session's work (most recent): a full UI redesign of the Purchases list/form/detail pages toward a denser, ERP-style layout, restyling only — no functional/schema/API changes. VERIFIED complete and confirmed byte-for-byte synced to the user's machine as of this session.
- **Testing:** `purchases.service.spec.ts` exists (VERIFIED file presence; extensive unit tests per prior-session summary — HISTORICAL for exact coverage detail).
- **Known limitations / unresolved:** Purchases does **not** currently trigger any Inventory stock effect — this is explicitly by design per the original spec ("Do not invent automatic stock effects for Purchases unless the business requirement explicitly establishes them"), not a gap to fix casually.

### 2.8 Transaction — Purchase Requests
- **Status:** VERIFIED IMPLEMENTED. **This entire module was not in the original spec at all** — it was added later, and is a substantial, non-trivial feature.
- **Implemented (VERIFIED, `schema.prisma`, `purchase-requests.service.ts`, `purchase-request.dto.ts`, `admin/purchase-requests/*`):**
  - `PurchaseRequest` (a pre-purchase request, optionally preceding a Purchase — most purchases have none) and `PurchaseRequestItem`.
  - `PurchaseRequestStatus`: DRAFT, SUBMITTED, APPROVED, PARTIALLY_PURCHASED, REJECTED, CANCELLED, COMPLETED. `PARTIALLY_PURCHASED` and `COMPLETED` are **never set by direct user edit** — they are recomputed automatically by `PurchaseRequestsService.recomputeStatus()` whenever a linked Purchase is created, edited, or removed, based on actual purchased-vs-requested quantities per item. A request in DRAFT/SUBMITTED, or already REJECTED/CANCELLED, is never touched by this recompute — only the APPROVED ⇄ PARTIALLY_PURCHASED ⇄ COMPLETED cycle. (VERIFIED directly from code and schema comments — this is a carefully reasoned, deliberately narrow automation, not a general workflow engine.)
  - `PurchaseRequestPriority`: LOW, NORMAL, HIGH, URGENT.
  - The link from Purchase back to the request it fulfills exists at **two levels**: `Purchase.purchaseRequestId` (the request as a whole) and `PurchaseItem.purchaseRequestItemId` (the specific line item it fulfills) — the second is what allows purchased/remaining quantity to be computed **per requested item**, not just per whole request. Purchased/remaining quantities are always **derived at read time** (via Prisma `groupBy`), never stored.
  - UI integration: "ایجاد خرید" (create purchase) / "خرید باقی‌مانده" (purchase the remainder) per-item actions on the Purchase Request detail page, and a bulk "ایجاد خرید کامل" (purchase everything) action — all of these **reuse the existing Purchase creation form** via a pre-fill query parameter, explicitly avoiding a duplicate/parallel purchase workflow (DECISION, per the original implementation instruction for this feature).
- **Testing:** `purchase-requests.service.spec.ts` exists, VERIFIED, extended with tests for the recompute logic per prior-session summary.
- **Known issue (UNCERTAIN, needs live verification):** a Prisma migration ordering bug was diagnosed and a fix produced (new migration `20260922150500_add_purchase_request_index`, replacing a mis-ordered `20260922114637_add_purchase_request_index`, plus a `fix_migration_history.sql` one-time bookkeeping fix) during this session. **The user never confirmed that `npx prisma migrate dev` succeeded after applying this fix**, and the cached file listing used to compile this archive still shows the *old*, mis-ordered migration folder present alongside the new one — meaning either the user hasn't deleted it yet, or this snapshot predates that step. **This must be verified against the live repository/database before any new team member runs a fresh migration.**

### 2.9 Transaction — Sales
- **Status:** NOT STARTED. No schema, no backend module, no frontend page. Sidebar nav item ("فروش") exists and points at `/admin/sales`, which does not exist as a page (VERIFIED absence).
- **Design on file (HISTORICAL/PROPOSAL only, `database_plan.txt` + original spec):** mirrors Purchases — `Sales`, `SalesItem` (this one **does** link to Item, unlike PurchaseItem — an intentional asymmetry per the original spec), `SalesPayment`, `SalesDocument`, reusing `PaymentMethod`/`PaymentStatus` from Purchases. `SalesStatus` (DRAFT/CONFIRMED/DELIVERED/CLOSED/CANCELLED), `SalesPaymentStatus` (UNPAID/PARTIAL/PAID). Seller is an Employee (no separate Seller table). The original spec itself calls this "a preliminary design" to be "validated against the company's real sales workflow" later — **do not treat this as confirmed enough to build without checking with the business owner first.**

### 2.10 Inventory
- **Status:** NOT STARTED. No schema, no backend module, no frontend page.
- **Design on file (HISTORICAL/PROPOSAL only):** `Stock` (running balance per Item+Location, unique constraint on that pair), `StockMovement` (a movement ledger — IN/OUT/TRANSFER_IN/TRANSFER_OUT/ADJUSTMENT_IN/ADJUSTMENT_OUT, quantities always stored positive with direction determined by movement type, never negative for OUT), `InventoryLocation`. `StockMovement.reference_type`/`reference_id` explicitly left as a generic, non-FK type/id pair — **explicitly flagged as open, not to be resolved by inventing a polymorphic FK design.**

### 2.11 Dashboard / Analytics
- **Status:** SKELETON ONLY — VERIFIED directly from `admin/page.tsx`.
- **Implemented:** page layout (KPI card row, a "trend" chart panel, a "recent activity" panel, a "latest transactions" table with disabled pagination controls), all permission-filtered, but **every data area is a hardcoded empty state** ("اطلاعاتی برای نمایش وجود ندارد" / "no data to display") — there is no real query, no chart library wiring, nothing dynamic. `echarts`/`echarts-for-react` are installed as dependencies but **not used anywhere in the codebase** (VERIFIED — package.json lists them, no import of either package appears in any file read this session or in prior session history).
- **Known bug:** the dashboard's "موجودی کالا" (inventory) KPI is gated behind `inventory.view`, which — as noted in §2.2 — does not exist in the permission catalog, so this KPI can never appear for any user.

### 2.12 Reports
- **Status:** NOT STARTED beyond a single `reports.view` permission existing in the catalog and a sidebar nav item gated behind it. No `/admin/reports` page exists (VERIFIED absence).

---

## 3. TECHNICAL ARCHITECTURE

**Backend:**
- **Framework:** NestJS (`@nestjs/*` ^12.0.1), TypeScript, CJS module system (not ESM) — DECISION per `claude/phase-1-foundation.md`, no reason recorded beyond it being the CLI's default output at scaffold time.
- **API style:** REST only, no GraphQL (DECISION, original spec).
- **Validation:** Zod (`zod` ^4.6.5) via a custom `ZodValidationPipe`, **not** `class-validator`/`class-transformer` (DECISION — the original spec asked for "Zod where appropriate," and it was used exclusively rather than mixed with class-validator). Every DTO in the codebase follows the same conventions: an `emptyToUndefined` preprocessor so a blank form field means "not provided" rather than an invalid value, and `optionalTrimmedString`/`optionalEnum`/etc. helper factories repeated per-module (not centralized into a shared validation-helpers file — a piece of **technical debt worth flagging**: `employee.dto.ts`, `purchase.dto.ts`, and `purchase-request.dto.ts` all independently redeclare `emptyToUndefined` and `optionalTrimmedString` with identical implementations).
- **ORM:** Prisma, **deliberately pinned to major version 6** (`"prisma": "^6.19.3"`, `"@prisma/client": "^6.19.3"`). **Reason (VERIFIED, documented in both `claude/phase-1-foundation.md` and `README.md`):** Prisma's newer major versions (7/8-rc at the time) pivoted toward a hosted "Prisma Platform" product and reportedly dropped the classic `prisma init`/`migrate`/`validate` local-first CLI workflow in that form. Since this project self-hosts Postgres via Docker with no cloud Prisma product, staying on v6 was a deliberate choice. **Do not upgrade Prisma past v6 without deliberately re-evaluating this** — both source docs use nearly identical wording to warn future developers about this specifically, which signals it was considered important enough to repeat.

**Frontend:**
- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS v4, shadcn/ui.
- **shadcn/ui here uses `@base-ui/react` as its primitive library, not Radix** — DECISION, reason not recorded, but explicitly flagged twice (README §11, and this session's own component inspection) as something a future developer must not assume otherwise about, since the two libraries' APIs differ.
- Tailwind v4: all color tokens are CSS custom properties in `app/globals.css`, mapped to utility classes via a `@theme inline` block. DECISION: **never hard-code a color in a component; add a token instead.**
- `lucide-react` for icons, Vazirmatn font for Persian text, `echarts`/`echarts-for-react` installed but unused (see §2.11).
- API access: a single `apiFetch()` helper (`lib/api.ts`) that prefixes `/api`, sends cookies, and throws a typed `ApiError`. `next.config.ts` rewrites `/api/:path*` → `http://localhost:3001/:path*` — this makes frontend and backend appear same-origin to the browser, which matters for the session cookie, and mirrors the intended Nginx reverse-proxy shape in production (DECISION, documented reasoning in README §7).

**Authentication:**
- Session-based, not JWT (DECISION, original spec: "Session-based authentication").
- `express-session` + `connect-pg-simple`, session rows in a `user_sessions` table that Prisma is told to *recognize but never manage* (`@@ignore` in `schema.prisma`, plus a migration, `baseline_user_sessions`, that records the table as already existing rather than creating it). **This is a decision a future developer could easily break** by "fixing" what looks like schema drift — see §4 and §10 for the explicit warning already written into the README about this exact trap.
- Argon2id password hashing (`argon2` npm package) — matches the original spec exactly.
- Cookie: `connect.sid`, `httpOnly`, `sameSite: 'lax'`, `secure: false` (VERIFIED, `main.ts`) — **`secure: false` means the cookie is sent over plain HTTP.** This is fine for local-network HTTP use as currently deployed, but is a **security item to revisit before any HTTPS/production-facing deployment** — not flagged as fixed anywhere in the code or docs, so treat as an open item (see §9).
- `SESSION_SECRET` — VERIFIED to have a hardcoded fallback in `main.ts` (`'dev-secret-change-me'`) if the environment variable is unset, and the `.env.example` value is a placeholder (`change-me-to-a-long-random-string`). The actual `.env` value in the user's local checkout was, at one point during this session, found sitting in plaintext in an **untracked scratch file** (`Claude outputs/env`, not `.env` itself) that was not covered by `.gitignore` — this was fixed (see §9, this is logged as a resolved incident, not an ongoing leak, but the fact that it happened once is worth the new team knowing).

**Authorization:** RBAC (Role → Permission) plus a per-user permission override table (`UserPermission`) layered on top — see §2.2. Enforced via NestJS guards (`SessionAuthGuard`, `PermissionsGuard`) applied per-route via a `@RequirePermissions(...)` decorator.

**Application architecture:** modular monolith, one NestJS module per domain concept (`auth`, `users`, `employees`, `departments`, `access`, `suppliers`, `units`, `purchase-types`, `purchases`, `purchase-requests`, `prisma`), each with its own `Controller` + `Service` + `dto/` folder. No shared "core" or "common" module currently exists for cross-cutting utilities (the duplicated Zod helpers mentioned above are one visible symptom of this).

**Project structure:** matches the originally proposed layout (`frontend/`, `backend/`, `database/` [reserved, unused], `docs/` [reserved, unused until this archive], `docker-compose.yml`, `.gitignore`, `README.md`) — VERIFIED via root directory listing.

**Configuration / environment:** `.env`/`.env.example` at the repo root (Docker Compose Postgres vars) and inside `backend/` (`DATABASE_URL`, `PORT`=3001, `SESSION_SECRET`). Both root and backend `.env` are correctly gitignored (VERIFIED, `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, explicitly keeps `!.env.example`).

**Testing:**
- Backend: Jest. Unit test spec files VERIFIED to exist for: `departments`, `employees`, `purchase-requests`, `purchases`, `suppliers`, `users` services, and one DTO spec (`create-user.dto.spec.ts`). **No spec files exist for `access`, `auth`, `purchase-types`, or `units`** (VERIFIED absence in the file listing) — this is a real, identifiable test-coverage gap.
- Frontend: Playwright E2E, configured (`playwright.config.ts`), with exactly two spec-related files VERIFIED to exist: `e2e/auth.setup.ts` and `e2e/employees.spec.ts`. **No E2E coverage exists for Suppliers, Purchases, or Purchase Requests** despite those being the most functionally complex parts of the system — another concrete coverage gap.
- No visible CI configuration (no `.github/workflows` or equivalent was found in any directory listing performed this session — UNCERTAIN whether one exists and simply wasn't listed, since the search wasn't exhaustive for hidden CI-specific paths, but nothing surfaced).

**Infrastructure / Deployment:**
- Local dev: Docker Compose runs Postgres only; frontend and backend are run directly via `npm run dev`/`start:dev`, not containerized locally.
- **Intended production target (PROPOSAL/HISTORICAL, original spec, not yet built or verified):** Ubuntu Server 24.04 LTS, Docker, Docker Compose (full stack this time, not just Postgres), PostgreSQL, Nginx reverse proxy. No production Dockerfiles, docker-compose overrides, or Nginx config were found in the repository (VERIFIED absence) — this entire piece of the original spec remains **PLANNED**, not implemented at all.
- The system is intended for the company's local network, not the public internet, at least initially (HISTORICAL, original spec).

**External services / integrations:** none. No third-party API integrations exist anywhere in the codebase (VERIFIED — no external HTTP client usage found beyond what Prisma/session/argon2 need internally).

**Notable libraries/dependencies of interest, with versions VERIFIED from `package.json`:**
- Backend: NestJS ^12.0.1, Prisma/`@prisma/client` ^6.19.3 (pinned, see above), Zod ^4.6.5, argon2 ^0.45.1, express-session ^1.19.0, connect-pg-simple ^10.0.0, TypeScript **^6.0.2** (note: this is a notably new/unusual TypeScript major version pin for the backend — worth double-checking this wasn't a typo carried forward, since the frontend pins TypeScript ^5).
- Frontend: Next.js 16.3.5, React/React-DOM 19.2.8, `@base-ui/react` ^1.8.0, echarts ^6.1.0 + echarts-for-react ^3.0.6 (both unused so far), lucide-react ^1.47.0, Tailwind ^4, TypeScript ^5.
- Dev/test tooling: Jest ^30, oxlint (backend linter — **not** ESLint on the backend, worth noting since it's an unusual choice), Playwright ^1.63.0 (both backend test-data scripts and frontend E2E), ESLint ^9 (frontend only).

### Architectural decisions in the requested format:

**Decision:** Modular monolith over microservices.
**Status:** DECISION, VERIFIED IMPLEMENTED as such.
**Reason:** original spec — avoid over-engineering for a system whose real requirements are still being discovered; a company that "currently manages much of its business using paper" doesn't need microservices-scale complexity.
**Alternatives considered:** none recorded as having been seriously evaluated — this was a starting constraint, not a decision arrived at by comparison.
**Current implementation:** one NestJS app, one Next.js app, one Postgres database.
**Potential problems:** none observed yet at current scale; would need revisiting only if/when the system grows well beyond its current scope.
**Potentially outdated?:** No signal of this being reconsidered.

**Decision:** Prisma pinned to major version 6.
**Status:** DECISION, VERIFIED IMPLEMENTED, actively enforced (both README and phase-1 doc warn against upgrading).
**Reason:** documented above — avoids Prisma's shift toward a hosted-platform-first CLI in later majors, which doesn't fit self-hosted Postgres.
**Alternatives considered:** implicitly, "use whatever Prisma version is latest" — rejected specifically because of the workflow shift.
**Current implementation:** `package.json` pins `^6.19.3` for both `prisma` and `@prisma/client`.
**Potential problems:** staying pinned indefinitely means missing Prisma 6 security/bug fixes eventually released only for later majors, if that ever happens — not an issue today, but worth a periodic re-check rather than a permanent freeze.
**Potentially outdated?:** UNCERTAIN — depends entirely on whether Prisma's actual current (2026) CLI behavior still matches this reasoning; this should be spot-checked by whoever next touches the database layer, not assumed to still be true forever.

**Decision:** Session-based auth over JWT.
**Status:** DECISION (original spec), VERIFIED IMPLEMENTED.
**Reason:** explicit original spec requirement.
**Alternatives considered:** JWT is the implicit alternative for a REST API but was never the chosen direction; no evidence it was seriously evaluated and rejected — it simply wasn't what was asked for.
**Current implementation:** `express-session` + `connect-pg-simple`, Postgres-backed.
**Potential problems:** `secure: false` on the session cookie — see §9.
**Potentially outdated?:** No.

**Decision:** Zod over class-validator for request validation.
**Status:** DECISION (original spec: "Zod where appropriate"), VERIFIED IMPLEMENTED exclusively (no class-validator usage found anywhere).
**Reason:** explicit original spec preference.
**Alternatives considered:** class-validator/class-transformer is NestJS's more conventional default — not used at all.
**Current implementation:** custom `ZodValidationPipe`, per-module DTO files with hand-rolled schema-building helpers.
**Potential problems:** helper duplication across DTO files (technical debt, noted above).
**Potentially outdated?:** No signal of reconsideration.

**Decision:** `@base-ui/react` instead of Radix as the shadcn/ui primitive library.
**Status:** DECISION, VERIFIED IMPLEMENTED throughout `components/ui/*`.
**Reason:** not recorded in any available source — HISTORICAL knowledge only that this is the case and must be respected; the *why* behind this specific choice is UNCERTAIN.
**Alternatives considered:** UNCERTAIN.
**Current implementation:** all of `button.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx` import from `@base-ui/react/*`.
**Potential problems:** a developer more familiar with Radix (the far more common shadcn/ui base) could easily introduce Radix-shaped code that doesn't compile or behave correctly against `@base-ui/react`'s different API.
**Potentially outdated?:** No signal either way.

---

## 4. DATABASE

**Current live schema** — VERIFIED, read directly from `backend/prisma/schema.prisma` this session (full contents preserved above in the compilation notes; not re-transcribed table-by-table here to avoid duplication — see §2 for a narrative walkthrough per module, and read `schema.prisma` directly for the authoritative field list).

**Tables/entities that exist today (VERIFIED):** `Department`, `Employee`, `Supplier`, `Unit`, `PurchaseType`, `PurchaseRequest`, `PurchaseRequestItem`, `Purchase`, `PurchaseItem`, `PurchasePayment`, `PurchaseDocument`, `Role`, `Permission`, `RolePermission`, `User`, `UserPermission`, `AuditLog`, `user_sessions` (unmanaged by Prisma, see below).

**Tables designed but not created (PROPOSAL only, from `database_plan.txt`):** `Customer`, `Item`, `ItemCategory`, `Sales`, `SalesItem`, `SalesPayment`, `SalesDocument`, `Stock`, `StockMovement`, `InventoryLocation`.

**Important relationships and WHY they were built the way they were — this section exists specifically because a future AI developer, seeing only the schema, might "fix" something that was actually a deliberate decision:**

1. **`User` and `Employee` have zero relationship — no FK either direction.** This is the single most explicitly and repeatedly documented decision in the entire codebase. It was *previously implemented* as a required 1:1 `User.employeeId` link, and was **removed by explicit user request** (migration `decouple_user_from_employee`). Both `README.md` and `database_plan.txt` state, almost word for word, that this **"must not be reintroduced without a new, explicit instruction to do so."** A future team member seeing a `User` table with no employee link and thinking "this looks like a bug, let me add the obvious FK" would be **directly reversing a deliberate, explicitly-requested architectural decision.** This is DECISION, VERIFIED, and marked here as a **do-not-casually-change** item per instruction §13 of this archive's own purpose.
2. **Purchase's requester is Department-only, not the Employee-OR-Department pair the original written spec described.** `database_plan.txt` (the plan document itself) still shows the two-nullable-FK design as the intended one; the actual `schema.prisma` comment explicitly states this was "explicitly simplified to Department-only for this implementation; Requester Employee is intentionally not modeled." **This is a real, confirmed deviation between the written plan and the built system** — not an oversight, but also not something `database_plan.txt` was ever updated to reflect. A future developer reading only `database_plan.txt` would believe Requester Employee exists on Purchase; it does not.
3. **`PurchaseItem.name`/`PurchaseRequestItem.name` are plain text, never linked to `Item`.** Reason preserved directly in schema comments: "A company can buy things (machinery, office supplies, ...) that aren't among the products it produces/sells." This is a **core business definition**, not a shortcut: ITEM in this system specifically means "things the company produces/sells," and Purchases are not constrained to only buying those things.
4. **`PurchaseItem.totalPrice` is stored independently of `quantity × unitPrice`, and `unitPrice` is optional.** Reason: some purchases have no meaningful per-unit price (lump-sum, exceptions); Total Price is what's actually billed and is the only always-required money field. **Do not add a check constraint or trigger enforcing the arithmetic** — this was explicitly instructed against.
5. **`Purchase.paymentStatus`/`totalAmount`/`paidAmount` are derived, server-recomputed, and persisted** (not computed live on every read) specifically so list views can filter/sort/display without re-aggregating on every request. A future developer must update `PurchasesService`'s recompute logic — never write to these columns directly from elsewhere.
6. **`PurchaseRequestItem` purchased/remaining quantities are never stored** — always derived at read time via a Prisma `groupBy` over linked `PurchaseItem` rows, explicitly to avoid the exact "STOCK = 500 → 700 without recording the event" anti-pattern the original spec calls out by name. This is the clearest concrete expression in the whole codebase of the original spec's core "preserve historical data, derive summaries from history" principle.
7. **`PurchaseRequestStatus.PARTIALLY_PURCHASED`/`COMPLETED` are exclusively system-recomputed, never user-set.** A future developer adding a "let admins manually override request status" feature needs to know this recompute exists and would silently fight it.
8. **`user_sessions` is declared in `schema.prisma` with `@@ignore` and is deliberately excluded from normal Prisma migration management** — it's owned entirely by `connect-pg-simple` at runtime. **This is flagged, in the README, as something that will look like schema drift to `prisma migrate dev`, and the explicit instruction on file is: check whether reported drift is about this table before assuming something is broken, and never run `prisma migrate reset` without confirming with the user first, since it drops the entire `public` schema.** This is as close to a "landmine" as this codebase has, and is called out here with maximum emphasis for that reason.
9. **Supplier bank info is three separate fields (`bankName`/`bankAccountNumber`/`bankShebaNumber`), not one blob**, and Supplier gained a unique optional `nationalId` — both added after the original single-field "bank_info" design, via migration `split_supplier_bank_info_add_national_id`. Reason not preserved verbatim in a comment beyond the migration name itself — inferred (UNCERTAIN on exact reasoning, though the direction — more structured fields — matches the project's general preference for explicit fields over free-text blobs elsewhere, e.g. Employee's salary amount+period split).

**Enumerations (VERIFIED, exhaustive list from `schema.prisma`):** `DepartmentStatus`, `EmployeeStatus`, `EducationLevel`, `MaritalStatus`, `Gender`, `SalaryPeriod`, `ContractType`, `UserStatus`, `SupplierStatus`, `PurchaseStatus`, `PurchasePaymentStatus`, `PaymentMethod` (shared, intended for Sales too, per comment), `PaymentStatus` (same), `DocumentType` (same), `PurchaseSourceType`, `PurchaseRequestStatus`, `PurchaseRequestPriority`.

**Foreign key delete behavior:** mostly implicit Prisma defaults except where explicitly set — `PurchaseItem.purchase` uses `onDelete: Cascade` (deleting a Purchase deletes its items), `PurchasePayment.purchase` and `PurchaseDocument.purchase` use `onDelete: Restrict` (a Purchase with payments/documents cannot itself be deleted), `PurchaseRequestItem.purchaseRequest` uses `onDelete: Cascade`, `UserPermission.user` uses `onDelete: Cascade` while `UserPermission.permission` uses `onDelete: Restrict` (a permission in active use by a user grant can't be deleted out from under it). `database_plan.txt`'s *proposed* (not-yet-built) tables consistently use Django-style `PROTECT` semantics, which is the same idea as Prisma's `Restrict` — worth keeping consistent when Sales/Inventory are eventually built.

**Migration history (VERIFIED filenames, from the cached migrations directory listing; chronological by filename except where noted):**
1. `20260919101133_users_and_access` — initial schema (User had a required `employeeId` at this point).
2. `20260920110337_decouple_user_from_employee` — removed the required link, added `User.email`/`User.phone`. **Note:** per README, this migration's folder-name timestamp sorts *before* #3 below even though it was applied after it in real time — harmless since each migration's SQL is independent, but a reminder that folder-name order isn't strictly real chronological order in this history.
3. `20260920130000_baseline_user_sessions` — records `user_sessions` as already existing (applied via `prisma migrate resolve --applied`, not by running its SQL).
4. `20260921140000_add_employee_details` through `20260922100000_add_employee_bank_account_number` — six incremental migrations adding the extended Employee fields (photo, extended identity/family/education fields, gender+salary period, field of study, contract document, bank account number) one at a time.
5. `20260922110000_add_suppliers` — Supplier table.
6. `20260922114637_add_purchase_request_index` — **this is the migration involved in the ordering bug** (see below).
7. `20260922120000_split_supplier_bank_info_add_national_id`.
8. `20260922130000_add_purchases_module` — Purchase/PurchaseItem/PurchasePayment/PurchaseDocument/PurchaseType and related enums.
9. `20260922140000_purchase_item_unit_price_optional`.
10. `20260922150000_add_purchase_requests_and_source_type` — PurchaseRequest/PurchaseRequestItem, `sourceType`, `purchaseRequestId`.
11. `20260922150500_add_purchase_request_index` — a **replacement** for #6, created during this session specifically to fix a migration-replay ordering bug (see below).

**KNOWN MIGRATION ISSUE — UNCERTAIN CURRENT STATE, needs verification before any new migration work:**
During this session, `npx prisma migrate dev` failed with a P3006/P1014 error when a migration was replayed against a shadow database, root-caused to migration `20260922114637_add_purchase_request_index` sorting (by filename timestamp) *before* `20260922130000_add_purchases_module`, even though the former structurally depends on tables the latter creates. The fix produced: a new migration folder `20260922150500_add_purchase_request_index` with identical SQL content, sorting correctly after the dependency; a one-time `backend/fix_migration_history.sql` to update Prisma's own bookkeeping table (`_prisma_migrations.migration_name`) for the already-applied migration, so Prisma doesn't treat the renamed folder as new/unapplied; and an instruction to the user to manually delete the old `20260922114637_add_purchase_request_index` folder. **The user never confirmed running these steps or that `migrate dev` subsequently succeeded.** The cached file listing used to compile this archive still shows *both* the old and new folders present. **This is the single most important "verify before touching migrations" item for the new team** — running `prisma migrate dev` (or worse, `migrate reset`) without first confirming the actual state of `_prisma_migrations` in the real database, and whether the old folder still exists, risks either a repeat failure or, if someone reaches for `migrate reset` to "fix" it, **dropping the entire schema** (explicitly warned against in README).

**Migration strategy in general:** Prisma Migrate, applied via `migrate dev` in local development and `migrate deploy` in the documented install instructions. No evidence of a squash/consolidation strategy — the history is long and incremental (17 migrations for what is still a fairly small schema), which is not itself a problem but is worth knowing before assuming a "clean baseline."

---

## 5. BUSINESS RULES

**Rule:** Exactly one of Requester Employee or Requester Department must be specified on a Purchase.
**Status:** ⚠️ **This was the ORIGINAL spec's rule — it is now SUPERSEDED.** The actual implementation uses Requester Department only; Requester Employee was never modeled on Purchase at the database level. Labeling: the *original* rule is HISTORICAL/CONFIRMED BUSINESS RULE at the time it was written; the *actual current rule* (Department-only, required for OPERATIONAL purchases, optional for HISTORICAL_IMPORT) is VERIFIED IMPLEMENTED. **This is flagged as POTENTIALLY OUTDATED in the sense that the original written rule no longer matches reality — a future team must treat the Department-only version as current truth, not the original spec text.**
**Source/context:** original project brief §6; superseded per `schema.prisma`'s own comment on the `Purchase` model.
**Reason (original):** a purchase's requester could be an individual or a whole department. **Reason (actual, inferred/UNCERTAIN):** not explicitly recorded why Employee was dropped — possibly simplification, possibly a discovered real-world fact that requests are always attributed to a department. This is worth confirming with the business owner rather than assuming either way.
**Current implementation:** `Purchase.requesterDepartmentId` (nullable FK), required by `purchase.dto.ts` for `sourceType: 'OPERATIONAL'`, optional for `'HISTORICAL_IMPORT'`.
**Unresolved questions:** should Requester Employee be reintroduced? Is Department-only actually correct for the business? — UNCERTAIN, not confirmed either way in available history.

**Rule:** User and Employee are completely independent; no relationship, ever, without new explicit instruction.
**Status:** CONFIRMED BUSINESS RULE (explicitly reaffirmed after being tried the other way and explicitly reversed).
**Source/context:** original spec §8 ("An employee may exist without a system account... USER → EMPLOYEE should be a one-to-one relationship from USER to EMPLOYEE" — note: even the *original* spec called for a 1:1 link, just optional-from-the-employee-side; what actually happened went further, to **no link at all**). This is itself a documented deviation from the original written spec, similar to the Requester Department case.
**Reason:** VERIFIED, repeatedly documented — the 1:1 link was tried, found wrong, and explicitly removed by the user.
**Current implementation:** no FK either direction; permissions are purely a function of the `User`/`Role`/`Permission`/`UserPermission` graph.
**Unresolved questions:** none — this is the most settled rule in the system.

**Rule:** PurchaseItem/PurchaseRequestItem names are free text, never linked to Item master data.
**Status:** CONFIRMED BUSINESS RULE.
**Source/context:** original spec §6 ("PURCHASE_ITEM.Name is plain text... Do NOT link PURCHASE_ITEM to ITEM. A company can purchase arbitrary things that are not company-produced/sellable ITEMS.").
**Reason:** Item specifically means "things the company produces/sells" — purchases are not limited to that set.
**Current implementation:** VERIFIED, `PurchaseItem.name String` with no FK, in both current schema and the Purchase Request equivalent.
**Unresolved questions:** none.

**Rule:** Purchase Item Total Price is never derived from Quantity × Unit Price.
**Status:** CONFIRMED BUSINESS RULE.
**Source/context:** original spec §6 ("Do NOT force Total Price to equal Quantity × Unit Price").
**Reason:** not elaborated in the original spec beyond the instruction itself; likely reflects real-world pricing that doesn't always follow simple unit math (bulk discounts, lump sums, etc.) — UNCERTAIN on the deeper reasoning, but the rule itself is unambiguous.
**Current implementation:** VERIFIED — the frontend *suggests* a computed total as a convenience (auto-fills when quantity/unit price change) but the field remains directly editable and the backend never recomputes or validates it against the arithmetic.
**Unresolved questions:** none.

**Rule:** Stock balances must never be updated in place without a corresponding Stock Movement record.
**Status:** CONFIRMED BUSINESS RULE (as a principle) — but **DESIGNED, NOT YET IMPLEMENTED** at the code level, since Inventory doesn't exist yet.
**Source/context:** original spec §10, restated verbatim as an example: "do not design the system in a way that destroys historical information... do not only update STOCK = 500 → 700 without recording the business event that caused the +200 movement."
**Reason:** the system's stated central purpose is historical traceability for later analysis.
**Current implementation:** N/A yet — this rule exists only as a constraint on the *future* Inventory implementation.
**Unresolved questions:** none about the rule itself; the open question is entirely about `reference_type`/`reference_id` design (see §2.10).

**Rule:** Purchases do not automatically affect Inventory stock.
**Status:** CONFIRMED BUSINESS RULE (as a negative constraint — i.e., a confirmed instruction *not* to build something).
**Source/context:** original spec §6, Phase 6 instructions ("Do not invent automatic stock effects for Purchases unless the business requirement explicitly establishes them").
**Reason:** avoiding invented business rules not yet confirmed by the company.
**Current implementation:** N/A — Purchases and Inventory are entirely unconnected at present, correctly, since Inventory doesn't exist.
**Unresolved questions:** when Inventory is built, will Purchase completion trigger a stock movement? This is explicitly **not yet decided** and must be confirmed with the business owner, not assumed.

**Rule:** National ID and mobile phone are required fields for Employee (tightened from the original spec).
**Status:** CONFIRMED BUSINESS RULE, but note the change from the original.
**Source/context:** VERIFIED code comment in `employee.dto.ts`: "the company asked for both to be mandatory going forward." The original spec's Employee field list did not even include National ID or a mobile/landline split — this whole area was added and then tightened after initial build.
**Reason:** explicit company request (exact business reasoning not preserved beyond the comment).
**Current implementation:** VERIFIED, Zod schema requires exactly 10 digits (national ID) / 11 digits (mobile phone).
**Unresolved questions:** none about the rule; worth knowing that "required going forward" implies pre-existing Employee records might predate this requirement and could have null values there — UNCERTAIN whether any such legacy rows exist in real data.

**Rule:** A "below diploma grade" value is required only when education level is "under_diploma"; salary period is required whenever a salary amount is given; contract end date cannot precede contract start date.
**Status:** CONFIRMED BUSINESS RULE (cross-field validation, clearly deliberate).
**Source/context:** VERIFIED, `employee.dto.ts` `withCrossFieldRules`.
**Reason:** each is explained in-line — e.g. "an amount without knowing ماهانه/هفتگی/روزانه isn't meaningful data."
**Current implementation:** enforced via Zod `superRefine` on both create and update.
**Unresolved questions:** none.

**Rule:** A locked or disabled user account should see the specific reason (not a generic "invalid credentials" message) when attempting to log in.
**Status:** CONFIRMED BUSINESS RULE.
**Source/context:** VERIFIED code comment in `auth.service.ts`: "per the company's request."
**Reason:** better UX/clarity for account-status issues versus a plain wrong-password case.
**Current implementation:** `LoginAttemptResult` discriminated union with distinct `locked`/`disabled`/`invalid_password`/`not_found` states.
**Unresolved questions:** none.

**Rule:** Purchase Request status auto-transitions (APPROVED ⇄ PARTIALLY_PURCHASED ⇄ COMPLETED) are driven only by actual purchased quantity, never by the mere existence of a linked Purchase.
**Status:** CONFIRMED BUSINESS RULE (this was a very explicit, detailed requirement given for this specific feature — see prior session history).
**Source/context:** HISTORICAL, from the detailed feature spec given for the Purchase Request → Purchase integration work; also directly reflected in code comments.
**Reason:** a Purchase could be created against a request without yet reflecting real fulfillment (e.g. a DRAFT purchase with no items priced/received yet) — status should reflect reality, not just "someone started a purchase."
**Current implementation:** VERIFIED, `PurchaseRequestsService.recomputeStatus()`.
**Unresolved questions:** what exactly counts as "purchased" for this computation (e.g. does a CANCELLED purchase's items count toward remaining quantity?) — per prior session history, CANCELLED purchases are excluded from the sum (HISTORICAL, from the earlier session's implementation summary — not re-verified line-by-line this pass, so marked UNCERTAIN pending a direct re-read of `recomputeStatus()`'s exact filter logic).

---

## 6. IMPORTANT DECISIONS

This section lists decisions not already fully covered in §3/§4/§5, to avoid repetition — cross-references are used where a decision is detailed elsewhere.

**Decision:** Build Purchases (and, unprompted by the original spec, Purchase Requests) before completing the rest of Master Data (Customer, Item, Item Category) or before Sales/Inventory.
**Why:** not explicitly recorded as a deliberate re-sequencing decision in any available source — it reads as organic, need-driven development (the user evidently needed Purchases working sooner than the rest), rather than a planned deviation from the original phase order.
**Alternatives considered:** UNCERTAIN — no evidence the original phase order (Master Data completion before Purchases) was explicitly reconsidered and rejected; it appears to have simply not been followed strictly.
**Rejected alternatives:** N/A.
**Current implementation:** Purchases and Purchase Requests are the most complete transactional modules; Customer/Item/Item Category/Sales/Inventory remain unbuilt.
**Confidence:** MEDIUM — this is an inference from build order (migration timestamps, module presence) rather than a stated decision.
**Potentially outdated?:** N/A — this is a historical fact about how development proceeded, not an ongoing policy.

**Decision:** Add a Purchase Request module, entirely absent from the original spec.
**Why:** HISTORICAL — requested later as a real business need (a pre-purchase request/approval step feeding into Purchases), per prior session's detailed feature spec.
**Alternatives considered:** UNCERTAIN whether a simpler approach (e.g. a status flag on Purchase itself) was considered and rejected in favor of a separate table — the separate-table approach is what was built, with clear reasoning for the design (see §2.8, §4).
**Current implementation:** full module, described in §2.8.
**Confidence:** HIGH for what was built; MEDIUM for the "why a separate table specifically" reasoning, since that predates the fully-detailed history available for this archive.
**Potentially outdated?:** No.

**Decision:** Redesign the Purchases module's UI (list/form/detail pages) toward a denser, ERP-style layout, restyling only, with an explicit, strict "do not touch anything else" scope boundary.
**Why:** EXPLICIT USER DECISION, this session — a very detailed design brief was given, explicitly modeled on Odoo/ERPNext-style enterprise UI, explicitly rejecting "consumer-app" styling (large rounded cards, gradients, glassmorphism, excessive color).
**Alternatives considered:** N/A — this was a direct, specific request, not a menu of options.
**Rejected alternatives:** N/A.
**Current implementation:** VERIFIED complete and synced to the user's machine; Purchase Requests pages, Sales, Customers, Suppliers, Employees, Users/Roles/Permissions, Inventory, Master Data, Dashboard, and navigation were explicitly left untouched, per the brief's own scope restriction.
**Confidence:** HIGH.
**Potentially outdated?:** No — this is the most recent work in the project.

**Decision:** Store Employee salary as two separate fields (`salaryAmount` + `salaryPeriod`) rather than one field.
**Why:** VERIFIED code comment — "an amount without knowing ماهانه/هفتگی/روزانه isn't meaningful data."
**Alternatives considered:** a single field encoding both (e.g. "5,000,000 ماهانه" as a string) — implicitly rejected in favor of structured, separately-queryable fields, consistent with the project's general preference for structured data over free text where it matters for later analysis.
**Current implementation:** VERIFIED, two nullable columns, paired validation.
**Confidence:** HIGH.
**Potentially outdated?:** No.

**Decision:** Split Supplier bank info into three fields instead of the original spec's single free-text field.
**Why:** UNCERTAIN — not documented beyond the migration name itself (`split_supplier_bank_info_add_national_id`).
**Alternatives considered:** UNCERTAIN.
**Current implementation:** VERIFIED, three separate columns.
**Confidence:** MEDIUM (the fact of the decision is certain; the reasoning behind it is not documented anywhere found).
**Potentially outdated?:** No signal either way.

**Decision:** Seed a catch-all "OTHER" Supplier rather than requiring a real supplier record to exist before a purchase can be entered.
**Why:** VERIFIED, explicit reasoning in `seed.ts` comment — avoid blocking data entry, while still preserving the real supplier's identity in the purchase's Note field, with the option to re-point the purchase to a proper Supplier record later.
**Alternatives considered:** making Supplier nullable on Purchase — rejected in favor of a real (if generic) Supplier row, which keeps the FK non-nullable and the data model simpler.
**Current implementation:** VERIFIED, seeded row `code: 'OTHER'`.
**Confidence:** HIGH.
**Potentially outdated?:** No.

**Decision:** Two separate but related "employees" routes — a redirect stub at `/admin/employees` pointing to the real page at top-level `/employees`.
**Why:** VERIFIED code comment — the page was intentionally moved to a top-level route while still sharing the admin layout chrome, and the redirect exists purely for backward-compatibility with old bookmarks/links.
**Alternatives considered:** UNCERTAIN why the page needed to move to a top-level route in the first place rather than staying under `/admin`.
**Current implementation:** VERIFIED, `admin/employees/page.tsx` is a client-side `router.replace('/employees')`.
**Confidence:** HIGH that this is intentional, not broken; MEDIUM on the original motivation.
**Potentially outdated?:** No.

---

## 7. REJECTED APPROACHES

**Rejected approach:** `User.employeeId` as a required 1:1 foreign key to `Employee`.
**Problem with it:** it forced every system-login account to correspond to exactly one Employee record, which didn't match the real business need — an Employee can exist with no system account, and (implicitly) the reverse case may also matter, or the coupling was simply found to be the wrong model in practice.
**Alternative selected:** complete independence between `User` and `Employee` — no relationship at all.
**Reason:** explicit user request/correction after the required-link version was already built and found wrong.
**Could it become relevant later?:** Only if the business explicitly asks for a way to associate a login account with a specific staff member (e.g. for reporting "which employee is this user account for"). **If that ever comes up again, it should be treated as a brand-new explicit decision, not a reversion** — and probably as an optional link, not a required one, given the history.

**Rejected approach:** Requester modeled as two nullable FKs (Employee OR Department, exactly one set) on Purchase, as the original written spec called for.
**Problem with it:** not documented as having caused a specific problem — it appears to have simply been simplified during implementation rather than rejected for a stated flaw.
**Alternative selected:** Requester Department only.
**Reason:** UNCERTAIN (see §5, §6) — not confirmed whether this was a deliberate simplification the business agreed to, or an implementation shortcut that was never revisited.
**Could it become relevant later?:** Yes, plausibly — if the business actually does want to attribute some purchase requests to a specific employee rather than only a department, Requester Employee would need to be added back. **This should be explicitly confirmed with the business owner, not silently reintroduced or silently left as-is.**

**Rejected approach:** Enforcing `PurchaseItem.totalPrice = quantity × unitPrice` at the database or validation layer.
**Problem with it:** doesn't match real purchasing scenarios (lump-sum pricing, exceptions) — this was rejected *before* being built, per the original spec's explicit instruction, not something tried and then reversed.
**Alternative selected:** store both fields independently; unit price optional, total price always required and directly entered.
**Reason:** original spec, explicit.
**Could it become relevant later?:** Only as an optional UI convenience (already implemented as an auto-fill suggestion), never as a hard constraint, per current instructions.

**Rejected approach (implicit):** A general-purpose polymorphic foreign key for `StockMovement.reference_type`/`reference_id` (i.e., building real FK constraints to multiple possible source tables).
**Problem with it:** the valid reference types haven't been specified by the business yet — building a general solution now would mean guessing at requirements.
**Alternative selected:** leave it as a plain, unenforced type/id pair, explicitly deferred.
**Reason:** original spec, explicit: "Do NOT invent a polymorphic foreign-key framework or redesign this part yet."
**Could it become relevant later?:** Yes — this is a genuinely open design question for whenever Inventory is actually built, not a permanently closed one.

---

## 8. UNFINISHED WORK

No priorities are invented here beyond what's directly evidenced; where no priority was ever stated, none is given.

**Features:**
- Sales module (schema, backend, frontend) — task: build per the "preliminary" design in `database_plan.txt`. Current state: NOT STARTED. What's missing: everything. Dependencies: none technical, but the original spec is explicit that the real workflow needs validation with the business owner first. Blockers: that business-owner confirmation, per the original spec's own instruction — this is a real, stated blocker, not a guess. Known risks: building it from the "preliminary" design without that confirmation directly contradicts explicit project instructions.
- Inventory module (Stock, StockMovement, InventoryLocation) — task: build per `database_plan.txt`. Current state: NOT STARTED. What's missing: everything, plus the unresolved `reference_type`/`reference_id` design. Dependencies: arguably depends on Purchases/Sales existing to have real movement sources, though Stock/Movement could technically be built standalone with manual adjustments first. Blockers: the reference-type design question is explicitly unresolved by instruction, not by oversight. Known risks: same as Sales — an explicit instruction exists not to guess at the open pieces.
- Customer, Item, Item Category master data — task: build per `database_plan.txt`, including resolving the "confirm the customer_type list" open item. Current state: NOT STARTED. Dependencies: Item is needed before Sales' `SalesItem` can be built (SalesItem links to Item, unlike PurchaseItem). Blockers: none stated beyond ordinary implementation work, except the customer_type list, which is explicitly flagged as needing confirmation, not invention.
- Production workflow — task: explicitly deferred, not to be started without business-owner confirmation of the real process. Current state: NOT STARTED, and per original spec, **should not be started** yet.
- Dashboard real data/charts — task: wire the existing skeleton (`admin/page.tsx`) up to real Purchases/Suppliers data (Sales/Inventory once they exist), and actually use the already-installed `echarts`/`echarts-for-react`. Current state: SKELETON ONLY, zero real data wiring. Dependencies: at minimum, Purchases data is already available to chart against today, even before Sales/Inventory exist. No stated priority found for this specific item beyond its place in the original phased plan (Phase 8).
- Reports (`reports.view` permission exists, no actual reports page/feature). Current state: NOT STARTED.
- Units admin frontend page. Current state: backend exists, no frontend CRUD page — currently edited only via re-running the seed script. No stated priority found.

**Backend:**
- Shared Zod validation helper module — the `emptyToUndefined`/`optionalTrimmedString` pattern is duplicated verbatim across `employee.dto.ts`, `purchase.dto.ts`, `purchase-request.dto.ts` (and likely others not read this session). Current state: works correctly, purely a maintainability/DRY issue. No stated priority — this is Claude's own observation from code inspection, not a previously assigned task, and is presented here as a fact about the code, not a recommendation to act on it.
- Broken permission-string references (`customers.manage`, `products.manage`, `inventory.view`) used by frontend nav/dashboard but absent from the backend `PERMISSION_CATALOG`. Current state: pre-existing inconsistency, explicitly noted in README as "worth fixing whenever those modules are actually built, not before" — i.e., this already has an explicit, stated non-priority: **don't fix it yet, on purpose.**

**Frontend:**
- Purchase Requests, Suppliers, Purchases: no E2E test coverage exists.
- User Activity page: explicit stub, "under development" placeholder text only.
- Reports, Sales, Customers, Products/Item Categories, Units admin pages: nav items exist pointing to routes that don't exist yet (aside from Units' distinct partial-implementation situation above).

**Database:**
- Verify and, if needed, complete the Purchase Request migration-ordering fix from this session (delete the old migration folder if not already done, confirm `_prisma_migrations` bookkeeping matches, confirm a fresh `prisma migrate dev` succeeds). Current state: UNCERTAIN, unconfirmed by the user. **This is the highest-confidence "do this first" item in this entire archive**, since an unverified migration-history problem can block all future schema work until resolved.
- No production migration-deploy process has been exercised beyond local dev, per available evidence.

**Testing:**
- No backend unit tests for `access`, `auth`, `purchase-types`, `units` modules.
- No E2E tests beyond `auth.setup.ts` and `employees.spec.ts`.
- No CI pipeline found.

**Security:**
- Session cookie `secure: false` — appropriate for local HTTP-only use today, needs revisiting before any HTTPS/production deployment. No stated priority/timeline found — this is a general Security-agent-relevant observation, not a previously assigned task.
- `SESSION_SECRET` has a hardcoded dev fallback in `main.ts` if the env var is unset — low risk today (local dev only) but worth an explicit "fail loudly instead of falling back" change before production.
- The `Claude outputs/env` plaintext-secret incident (see §9) — resolved for that one file, but its existence suggests a general risk: **scratch/output files created during AI-assisted sessions can accidentally contain real secrets and are easy to miss in `.gitignore` coverage.** Worth a periodic audit, not a one-time fix.

**Infrastructure:**
- No production Docker Compose configuration, no Nginx configuration, despite the original spec naming both as the intended production setup. Current state: PLANNED only.

**Documentation:**
- `README.md` is significantly stale relative to the actual codebase (see §9) — it describes Suppliers and Purchases as "Not started," when both are in fact fully built. This archive itself is new documentation, not a fix to the existing stale doc — **updating `README.md` to match reality is a concrete, well-defined, low-risk task** that would meaningfully help any new contributor, and is flagged here as worth doing early, though no formal priority was ever assigned to it by the user.
- `database_plan.txt` was never updated to reflect the Requester Employee → Department-only simplification, or the Purchase Request module's existence at all (it predates that module).

**Refactoring / technical debt:** covered inline above (Zod helper duplication being the clearest concrete example).

**Research / business requirements needing confirmation with the business owner (not to be resolved by invention):**
- The real Sales workflow.
- The real Production workflow (whether/when it's needed at all).
- Whether Requester Employee should exist alongside Requester Department on Purchase.
- The valid `customer_type` list for Customer.
- `StockMovement.reference_type`/`reference_id` valid values, once Inventory work begins.
- Whether Purchases should ever automatically trigger Inventory stock movements (once Inventory exists).

---

## 9. KNOWN BUGS AND PROBLEMS

**Problem:** `README.md` is stale — it documents Suppliers and Purchases (and Purchase Requests, which it doesn't mention at all) as not built, when they are VERIFIED fully implemented.
**Evidence:** README §4's status table says "Not started" for Supplier/Customer/Unit/Item/Item Category master data and for the entire Purchases transaction area; README's own "Last updated" date is 2026-09-20, while the Suppliers/Purchases/Purchase-Requests migrations are all dated 2026-09-22 or later.
**Affected area:** documentation only — does not affect running code — but **directly affects any future developer or AI agent who trusts README.md as current truth without cross-checking the actual schema/code.**
**Current workaround:** this archive (§2) documents the actual current state; direct code/schema inspection was used throughout rather than trusting the README's status table.
**Known solution:** update `README.md`'s §4 status table and §5 module table to reflect Suppliers/Purchases/Purchase Requests/Units-backend as built, and embed (or link to) the actual current `schema.prisma` rather than the stale copy embedded in README §8.
**Unresolved?:** Yes — not yet fixed.

**Problem:** Broken/unreachable permission-gated nav items and dashboard KPI (`customers.manage`, `products.manage`, `inventory.view` referenced in frontend, absent from backend `PERMISSION_CATALOG`).
**Evidence:** VERIFIED directly — `admin/layout.tsx` nav definitions and `admin/page.tsx` KPI list reference these three strings; `access.service.ts`'s `PERMISSION_CATALOG` const, which is the actual complete and only source of valid permissions, does not contain any of them.
**Affected area:** frontend navigation, dashboard.
**Current workaround:** none — these UI elements are simply unreachable for every role today.
**Known solution:** add these permissions to the catalog (and seed them onto appropriate roles) once the corresponding modules (Customers, Products/Items, Inventory) are actually built — README already states this explicitly as the intended timing ("worth fixing whenever those modules are actually built, not before").
**Unresolved?:** Yes, and per existing instruction, **intentionally left unresolved for now.**

**Problem:** Unconfirmed Prisma migration-history state (the P3006/P1014 ordering bug and its fix).
**Evidence:** detailed in §4 above.
**Affected area:** database schema/migrations.
**Current workaround:** a fix was produced (new migration + bookkeeping SQL) but never confirmed applied/successful by the user.
**Known solution:** the fix itself is on file (`backend/fix_migration_history.sql`, the renamed migration folder); what's missing is confirmation it was actually run, and that the old duplicate folder was deleted.
**Unresolved?:** Yes — **highest-priority verification item for the new team**, per §8.

**Problem (resolved, but worth knowing happened):** a plaintext file (`Claude outputs/env`, not `.env` itself) contained the real database password and session secret, and was not covered by `.gitignore`, discovered while preparing this repository's first push to GitHub.
**Evidence:** VERIFIED directly during this session — file content read, confirmed to contain `DATABASE_URL` (with the real local dev password), `SESSION_SECRET`.
**Affected area:** secrets management / git hygiene.
**Current workaround/fix:** `.gitignore` was updated to exclude the entire `Claude outputs/` folder, before the very first commit/push to GitHub — confirmed via direct inspection of git internals that **no commit had ever been made in this repository before this fix**, so nothing had actually leaked to GitHub at any point.
**Unresolved?:** No, for this specific file — but see §8's Security section for the general pattern-level risk this exposed.

**Problem:** Duplicate `PurchaseType.nameFa` values could previously be created via the Purchase form's inline "add purchase type" affordance.
**Evidence:** VERIFIED, `backend/scripts/merge-duplicate-purchase-types.ts`'s own detailed header comment, describing exactly this bug and stating it has since been fixed at the `PurchaseTypesService.create()` level.
**Affected area:** Purchase Type master data.
**Current workaround:** a one-time cleanup script exists to merge any duplicates that already existed in a real database, re-pointing any Purchases that referenced a duplicate onto the kept row before deleting the duplicate.
**Known solution:** already applied at the code level (duplicate creation is now rejected).
**Unresolved?:** UNCERTAIN whether the cleanup script was ever actually run against real data — worth checking if any duplicate-looking Purchase Type rows are visible in the live database.

**Problem:** Dashboard shows only hardcoded empty states; `echarts`/`echarts-for-react` are installed but entirely unused.
**Evidence:** VERIFIED, direct read of `admin/page.tsx`.
**Affected area:** Dashboard/Analytics.
**Current workaround:** none needed — this is simply unfinished work, not a defect in what exists.
**Known solution:** N/A — greenfield work.
**Unresolved?:** Yes, and expected to be (Phase 8 was never reached).

**Problem:** Two independent AI/tool sessions built different parts of this repository over time, and file contents may not match earlier descriptions of them.
**Evidence:** VERIFIED — direct statement in `README.md` §11: "Two parallel work streams built this repo... Don't assume a file's current content matches an earlier description of it — always re-read the file before editing."
**Affected area:** general project history/institutional knowledge.
**Current workaround:** this archive was compiled by directly re-reading current files wherever possible, per that same instruction, rather than trusting only prior conversation summaries.
**Known solution:** N/A — this is a standing caution, not a fixable bug.
**Unresolved?:** Ongoing caution, not a problem to close out.

**Design/reliability note (not a confirmed bug):** the session cookie is `secure: false`. Not a problem for the system's current local-HTTP-only deployment, but would be a real issue if deployed behind HTTPS without updating this — see §8 Security.

---

## 10. IMPORTANT PROJECT CONTEXT THAT IS EASY TO FORGET

- **User and Employee are permanently, deliberately unlinked.** This was tried the other way, explicitly reversed, and documented in two separate places (README, database_plan.txt) with nearly identical "must not be reintroduced without explicit new instruction" wording. This is the single most emphasized rule in the entire project history.
- **`user_sessions` looking like schema drift is expected, not a bug.** Never resolve it by resetting the database.
- **Never run `prisma migrate reset`** without explicit user confirmation — it drops the entire `public` schema, and the project has real accumulated master/transactional data (employees, suppliers, purchases) that would be lost.
- **Prisma is pinned to v6 for a specific, documented reason** (hosted-platform pivot in later majors) — don't "helpfully" upgrade it.
- **`@base-ui/react`, not Radix**, underlies this project's shadcn/ui components — don't assume Radix APIs.
- **The written `database_plan.txt` is not fully in sync with the actual schema** — most notably, it still shows the two-FK Requester Employee/Department design that was simplified away, and it predates the Purchase Request module entirely. Treat the actual `schema.prisma` as ground truth over this document when they conflict, per README's own explicit instruction.
- **`README.md` is itself stale** (last updated before Suppliers/Purchases/Purchase Requests existed) — don't trust its §4 status table without cross-checking actual code, though its architectural/decision-history content (§1-3, §6, §9, §11) still appears accurate and valuable.
- **The Purchase Request migration-ordering fix from this session was never confirmed successful.** Treat the database's actual migration state as unverified until checked directly.
- **A real secret once sat unprotected in an untracked scratch file** (`Claude outputs/env`) — this was caught before any commit was made, but it's a reminder that AI-session scratch output can contain real credentials and isn't automatically covered by `.gitignore` just because `.env` is.
- **Sales and Production are explicitly "not yet confirmed with the business owner"** — building either beyond their current preliminary/nonexistent state without that confirmation directly contradicts the original project instructions, twice repeated in the original spec.
- **The original spec's exact business-rule text sometimes describes something different from what was actually built** (Requester Employee-or-Department being the clearest example). When the original spec and the current code disagree, this is a **known, existing gap**, not necessarily a mistake to silently "correct" back to the spec — it may reflect a deliberate later simplification that simply was never written back into the spec documents. **When in doubt, ask the business owner rather than picking a side.**
- **The codebase has unusually good self-documentation in code comments** — service files, DTO files, and schema.prisma itself contain extensive "why" comments explaining non-obvious decisions. **Read these comments before changing the code they annotate** — they were clearly written for exactly this handoff situation.
- **This archive was compiled while the live device bridge to the user's machine was intermittently offline**, from a cached snapshot. Treat any claim here about exact current file bytes/timestamps as "true as of the last successful sync," and re-verify against the live repository for anything that matters for a first action (especially the migration-history question above).

---

## 11. UNRESOLVED QUESTIONS

**BUSINESS QUESTIONS:**
- What is the company's actual Sales process? (Explicitly deferred pending business-owner confirmation.)
- Does the company need a Production workflow at all, and if so, what does it actually look like? (Explicitly deferred.)
- Should Purchase support a Requester Employee in addition to (or instead of) Requester Department? (Original spec said both; built system has only Department.)
- What is the valid `customer_type` list for Customer? (Explicitly flagged in `database_plan.txt` as "proposed, confirm the list.")
- Should Purchases ever automatically create Inventory stock movements once Inventory exists? (Explicitly deferred — "do not invent... unless the business requirement explicitly establishes them.")
- Is there a real approval workflow needed for Purchase Requests beyond the current single-status-edit model, or is that intentionally out of scope permanently?

**ARCHITECTURAL QUESTIONS:**
- Is Prisma's classic CLI/local-first workflow still unavailable in current (post-v6) major versions, or has this changed since the pinning decision was made? (Worth a periodic re-check, not an assumption either way.)
- Should the duplicated Zod DTO helpers be consolidated into a shared module? (No stated priority; purely a maintainability question raised by this archive's own inspection, not a previously assigned task.)
- Why was `@base-ui/react` chosen over Radix for shadcn/ui? (Not recorded anywhere found.)

**DATABASE QUESTIONS:**
- Was the Purchase Request migration-ordering fix from this session ever actually applied, and is the live database's `_prisma_migrations` table in the expected state? **(Highest priority to resolve.)**
- Was `backend/scripts/merge-duplicate-purchase-types.ts` ever run against real data, or are there still duplicate `PurchaseType` rows in the live database from before the create-time duplicate check was added?
- Why was Supplier bank info split into three fields instead of the original single field? (Not documented beyond the migration name.)
- Do any existing Employee rows predate the National ID/mobile phone "required going forward" rule, and if so, do they have null values there?

**IMPLEMENTATION QUESTIONS:**
- Should `README.md` and `database_plan.txt` be updated now to reflect actual current state, or left as historical snapshots with this new archive as the authoritative current-state document? (Not decided — a reasonable option either way, not a fact to assert.)
- Should the Units admin frontend page be built now, or is seed-file-editing an accepted permanent workflow for that master data? (Read as a stopgap in the seed.ts comment, but never explicitly revisited.)

**SECURITY QUESTIONS:**
- Should the session cookie's `secure` flag and `SESSION_SECRET` fallback behavior be hardened now, or only when a production/HTTPS deployment is actually imminent? (No stated timeline.)
- Are there other scratch/output locations (beyond the one already found and fixed) that might contain unprotected secrets from AI-assisted sessions?

**DEPLOYMENT QUESTIONS:**
- No production Docker Compose or Nginx configuration exists yet despite being named in the original spec as the target — when is this expected to be built, and by whom (this new agent team, presumably, but no timeline is on record)?
- Has the application ever been run/tested outside the user's local Windows development machine?

**OTHER QUESTIONS:**
- Is the "~30% complete" figure the user has used informally meant to guide the new team's expectations at all, or should it be disregarded entirely in favor of the module-by-module inventory in §2? (Per this archive's own instructions, the module inventory should be treated as the more reliable signal.)

---

## 12. CURRENT DEVELOPMENT PRIORITIES

**Important caveat for this section specifically:** the user has not, in the material available for this archive, laid out an explicit prioritized backlog for the *new* multi-agent team. The items below are priorities that were explicit and active **during the previous (Claude-assisted) development process**, presented here as historical record — not as instructions this archive is inventing on the new team's behalf.

**Priority:** Get the Purchases module's UI to a professional, ERP-appropriate standard.
**Reason:** explicit, detailed user request this session, with strict scope boundaries to avoid destabilizing anything else.
**Dependencies:** none — purely presentational, built on top of the already-functioning Purchases backend.
**Current status:** VERIFIED COMPLETE (list, form, and detail pages all redesigned and confirmed synced).

**Priority (implicit, from build order, MEDIUM confidence):** Get Purchases (and the Purchase Request → Purchase workflow) fully functional before returning to complete the rest of Master Data or starting Sales/Inventory.
**Reason:** inferred from what was actually built, not a stated instruction — see §6.
**Dependencies:** none technical.
**Current status:** Purchases/Purchase Requests are now substantially mature; nothing else in Master Data/Sales/Inventory has been started since.

**Priority:** Get the project onto GitHub.
**Reason:** explicit user request, most recent action before this archive was requested.
**Dependencies:** git hygiene (the plaintext-secret discovery had to be resolved first — see §9).
**Current status:** VERIFIED COMPLETE — initial commit pushed to `https://github.com/Erfanniazi39/DMS`, confirmed via a clean `git status`/`git push` round-trip.

**No other explicit, stated priorities were found for what comes next** (Sales vs. Inventory vs. Customer/Item completion vs. Dashboard wiring vs. fixing the stale README vs. resolving the migration-history question) — **this is itself important information for the Project Manager role to know: the next priority has not yet been set by the business owner and should be asked about, not assumed.**

---

## 13. PROJECT KNOWLEDGE FOR THE NEW AGENT TEAM

The single most important things to internalize before writing or changing anything:

1. **Do not reintroduce a `User`↔`Employee` relationship.** It was tried, explicitly rejected, and this has been stated in writing at least three separate times across this project's history (original architecture, README, database_plan.txt).
2. **Never run `prisma migrate reset`** without explicit, direct confirmation from the human user immediately beforehand — it destroys all data. Before touching migrations at all, **first verify the actual state of `_prisma_migrations` in the live database and whether the duplicate `add_purchase_request_index` migration folder situation (§4, §9) was ever resolved.** This is unconfirmed and is the single highest-risk unresolved item in this handoff.
3. **`README.md`'s "what's built" table is out of date.** Suppliers, Purchases, and Purchase Requests are fully built; the README says otherwise. Trust the actual schema/code (or this archive) over that table, but don't discard the README's architectural and decision-history sections, which remain accurate and valuable.
4. **`database_plan.txt` describes the original intended design, not necessarily what was actually built** — most notably around Purchase's requester model. Where they disagree, that's a known, already-identified gap (§10), not something to silently reconcile in either direction without asking.
5. **Do not build Sales, Production, or Inventory's `reference_type`/`reference_id` design from invention** — all three are explicitly, repeatedly marked in the original spec as requiring business-owner confirmation first. This instruction predates this handoff and still stands.
6. **`PurchaseItem`/`PurchaseRequestItem` are free text, not linked to Item — by design, not oversight.** Item means "things the company makes/sells," and purchases aren't limited to that set.
7. **Purchase's derived fields (`paymentStatus`, `totalAmount`, `paidAmount`) and Purchase Request's derived quantities are never written to directly** — they're recomputed by service-layer logic (`PurchasesService`, `PurchaseRequestsService.recomputeStatus()`). Any new code that touches Purchases or Purchase Requests needs to go through (or trigger) that recompute logic, not bypass it.
8. **`user_sessions` looking like Prisma drift is expected and correct** — it's intentionally unmanaged by Prisma migrations (owned by `connect-pg-simple` instead).
9. **Prisma is pinned to v6 on purpose.** Don't upgrade without re-evaluating the documented reason first.
10. **`@base-ui/react`, not Radix, is this project's shadcn/ui foundation.**
11. **A real secret once sat exposed in an untracked scratch file** before the first git commit was made — no leak actually occurred, but it's a reminder to audit `.gitignore` coverage carefully, especially around any AI-session scratch/output directories, before assuming secrets are safe.
12. **The next development priority has not been set by the business owner** for this new team — don't assume Sales, Inventory, Dashboard-wiring, or anything else is "obviously next." Ask.
13. **This project has unusually thorough in-code reasoning comments.** Read them before changing the code they document — they exist specifically to prevent well-intentioned but wrong "fixes" to deliberate decisions.
14. **Do not treat "~30% complete" as a real number.** Use the module-by-module inventory in §2 to reason about actual scope and remaining work instead.

---

## 14. SOURCE AND CONFIDENCE

Legend used throughout this document: **VERIFIED** (read directly from current project files/code this session), **HISTORICAL** (prior conversation/session history, not independently re-verified this pass), **EXPLICIT USER DECISION** (the human user directly stated this), **CLAUDE RECOMMENDATION** (an observation or suggestion originating from Claude's own analysis, not a user instruction — clearly marked as such wherever it appears, e.g. the Zod-helper-duplication note), **ASSUMPTION/UNCERTAIN** (not confirmed either way).

**High confidence, VERIFIED this session (i.e., read directly from live/cached project files):**
- Full current `schema.prisma` contents and every model/enum/relationship discussed in §4.
- Full backend module list (`backend/src/*`) and frontend admin page list (`frontend/src/app/admin/*`, plus `frontend/src/app/employees`, `login`, root `page.tsx`).
- `package.json` (both frontend and backend) exact dependency versions.
- `access.service.ts`'s exact, exhaustive `PERMISSION_CATALOG`.
- `auth.service.ts`, `main.ts`, both guard files, `seed.ts`, `employee.dto.ts`, `purchase.dto.ts`, `purchase-request.dto.ts`, `admin/layout.tsx`, `admin/page.tsx`, `merge-duplicate-purchase-types.ts` — read in full.
- The migration folder name list (17 folders) and git internals (no commits existed before this session's push; `.gitignore` contents; no remote configured until this session).
- The plaintext-secret file discovery and its fix.
- The successful GitHub push.

**Medium-to-high confidence, HISTORICAL (from prior conversation summary within this same overall session, not re-verified line-by-line this pass):**
- Exact internals of `PurchasesService`/`PurchaseRequestsService`'s recompute logic (the general shape is corroborated by schema/DTO comments read directly this session, but the precise implementation — e.g. exact CANCELLED-purchase exclusion logic — was not re-read verbatim this pass).
- The exact detailed feature spec originally given for the Purchase Request → Purchase integration work.
- The exact sequence and content of the Prisma migration-ordering bug diagnosis and fix.

**Lower confidence / genuinely uncertain, explicitly marked throughout with UNCERTAIN:**
- Reasoning behind several decisions not preserved in any comment or doc (Supplier bank-info split, `@base-ui/react` choice, exact build-order rationale for doing Purchases before completing Master Data).
- Whether the Prisma migration fix was actually applied and confirmed working.
- Whether the duplicate-purchase-type cleanup script was ever run against real data.
- Whether any TypeScript ^6.0.2 pin in `backend/package.json` is intentional or a typo.

**This document itself should be treated as a snapshot as of 2026-09-23**, compiled under a temporarily unreliable connection to the live development machine. Anything time-sensitive (exact file bytes, exact migration state, whether the user has made further manual changes) should be re-verified directly against the live repository before being relied upon for a specific implementation decision.

---

## 15. SESSION LOG — 2026-09-30 UPDATE (read this first, then the rest of the archive for deep history)

Everything below is **VERIFIED** — either built and independently re-verified (fresh `npm test`/`npm run build`/`npx playwright test` runs, not trusted from agent self-reports alone) during a single long session on 2026-09-30, working with a multi-agent Claude Code setup (one coordinating session dispatching `general-purpose` subagents running as Builder/QA-Tester/Architect roles via embedded instructions — see §15.9 on why the intended named custom subagents never actually registered).

**If anything below conflicts with earlier sections of this archive (§1–§14, written 2026-09-23), trust this section — it supersedes them for anything it discusses.**

### 15.1 Migration-history risk — RESOLVED

The archive's own §4/§8/§9/§13 flagged an unconfirmed Prisma migration-ordering bug (`add_purchase_request_index` duplicate folders, `_prisma_migrations` bookkeeping) as **the single highest-priority verification item** for whoever picked this up next. **This is fully resolved and verified.** `npx prisma migrate status` reports clean, up-to-date, no drift beyond the expected `user_sessions` table. The duplicate migration folder is gone. As of this session's end: **21 migrations**, all applied, database up to date. Do not re-litigate this — it was a real risk at archive time, it no longer is.

### 15.2 New modules built this session

- **Return-to-Vendor tracking** (`PurchaseReturn`/`PurchaseReturnItem`) — new. Records what was returned to a supplier and its credit value against a specific `Purchase`. Deliberately does **not** touch `Purchase.totalAmount`/`paidAmount`/`paymentStatus` (those represent what was originally billed; changing them would erase history) and has no status workflow (plain record, like `PurchasePayment`). **Known, accepted limitation:** a `Restrict` FK from `PurchaseReturnItem.purchaseItemId` means a purchase with any return on it **cannot be edited at all** — not even a pure status change — because `PurchasesService.update()` deletes and recreates all line items on every edit. The user was told this explicitly and chose to accept it rather than rework the core update logic. Don't "fix" this without asking first — it was a deliberate trade-off, not an oversight.
- **Units admin frontend page** (`/units`) — the backend CRUD already existed (read-only before); now has full create/update UI. No delete endpoint (retire a unit by setting it inactive — purchase items reference units).
- **Dashboard, wired to real data** (`admin/page.tsx`, new `backend/src/dashboard/`) — was a pure skeleton before (§2.11 in the original archive), now shows real KPI cards (purchase totals/count for the selected period, outstanding unpaid amount, open Purchase Request count), a real `echarts` trend chart (first actual use of that previously-installed-but-unused library), and a "recent activity" panel reading real `AuditLog` entries. **Deliberately excludes login/logout audit events** from the activity feed — `LOGIN_FAILED:<username>:<reason>` entries would leak attempted usernames to anyone with `purchases.manage`, which isn't a user-administration permission. Sales/Inventory KPI cards are untouched — still correctly empty, since those modules don't exist.
- **Customer master data** (`/customers`) — brand new. Fields: `code`, `name`, `customerType` (enum `retail`/`wholesale`/`distributor`/`other` — **this was the one open question in the original archive's database_plan.txt, "proposed, confirm the list" — the user confirmed this exact list this session, it is no longer open**), `phone` (required), `email`/`address`/`note` (optional). **Deliberately no status field, no bank fields** — per `database_plan.txt`'s own note, held back by request. Nothing references Customer yet (Sales would, once built).
- **Item + Item Category master data** (`/items`, `/item-categories`) — brand new. `ItemCategory` mirrors `Unit`'s shape exactly (code/nameEn/nameFa/isActive/sortOrder, no delete, retire via inactive). `Item`: code, name, category (FK Restrict), unit (FK Restrict), description, status (active/inactive), note. **`PurchaseItem` remains untouched — still free text, still NOT linked to `Item`** — this core business rule (Item = "what the company produces/sells," not a universal purchasing catalog) was preserved deliberately, not accidentally forgotten.

With Customer and Item now real, **Sales' master-data prerequisites are met** — `SalesItem` (per the original preliminary Sales design in `database_plan.txt` §Sales) links to `Item`, unlike `PurchaseItem`. Sales itself is still explicitly NOT started and still explicitly requires business-owner workflow confirmation before building (original spec instruction, never superseded) — building the prerequisite master data does not change that gate.

### 15.3 Routing restructure — business modules moved out of `/admin/*`

The original archive (§2.3) already documented that Employees had been deliberately moved to a top-level `/employees` route with a redirect stub left at `/admin/employees`, specifically because Employees isn't administration. **That same treatment was applied this session to Purchases, Purchase Requests, Suppliers, Departments, and Units** — all now live at top-level routes (`/purchases`, `/purchase-requests`, `/suppliers`, `/departments`, `/units`), each with a redirect stub at its old `/admin/*` path (11 stub routes total, all carrying query strings through — important for the Purchase Request → Purchase `?prefill=` flow). Customer/Item/Item Category were built directly at top-level from the start, never under `/admin/`.

**`/admin/*` is now consistently reserved for genuine administration only**: users, roles, permissions, user-permission overrides, user-activity (audit log), add-users, and the dashboard itself (`admin/page.tsx`).

Each top-level module gets its layout chrome via a one-line re-export (`export { default, useAdminUser, AdminUserContext } from "../admin/layout";`) — same pattern Employees already used. **Known side effect, not a bug:** switching between top-level modules (e.g. `/purchases` → `/suppliers`) remounts this layout, so there's a brief loading flash each time — Employees already behaved this way before this session, this isn't new.

### 15.4 Security/access-control fix — read access was previously wide open

A QA pass discovered that `GET /purchases`, `/purchases/:id`, `/purchase-requests` (+`:id`), `/suppliers` (+`:id`), `/employees` (+`:id`) had **no permission check at all** — only session login — meaning any logged-in user, regardless of role, could read purchase financials, supplier data, and employee personal data (national ID, mobile). **Fixed**: new `purchases.view`, `suppliers.view`, `employees.view` permissions now gate these routes, plus the new `customers.view`/`customers.manage` and `items.view`/`items.manage` pairs added alongside the new modules.

**Important nuance preserved correctly**: `PURCHASE_MANAGER` has `employees.view` despite never having had `employees.manage` — this is deliberate, not a mistake. It needs read access to the employee list to populate the buyer/requester dropdown on Purchase and Purchase Request forms, a real cross-module dependency that was verified working (live-tested with a `PURCHASE_MANAGER`-role session) before this was shipped.

**Operational gotcha discovered and worth remembering**: permissions are copied into the session at login (`req.session.permissions`) and are **not** re-read on later requests. Anyone already logged in when a permission change ships needs to log out and back in, or they'll get spurious 403s on things they should now be able to see. This bit both the live admin session and the E2E test sessions multiple times this session — if something that should now be visible isn't, check this before assuming a bug.

### 15.5 Other bug fixes this session

- **Accessibility**: `@base-ui/react`'s modal `Dialog` marks sibling elements `aria-hidden` while open; `ToastViewport` returned `null` when empty (no `aria-live` region present), so it got caught by that hiding — error toasts were visually on screen but invisible to screen readers while a dialog was open. Fixed in `toast.tsx` alone (always renders as a live region now) — fixes every page that uses toasts, not a per-page patch.
- **Persian validation UX**: many forms (Purchase, Purchase Request, Department, Employee, Payment, Document, Supplier, purchase-type quick-add) had native HTML `required`/`type="email"` letting the browser's own English tooltip preempt the app's custom Persian error message. Fixed via `noValidate` + (for Suppliers specifically) a proper custom email-format check added first, so email validation wasn't silently dropped.
- **Suppliers UX bug**: the "add supplier" button/dialog was visible to users without `suppliers.manage`, who'd only discover they were blocked on submit (403). Now correctly hidden per-permission, same pattern used elsewhere.
- **Flaky E2E test**: `employees.spec.ts` test 4 collided with test 5 due to toast text matching two on-screen toasts at once (a side effect of the accessibility fix above — toasts no longer get hidden by a subsequent dialog). Fixed with `.last()` disambiguation.

### 15.6 Pagination added

Neither backend nor frontend had any pagination anywhere before this session — Purchases (66 rows) and Suppliers (74 rows) loaded and rendered everything at once. Now: server-side pagination, 20 rows/page, on Purchases, Suppliers, and Items (Item Category and other small reference-data lists like Units/Departments remain unpaginated, matching how small master data is normally handled). **Response shape is opt-in** (`{items, total, page, pageSize}` only when `page`/`pageSize` query params are sent, plain array otherwise) specifically to avoid breaking other callers of the same endpoints that need the full list (e.g. the supplier dropdown in `PurchaseForm.tsx`). Suppliers' search/status filtering was moved server-side in the process — it used to filter client-side over the full list, which would have silently only searched the visible page once pagination landed.

### 15.7 Purchase/Purchase Request form UX overhaul

User feedback (from actually using the system) drove four fixes to `PurchaseForm.tsx`/`PurchaseRequestForm.tsx`:
1. **Layout widened and tightened** (`max-w-4xl` → `max-w-7xl`, 2-column → 4-column header grid, sticky save bar) — the full create-purchase form now fits one screen at 1366×768 with no scrolling for the common case (few line items).
2. **"درخواست خرید مرتبط" (related purchase request) field now hidden for `HISTORICAL_IMPORT` purchases** — only shown/relevant for `OPERATIONAL`. Double-guarded: cleared client-side on source-type switch, and never sent in the submit payload for historical purchases even if stale.
3. **Richer dropdown labels** — was just `REQ-000042`, now `REQ-000042 — department — item name (+N more) — Jalali date`. Turned out to be frontend-only; the backend already returned enough data.
4. **File upload added directly to the create form** — previously required saving first, then navigating to the detail page. Now stages files locally, uploads them right after the purchase is created (reusing the existing detail-page upload endpoints), with careful failure handling: if a file fails post-save, the purchase itself is never lost, the user gets a clear Persian warning + link to retry from the detail page, and the submit button locks to prevent a duplicate purchase.

### 15.8 Environment fix: Node version

The sandbox's default Node (v22.23.3) **cannot run this project's backend Jest tests at all** — NestJS 12 ships native-ESM packages that Jest can only `require()` under Node ≥24.9. This wasted real time being rediscovered by multiple agents across the session before `backend/.nvmrc` (pinning Node 24) was added. **If `npm test` in `backend/` fails with "Must use import to load ES Module," this is why — not a real test failure.** Use `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH npm test` (or whatever Node 24.x is available via `nvm`) if the shell's default Node isn't already ≥24.9.

### 15.9 Custom subagents — set up but never actually working this session

`.claude/agents/architect.md`, `.claude/agents/builder.md`, `.claude/agents/qa-tester.md` exist with correct frontmatter (verified — `builder.md` initially had a real bug, a missing closing `---` on its YAML frontmatter, which was fixed). **Despite the fix and a lowercase-filename rename (also tried as a suggested fix), none of the three ever registered as invokable `subagent_type` values in this running session** — `Agent` tool calls with `subagent_type: "architect"`/`"builder"`/`"qa-tester"` consistently returned "Agent type not found," even after both fixes. The working theory (untested) is that this session's available-agent-type list was fixed at session start, before these files existed/were fixed, and doesn't hot-reload mid-session. **Everything this session that needed Builder/QA-Tester behavior was done via `subagent_type: "general-purpose"` with the role's full instructions embedded directly in the prompt, plus `model: "opus"` passed explicitly** (matching what `builder.md`'s frontmatter specifies) — this worked fine as a workaround, but the named custom agents themselves were never actually exercised. **Worth testing in a genuinely fresh Claude Code session** (not a continuation of this one) whether they register correctly now — if they do, prefer invoking them directly by name going forward; if not, the embedded-instructions-in-general-purpose pattern used throughout this session's agent prompts (search this session's history for examples) is the reliable fallback.

### 15.10 Other tooling notes

- **`graphify`** — a code-graph CLI (`~/.local/bin/graphify`, index at `graphify-out/graph.json`, 1226+ nodes) was installed by the user mid-session. A machine-level hook now injects a reminder to use `graphify query`/`explain`/`path` for broad code orientation before raw file reads/greps. Measured this session (see conversation history around the graphify token-comparison discussion, not repeated here): genuinely saves tokens (~65-70%) on broad, cross-cutting questions where you don't yet know which files matter; costs *more* tokens (sometimes 4-11x) on narrow single-file lookups where you already know where to look. It's a recall/thoroughness tool, not a blanket cost optimization — use it selectively.
- **`CLAUDE.md`** (repo root) — created this session, holds the condensed hard-rules every agent/session needs (User↔Employee decoupling, never `migrate reset`, Prisma pinned to v6, etc.). Keep its "Current state" section updated as modules get built — it's what a fresh session reads automatically, this archive is the deep-dive.
- This file was renamed this session from `docs/Project knowledge.md` (note the old name had a space and different capitalization) to `docs/project-knowledge-archive.md` — both `builder.md` and `qa-tester.md` reference the new path explicitly; if you ever see a broken reference to the old filename, that's why.

### 15.11 Test coverage, as of session end (independently verified, not just agent-reported)

- Backend: **18 Jest suites, 184 tests, all passing** (under Node ≥24.9).
- Frontend E2E (Playwright): **60 tests, all passing** — covers Employees, Suppliers, Purchases, Purchase Requests, Purchase Request fulfillment flow, permission-denial (a real non-admin `VIEWER`-role browser session genuinely blocked, not just unit-tested guards), admin-route redirects, Customers, Items, Item Categories.
- Two throwaway dev-DB test accounts exist and are being kept intentionally (not accidental leftovers): `e2e_qa_admin` (ADMIN role) and `e2e_qa_viewer` (VIEWER role) — both created through the app's own `POST /users` (argon2-hashed, no raw SQL), passwords never stored, regenerated per E2E run as needed. `E2E_ADMIN_PASSWORD` env var is not set in this sandbox, so E2E runs reuse the saved session at `frontend/e2e/.auth/admin.json` via `--project=chromium --no-deps` rather than re-running the login setup step.

### 15.12 Open questions — updated

The original archive's §11 "Unresolved Questions" list is mostly still accurate, **except**: the `customer_type` list question is **resolved** (`retail`/`wholesale`/`distributor`/`other`, confirmed by the user, already implemented). Still genuinely open, still requiring the business owner (not to be guessed at by whoever picks this up next):
- The real Sales workflow (unchanged — still the biggest blocker to further progress on the transactional side).
- Whether/how tax should be tracked on Purchases (no tax fields exist anywhere in the schema — flagged this session as a possible real compliance gap, not confirmed either way).
- Whether Purchases need a real Goods Receipt entity (partial-delivery date/quantity tracking) instead of just a `RECEIVED` status flag.
- Whether Contracts/blanket orders with suppliers are needed.
- Everything else in the original §11 that wasn't touched this session (Production workflow, Requester Employee question, etc.) — still open, still unaddressed.

### 15.13 Recommended next step

Per the session's own closing discussion: **Sales is the natural next big piece**, and its master-data prerequisites (Customer, Item) are now in place — but it still cannot be started without the business-owner workflow confirmation the original spec has always required. Until that conversation happens, the honest next-best-use-of-time options are: (a) the tax/goods-receipt/contracts business questions above, which block real further growth of the Purchases side, or (b) the supplier price-history hint (a `PurchaseItem`-entry convenience feature, needs a fuzzy-matching design decided since item names are free text) — the only remaining Purchases-adjacent item that doesn't need a business-owner conversation first.

**Git state at session end**: two commits made directly by the user (not by any agent) during this session — `9cf948b` ("update DMS project v0.2") and `b9856f7` ("Update DMS v0.21") — both already pushed to `https://github.com/Erfanniazi39/DMS`. Everything described in this session log (§15.1–§15.11) is included in those commits. Working tree was clean (only untracked doc/config files: `.claude/`, `CLAUDE.md`, `docs/*`, `graphify-out/`) as of this log being written.

---

## 16. SESSION LOG — 2026-10-03 UPDATE (read this first, then §15, then the rest for deep history)

Everything below is **VERIFIED** — a multi-agent Claude Code session (one coordinating session dispatching `architect`/`builder`/`qa-tester` subagents — see §16.6, these registered correctly this session, unlike §15.9's finding). If anything below conflicts with §1–§15, trust this section.

### 16.1 Correction to §15.13: the day's work was NOT actually committed

§15.13 stated the working tree was clean at session end on 2026-09-30. **This was wrong.** At the start of this session (2026-10-03), `git status` showed the entire Customer/Item/Item Category build (backend modules, two migrations, frontend pages, e2e specs) plus `schema.prisma`/`seed.ts`/`access.service.ts`/`app.module.ts` changes still **uncommitted** — independently confirmed by all three subagents during an onboarding readiness check. The dev database itself was fine (`npx prisma migrate status`: 21 migrations, schema up to date — §15.1's resolution still holds), only git was behind. The user committed this work partway through the session (commit `9cb4c94`, "Update DMS v 0.22"). **Lesson for future sessions: don't trust a prior session log's claim about git state — always run `git status` fresh.**

### 16.2 New architectural decision: modular monolith with strict module boundaries

The user did external research and confirmed, as a standing project-level decision, that DMS stays a modular monolith (one NestJS app, one Postgres DB) but with explicit internal module ownership — no microservices without a concrete approved reason, and no module reaching into another module's tables to bypass its business logic. This is now **CLAUDE.md rule 11**, with sub-bullets for the exceptions actually ruled on (see below). This is the first time the project's architecture has been stated as an explicit, durable rule rather than an implicit convention.

An architect-agent audit of `backend/src` found **no actual cross-module writes bypassing business logic** — the codebase was already fairly clean. It found two **medium-risk** spots where a module re-derived another module's *business rule* (not just read its data): Purchase Requests re-implementing Purchases' "what counts as purchased, excluding CANCELLED" rule, and the Dashboard re-implementing the same CANCELLED-exclusion plus "open" status definitions for both Purchases and Purchase Requests. User-approved rulings (now CLAUDE.md rule 11 sub-bullets):
- Simple read-only "does this ID exist and is it active" cross-module lookups, and plain display joins, are an allowed exception — no refactor needed.
- Business-rule logic (status meaning, exclusions, "what counts as open") must be owned by one module and referenced by others, not re-derived.
- Purchases and Purchase Requests stay separate modules (not merged into one "Procurement" module).
- Consolidating the five modules' separate private `AuditLog` writers into one shared service — approved, non-urgent.

### 16.3 Rule-11 boundary refactor — implemented and verified

- New `PurchaseQuantitiesService` (its own small `PurchaseQuantitiesModule`, no dependency on the rest of Purchases) now owns `sumQuantitiesByRequestItem()` — the one definition of "purchased quantity, excluding CANCELLED." `PurchaseRequestsService.withItemQuantities()` and `recomputeStatus()` (which previously had its own *second*, independent copy of the same CANCELLED-exclusion logic — a pre-existing duplication the architect's audit hadn't even flagged) both now call it.
- Circular-dependency avoidance: `PurchaseRequestsModule` imports the small `PurchaseQuantitiesModule` directly rather than all of `PurchasesModule` (which already depends on `PurchaseRequestsModule` for `recomputeStatus()` calls) — no `forwardRef()` needed.
- New `backend/src/purchases/purchase-rules.ts` and `backend/src/purchase-requests/purchase-request-rules.ts` export shared `*_WHERE`/status-list constants (`COUNTABLE_PURCHASE_WHERE`, `OPEN_PURCHASE_WHERE`, `OUTSTANDING_PURCHASE_WHERE`, `OPEN_PURCHASE_REQUEST_WHERE`). `DashboardService` now imports these instead of hardcoding its own copies of the status lists.
- **Verified correct, not just "tests pass":** the builder agent ran the old and new quantity calculations side by side against all 97 real purchase requests / 113 items in the dev database — 0 mismatches. It also booted the full compiled app to confirm the DI wiring (no circular dependency) actually resolves at runtime, not just that `tsc` is happy.
- No behavior change, no schema change, no API change. 188 backend tests passing (184 baseline + 4 new from the dashboard work below).

### 16.4 Dashboard additions, informed by `AI_reports/Purchase_Module_Design_Report.md`

The user had an external "Kimi deep research" report on generic procure-to-pay module design (`AI_reports/Purchase_Module_Design_Report.md`) analyzed against DMS's actual Purchases module. Conclusion: the report assumes a full manufacturing company with production/MRP and a multi-document (PR/RFQ/PO/GRN/Invoice) chain with three-way matching — far beyond DMS's current scope, and most of it (RFQ, landed cost, QC inspection, MRP-driven requisitioning, tiered approval/SoD) should **not** be built speculatively, per the project's existing "don't invent business rules" principle and Production/Sales still being gated on business-owner confirmation. Three low-risk, additive pieces were pulled from it and shipped (no schema change):
- `GET /dashboard/purchases-summary` gained a `topSuppliers` field (top 5 by spend/count/outstanding, following the period filter).
- New `GET /dashboard/open-items`: payment-aging buckets (0-30/31-60/61+ days since `purchaseDate`, UNPAID/PARTIAL only), purchase-request-aging buckets (0-7/8-30/31+ days since `requestDate`, open statuses only), and oldest-10 lists of open purchases and open requests.
- Frontend: three new cards on `/admin` (aging × 2, supplier spend overview, open-items with tabs), all gated behind `purchases.manage` like the rest of the dashboard, each with its own loading/empty/error states.
- **Known, accepted limitation** (stated plainly in the UI, not hidden): since nothing auto-closes a `Purchase` (see new `docs/purchase-module-workflow.md` §2.1), a fully-paid `RECEIVED` purchase still counts as "open" until someone manually closes it — this reflects the real status field honestly rather than inventing a "should be closed" heuristic.
- True on-time-delivery% and defect-rate KPIs from the report were explicitly **not** attempted — `Purchase` has no expected-delivery-date or status-transition-timestamp field to compute them from, and inventing one wasn't in scope.

### 16.5 Frontend lint cleanup + AuditService consolidation

Both deferred items from §16.2 were completed in the same session, same day:
- Fixed all 6 pre-existing `react-hooks/set-state-in-effect` lint errors (and 3 related warnings) across `employees/page.tsx`, `purchases/PurchaseForm.tsx`, `purchases/[id]/page.tsx`, and the shared `components/ui/jalali-date-input.tsx` — by changing each to compute state during render or in the triggering event handler, per React's own guidance, not by suppressing the lint rule. `frontend npm run lint` is now **fully clean (0 problems)**, a first for this project per the available history.
- New `backend/src/audit/` (`AuditModule`, global, `AuditService.log(...)`) replaces five separate private audit-log writers (Purchases, Purchase Requests, Items, Customers, Auth/`AuthController`). Rows written are field-for-field identical to before — confirmed by existing test assertions passing unchanged plus a runtime DI boot check.
- Both changes verified in a live browser session (not just build/test): logged in as `admin`, confirmed the new dashboard sections render with correct/consistent numbers, the Purchase-Request-to-Purchase prefill flow works, a purchase detail page loads, the Jalali date-input pre-fills an existing employee's birth date correctly, and the full logout → wrong-password (correct Persian error) → successful-login cycle works end to end (exercising the new `AuditService` path for `LOGIN_FAILED`/`LOGIN`/`LOGOUT`).

### 16.6 Custom subagents — now working correctly

Unlike §15.9 (where `architect`/`builder`/`qa-tester` never registered as invokable `subagent_type` values), **all three registered and worked correctly this session**, including being resumed mid-session via `SendMessage` to continue with new tasks after their initial onboarding read (rather than being re-spawned from scratch each time). The theory in §15.9 — that the available-agent-type list was fixed at session start before the files existed — appears consistent with this: a fresh session picked them up fine.

### 16.7 New reference documents

- **`docs/purchase-module-workflow.md`** (new) — a from-the-code explainer of exactly how `Purchase`/`PurchaseRequest` status lifecycles, the fulfillment-quantity calculation, payments/documents/returns, and permissions actually work today, including the real behavioral quirks (status fields are freely hand-editable with no enforced transitions; manual edits and the automatic recompute can fight each other; nothing auto-closes a purchase). Written because comparing against the AI_reports document surfaced genuine doubts about the module's actual behavior that the existing archive didn't answer directly. Read this before making any change to Purchase/Purchase Request status logic.
- **`AI_reports/Purchase_Module_Design_Report.md`** (new, user-supplied, not Claude-authored) — external research report on generic procure-to-pay module design. Reference material for *future* scope (if/when the business wants heavier procurement controls), not a spec to implement now.

### 16.8 Git state at session end

Commit `9cb4c94` ("Update DMS v 0.22") captured the Customer/Item/Item Category work plus `CLAUDE.md`/`.claude/`. The rule-11 refactor (§16.3), dashboard additions (§16.4), and lint/AuditService cleanup (§16.5) were made **after** that commit and were uncommitted as of this log being written — check `git status` before assuming they're saved.

---

## 17. SESSION LOG — 2026-10-04 UPDATE (read this first, then §16, then the rest for deep history)

Everything below is **VERIFIED** — a single coordinating Claude Code session (no subagents dispatched; all work done directly, verified with real `npm run build`/`npm test`/`npm run lint` runs and live browser click-throughs, not agent self-reports). Picked up exactly where §16 left off: all of §16.1–§16.7's work (rule-11 refactor, dashboard additions, lint/AuditService cleanup) was found **still uncommitted** at session start, built and tested clean, and was extended rather than redone. If anything below conflicts with §16 or earlier, trust this section.

### 17.1 Dashboard moved from `/admin` to `/main`

The dashboard page (`admin/page.tsx` + its `PurchaseTrendChart.tsx` sibling) moved to a new top-level `/main` route, via `git mv` (history preserved) plus a one-line `main/layout.tsx` re-export of `AdminLayout` — the same pattern already used by `/employees`, `/purchases`, etc. `admin/page.tsx` is now a client-side redirect stub to `/main` (keeping query strings), matching the existing `admin/purchases`-style stub convention. Root `page.tsx`'s redirect and the sidebar's "داشبورد" button/active-check in `admin/layout.tsx` were updated from `/admin` to `/main`. **`/admin/*` continues to hold genuine administration** (users, roles, permissions, audit log) — this move was purely about the dashboard itself, which isn't administration.

### 17.2 Dashboard wording and data-display fixes (user-reported)

- **"سن" (age — a word used for people, not transactions) replaced** everywhere it appeared on `/main`: the two aging-table card titles now say "مدت‌زمان..." instead of "سن...", the aging-table column headers say "بازه زمانی", and the موارد باز (open items) table column header says "مدت".
- **Aging buckets now render as real calendar-date ranges**, computed fresh from today (e.g. "۴ شهریور تا ۴ مهر ۱۴۰۵") instead of a relative "۰ تا ۳۰ روز" label — see `agingBucketRanges`/`jalaliDaysAgo`/`agingBucketLabel` in `frontend/src/app/main/page.tsx`. Dates are computed in plain Gregorian (`Date` arithmetic) then rendered through the existing `formatJalali()` helper, same convention as the rest of the app.
- **موارد باز's per-row "مدت" column now shows a plain-language duration** ("۱۵ سال، ۶ ماه و ۲۱ روز") instead of a raw day count ("5676 روز") — new `formatAgeDuration()` helper, 365/30-day calendar approximation, drops zero-valued units, Persian "X، Y و Z" conjunction style.
- **The dashboard KPI cards were silently swallowing the real error message** behind a generic "دریافت اطلاعات ناموفق بود" — fixed to show the actual backend message (relevant specifically to the next item).
- **The 366-day custom-date-range cap was reported as a bug but is an intentional, documented decision** (`backend/src/dashboard/dto/purchases-summary.dto.ts`'s `MAX_CUSTOM_RANGE_DAYS`): "the dashboard is a 'recent state of the business' view, not a multi-year report — that's what the not-yet-built Reports module is for." **User explicitly confirmed (asked directly): leave it as-is, do not raise/remove it.** Don't re-litigate this without a new explicit instruction.

### 17.3 Purchase Request form UX (user-reported)

- `PurchaseRequestForm.tsx`'s request-date field now **defaults to today** (new `todayIso()` helper) instead of blank — still a plain editable `JalaliDateInput` afterwards. Scoped to this one form only; `PurchaseForm.tsx`'s purchase-date field was deliberately left as-is (not asked for).
- **Replaced the "(اختیاری)" optional-field-label convention with the project's existing `RequiredMark` pattern** (a red `*` on *required* fields, nothing on optional ones — already used in `employees/page.tsx`, just not here). Added a shared `RequiredMark()` export to `purchases/shared.tsx` (so both the Purchase and Purchase Request forms import one definition) and applied it across `PurchaseForm.tsx`, `PurchaseRequestForm.tsx`, and the purchase detail page's payment/return/document dialogs (`purchases/[id]/page.tsx`) — every genuinely-required label/column-header now carries the mark, every "(اختیاری)" suffix (labels, placeholders, `aria-label`s) was removed.

### 17.4 Purchase Request detail page: تایید / ثبت خرید actions

Added two header-level buttons, both permission-gated (not just visually hidden — the underlying endpoints enforce the same permissions):
- **"تایید"** — a shortcut for the already-existing DRAFT/SUBMITTED → APPROVED transition (the same one the edit form's status dropdown always allowed), calling `PATCH /purchase-requests/:id` with the record's own current values plus `status: "APPROVED"`. Requires `purchases.edit`. Shown only when `status` is `DRAFT`/`SUBMITTED`.
- **"ثبت خرید"** — reuses the exact same "ایجاد خرید کامل" logic already on the page (prefills and navigates to the Purchase creation form). Requires `purchases.manage`. Disabled (with an explanatory `title` tooltip) until the request is `APPROVED`/`PARTIALLY_PURCHASED` and has remaining quantity.

**Bug found and fixed during this work**: clicking "تایید" didn't make "ثبت خرید" clickable until a manual page refresh. Root cause — `PurchaseRequestsService.update()` was returning the raw Prisma row straight from the transaction, without the computed `purchasedQuantity`/`remainingQuantity` fields that `withItemQuantities()` (used by every `GET`) attaches; the detail page's `remainingQuantity > 0` filter therefore saw `undefined` for every item until a fresh `GET` ran. Fixed by routing `update()`'s return through `withItemQuantities()` too, so a `PATCH` response is now shape-identical to a `GET` — fixes this for *any* future caller, not just the new button. Two existing unit tests needed their `purchaseRequest.update` mocks updated to include `items: []` (they previously didn't need to, since `update()` never touched `.items` before). All 189 backend tests pass.

**Button colors**: added a `success` variant to `components/ui/button.tsx` (green-tinted, same restrained styling as the existing `destructive` variant, using the `--success` token already defined for status badges). "تایید" uses it; "ثبت خرید" switched from `outline` to the primary `default` (blue) variant. Purely a visual-distinction fix for these two new buttons plus the pre-existing "ویرایش" — not a redesign of buttons elsewhere in the app.

### 17.5 Purchase Requests list: pagination + layout overlap fix

- **Backend**: `PurchaseRequestsService.list()` and its controller gained the same opt-in `page`/`pageSize` pagination `PurchasesService.list()` already had (`parsePagination()`/`toSkipTake()` from `common/pagination.ts`) — omitted params still return the full array (needed by the Purchase form's "درخواست خرید مرتبط" picker), present params return `{items, total, page, pageSize}`.
- **Frontend**: `purchase-requests/page.tsx` now uses the same `ListPagination`/`LIST_PAGE_SIZE`/`Paginated` components as the Purchases list — 20 rows/page, with a page footer.
- **Layout overlap bug, found to be a real bug, not just a narrow-viewport edge case**: both `/purchases` and `/purchase-requests` list tables had a hardcoded `min-w-[Nrem]` *wider than their own container could ever provide* (e.g. `/purchases`' table demanded 76rem inside a 72rem `max-w-6xl` container minus the card's own padding) — meaning the horizontal scrollbar the user was seeing was **permanent, not width-dependent**. Fixed by removing the artificial `min-w-[...]` (table now just `w-full`, sized by actual content) and widening both containers from `max-w-6xl` to `max-w-7xl` to match the already-redesigned Purchase/Purchase-Request forms. The same bug was also found and fixed on the Purchase Request **detail** page's "اقلام درخواستی" table (flagged-but-left in the previous session's response; the user asked for it directly this time).

### 17.6 Purchase Request detail page: scrollable items table

"اقلام درخواستی" table now sits in a `max-h-[26rem] overflow-auto` box with a `sticky top-0` header — a request with many items scrolls within its own bounded box (header staying visible) instead of stretching the whole page. Combined with the `min-w` fix in §17.5.

### 17.7 Sidebar icons

The "خرید" nav group's four sub-items (previously plain text, no icons, unlike every top-level nav item) now have one each: ثبت خرید → `Plus`, خریدها → `ShoppingBag`, ثبت درخواست خرید → `FilePlus2`, درخواست‌های خرید → `ClipboardList` (reusing the same icon already used for the "درخواست‌های خرید باز" KPI, for consistency).

### 17.8 Operational note: admin password was reset for live verification

The seeded `admin` user's original password was a random value from `prisma/seed.ts` that was never saved (per §9/§10's standing caution) and `E2E_ADMIN_PASSWORD` wasn't set in this sandbox — so there was no way to log in and verify any of this in a real browser. **With the user's explicit go-ahead, the `admin` password was reset directly via a one-off script to `TempAdmin#2026`.** This is a real credential change to the dev database, not a cosmetic note — change it (or re-reset it) once done testing. The activity feed during this session showed the user had already independently logged in as `admin` with this password and exercised the new تایید button on REQ-000122/125/126/127/128 themselves before this log was written — organic confirmation that the refresh bug in §17.4 was real.

### 17.9 Git state at session end

**Still nothing from §16 or this session has been committed.** `git status` at the time of writing shows: the `admin/page.tsx` → `main/page.tsx` + `PurchaseTrendChart.tsx` rename staged (from an earlier `git mv`), ~29 modified tracked files (backend: app.module/auth/customers/dashboard/items/purchase-requests/purchases; frontend: admin/layout, main/page, purchases/purchase-requests pages and forms, button.tsx, jalali-date-input.tsx), and untracked new files (`backend/src/audit/`, `purchase-rules.ts`, `purchase-request-rules.ts`, `purchase-quantities.*`, `frontend/src/app/admin/page.tsx` redirect stub, `frontend/src/app/main/layout.tsx`, plus the pre-existing untracked docs: `CLAUDE.md`, `.claude/`, `AI_reports/`, `docs/*.md`/`.pdf`/`.docx`). **This covers two full sessions' worth of work (§16 + §17) with zero commits** — if anything happens to this working tree before a commit is made, all of it is at risk. A new `docs/project-state.md` was created alongside this update specifically to track this kind of in-flight, not-yet-committed status going forward — check it first in any new session, before this archive.