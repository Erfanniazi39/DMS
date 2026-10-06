# Purchases module (backend)

Owns `Purchase`, `PurchaseItem`, `PurchasePayment`, `PurchaseDocument`, and
`PurchaseReturn`/`PurchaseReturnItem`. It never creates Inventory stock movements
(CLAUDE.md rule 7). `PurchaseItem.name` is plain text with no FK to Item (rule 5).
Background: `docs/project-knowledge-archive.md` §2.7 and §19.

## Which file owns what

| Sub-domain | File | Notes |
|---|---|---|
| Lifecycle: list/get/create/update/changeStatus/remove, reference checks, request-overage check | `purchases.service.ts` (`PurchasesService`) | Generates `PUR-000001`. Items are replaced wholesale on update. Update is refused once returns exist, and refuses any status change. Status changes go only through `changeStatus()` (`PATCH /purchases/:id/status`, status-only, transitions in `ALLOWED_PURCHASE_STATUS_TRANSITIONS`). Optimistic lock via `updatedAt` on both. |
| Payments | `purchase-payments.service.ts` | Locks the parent row. Write, recompute, and audit happen in one transaction. |
| Documents (metadata + file) | `purchase-documents.service.ts` | Two-step flow: JSON metadata, then multipart file. Checks extension and `common/file-signature.ts`. |
| Return to Vendor | `purchase-returns.service.ts` | Generates `RTN-000001`. Caps quantity and credit per line. Never touches money fields. |
| Derived money math | `purchase-totals.ts` | Plain functions, no DI. |
| Status meaning for other modules | `purchase-rules.ts` | `COUNTABLE_/OPEN_/OUTSTANDING_PURCHASE_WHERE`, `PAYABLE_`/`RETURNABLE_PURCHASE_STATUSES`, `ALLOWED_PURCHASE_STATUS_TRANSITIONS`, `RETURN_BLOCKED_TARGET_STATUSES`, Persian status labels. |
| Purchased quantities, exposed to Purchase Requests | `purchase-quantities.service.ts` + `purchase-quantities.module.ts` | `sumQuantitiesByRequestItem()`, `findLinkedRequestItemIds()`. |
| HTTP | `purchases.controller.ts`, `purchase-files.controller.ts` | |

## Derived fields (CLAUDE.md rule 6)

`totalAmount`, `paidAmount`, and `paymentStatus` are never taken from client input. They
are computed only in `purchase-totals.ts`:

- `sumItemTotals()` computes `totalAmount` in `PurchasesService.create()`/`update()`.
- `derivePaymentStatus()` is the only place `paymentStatus` values are decided. `update()` calls it against the existing `paidAmount`.
- `recomputePaymentTotals(tx, ...)` writes `paidAmount` and `paymentStatus`. It runs only inside `PurchasePaymentsService` transactions, after `lockPurchaseForPayment()`.
- `PurchaseReturnsService` deliberately never touches any of the three.

## Dependencies and DI wiring (`purchases.module.ts`)

- Imports `PurchaseRequestsModule`, so it can call `PurchaseRequestsService.recomputeStatus()` after a linked purchase is created, updated, or removed.
- Imports `PurchaseQuantitiesModule` and **injects** `PurchaseQuantitiesService`; it does not create it with `new`. That module imports nothing, and `PurchaseRequestsModule` imports it too. This lets both modules share the "CANCELLED excluded" quantity rule without a `PurchasesModule` and `PurchaseRequestsModule` DI cycle.
- Payments and Documents services inject `PurchasesService` (for `get()`). `PurchasesService` never injects them back, so there is no provider cycle.
- Imports `LINKABLE_PURCHASE_REQUEST_STATUSES` from `purchase-requests/purchase-request-rules.ts`. It does not re-derive that rule.
- Uses the global `AuditService.log()` for audit rows and `units/unit-rules.ts` and `departments/department-rules.ts` for active checks.
- Detail includes narrow `buyerEmployee`/`supplier` to display fields only. A `purchases.view` user must not receive national ID, salary, bank, or Sheba data through them.

## Business rules enforced in code (each documented inline)

- Payments are allowed only on CONFIRMED/RECEIVED/CLOSED purchases. A payment cannot be dated before the purchase. Overpayment is allowed.
- Returns are allowed only on RECEIVED/CLOSED purchases.
- Status transitions: DRAFT→CONFIRMED→RECEIVED→CLOSED one step at a time, or CANCELLED from any non-terminal status. A purchase with returns can be closed but not cancelled (`RETURN_BLOCKED_TARGET_STATUSES`). Only a cancellation recomputes the linked request.
- Delete is allowed only with no payments and no documents.
- Buying more than a linked request line still needs returns 409 `PURCHASE_QUANTITY_EXCEEDS_REQUEST` unless the client sends `confirmOverage`.

## File serving

`purchase-files.controller.ts` serves `GET /uploads/purchases/:filename` behind
`SessionAuthGuard` + `PermissionsGuard` with `purchases.view`. It only serves files that a
`PurchaseDocument` row references (`PurchaseDocumentsService.resolveDocumentFile()`). This
folder is **not** statically mounted in `main.ts`.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- purchase   # purchases/purchase-payments/-documents/-returns/-totals specs
```

Shared fixtures are in `purchases.spec-helpers.ts`: one Prisma mock shared by all four
services. `tsconfig.build.json` excludes the file from the build.
