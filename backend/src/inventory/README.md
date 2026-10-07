# Inventory module (backend)

Owns `InventoryLocation`, `StockBalance`, `StockMovement`, `StockAdjustment` /
`StockAdjustmentItem`. Built in Sales batch 1 (2026-10-06) as the stock-ledger
foundation the later Sales batches (orders → reserve/release, deliveries → issue,
returns → QC/restock/write-off) build on. Purchases never create stock movements
(CLAUDE.md rule 7). Stock enters the system only through a posted stock adjustment.

## Which file owns what

| Sub-domain | File | Notes |
|---|---|---|
| **The only writer of `StockMovement` / `StockBalance`** | `stock-ledger.ts` (`applyMovements(tx, rows)`) | Plain function, no DI. It takes the caller's transaction client. It locks balance rows `FOR UPDATE` in itemId→locationId order and validates the whole batch before writing anything. Every bucket is blocked from going negative, with no override. `StockMovement` is append-only: no update/delete path exists anywhere. |
| Enum meaning + Persian labels | `inventory-rules.ts` | `MOVEMENT_TYPE_BUCKETS` (which bucket each movement type may touch, and in which direction), `movementTypeForAdjustmentLine()`, `EDITABLE_STOCK_DOCUMENT_STATUSES`, `*_LABELS_FA`. Pure values, safe to import from any module. |
| Read side | `inventory.service.ts` (`InventoryService`) | `listLocations()`, `getDefaultLocation()`, `listBalances()`, `getAvailability()` (available = onHand − reserved), `verifyBalances()` (balance vs. fresh `SUM` over movements; not wired into any UI). Exported for later modules. |
| Stock adjustment documents | `stock-adjustments.service.ts` | list/get/create/update/remove (DRAFT only) and `post()`. |
| Gap-free document numbers | `../common/document-sequence.ts` | `nextDocumentNumber(tx, 'ADJ', date)` returns `ADJ-1405-000001`. Shared with the later Sales documents. |
| HTTP | `inventory.controller.ts` | All under `/inventory`. |

## Derived data

- `StockBalance` is derived from `StockMovement`. Each bucket must always equal the `SUM` of that item+location+bucket's movements. `verifyBalances()` checks this. A DB `CHECK (on_hand >= 0)` (and the same for `reserved`/`qc`) is a backstop. It comes from the migration and is not modelled in Prisma.
- `StockAdjustment.adjustmentNumber` is assigned only at posting and is never taken from the client. Drafts have none.

## Stock references (business decision 2026-10-06, resolves CLAUDE.md rule 9)

`StockMovement.referenceType` is the enum `StockReferenceType` (`STOCK_ADJUSTMENT`,
`SALES_ORDER`, `DELIVERY`, `SALES_RETURN`). With it go `referenceId` (header id),
`referenceLineId` (line id, nullable) and `referenceNumber` (snapshot, nullable). There is
**no foreign key** into the source tables. Integrity is enforced procedurally: only
`applyMovements()` writes movements, always in the same transaction as the source
document. A new source adds an enum value, not a relation.

## Stock adjustment lifecycle

- **Kinds**:
  - `OPENING` → `OPENING_BALANCE`
  - `RECEIPT` → `MANUAL_RECEIPT`
  - `CORRECTION` → `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` (by line sign)

  OPENING/RECEIPT lines must be positive (DTO). All lines post to the `ON_HAND` bucket.
- **DRAFT**: editable (lines replaced wholesale, optimistic lock on `updatedAt` plus `status = DRAFT` compare-and-set) and deletable (lines cascade).
- **POSTED** is immutable. To fix a mistake, post a new CORRECTION.
- **`post()`** runs as one transaction:
  1. Lock the draft row `FOR UPDATE`, check it's DRAFT and the version matches.
  2. Claim the number with `nextDocumentNumber('ADJ', adjustmentDate)`. The Jalali year comes from the **document date**.
  3. Call `applyMovements()`.
  4. Set `POSTED` / `postedByUserId` / `postedAt`.
  5. Write the audit row.

  If any step fails, nothing is kept, including the number (gap-free).
- **Concurrency**:
  - Two posts of the same draft serialize on the draft row lock; the second gets a 409.
  - Two different drafts serialize on the `(ADJ, year)` counter row, so their numbers are consecutive and never duplicated.
  - Balance rows are locked in a fixed order, so overlapping posts can't deadlock.
- **Audit** (`AUDIT_ENTITY.STOCK_ADJUSTMENT`): `STOCK_ADJUSTMENT_CREATED` / `_UPDATED` / `_DELETED` / `_POSTED`.

## Dependencies and DI wiring (`inventory.module.ts`)

- Imports nothing. `PrismaModule` and `AuditModule` are global. It exports `InventoryService`.
- `StockAdjustmentsService` injects `InventoryService` (for the default location). Item/location "exists and is active" checks are direct read-only lookups, the documented exception to CLAUDE.md rule 11.
- Later modules call `applyMovements(tx, …)` from inside **their own** posting transaction. It is a function, not a provider, so there is no module cycle.

## Permissions

- `inventory.view` covers every GET.
- `inventory.adjust` covers create/edit/post/delete of stock adjustments.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- inventory document-sequence
```

`inventory.spec-helpers.ts` is an in-memory fake of the stock tables. Its `$transaction`
restores state on error, so the specs assert real rollback behaviour: a failed batch leaves
no rows, and a failed post burns no number. The file is excluded from the build.
