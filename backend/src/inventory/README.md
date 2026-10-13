# Inventory module (backend)

Owns `InventoryLocation`, `StockBalance`, `StockMovement`, `StockAdjustment` /
`StockAdjustmentItem`. Built in Sales batch 1 (2026-10-06) as the stock-ledger
foundation the later Sales batches (orders → reserve/release, deliveries → issue,
returns → QC/restock/write-off) build on. Purchases never create stock movements
(CLAUDE.md rule 7). Stock enters the system through a posted stock adjustment, a
posted goods receipt (raw materials/packaging from a supplier) or a posted production
output (finished goods) — the last two since Inventory Batch I5, see below and
`docs/inventory-module-build-plan.md`.

**Inventory Batch I1 (2026-10-08) added:** a real DB-level append-only guard on
`stock_movements` (a trigger; previously enforced only by the convention that
`applyMovements()` is the only writer), `Item.itemKind` (`FINISHED_GOOD` /
`RAW_MATERIAL` / `PACKAGING` — Sales pickers filter to `FINISHED_GOOD` only,
enforced both in the picker and server-side in `SalesOrdersService.prepareLines()`),
a fix locking `Item.unitId` once an item has stock history (previously editable at
any time, silently changing the meaning of every past quantity), `GET
/inventory/integrity` wiring up the previously-unused `verifyBalances()`, an
over-committed (`available < 0`) indicator on the stock list (visibility only, not
a block), a stock card (کاردکس) page, and a movement browser page. This is the
first batch of a much larger Inventory build — read `docs/inventory-module-build-plan.md`
before touching this module further; it covers goods receipts, production output,
batch/expiry tracking, multi-location transfers, stocktakes and valuation, none of
which exist yet.

**Inventory Batch I2 (2026-10-10) added:** adjustment approval controls (B10/B11/B20).
A new `WRITE_OFF` kind (always a stock decrease, lines must be negative — the mirror
of `OPENING`/`RECEIPT`'s positive-only rule), a new `StockAdjustmentReason` enum
(`reasonCode` — `DAMAGED`/`EXPIRED`/`LOST`/`FOUND`/`COUNT_ERROR`/`DATA_ENTRY_ERROR`/
`SAMPLE_OR_INTERNAL_USE`/`OTHER`), and a new `PENDING_APPROVAL` status. Every stock
*decrease* that needs sign-off — `WRITE_OFF` always, `CORRECTION` whenever the
document's net quantity is negative — now goes `DRAFT → PENDING_APPROVAL` (`submit()`,
`inventory.adjust`) → `POSTED` (`approve()`, `inventory.approve`) or back to `DRAFT`
(`reject()`, `inventory.approve`, reason required) instead of `post()` directly.
`post()` now refuses both a `PENDING_APPROVAL` document and a `DRAFT` document whose
kind/net quantity needs approval — only `submit()`/`approve()` may move those (the
Sales Batch 2 class of bug). No self-approval, ever: `approve()` refuses a document
whose `submittedByUserId` matches the caller. A new `INVENTORY_MANAGER` role holds
`inventory.approve`; `WAREHOUSE` keeps `inventory.adjust` only (create/submit, never
approve). See `stockAdjustmentNeedsApproval(kind, quantities)` in `inventory-rules.ts` —
the single source of truth the DTO (`reasonCode` required-ness) and the service
(submit/post/approve gating) both call.

