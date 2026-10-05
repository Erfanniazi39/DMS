# DMS frontend (Next.js 16 App Router + React 19 + Tailwind v4)

Persian, RTL, Vazirmatn, `lucide-react` icons, dense ERP-style UI. Hard rules live in the
repo-root `CLAUDE.md`, and history lives in `docs/project-knowledge-archive.md`. Both are
local-only (gitignored). `AGENTS.md`: this Next.js version has breaking changes, so check
`node_modules/next/dist/docs/` before using unfamiliar APIs.

## Layout

- Business modules are top-level routes: `src/app/purchases`, `purchase-requests`, `suppliers`, `departments`, `employees`, `units`, `customers`, `items`, `item-categories`. The dashboard is at `main/`.
- `src/app/admin/` holds only real administration (users, roles, permissions, audit log). Old `/admin/<module>` paths are redirect stubs.
- Model new screens on `src/app/purchases/` (see its README).

## App shell and session (moved out of `/admin` in batch 2)

- `components/app-shell/AppShell.tsx`: header, sidebar, and session loading. Each route's `layout.tsx` re-exports it as its default.
- `components/app-shell/nav-config.ts`: sidebar entries as pure data. A child's `permission` hides it from users who lack that permission.
- `lib/session.tsx`: `SessionUserContext` / `useSessionUser()` (from `GET /auth/me`). `useAdminUser`/`AdminUserContext` are legacy aliases, also re-exported from `app/admin/layout.tsx`.

## Talking to the backend

Use only `lib/api.ts`. Never call `fetch()` ad hoc.

- `apiFetch<T>(path, options)`: JSON. It prefixes `/api`, which `next.config.ts` rewrites to `http://localhost:3001`, and sends cookies.
- `apiUpload<T>(path, file, fieldName)`: multipart file uploads.
- Both throw `ApiError` `{ message, status, messages?, code?, details? }`. Check `code` for machine-readable cases (`RECORD_MODIFIED`, `PURCHASE_QUANTITY_EXCEEDS_REQUEST`).

## Permissions in the UI

- `components/require-permission.tsx`: `<RequirePermission permission message>` wraps form pages reached by URL (e.g. `/purchases/new`). Without the permission, the form is not mounted.
- Hide individual actions by checking `useSessionUser().permissions`.
- Permission codes must already exist in backend `PERMISSION_CATALOG`. The UI check is for convenience. The backend guard is authoritative.

## Shared UI and helpers (moved out of `app/purchases/shared.tsx` in batch 2)

- `components/ui/status-badge.tsx`: `StatusBadge`, `BadgeTone`, `toneCellClasses`, `ColorLegend`. Each module maps its own statuses to a tone.
- `components/ui/form-field.tsx`: `RequiredMark`, `selectClass`, `textareaClass`.
- `lib/format.ts`: `formatMoney`, `todayIso`. Jalali display is in `lib/jalali.ts`, and the date input is `components/ui/jalali-date-input.tsx`.
- `lib/reference-options.ts`: master-data option types (`SupplierOption`, `UnitOption`, `EmployeeOption`, ...) and `employeeFullName`.
- `lib/roles.ts`: Persian role labels.
- Other primitives: `components/ui/` (button, card, dialog, input, label, list-pagination, toast).

`app/purchases/shared.tsx` still re-exports the moved items for old imports. New code
should import from the canonical paths above.

## Components: `@base-ui/react`, not Radix

shadcn/ui here is built on **`@base-ui/react`**. Do not write Radix-shaped APIs and do not
install Radix. Charts use `echarts` / `echarts-for-react` only. Never hard-code colours;
use the tokens in `src/app/globals.css`.

## Commands (run from `frontend/`)

```bash
npm run dev       # http://localhost:3000 (backend must run on :3001)
npm run build
npm run lint
npm run test:e2e  # Playwright, e2e/*.spec.ts. Its webServer config starts backend + frontend.
```

Run `npm run build && npm run lint` before declaring frontend work done.
