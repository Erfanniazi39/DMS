# QA Test Report — 2026-09-30

## Scope

Backend unit tests (Jest) and frontend E2E tests (Playwright) for the modules that actually
exist today: Users & Access (auth, roles, permissions), Employee, Department, Supplier, Unit,
PurchaseType, Purchase, PurchaseRequest. Sales, Inventory, Customer, Item/Item Category are not
built yet and were not touched.

## Environment note (read this first)

The sandbox's Node was v22.23.3. NestJS 12's packages ship as native ESM, and Jest under Node
< 24.9 cannot `require()` them even with `--experimental-vm-modules` — **7 of 8 backend test
suites failed to even load**, unrelated to any application bug. Installed Node v24.21.0 via
`nvm` (already present on the box) and ran all backend commands under it; no repo files were
changed to work around this. Anyone running `cd backend && npm test` on Node 22 here will see
this same wall of failures — worth fixing at the environment/CI level (pin Node ≥24.9, or add
Jest's ESM transform config).

The sandbox's root disk was also essentially full (608 KB free), which crashed headless Chromium
outright. Freed ~1.5 GB by clearing only regenerable caches under `~/.cache` (Chrome, an unused
`ms-playwright-go` cache, pnpm store, node/prisma/pip caches) — no project files or personal
documents touched.

The real seeded `admin` account's password isn't recoverable (the seed script prints it once,
never stores it). Rather than touch that account, a second ADMIN-role user (`e2e_qa_admin`) was
created directly in the dev database for running the E2E suite. This is an addition, not a
modification — nothing about the existing `admin` user or any other row was changed.

## Results

**Backend build:** `npm run build` — clean, no errors.

**Backend tests, before my changes:** 7 suites failed to load (Node/ESM issue above); the 1
suite that did load (`create-user.dto.spec.ts`) passed, 4/4 tests. Once run under Node 24: 8
suites, all passing except one real bug in an existing test (see Results → fixed below).

**Backend tests, final:** `npm test` — 14 suites passed, 87 tests passed, 0 failed.

**New backend unit tests added** (closing the stated coverage gap for `access`, `auth`,
`purchase-types`, `units`):
- `backend/src/access/access.service.spec.ts` — role create/update, PERMISSION_CATALOG
  allowlist rejection, duplicate role name, effective-permission union/dedup for a user.
- `backend/src/auth/auth.service.spec.ts` — all five `LoginAttemptResult` branches
  (`not_found`/`locked`/`disabled`/`invalid_password`/`ok`), permission-name dedup, login
  recording, audit log write.
- `backend/src/auth/guards/session-auth.guard.spec.ts` — allows a session with `userId`,
  rejects no session / no `userId`.
- `backend/src/auth/guards/permissions.guard.spec.ts` — allows when no permission required,
  allows when all required permissions present, rejects when any is missing.
- `backend/src/purchase-types/purchase-types.service.spec.ts` — active-only listing,
  sortOrder increment, duplicate-code rejection, duplicate-name rejection (the business rule
  called out explicitly in the task).
- `backend/src/units/units.service.spec.ts` — active-only listing, empty-list case.

**Existing test fixed:** `backend/src/suppliers/suppliers.service.spec.ts`'s "deletes an
existing supplier" test had a stale mock — `SuppliersService.remove()` guards against deleting a
supplier with purchase history (`prisma.purchase.count`), but the test's Prisma mock never
defined `purchase.count`, so it threw `TypeError` once the ESM/Node issue above was no longer
masking it. The application logic itself was correct; only the test mock was out of date. Added
the missing mock plus a new "rejects deleting a supplier that still has purchase history" test.

**E2E, full suite (`npx playwright test`), final run:** 16 tests, **15 passed**, 1 failed
(pre-existing, see Defects).

**New E2E tests added:**
- `frontend/e2e/suppliers.spec.ts` — create success, duplicate-code rejection, duplicate-name
  rejection, edit success. (4 tests)
- `frontend/e2e/purchase-requests.spec.ts` — create success (server-generated `REQ-######`),
  empty-items client-side rejection, edit (note + priority) success. (3 tests)
- `frontend/e2e/purchases.spec.ts` — OPERATIONAL create success (server-generated
  `PUR-######`, starts `DRAFT`), HISTORICAL_IMPORT create without department/buyer (tests the
  sourceType-conditional required rule), empty-items rejection, edit (status + note) success.
  Employee/department prerequisites are created via a direct API call (arrange), the purchase
  itself is driven through the real UI (act/assert). (4 tests)

All 11 new E2E tests pass, plus the 4 pre-existing Suppliers/Purchases/Purchase-Requests tests
they build on.

## Defects found

**[MEDIUM] Validation-error toasts become inaccessible while their own dialog is open.**
- Steps: open any create/edit `Dialog` (e.g. Employees → "افزودن کارمند جدید", or Suppliers →
  "افزودن تأمین‌کننده") and submit invalid/duplicate data so a `pushError`/`pushErrors` toast
  fires while the dialog stays open.
- Expected: the error toast is reachable by assistive technology (`role="alert"`) while visible.
- Actual: `@base-ui/react`'s modal `Dialog` marks background siblings `aria-hidden`/inert while
  open. `ToastViewport` is rendered as a sibling of the dialog, not inside its portal, so the
  toast is visually on screen (confirmed via screenshot, exact expected text present) but absent
  from the accessibility tree — a screen-reader user gets no feedback that their submission
  failed. Reproduced 3/3 times via the pre-existing `employees.spec.ts` test ("adding an
  employee with invalid field formats...") and independently confirmed on Suppliers' create
  dialog. Sighted users aren't blocked (the toast renders visually above the dialog,
  `z-[100]` vs `z-50`), which is why this wasn't MEDIUM→HIGH. Worked around it in the new
  Suppliers tests using `getByText()` instead of `getByRole("alert")`; the pre-existing
  `employees.spec.ts` test was left as-is (not mine to fix, and changing it would just hide the
  bug). Likely affects every other `Dialog`-based form that shows validation toasts while open
  (e.g. the "+ افزودن نوع خرید جدید" quick-add on the Purchase form).

**[LOW] Native browser validation shows an English/generic message instead of the app's Persian
one for several required fields.**
- Steps: on the Purchase or Purchase Request full-page form, leave a `required`-attributed
  field empty (purchase type, supplier, department, buyer employee, or any `JalaliDateInput`,
  which propagates `required` to its year/month/day `<select>`s) and submit.
- Expected: the app's own Persian error message (e.g. "همه فیلدهای اطلاعات خرید الزامی است.").
- Actual: the browser's native constraint validation intercepts the submit first and shows its
  own generic, English tooltip (e.g. "Please select an item in the list."), so the custom
  Persian branch of `PurchaseForm.submit()` for that condition is effectively unreachable
  through normal use. Functionally harmless (the browser still guides the user to the right
  field and blocks the bad submit) but breaks the app's stated Persian-only/RTL UI convention.
  Confirmed directly while building `purchases.spec.ts` test 3 (had to switch that test's
  scenario to the items-table path, which has no native `required` and does reach the custom
  message).

**[LOW / test-fragility, not investigated further] `employees.spec.ts` test 4** ("editing an
employee to reuse another employee's national ID is rejected") fails in isolation with a
Playwright strict-mode violation: it creates two employees back-to-back, and both share the
identical success-toast text ("کارمند جدید با موفقیت ایجاد شد."); since toasts auto-dismiss
after 6s, both can be on screen at once, so `getByRole("status").filter({hasText:...})` resolves
to 2 elements instead of 1. This is a pre-existing test I did not write or modify — flagging it
here rather than silently ignoring it, per the task's instructions. Needs debugger only if the
team wants to fix the test itself (not an application bug).

## Questions for the user (things to check by hand)

- Visual/layout review of the new Suppliers/Purchases/Purchase-Requests E2E flows — these tests
  check behavior and text, not pixel layout, spacing, or RTL rendering correctness.
- Whether the `e2e_qa_admin` account (ADMIN role, dev DB only) should be kept for future CI runs
  or removed — it was added because the real `admin` password isn't recoverable.
- Decide whether the aria-hidden toast defect and the native-vs-custom-validation-message defect
  are worth fixing now or deferred — both are real but neither blocks a core workflow.
- Full permission-denial E2E coverage (a non-admin user actually being refused a specific screen
  action in the browser) wasn't added — the new `SessionAuthGuard`/`PermissionsGuard` unit tests
  cover the enforcement logic directly, but no E2E test drives a low-privilege user through the
  UI to confirm the guard is wired up correctly end-to-end on every route.
- Purchase Request → Purchase linking/fulfillment UI flow (the "ایجاد خرید"/"خرید باقی‌مانده"
  prefill actions on the Purchase Request detail page, and `recomputeStatus()`'s effect on
  request status) is covered by existing backend unit tests
  (`purchases.service.spec.ts`/`purchase-requests.service.spec.ts`) but not by a new E2E test —
  out of scope for "brief," flagging as a gap.
- Node version mismatch (repo needs Node ≥24.9 for `npm test` to even run under plain Jest) is
  worth fixing at the environment/CI level so this isn't rediscovered by the next person.
