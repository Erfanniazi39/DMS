# Customers module (frontend)

Governed customer master data (2026-10-06 rebuild). Backend: `backend/src/customers/`
(plus `customer-groups/`, `territories/`, `payment-terms/`). All calls go through
`apiFetch`/`apiUpload`. `customerNumber` ("CUS-000001") is always server-generated;
`legacyCode` is the old user-typed code, read-only and searchable, never "the" number.

## File map

- `layout.tsx`: re-exports the shared `AppShell`. `error.tsx`: route error fallback.
- `page.tsx`: search-first list. One box searches number, name, legal name, legacy code,
  phone, national id and contact names (normalized server-side: ي/ك, ZWNJ, Persian digits).
  Filters: status (archived hidden unless chosen; "همه (با بایگانی‌شده)" = `status=ALL`),
  group, territory, kind. Warning icon = pinned WARNING note or credit hold.
- `new/page.tsx` → `<RequirePermission customers.manage>` + `<CustomerForm mode="create">`.
- `[id]/edit/page.tsx` → `<RequirePermission customers.manage>` + `<CustomerForm mode="edit">`.
- `CustomerForm.tsx`: identity / classification / communication (+ optional first address
  and first contact in create mode). Sends `updatedAt` on edit (`RECORD_MODIFIED` → stale
  banner). Never sends status.
  - `_form/FormSection.tsx`: section chrome (copy of the Purchases one).
  - `_form/DuplicateCandidates.tsx`: the `CUSTOMER_POSSIBLE_DUPLICATE` panel. **Inline
    banner, not a Dialog** (same rule as `purchases/_form/RequestPicker.tsx`). Confirm
    resubmits the same payload with `acknowledgeDuplicates: true`; any field edit clears it.
- `[id]/page.tsx`: detail page. Holds the loaded customer + stale flag; each section owns
  its own dialog state and calls `onChanged` (reload) after a write.
  - `_sections/StatusActions.tsx`: header (number, name, status, group, primary contact,
    credit-hold + pinned-warning banners) and status buttons → `PATCH /customers/:id/status`
    with `{ status, reason, updatedAt }`. Reason required for SUSPENDED/ARCHIVED.
    Archive/unarchive buttons only with `customers.archive`. Delete only shown when the
    customer has no child records (otherwise archive).
  - `_sections/OverviewSection.tsx`: fields + missing-data indicators. National id masked
    until "نمایش" is clicked.
  - `_sections/ContactsSection.tsx`, `AddressesSection.tsx`, `NotesSection.tsx`,
    `DocumentsSection.tsx`, `ComplaintsSection.tsx`: table + add/edit Dialog each.
  - `_sections/FinancialSection.tsx`: policy only, `customers.finance` only. No balance —
    placeholder text until Sales/finance exists.
  - `_sections/HistorySection.tsx`: `GET /customers/:id/history` with field-level changes.
  - `_sections/DetailSection.tsx`: section chrome + toast-callback type.
- `shared.tsx`: types mirroring backend responses, Persian labels, tones, helpers.

Reference-data pages (straight copies of `item-categories/page.tsx`):
`/customer-groups`, `/territories`, `/payment-terms` (adds `dueDays`).

## Backend contract (summary)

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/customers?q&status&customerGroupId&territoryId&customerKind&page&pageSize` | customers.view | list rows have no `nationalId` |
| GET | `/customers/:id` | customers.view | detail; `financialSummary` only |
| GET | `/customers/:id/history` | customers.view | financial diffs hidden without customers.finance |
| GET | `/customers/assignable-users` | customers.manage | complaint owner picker |
| POST | `/customers` | customers.manage | 409 `CUSTOMER_POSSIBLE_DUPLICATE` (soft) / plain 409 (national id) |
| PATCH | `/customers/:id` | customers.manage | `updatedAt` required |
| PATCH | `/customers/:id/status` | customers.manage (+ customers.archive for ARCHIVED in/out) | |
| DELETE | `/customers/:id` | customers.manage | only with zero child records |
| POST/PATCH/DELETE | `/customers/:id/{contacts,addresses,notes}[/:childId]` | customers.manage | |
| POST/PATCH/DELETE | `/customers/:id/complaints[/:complaintId]` | customers.manage | PATCH needs `updatedAt` |
| GET/PATCH | `/customers/:id/financial` | customers.finance | PATCH needs `updatedAt` |
| POST/DELETE | `/customers/:id/documents[/:documentId]` | customers.manage | |
| POST | `/customers/:id/documents/:documentId/file` | customers.manage | multipart, 10 MB, pdf/png/jpg |
| GET | `/uploads/customers/:filename` | customers.view | guarded download |
| GET | `/customer-groups`, `/territories`, `/payment-terms` | logged in | active only |
| GET | `.../all` | customers.view | |
| POST/PATCH | `/customer-groups`, `/territories`, `/payment-terms` | customers.manage | |

## Before changing this module

- Check the backend DTO/response first; don't invent fields.
- Keep the UI mirrors of backend rules in sync: `REASON_REQUIRED_STATUSES` and the status
  matrix (`backend/src/customers/customer-rules.ts`), national-id length by kind
  (`customer.dto.ts`), upload limits (`customer-documents.service.ts`).
- No Sales/Transactions tab until Sales exists.
- After a change: `npm run build && npm run lint`. E2E: `e2e/customers.spec.ts` (needs a
  rewrite for this version — see the 2026-10-06 report).