**Inventory Batch I3 (2026-10-10) added:** stock levels + low stock (B14). A new
`ItemStockLevel` table (`item_stock_levels`, per item+location `minQty`/`reorderQty`/
`maxQty`, user-set only — the system never invents or defaults a threshold), CRUD via
`stock-levels.service.ts`, and a read-only `InventoryReportsService.lowStockSummary()`
(low = **available**, i.e. `onHand − reserved`, below `minQty` — never `onHand` alone).
A new `inventory.manage` permission ("admin-level inventory configuration") now gates
stock-levels CRUD and `GET /inventory/integrity` (**moved** from `inventory.adjust`,
I1's stand-in before this permission existed — `WAREHOUSE` lost access, `INVENTORY_MANAGER`
gained it, both at once per the plan's module-boundary note). Two new controllers:
`inventory-admin.controller.ts` (stock-levels + integrity; will also own locations/
item-settings/batches as those batches land) and `inventory-reports.controller.ts`
(`GET /inventory/reports/low-stock`). `InventoryModule` now also exports
`InventoryReportsService` so Dashboard can call `lowStockSummary()` directly instead of
re-deriving the rule from raw tables (CLAUDE.md rule 11) — see
`backend/src/dashboard/dashboard.service.ts`'s `getLowStockSummary()`. `GET
/inventory/balances` gained a `lowStockOnly` filter (same rule, reused — not re-derived).

**Inventory Batch I4 (2026-10-10) added:** batch/expiry tracking (B7), opt-in per item.
A new `InventoryItemSetting` table (`inventory_item_settings` — `batchTracked`/
`expiryRequired`/`shelfLifeDays`/`batchTrackedSince`; an item missing a row is
untracked, the table's whole-row default), `StockBatch` (a producer's lot per item,
`batchNumber` normalized — Persian/Arabic digits → Latin, trimmed, whitespace
collapsed — before the `(itemId, batchNumber)` uniqueness check, `stock-batches.ts`
`normalizeBatchNumber()`, R9) and `StockBatchBalance` (ON_HAND/QC per batch+location —
RESERVED never has a batch, by a hand-added CHECK). `StockMovement.batchId` (required
on ON_HAND/QC rows of a tracked item, forbidden otherwise and on every RESERVED row —
enforced by `applyMovements()`, not just the DTO). `StockAdjustmentKind.BATCH_CUTOVER`
(one-way, converts an unbatched item to tracked) and matching `StockAdjustmentItem`
batch fields (`batchId`/`batchNumber`/`productionDate`/`expiryDate`). A new
`SalesReturnItem.batchId` (Sales schema touch, additive — a return's physical stock
goes back into the specific batch it came out of).

- **A real race, fixed (R1):** `applyMovements()`/`issueForDelivery()` reading an
  item's `batchTracked` setting and a concurrent settings-change/`BATCH_CUTOVER` could
  interleave — a brand-new balance row isn't visible to the other transaction yet, so
  row-locking it doesn't prevent the race. Fixed with a per-item Postgres advisory lock
  (`lockItemSettings()` in `stock-ledger.ts`, `pg_advisory_xact_lock(_shared)` via
  `$executeRaw`, items sorted), shared for readers and exclusive for writers (settings
  `PUT`, `BATCH_CUTOVER`), taken **after** the item-level `stock_balances` row locks and
  **before** reading the setting. Full lock order, every write path: `stock_balances`
  (item, location) → advisory lock (item) → `stock_batch_balances` (batch, location).
- **FEFO** (`batch-allocation.ts allocateFefo()`, pure — no DB): `issueForDelivery()`
  splits a tracked item's issued quantity across its batches ordered by `expiryDate`
  ascending (no-expiry last, then `batchId`), excluding anything expired as of the
  delivery date (same calendar day still counts as deliverable — B8). `IssueResult`
  gained an optional `batches[]`. Error order, all three now live in the same function:
  `NEGATIVE_STOCK` (physical on-hand itself is short — thrown directly in the per-item
  loop now, not left for `applyMovements()` to infer from a missing `batchId`, which
  used to surface as a misleading `BATCH_REQUIRED` instead) → `STOCK_RESERVED_FOR_OTHERS`
  (unchanged) → `EXPIRED_STOCK_ONLY` (enough free stock, but what's left is expired).
- **B21 — "available" excludes expired stock, everywhere:** `reserveAvailable()`,
  `InventoryService.getAvailability()`/`listAvailability()` (so the order form and
  `InventoryReportsService.lowStockSummary()` inherit it without re-deriving anything)
  all subtract a tracked item's expired-batch on-hand via `inventory-queries.ts`
  `sumExpiredOnHand()`/`listExpiredOnHandByItem()`. Prevents confirming an order (or
  showing it as not-low) against stock that then fails delivery with
  `EXPIRED_STOCK_ONLY`.
- **`BATCH_CUTOVER`** (`StockAdjustmentsService.postBatchCutover()`, called only from
  `approve()` — always needs `inventory.approve`, B23, but deliberately **never** a
  `reasonCode`, R6/`stockAdjustmentRequiresReasonCode()` — a separate function from
  `stockAdjustmentNeedsApproval()` now, not the same rule). Allowed only when QC is
  zero everywhere and ON_HAND is zero at every *other* location (R2 — the flag is
  per-item, but I7 locations mean cutover stock must be concentrated at the document's
  own location). Posts as two `applyMovements()` calls with the settings flip in
  between (R3 — a single unbatched→batched call isn't possible, since the unbatched
  outbound row would be rejected once the flag is already on): `ADJUSTMENT_OUT` of the
  whole unbatched on-hand (`referenceLineId: null`), flip `batchTracked`, then
  `ADJUSTMENT_IN` per batch line (lines must sum exactly to the unbatched quantity).
  Turning `batchTracked` on as a plain settings edit (`InventoryItemSettingsService`,
  `PUT /inventory/item-settings/:itemId`) is a separate, simpler path, allowed only
  when the item has zero stock everywhere already (no cutover needed); turning it back
  off is always refused — one-way in I4.
- **Returns** (`receiveReturn()`/`inspectReturn()`) take an optional `batchId` per
  line now, passed straight through from Sales (`SalesReturnsService`) — see
  `backend/src/sales/README.md`/`sales-returns.service.ts` for the receive-time batch
  selection itself (one issued batch → auto-selected; several → the caller must pick,
  via a new `GET /sales-returns/:id/receive-options`; none, because the delivery
  predates the item's cutover → B22, a typed lot number resolves/creates the batch).
  One batch per return line (B24) — a FEFO-split delivery returned across two batches
  is two return documents. Sales never reads `stock_movements`/`stock_batches`
  directly — only via `inventory-queries.ts`'s exported `getItemBatchSettings()` /
  `listIssuedBatches()` and `stock-batches.ts`'s `resolveBatches()`.
- **New reads:** `GET /inventory/items/:itemId/batches?locationId` (`InventoryService
  .listItemBatches()` — every batch of one item that still carries stock, with its
  expiry status) and `GET /inventory/reports/expiry` (`InventoryReportsService
  .expiryReport({withinDays?, includeExpired?})` — every dated batch with stock,
  excluding already-expired ones unless `includeExpired`, and (when `withinDays` is
  given) excluding ones further out than that; an already-expired batch always passes,
  since it's the most urgent case, not the least).
- **`verifyBalances()`** gained three additive, batch-aware mismatch kinds in
  `batchMismatches[]` (the pre-existing `mismatches[]` is untouched): `BATCH_LEDGER`
  (a batch's own balance ≠ the SUM of its movements), `BATCH_SUM` (a tracked item's
  item-level balance ≠ the SUM of its batch balances), `UNEXPECTED_BATCH` (a `batchId`
  on a RESERVED movement, or on an item that isn't/no-longer-is tracked).
- `common/business-date.ts`'s `tehranToday()` (moved out of `dashboard.service.ts`,
  which now re-exports it — R10, so Inventory doesn't have to import from Dashboard
  and reverse I3's dependency direction) is shared by the expiry report and the B21
  availability fix.
- `inventory.spec-helpers.ts`'s fake `stockMovement.groupBy()` is now generic over
  `by` (any field list, not just the original `['itemId','locationId','bucket']`) and
  understands `where: { batchId: { not: null } }` — this is what unblocked
  `verifyBalances()`'s batch mismatches (a first attempt the previous session landed
  surfaced a false positive from the old hard-coded fake and was backed out rather
  than rushed; see §16/§17 of the build plan for the full handoff).

**Inventory Batch I5 (2026-10-11, backend only — frontend is a separate follow-up)
added:** the two inbound stock documents (build plan §5.5/§5.11/§6, used verbatim).

- **Goods receipt — رسید انبار** (`GoodsReceipt`/`GoodsReceiptItem`,
  `goods-receipts.service.ts`/`.controller.ts`, `GRN-<jalali year>-NNNNNN`). Raw
  materials / packaging received from a supplier (B3 reframed): lines must be
  `Item.itemKind` `RAW_MATERIAL` or `PACKAGING` — a `FINISHED_GOOD` line is a 400
  `ITEM_KIND_NOT_ALLOWED` at create/update **and again at posting** (the kind can change
  in between). `supplierId` is a real FK (master data, active required on a new
  choice; `supplierName` snapshotted); `purchaseId` is an optional plain reference,
  **no FK** (B3/B12 — Purchases never drive stock, CLAUDE.md rule 7), existence-checked
  read-only with `purchaseNumber` snapshotted. DRAFT → POSTED via `post()` (no approval
  step — inbound only): `GOODS_RECEIPT` movements into ON_HAND, or into **QC** when the
  document's `inspectionRequired` is on (B19, default off). `releaseFromQc()` (POSTED +
  `inspectionRequired` only) moves any partial quantity per line QC → ON_HAND as two
  `QC_RELEASE` rows (QC −r, ON_HAND +r, the line's own batch), increments
  `releasedQty`, and refuses more than `quantity − releasedQty − rejectedQty` (409
  `QC_RELEASE_EXCEEDS_REMAINING`). Movement date = the release moment (Sales-returns
  receive/inspect convention). `rejectedQty`/`returnedQty` exist (schema verbatim) but
  stay 0 until I8's goods returns — **there is no path out of QC for a failed
  inspection yet** (WRITE_OFF only touches ON_HAND; see I8/B9).
- **Production output — رسید تولید** (`ProductionOutput`/`ProductionOutputItem`,
  `production-outputs.service.ts`/`.controller.ts`, `PRD-<jalali year>-NNNNNN`). The
  primary finished-goods inbound (B1). `FINISHED_GOOD` lines only (same double check).
  Optional `producedByEmployeeId` (Employee FK, SetNull — display joins select
  id/code/name only, never a sensitive column; this is Employee, not User). No BOM, no
  raw-material consumption (B1, CLAUDE.md rule 9). `post()` writes `PRODUCTION_OUTPUT`
  ON_HAND +q; a line without its own production date uses the header's when its batch
  is created, so a shelf-life-days setting derives the expiry.
- **Shared posting shape** (both documents): lock the document row `FOR UPDATE`, CAS on
  `updatedAt`, re-check item kind + batch fields, claim the number from the
  **document date**, `inbound-documents.ts resolveInboundBatches()` (wraps I4's
  `resolveBatches()` — normalization, `expiryRequired`, shelf life,
  `BATCH_DATA_MISMATCH`), one `applyMovements()` call, stamp the resolved
  `batchId`/canonical `batchNumber` back onto each line, set POSTED, audit. Failure
  keeps nothing, not even the number. POSTED is immutable (no edit, no delete) — fix with
  a CORRECTION adjustment. A batch-tracked item's line needs a `batchNumber` (typed lot;
  create-or-match — there's no "pick an existing batchId" input on these documents); an
  untracked item's line must have none.
- **Cost (B15)**: `unitCost` (whole Rial, optional) on both line tables plus
  `ProductionOutputItem.costIsEstimated`, stamped onto the new nullable
  `StockMovement.unitCost` at posting (no valuation math — that's I9; B16's opening-cost
  backfill is also I9, not done here). Gated by the new `inventory.cost` permission:
  detail responses strip the cost fields without it, create/update **refuse** (403) a
  cost from a caller without it, and an edit by such a caller carries each line's
  previous cost over when the same item stays at the same line position (instead of
  silently wiping a cost a cost-holder entered). `getStockCard()`/`listMovements()`
  `omit` `unitCost` always (they're `inventory.view` reads). Audit `details` never
  contain a cost.
- **Pickers**: `GET /inventory/goods-receipts/form-options`,
  `GET /inventory/goods-receipts/purchase-options?supplierId`,
  `GET /inventory/production-outputs/form-options` (all `inventory.receive` — the
  receiving roles hold neither `suppliers.view` nor `items.view`). Item options carry
  `batchTracked`/`expiryRequired`/`shelfLifeDays` (closes I4 coordination gap #1 for
  these two forms). Purchase options are the supplier's newest 100, unfiltered by
  status (status meaning belongs to Purchases — rule 11).
- New enum values (one migration, `20261011061810_inventory_goods_receipts_and_production_output`,
  no statement uses them): `StockMovementType` += `GOODS_RECEIPT`/`QC_RELEASE`/
  `PRODUCTION_OUTPUT`; `StockReferenceType` += `GOODS_RECEIPT`/`PRODUCTION_OUTPUT`.
  `AUDIT_ENTITY` += `GOODS_RECEIPT`/`PRODUCTION_OUTPUT`. Hand-added CHECKs: line
  `quantity > 0`, `unit_cost >= 0`, QC counters `>= 0` and
  `released_qty + rejected_qty <= quantity`.

**Inventory Batch I6 (2026-10-11, backend only — frontend is a separate
follow-up) added:** stock counts / physical inventory (build plan §5.6/§6,
**B13 — the architect's documented default adopted, not yet confirmed by the
business owner**: blind entry, approval by a different person than the
submitter, and "stale-line" detection instead of freezing warehouse
operations during a count).

- **`StockCount`/`StockCountItem`** (`stock-counts.service.ts`/`.controller.ts`,
  `CNT-<jalali year>-NNNNNN`, claimed only at `approve()` — the only
  transition that writes movements). Lifecycle: `DRAFT` (create/update/
  remove, header + `PARTIAL`-scope lines) → `COUNTING` (`start()`,
  `inventory.count` — snapshots `systemQty` per line from real stock
  balances; `FULL` scope enumerates every item with a balance row at the
  location and creates its lines here, not at `create()`; `PARTIAL` scope
  just re-reads the current on-hand of the lines the caller already picked)
  → `REVIEW` (`submit()`, `inventory.count` — every line must already have
  a `countedQty`; computes and stores `varianceQty = counted − system` for
  every line) → `POSTED` (`approve()`, `inventory.approve`) or back to
  `COUNTING` for selected lines (`requestRecount()`, `inventory.approve`).
  `DRAFT`/`COUNTING`/`REVIEW` → `CANCELLED` any time before `POSTED`
  (`cancel()`, `inventory.count` — same convention as
  `SalesOrdersService.cancel()` using the document's own "manage"
  permission rather than the approval-level one).
- **Blind entry (B13):** `isBlind` (default `true`). While `true` and the
  document is `COUNTING`, `systemQty`/`varianceQty` are omitted from every
  response to a caller without `inventory.approve` — `maskBlindFields()` in
  `stock-counts.service.ts`, server-side, not a frontend hide. The masking
  stops once the document leaves `COUNTING` (`REVIEW`/`POSTED`/`CANCELLED`
  reveal both to anyone who can already read the document at all) —
  `isBlind = false` never masks, even while `COUNTING`.
- **Stale-line detection (B13), checked first in `approve()`, before
  anything else is validated or written:** if any `ON_HAND` `StockMovement`
  exists for a counted item at the document's location with
  `createdAt > startedAt`, refuses with 409 `COUNT_STALE` naming the items —
  nothing is posted. `requestRecount()` is the only way out: for the
  selected lines it re-reads `systemQty` fresh, clears `countedQty`/
  `varianceQty`/`reasonCode`, increments `recountCount`, and sends the whole
  document back to `COUNTING` with `startedAt` bumped to now. Bumping the
  *whole* document's `startedAt` (there is no per-line one in the schema) is
  still correct for every *other*, non-selected line too: a line that
  wasn't flagged stale had, by definition, no movement between the old and
  new `startedAt`, so its old `systemQty` is still accurate as of the new
  anchor.
- **No self-approval (B10's rule, reused):** `approve()` refuses a document
  whose `submittedByUserId` matches the caller, same check as
  `StockAdjustmentsService.approve()`.
- **`reasonCode` required on variance, decided at `approve()` time, not
  earlier:** blind entry means the counter who calls `enterCount()` can't
  know whether their line has a variance, so `reasonCode` is optional there.
  The approver — who can see `systemQty`/variance once reviewing — supplies
  it via `approve()`'s own `lines: [{ stockCountItemId, reasonCode }]`
  (falling back to whatever an earlier `enterCount()` call already set, if
  anything). A variance line with no `reasonCode` from either source is a
  400 naming the line; nothing posts.
- **Posting (`approve()` only):** for each line with a non-zero variance,
  `COUNT_GAIN` (`countedQty > systemQty`, `ON_HAND` in) or `COUNT_LOSS`
  (`countedQty < systemQty`, `ON_HAND` out) via the existing
  `applyMovements()` — reuses `StockAdjustmentReason` verbatim for
  `reasonCode` (same enum, same Persian labels, B11 — no new reason list).
  A zero-variance line posts nothing but is still part of a numbered,
  audited document. **Over-commitment (B12):** a loss still posts even if
  it leaves `available` (`onHand − reserved`) negative at that item —
  `approve()`'s response carries a `warnings: [{ itemId, available }]` array
  instead of blocking.
- **Batches (I4 present, but deliberately minimal):** `StockCountItem.batchId`
  may name an *existing* batch of the item — a count line never creates a
  new one (unlike receipts/adjustments' typed-lot-number lines; there is no
  "pick an existing batch **or** type a new lot" input here). When set,
  `systemQty` is the batch's own `StockBatchBalance.onHand` at the location
  instead of the item-level balance, and the posted `COUNT_GAIN`/
  `COUNT_LOSS` carries that `batchId`. The hand-added expression unique
  index (`stock_count_id, item_id, COALESCE(batch_id, 0)`) keeps one line
  per item (or per item+batch) — Prisma's `@@unique` treats `NULL`s as
  distinct, so a plain `@@unique` would have let the same untracked item
  appear twice.
- New permission `inventory.count` («شمارش موجودی») — flagged for
  confirmation like I5's grants: granted to both `WAREHOUSE` (does the
  physical counting: create/start/enter/submit/cancel) and
  `INVENTORY_MANAGER` (also holds `inventory.approve`, so it can both run
  and approve counts — no-self-approval still refuses approving one it
  submitted itself). Mirrors the existing `inventory.adjust`/
  `inventory.approve` split exactly.
- New enum values (one migration, `20261011071933_inventory_stock_counts`,
  no statement uses them): `StockMovementType` += `COUNT_GAIN`/`COUNT_LOSS`;
  `StockReferenceType` += `STOCK_COUNT`; new `StockCountStatus`
  (`DRAFT`/`COUNTING`/`REVIEW`/`POSTED`/`CANCELLED`) and `StockCountScope`
  (`FULL`/`PARTIAL`). `AUDIT_ENTITY` += `STOCK_COUNT`. Document prefix `CNT`.
  Hand-added: `CHECK (system_qty IS NULL OR system_qty >= 0)`,
  `CHECK (counted_qty IS NULL OR counted_qty >= 0)`, and the expression
  unique index above.

## Which file owns what

| Sub-domain | File | Notes |
|---|---|---|
| **The only writer of `StockMovement` / `StockBalance` / `StockBatchBalance`** | `stock-ledger.ts` (`applyMovements(tx, rows)`) | Plain function, no DI. It takes the caller's transaction client. It locks balance rows `FOR UPDATE` in itemId→locationId order, then (I4) a per-item advisory lock, then batch balance rows in (itemId, locationId, batchId) order, and validates the whole batch before writing anything. Every bucket (item-level and, I4, per-batch) is blocked from going negative, with no override. `StockMovement` is append-only: no update/delete path exists anywhere. |
| Higher-level stock events (Sales) | `stock-ledger.ts` | All write only through `applyMovements()`. `reserveAvailable()` / `releaseReserved()` (batch 2, sales orders — I4: excludes expired batch stock, B21). `issueForDelivery()` (batch 3, deliveries; I4: FEFO for a tracked item, `IssueResult.batches[]`): `DELIVERY_ISSUE` rows ON_HAND −q and RESERVED −min(q, the order line's reservedQty). Blocked with 409 `NEGATIVE_STOCK` if ON_HAND would go negative, 409 `STOCK_RESERVED_FOR_OTHERS` if the unreserved part exceeds free stock, or (I4) 409 `EXPIRED_STOCK_ONLY` if what's left of a tracked item's free stock is in expired batches. `receiveReturn()`/`inspectReturn()` (I4: take an optional `batchId` per line). |
| Batch resolution + FEFO, DI-free (I4) | `stock-batches.ts`, `batch-allocation.ts` | `stock-batches.ts`'s `resolveBatches()` creates-or-matches a batch per line (normalizing the lot number first, R9) and enforces `expiryRequired`. `batch-allocation.ts`'s `allocateFefo()`/`isExpiredBatch()` are pure (no DB) — expiry-ascending order, no-expiry-last, expired-excluded, still deliverable on the expiry day itself. |
| Per-item batch/expiry config (I4) | `inventory-item-settings.service.ts` (`InventoryItemSettingsService`) | `get()`/`upsert()` — `expiryRequired`/`shelfLifeDays` editable anytime; `batchTracked` false→true only with zero stock everywhere (otherwise 409 pointing at `BATCH_CUTOVER`), true→false always refused. |
| Enum meaning + Persian labels | `inventory-rules.ts` | `MOVEMENT_TYPE_BUCKETS` (which bucket each movement type may touch, and in which direction), `movementTypeForAdjustmentLine()`, `EDITABLE_STOCK_DOCUMENT_STATUSES`, `INBOUND_ONLY_ADJUSTMENT_KINDS` / `OUTBOUND_ONLY_ADJUSTMENT_KINDS` (I2, I4: `BATCH_CUTOVER` is inbound-only too), `stockAdjustmentNeedsApproval(kind, quantities)` (I2 — B10's one rule, shared by the DTO and the service), `stockAdjustmentRequiresReasonCode(kind, quantities)` (I4, R6 — a deliberately separate rule: `BATCH_CUTOVER` needs approval but never a reasonCode), `*_LABELS_FA`. Pure values, safe to import from any module. |
| Read side | `inventory.service.ts` (`InventoryService`) | `listLocations()`, `getDefaultLocation()`, `listBalances()` (now includes `overCommitted: boolean` per row — I1), `getAvailability()`/`listAvailability()` (available = onHand − reserved − expired batch stock, I4/B21), `listItemBatches(itemId, locationId?)` (I4 — every batch with stock, expiry-flagged), `verifyBalances()` (balance vs. fresh `SUM` over movements, plus I4's `batchMismatches[]` — wired to `GET /inventory/integrity`, I1), `getStockCard(itemId, {locationId?})` (I1, per-item running ledger), `listMovements(filters, pagination)` (I1, filterable movement browser). Exported for later modules. |
| Cross-module checks, DI-free | `inventory-queries.ts` (I1) | `hasStockHistory(client, itemId)` — called from `ItemsService.update()` to block a unit change once an item has stock movements. I4: `getItemBatchSettings(db, itemIds)` and `listIssuedBatches(db, deliveryId, deliveryItemId)` — what Sales needs to know about an item's batch config and a delivery line's actual issued batch(es), without reading Inventory's tables directly; `listExpiredOnHandByItem()`/`sumExpiredOnHand()` back the B21 availability fix. Same DI-free pattern as `customers/customer-rules.ts`'s `ensureTransactableCustomer()`; avoids a module cycle. |
| Goods receipts (I5) | `goods-receipts.service.ts` (`GoodsReceiptsService`) | list/get/create/update/remove (DRAFT only), `post()` (DRAFT → POSTED, GRN), `releaseFromQc()` (B19), `formOptions()`/`purchaseOptions()`. |
| Production output (I5) | `production-outputs.service.ts` (`ProductionOutputsService`) | list/get/create/update/remove (DRAFT only), `post()` (DRAFT → POSTED, PRD), `formOptions()`. |
| Inbound-document helpers, DI-free (I5) | `inbound-documents.ts` | `ensureInboundItems()` (exists/active/allowed itemKind), `ensureInboundBatchFields()`, `resolveInboundBatches()`, `maskLineCosts()` + `CostAccess`. |
| Stock counts (I6) | `stock-counts.service.ts` (`StockCountsService`) | list/get/create/update/remove (`DRAFT` only), `start()` (`DRAFT`→`COUNTING`, systemQty snapshot), `enterCount()` (`COUNTING`, blind), `submit()` (`COUNTING`→`REVIEW`, variance computed), `approve()` (`REVIEW`→`POSTED`, stale check + no self-approval + `COUNT_GAIN`/`COUNT_LOSS`), `requestRecount()` (`REVIEW`→`COUNTING` for selected lines), `cancel()`, `formOptions()`. `maskBlindFields()` (B13) strips `systemQty`/`varianceQty` for a non-approver while blind+`COUNTING`. |
| Stock adjustment documents | `stock-adjustments.service.ts` | list/get/create/update/remove (DRAFT only), `post()` (DRAFT → POSTED, non-approval kinds only), and (I2) `submit()` (DRAFT → PENDING_APPROVAL), `approve()` (PENDING_APPROVAL → POSTED, no self-approval), `reject()` (PENDING_APPROVAL → DRAFT, reason required). I4: `approve()` detects `BATCH_CUTOVER` and delegates to the private `postBatchCutover()` instead of the generic `buildMovementRows()`+`applyMovements()` path every other kind uses. |
| Stock levels (I3) | `stock-levels.service.ts` | `list()`, `get()`, `upsert()` (create-or-update keyed by the `(itemId, locationId)` unique constraint), `remove()`. Not a document — no posting workflow, no number, never touches `StockBalance`/`StockMovement`. Audited like `Item` (`AUDIT_ENTITY.ITEM_STOCK_LEVEL`). |
| Low-stock + expiry reporting | `inventory-reports.service.ts` (`InventoryReportsService`) | `lowStockSummary({locationId?})` (I3) — joins `ItemStockLevel` thresholds with `InventoryService.listAvailability()` (never re-derives the `onHand − reserved − expired` math itself, so it inherited B21 for free). `expiryReport({withinDays?, includeExpired?})` (I4) — every dated batch with stock, expiry-status and urgency-filtered. Exported from `InventoryModule` for Dashboard. |
| Low-stock predicate (I3) | `inventory-rules.ts` | `isBelowMinimum(available, minQty)` — B14's one rule, shared by `InventoryService.listBalances()`'s `lowStockOnly` filter and `InventoryReportsService.lowStockSummary()` so "what counts as low" is defined once. |
| Gap-free document numbers | `../common/document-sequence.ts` | `nextDocumentNumber(tx, 'ADJ', date)` returns `ADJ-1405-000001`. Shared with the later Sales documents. |
| HTTP | `inventory.controller.ts` (balances/movements/stock-adjustments/availability/stock-card/items/:id/batches), `inventory-admin.controller.ts` (I3 — stock-levels, integrity; I4 — item-settings), `inventory-reports.controller.ts` (I3 — low-stock report; I4 — expiry report), `goods-receipts.controller.ts` / `production-outputs.controller.ts` (I5), `stock-counts.controller.ts` (I6) | All under `/inventory`. |

## Derived data

- `StockBalance` is derived from `StockMovement`. Each bucket must always equal the `SUM` of that item+location+bucket's movements. `verifyBalances()` checks this. A DB `CHECK (on_hand >= 0)` (and the same for `reserved`/`qc`) is a backstop. It comes from the migration and is not modelled in Prisma.
- (I4) `StockBatchBalance` is derived from `StockMovement` the same way, per batch+location (ON_HAND/QC only — RESERVED never has a batch). A tracked item's item-level `StockBalance` must also equal the `SUM` of its own `StockBatchBalance` rows. `verifyBalances()`'s `batchMismatches[]` checks both (`BATCH_LEDGER`, `BATCH_SUM`), plus `UNEXPECTED_BATCH` for a `batchId` that should never exist (RESERVED, or an untracked item). `CHECK (on_hand >= 0)`/`CHECK (qc >= 0)` on `stock_batch_balances` are the same kind of backstop.
- `StockAdjustment.adjustmentNumber` is assigned only at posting and is never taken from the client. Drafts have none.

## Stock references (business decision 2026-10-06, resolves CLAUDE.md rule 9)

`StockMovement.referenceType` is the enum `StockReferenceType` (`STOCK_ADJUSTMENT`,
`SALES_ORDER`, `DELIVERY`, `SALES_RETURN`, and — I5 — `GOODS_RECEIPT`,
`PRODUCTION_OUTPUT`). With it go `referenceId` (header id),
`referenceLineId` (line id, nullable) and `referenceNumber` (snapshot, nullable). There is
**no foreign key** into the source tables. Integrity is enforced procedurally: only
`applyMovements()` writes movements, always in the same transaction as the source
document. A new source adds an enum value, not a relation.

## Stock adjustment lifecycle

- **Kinds**:
  - `OPENING` → `OPENING_BALANCE`
  - `RECEIPT` → `MANUAL_RECEIPT`
  - `CORRECTION` → `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` (by line sign)
  - `WRITE_OFF` (I2) → `WRITE_OFF`, always a decrease
  - `BATCH_CUTOVER` (I4) → one `ADJUSTMENT_OUT` (the whole unbatched on-hand) then one
    `ADJUSTMENT_IN` per batch line — not through `movementTypeForAdjustmentLine()`
    (calling it with this kind is a programming error), built directly in
    `postBatchCutover()`. Lines are positive-only, each naming a `batchNumber`.

  OPENING/RECEIPT/BATCH_CUTOVER lines must be positive (DTO); WRITE_OFF lines must be
  negative (the mirror rule). All lines post to the `ON_HAND` bucket (no `DAMAGED`
  bucket until I8) — `BATCH_CUTOVER`'s inbound lines additionally carry a `batchId`
  (I4).
- **DRAFT**: editable (lines replaced wholesale, optimistic lock on `updatedAt` plus `status = DRAFT` compare-and-set) and deletable (lines cascade).
- **PENDING_APPROVAL** (I2): set by `submit()` for a kind/net-quantity that needs `inventory.approve` (`stockAdjustmentNeedsApproval()` — `WRITE_OFF` always, `CORRECTION` when the document's net quantity is negative). Not editable. `approve()` moves it to POSTED (same transaction shape as `post()`); `reject()` (reason required) sends it back to DRAFT.
- **POSTED** is immutable. To fix a mistake, post a new CORRECTION.
- **`post()`** (DRAFT → POSTED, only when the kind/net quantity does **not** need approval) runs as one transaction:
  1. Lock the draft row `FOR UPDATE`, check it's DRAFT (refuses PENDING_APPROVAL and POSTED with distinct messages) and the version matches.
  2. Claim the number with `nextDocumentNumber('ADJ', adjustmentDate)`. The Jalali year comes from the **document date**.
  3. Call `applyMovements()`.
  4. Set `POSTED` / `postedByUserId` / `postedAt`.
  5. Write the audit row.

  If any step fails, nothing is kept, including the number (gap-free). `approve()`
  (I2) is the same shape, sourced from PENDING_APPROVAL instead of DRAFT, plus a
  self-approval check (`submittedByUserId !== callerId`) before claiming the number.
  `postedByUserId`/`postedAt` double as "approved by/at" — there's no separate column.
- **Concurrency**:
  - Two posts of the same draft serialize on the draft row lock; the second gets a 409.
  - Two different drafts serialize on the `(ADJ, year)` counter row, so their numbers are consecutive and never duplicated.
  - Balance rows are locked in a fixed order, so overlapping posts can't deadlock.
- **Audit** (`AUDIT_ENTITY.STOCK_ADJUSTMENT`): `STOCK_ADJUSTMENT_CREATED` / `_UPDATED` / `_DELETED` / `_POSTED` / `_SUBMITTED` / `_APPROVED` / `_REJECTED` (I2). `BATCH_CUTOVER`'s `approve()` writes two rows: the usual `STOCK_ADJUSTMENT_APPROVED` plus `INVENTORY_ITEM_SETTING_BATCH_CUTOVER` (`AUDIT_ENTITY.INVENTORY_ITEM_SETTING`) — the settings flip is its own auditable fact, not just a side effect of the document posting.

## Dependencies and DI wiring (`inventory.module.ts`)

- Imports nothing. `PrismaModule` and `AuditModule` are global. It exports `InventoryService` and (I3) `InventoryReportsService`.
- `StockAdjustmentsService`/`StockLevelsService`/`InventoryItemSettingsService` (I4) inject `InventoryService` (for the default location) and/or `AuditService`. Item/location "exists and is active" checks are direct read-only lookups, the documented exception to CLAUDE.md rule 11.
- Later modules call `applyMovements(tx, …)` from inside **their own** posting transaction. It is a function, not a provider, so there is no module cycle. I4: Sales (`SalesReturnsService`) additionally calls `inventory-queries.ts`'s `getItemBatchSettings()`/`listIssuedBatches()` and `stock-batches.ts`'s `resolveBatches()` the same DI-free way — never a new `InventoryModule` import, never a direct read of Inventory's tables.
- `DashboardModule` imports `InventoryModule` (I3) — the one deliberate exception to Dashboard's usual "imports nothing" rule, because the low-stock KPI is a real business rule (B14), not a raw-table aggregate (CLAUDE.md rule 11). I4: `tehranToday()` moved to `common/business-date.ts` (Dashboard re-exports it) specifically so this dependency direction never has to reverse for the expiry report.

## Permissions

- `inventory.view` covers every GET except the ones below.
- `inventory.adjust` covers create/edit/post/submit/delete of stock adjustments (including `BATCH_CUTOVER` drafts/submits — posting one still needs `inventory.approve`, same as any other approval-gated kind).
- `inventory.approve` (I2) covers approve/reject of a `PENDING_APPROVAL` stock
  adjustment, including (I4) `BATCH_CUTOVER` (always needs approval, B23, never
  self-approved — even though it nets to zero stock-wise). Never granted to
  `WAREHOUSE`; the new `INVENTORY_MANAGER` role holds it alongside
  `inventory.view`/`inventory.adjust`.
- `inventory.manage` (I3) — "admin-level inventory configuration": stock-levels CRUD,
  `GET /inventory/integrity` (**moved** from `inventory.adjust` in this batch — not
  additive, `WAREHOUSE` lost this route), and (I4) per-item batch/expiry settings
  (`GET`/`PUT /inventory/item-settings/:itemId`). Only `INVENTORY_MANAGER` holds it
  today. Reading the low-stock/expiry reports (`GET /inventory/reports/low-stock`,
  `GET /inventory/reports/expiry`, `GET /dashboard/low-stock-summary`) and the batch
  picker (`GET /inventory/items/:itemId/batches`) only need `inventory.view` — reading
  is cheaper than editing the config it's based on.
- `inventory.receive` (I5, «رسید و برگشت کالا») covers create/edit/delete/post of goods
  receipts and production outputs, QC release, and their form pickers (reading them
  is `inventory.view`). Granted to `INVENTORY_MANAGER` (and `ADMIN`); `WAREHOUSE` was
  deliberately not granted — role grants beyond that are the business owner's call.
- `inventory.cost` (I5, «مشاهده بهای موجودی», B15) — see and enter unit costs. Only
  `ADMIN` holds it today; never to be granted to Sales roles.
- Sales' `GET /sales-returns/:id/receive-options` (I4) uses `sales.deliver` — the same
  permission as `receive()` itself, a read against the same action.
- `inventory.count` (I6, «شمارش موجودی», B13 — flagged for confirmation): create/
  update/delete/start/enterCount/submit/cancel of stock counts, and the form picker.
  Granted to `WAREHOUSE` (does the physical counting) and `INVENTORY_MANAGER`.
  Approving a count's variances and requesting a recount use `inventory.approve`
  instead (never `WAREHOUSE`) — mirrors the `inventory.adjust`/`inventory.approve`
  split exactly.

## Tests (run from `backend/`, Node 24)

```bash
npm test -- inventory document-sequence
```

`inventory.spec-helpers.ts` is an in-memory fake of the stock tables. Its `$transaction`
restores state on error, so the specs assert real rollback behaviour: a failed batch leaves
no rows, and a failed post burns no number. The file is excluded from the build. I3 added
a bare `itemStockLevel` fake (`findMany`/`findUnique`/`upsert`/`delete`, empty by default)
and `buildInventoryReportsService(db)`; `StockLevelsService`'s own spec uses a plain
per-field Prisma mock instead (same convention as `payment-terms.service.spec.ts`), since
it needs no ledger/transaction behaviour. `inventory-admin.controller.spec.ts` asserts the
`GET /inventory/integrity` permission metadata directly (`inventory.manage`, not
`inventory.adjust`) — the 403/200 round-trip itself needs a running server + session and
was verified live instead (see the batch's handback report).

I4 added: `inventoryItemSetting`/`stockBatch`/`stockBatchBalance` fakes, `trackItem()`/
`seedBatch()` helpers, and `buildInventoryItemSettingsService(db)`. The fake
`stockMovement.groupBy()` is now generic over `by` (any field list) and understands
`where: { batchId: { not: null } }` — needed once `verifyBalances()` started grouping
movements by `batchId` too. No single raw SQL statement in the fake mentions both
`stock_balances` and `stock_batch_balances` (§5.4a R8 — would break the fake's
substring matching). New/extended specs: `batch-allocation.spec.ts` (pure FEFO logic),
`stock-ledger.spec.ts` (batch-aware `applyMovements()`/`issueForDelivery()`/
`receiveReturn()`/`inspectReturn()`), `stock-adjustments.service.spec.ts`
(`BATCH_CUTOVER`), `inventory-item-settings.service.spec.ts`, `inventory.service.spec.ts`
(`listItemBatches()`, the B21 availability fix, batch mismatches), `inventory-reports
.service.spec.ts` (`expiryReport()`), and `backend/src/sales/sales-returns.service.spec.ts`
(receive-time batch selection — lives in Sales since that's where the behavior is).

I5 added: `goodsReceipt`/`goodsReceiptItem`/`productionOutput`/`productionOutputItem`
plain mocks plus `supplier`/`purchase`/`employee` lookups, the two documents' `FOR
UPDATE` raw shapes, a per-item `itemKind` in the fake `item.findMany` (`setItemKind()`,
default `FINISHED_GOOD`), and `buildGoodsReceiptsService()`/
`buildProductionOutputsService()`. New specs: `goods-receipts.service.spec.ts`,
`production-outputs.service.spec.ts` (both include their controller's permission
metadata), plus I5 cases in `stock-ledger.spec.ts` (new movement-type directions,
`unitCost`) and `inventory.service.spec.ts` (`unitCost` omitted from the view reads).

I6 added: `stockCount`/`stockCountItem` plain mocks (same convention as `goodsReceipt`
above — each spec wires `findUnique`/`update`/`stockCountItem.update`/`createMany` to a
mutable "current" document via `mockCount()`, local to `stock-counts.service.spec.ts`)
plus the document's own `FOR UPDATE` raw shape, `buildStockCountsService()`, a
`seedMovementAt(db, itemId, locationId, createdAt)` helper (a bare `ON_HAND` movement
at a specific moment, for the stale-check specs, independent of whichever posting path
would normally produce it), `seedStock()` gained an optional `createdAt` parameter (the
real DB's `createdAt @default(now())` meant every prior spec didn't care when a seeded
movement happened — I6's stale check is the first thing in this module that does), and
`stockMovement.findMany()`/`stockBatchBalance.findMany()` learned `itemId: { in }`/
`createdAt: { gt }`/`batchId` filters. New spec: `stock-counts.service.spec.ts` — the
full DRAFT→COUNTING→REVIEW→POSTED path (`FULL` and `PARTIAL` scope), blind-entry
masking (and its `isBlind = false` escape hatch), submit's all-lines-counted gate, the
409 `COUNT_STALE` path and its `requestRecount()` clearing, no-self-approval, the
missing-reasonCode 400, the B12 over-commit warning, cancel, remove, and the
controller's permission metadata.
