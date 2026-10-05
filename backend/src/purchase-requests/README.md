# Purchase Requests module (backend)

Owns `PurchaseRequest` and `PurchaseRequestItem` (`REQ-000001`, server-generated).
`PurchaseRequestItem.name` is plain text with no FK to Item (CLAUDE.md rule 5). A
Purchase links to its request through `Purchase.purchaseRequestId`, and each purchase line
links through `PurchaseItem.purchaseRequestItemId`. The request side never links back.
Background: `docs/project-knowledge-archive.md` §2.8, §17.3–17.6, §19.

## Files to open first

- `purchase-requests.service.ts`: list/get/create/update, `recomputeStatus()`, item diffing (`matchItems()`), `withItemQuantities()`.
- `purchase-request-rules.ts`: `OPEN_PURCHASE_REQUEST_STATUSES`/`_WHERE` and `LINKABLE_PURCHASE_REQUEST_STATUSES`. These are pure values with no DI.
- `dto/purchase-request.dto.ts`: Zod schemas built from `common/zod-fields.ts`.
- `purchase-requests.controller.ts`: `GET /` and `GET /:id` (`purchases.view`), `POST /` (`purchases.manage`), `PATCH /:id` (`purchases.edit`). There is no DELETE.

## Status rules (CLAUDE.md rule 6)

- `PARTIALLY_PURCHASED` and `COMPLETED` are **system-only** (`SYSTEM_ONLY_STATUSES`). `update()` refuses any edit that moves a request into either one. The DTO still accepts them so that a request already in that state can round-trip its own status.
- `recomputeStatus()` is the only path into those two statuses. It moves only between APPROVED, PARTIALLY_PURCHASED, and COMPLETED (`AUTO_MANAGED_STATUSES`), based on purchased versus requested quantities. It never changes DRAFT, SUBMITTED, REJECTED, or CANCELLED requests. It writes a `PURCHASE_REQUEST_STATUS_CHANGED` audit row.
- `PurchasesService` triggers it after creating, updating, or removing a linked purchase. `update()` here also triggers it.

## Items are diffed, never deleted and recreated

`purchase_items.purchase_request_item_id` is `ON DELETE SET NULL`. The old
delete-all-then-recreate update therefore silently unlinked every purchase line from the
request on *any* edit, including the تایید/رد buttons. That was a real data-loss bug found
in the 2026-10-05 QA (archive §19.2). The current code works like this:

- An incoming line is matched to an existing row, by `id` or else by name/unit. A matched row is updated in place, so it keeps its id and its links.
- An unmatched incoming line is created.
- An unmatched existing row is deleted only if no `PurchaseItem` references it (`findLinkedRequestItemIds()`).
- A line that has purchases against it cannot be removed, cannot change its unit, and cannot drop below the quantity already purchased. Each case returns a Persian 409.

Full-record PATCH uses optimistic locking: `updatedAt` plus `common/optimistic-lock.ts`.

## Cross-module dependencies (CLAUDE.md rule 11)

- Imports `PurchaseQuantitiesModule`, not `PurchasesModule`, which would create a cycle. It gets purchased quantities from `PurchaseQuantitiesService.sumQuantitiesByRequestItem()`, which owns the "CANCELLED purchases excluded" rule, and does not re-derive that rule.
- Exports `PurchaseRequestsService` so that `PurchasesModule` can call `recomputeStatus()`.
- `LINKABLE_PURCHASE_REQUEST_STATUSES` (APPROVED, PARTIALLY_PURCHASED) is defined **here**. `purchases.service.ts` imports it, and the frontend mirrors it in `frontend/src/app/purchase-requests/shared.tsx`.
- Dashboard imports `OPEN_PURCHASE_REQUEST_WHERE`.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- purchase-requests
```
