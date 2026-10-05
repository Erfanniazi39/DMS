# Dashboard module (backend)

Read-only analytics for the `/main` dashboard page. It writes nothing. It reads the
derived Purchase fields (`totalAmount`, `paidAmount`, `paymentStatus`) exactly as
`PurchasesService` persisted them and never recomputes them. Background:
`docs/project-knowledge-archive.md` §2.11, §16.4, §17.1–17.2.

## Files

- `dashboard.controller.ts`: `GET /dashboard/purchases-summary`, `GET /dashboard/recent-activity`, `GET /dashboard/open-items`. All three require `purchases.manage`.
- `dashboard.service.ts`: `getPurchasesSummary()` (KPIs, spend chart, top suppliers, latest purchases), `getOpenItems()` (aging buckets, oldest open purchases/requests), and recent activity.
- `dto/purchases-summary.dto.ts`: the period query schema (`today` / `week` / `month` / custom `from`–`to`).

## Business rules come from the owning modules (CLAUDE.md rule 11)

The dashboard never defines what counts as "open", "outstanding", or "countable". It
imports those definitions:

- `COUNTABLE_PURCHASE_WHERE`, `OPEN_PURCHASE_WHERE`, `OUTSTANDING_PURCHASE_WHERE` from `purchases/purchase-rules.ts`.
- `OPEN_PURCHASE_REQUEST_WHERE` from `purchase-requests/purchase-request-rules.ts`.
- Recent activity uses the global `AuditService.listRecent()` (filtered to Purchase/PurchaseRequest entity types). It does not query `prisma.auditLog` directly. Auth events are excluded on purpose.

`dashboard.module.ts` deliberately does **not** import `PurchasesModule` or
`PurchaseRequestsModule`. It runs Prisma aggregates, groupBy, and counts on top of those
rule constants. This read-only access is the allowed exception. If a new figure needs a
rule that has no constant yet, add the constant to the owning module's rule file first.

## Bounds and calendar details found in code

- Custom range is capped at **366 days** (`MAX_CUSTOM_RANGE_DAYS` in the DTO). Anything longer is a Persian 400 error. Multi-year reporting belongs to the future Reports module.
- Ranges up to 62 days (`DAILY_BUCKET_MAX_DAYS`) are charted per day. Longer ranges are charted per 7 days.
- "Today", "this week", and "this month" use the Tehran calendar day. The week starts on Saturday, and the month is the current Jalali month.
- Aging means age since the record's own date. Purchase has no due date, so there is no "overdue" figure.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- dashboard
```
