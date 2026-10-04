# DMS — Distribution Software System (Business System)

Internal, Persian-language (RTL) ERP-style business management system ("Alish Automation").
Modular monolith: Next.js 16 frontend + NestJS backend + PostgreSQL 16 (Docker), Prisma 6 pinned.

Full context, module-by-module status, business rules, and history: **`docs/project-knowledge-archive.md`** — read it before any non-trivial task. This file only holds the rules that must never be silently broken.

## Hard rules — do not violate without explicit new user instruction

1. **`User` and `Employee` have zero relationship.** No FK either direction, ever. This was built, explicitly rejected, and reversed once already. Do not reintroduce it.
2. **Never run `prisma migrate reset`, `db push --force-reset`, or any DROP** without explicit user confirmation immediately beforehand. This is real production/dev data.
3. **`user_sessions` table drift is expected and correct** — it's intentionally unmanaged by Prisma (`@@ignore`), owned by `connect-pg-simple`. Never "fix" it by resetting.
4. **Prisma stays pinned to major version 6.** Don't upgrade without re-evaluating the documented reason (Prisma 7+ pivots to a hosted-platform CLI that doesn't fit self-hosted Postgres).
5. **`PurchaseItem.name` / `PurchaseRequestItem.name` are plain text, never FK'd to Item.** Item means "things the company produces/sells"; purchases aren't limited to that set.
6. **Purchase's derived fields never get written directly:** `Purchase.paymentStatus`, `Purchase.totalAmount`, `Purchase.paidAmount` — always via `PurchasesService`'s recompute logic. Same for `PurchaseRequest.status` transitions to `PARTIALLY_PURCHASED`/`COMPLETED` — always via `recomputeStatus()`.
7. **Purchases must not trigger Inventory stock movements** unless a future explicit business requirement says so.
8. **`@base-ui/react`, not Radix**, underlies shadcn/ui here. Don't write Radix-shaped code; don't install Radix.
9. **Do not build Sales, Production, or Inventory's `reference_type`/`reference_id` design from invention** — all three explicitly require business-owner confirmation first (not yet given).
10. **Stock balances (once Inventory exists) must never change without a corresponding StockMovement record** — no silent `500 → 700`, always record the event.
11. **Modular monolith with strict internal module boundaries — confirmed architectural decision, 2026-10-03.** One NestJS app, one Next.js app, one PostgreSQL database. Do not introduce microservices without a concrete, approved technical reason (independent scaling, different runtime, real deployment constraint) — this is a small team on-premise system; microservices would add unjustified operational complexity. Each backend module (Sales, Purchases, Inventory, Employees, Suppliers, Customers, Documents, Workflow, Reports, Admin/Auth, etc.) owns its own business logic and data. A module must not reach into another module's tables to bypass its business logic, and should not casually read/write another module's tables directly either — prefer going through that module's service. Keep boundaries strong enough that a module could plausibly be extracted into its own service later if a real reason ever emerges — this is a design constraint to preserve optionality, not a plan to actually do it. **Before any change that would weaken these boundaries (merging module logic, a cross-module shortcut write, a new "distributed monolith"-shaped split), explain the reason and get explicit approval first — don't just do it.**
    - **Documented exception (approved 2026-10-03):** simple read-only "does this ID exist and is it active" cross-module lookups (e.g. Purchases checking a Department/Supplier/Unit is active) are allowed directly via Prisma — not a violation. Plain read-only display joins (e.g. `include:` for supplier/department names on a detail page) are also fine.
    - **Not allowed (approved 2026-10-03):** re-deriving another module's *business rule* instead of asking it. Concretely: Purchase Requests' fulfilled-quantity calc must call a `PurchasesService` method (e.g. `sumQuantitiesByRequestItem()`) instead of re-deriving the CANCELLED-exclusion rule itself; Dashboard/Reports must call owning-module service methods for anything that encodes a business rule (status meaning, exclusions, what counts as "open"/"outstanding") rather than re-implementing it from raw tables. Purchases and Purchase Requests stay separate modules (not merged into one "Procurement" module) — fix via an explicit service method, watch for the circular-dependency risk (Purchases already injects PurchaseRequests).
    - **Approved for later, not urgent:** consolidate the per-module private `AuditLog` writers (Purchases, Purchase Requests, Customers, Items, Auth) into one shared `AuditService`.

## Stack conventions

- **Validation:** Zod only, via `ZodValidationPipe`. Never `class-validator`.
- **Auth:** session-based (`express-session` + `connect-pg-simple`), not JWT. `SessionAuthGuard` + `@RequirePermissions(...)`.
- **Permissions:** must exist in `PERMISSION_CATALOG` (`backend/src/access/access.service.ts`) before being referenced anywhere in frontend nav/guards.
- **API:** frontend talks to backend only through `apiFetch()` in `lib/api.ts`. No ad-hoc fetches.
- **UI:** Persian text, RTL layout, Vazirmatn font, `lucide-react` icons, dense ERP-style (Odoo/ERPNext-like) — model new screens on `frontend/src/app/admin/purchases/`. No large rounded cards, gradients, glassmorphism.
- **Document numbers** (e.g. `PUR-000001`) are always server-generated, never accepted from the client.
- **Charts:** `echarts` / `echarts-for-react` are installed — use them, don't add another chart library.

## Dev environment

- Postgres via `docker compose up` (service `postgres`, container `business_system_postgres`).
- Backend: `cd backend && npm run start:dev` → `http://localhost:3001`.
- Frontend: `cd frontend && npm run dev` → `http://localhost:3000`.
- Before creating a migration: `cd backend && npx prisma migrate status` first.
- Backend checks before declaring work done: `npm run build && npm test`.
- Frontend checks before declaring work done: `npm run build && npm run lint`.

## Current state (see `docs/project-knowledge-archive.md` §15 for full detail — updated 2026-09-30)

Mature: Users & Access, Employee/Department, Supplier, Purchases, Purchase Requests, Return-to-Vendor tracking, Units, Customer, Item/Item Category, Dashboard (wired to real Purchase data).
Not started: Sales, Inventory, Reports. Sales' master-data prerequisites (Customer, Item) now exist, but Sales itself still requires business-owner workflow confirmation before building — per the original spec, not yet given.
Business-operation modules (Purchases, Purchase Requests, Suppliers, Departments, Units, Customers, Items, Item Categories) live at **top-level routes**, not under `/admin/*` — `/admin/*` is reserved for genuine administration (users, roles, permissions, audit log). Old `/admin/<module>` paths still work via redirect stubs.
The next development priority has **not** been set by the business owner for Sales/tax/goods-receipt/contracts specifically — don't assume what's "obviously next" there.

## Known environment gotchas

- **Node version:** the default shell Node may be v22, which cannot run `backend`'s Jest tests at all (NestJS 12 ships native ESM; Jest needs Node ≥24.9). `backend/.nvmrc` pins Node 24 — if `npm test` fails with "Must use import to load ES Module," this is why, not a real failure. Use `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH npm test` (or whatever Node 24.x is available) if needed.
- **Session-cached permissions:** permissions are copied into the session at login and not re-read afterward. After any permission/role change, existing logged-in sessions (including your own browser session) need to log out and back in, or they'll get stale/incorrect 403s.
- **Custom subagents** (`.claude/agents/architect.md`/`builder.md`/`qa-tester.md`) exist with correct frontmatter but never successfully registered as invokable `subagent_type` values in past sessions — worth testing again in a fresh session; if still broken, fall back to `subagent_type: "general-purpose"` with the role's instructions embedded directly in the prompt (plus `model: "opus"` for Builder/Architect).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
