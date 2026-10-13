# Inventory module (frontend)

Stock list plus stock-adjustment documents (Sales batch 1). The backend contract is in
`backend/src/inventory/README.md`. All calls go through `apiFetch`. The frontend never
computes stock as truth: balances come from `GET /inventory/balances`. "قابل فروش" (onHand −
reserved) is computed here for display only.

## File map

- `layout.tsx` re-exports `AppShell`. `error.tsx` is the route error fallback.
- `shared.tsx` holds the types, Persian labels and tones (mirroring backend `inventory-rules.ts`), `formatQuantity`, `adjustmentTitle`, and `NoAccess`.
- `page.tsx` (`/inventory`) is the stock list: search, a warehouse filter (shown only once there is more than one warehouse), and server pagination. It needs `inventory.view`.
- `adjustments/page.tsx` lists drafts and posted documents, with filters for status and kind. Draft edit/delete is shown with `inventory.adjust`.
- `adjustments/new/page.tsx` and `adjustments/[id]/edit/page.tsx` wrap `<RequirePermission inventory.adjust>` around `StockAdjustmentForm`.
- `adjustments/StockAdjustmentForm.tsx` handles create/edit of a **draft**. Saving never touches stock. Edit sends `updatedAt` (optimistic lock, `RECORD_MODIFIED` shows a banner).
  - `_form/AdjustmentLinesGrid.tsx` is the lines table (item, unit, current stock, quantity, note).
  - `_form/FormSection.tsx` is the section chrome.
- `adjustments/[id]/page.tsx` is the detail page. For a draft with `inventory.adjust` it offers **ثبت نهایی** (`POST …/post`, confirm first), ویرایش, and حذف. A POSTED document is read-only.

## Notes

- The item picker uses `GET /inventory/item-options` (`inventory.adjust`), **not** `GET /items`. The WAREHOUSE role has no `items.view`.
- OPENING/RECEIPT lines must be positive. CORRECTION lines are signed (+ increase, − decrease). This is checked client-side for UX; the backend DTO is authoritative.
- Posting can fail with 409 `NEGATIVE_STOCK`. The backend message names the item and is shown as-is.
- The document number (`ADJ-<jalali year>-NNNNNN`) exists only after posting. Drafts show «پیش‌نویس #id».

## I4 — batch/expiry (frontend)

Backend contract: `backend/src/inventory/README.md`'s I4 section.

- `shared.tsx`: `BATCH_CUTOVER` kind/label/hint/tone; `stockAdjustmentNeedsApproval()` (BATCH_CUTOVER always) and a **separate** `stockAdjustmentRequiresReasonCode()` (never for BATCH_CUTOVER — R6); `ItemBatchRow`/`ItemBatches`/`ExpiryReportRow` types; `batchId` on movements; batch fields on adjustment lines; `batchMismatches` on the integrity result.
- `_batches/BatchBreakdownTable.tsx`: read-only per-item batch table (number, production/expiry, expired badge from the backend's `isExpired`, on-hand, QC). Used by the `/inventory` drill-down and the stock card.
- `adjustments/_form/AdjustmentLinesGrid.tsx`: a «بچ» column. Ordinary kinds: a native-select batch picker per line (existing batch, or «+ بچ جدید» → lot number + production/expiry sub-row; outbound lines may only pick a batch with stock). Whether an item is tracked isn't exposed to `inventory.adjust` users, so the grid infers it from the item's batch list (non-empty ⇒ tracked); the backend's per-row message stays authoritative. `BATCH_CUTOVER`: one item for the whole document (picker above the table), every line a new lot, and a live «جمع ردیف‌ها / موجودی فعلی / اختلاف» check.
- `adjustments/[id]/page.tsx`: batch/production/expiry columns; for an unposted cutover a live lines-sum vs current on-hand strip (`GET …/availability?locationId=`); a persistent alert for `409 BATCH_CUTOVER_QUANTITY_MISMATCH` (uses `details.linesSum/currentOnHand`).
- `page.tsx` (`/inventory`): «بچ‌ها» toggle per row → batches with stock at that row's warehouse.
- `items/[itemId]/page.tsx` (stock card): «بچ‌های کالا» section (depleted batches behind a checkbox) and a «بچ» column on ledger rows.
- `movements/page.tsx`: «بچ» column; batch numbers resolved per tracked item on the page via `GET /inventory/items/:itemId/batches` (the movement list only carries `batchId`). No batch filter — the backend has no `batchId` query param.
- `reports/expiry/page.tsx`: `GET /inventory/reports/expiry` with a look-ahead select (`withinDays`, default 90) and «نمایش بچ‌های منقضی‌شده» (`includeExpired`, default on); expired rows tinted and badged.
- `integrity/page.tsx`: second table for `batchMismatches[]`.
- `item-settings/page.tsx` (`/inventory/item-settings`, `inventory.manage`, nav «تنظیمات بچ و انقضا»): item picker (`GET /inventory/item-options` — note: that endpoint is gated on `inventory.adjust`, the pre-existing I3 coupling) + `?itemId=` deep link; `GET`/`PUT /inventory/item-settings/:itemId`. Batch tracking shows as a فعال/غیرفعال badge (+ «از تاریخ»); turning it on is a one-way checkbox (confirm first) that the backend allows only at zero stock — a `409 STOCK_NONZERO` shows inline with a link to `/inventory/adjustments/new?kind=BATCH_CUTOVER&itemId=…` (the form prefills from those params). «الزام تاریخ انقضا» and «طول عمر (روز)» (blank = null) are editable anytime. The stock card header links here for `inventory.manage` users.
- Sales: `app/sales-returns/[id]/_sections/ReceiveDialog.tsx` reads `GET /sales-returns/:id/receive-options` — one issued batch auto-selected, several → required pick, none (pre-cutover delivery, B22) → typed lot number + optional expiry.


## I5 — goods receipts + production output (frontend)

Backend contract: `backend/src/inventory/README.md`'s I5 section.

- Routes: `/inventory/receipts` (رسید انبار — raw materials/packaging from a supplier) and `/inventory/production` (رسید تولید — finished goods), each with `/new`, `/[id]`, `/[id]/edit`, `/[id]/print`. Reading needs `inventory.view`; create/edit/delete/post/QC release need `inventory.receive` (`RequirePermission` on new/edit, hidden buttons elsewhere). Nav: «رسید انبار» / «رسید تولید» under «موجودی».
- Pickers come only from `GET /inventory/goods-receipts/form-options`, `/goods-receipts/purchase-options?supplierId` and `/production-outputs/form-options` — never `/items`, `/suppliers` or `/inventory/item-options` (receiving roles can't reach those). Item lists are already filtered by itemKind server-side; not re-filtered here. A draft's since-deactivated supplier/location/employee/item is merged back in so editing doesn't drop it.
- `_inbound/InboundLinesGrid.tsx` (shared form grid): the lot number is always **typed** (create-or-match at posting — no existing-batch picker, unlike adjustments), shown/required only when the item's form-options entry says `batchTracked`; production/expiry dates live in a sub-row under a tracked line only (an untracked line never sends batch fields — the backend 400s it). `expiryRequired` without an expiry (and without production date + shelf life) shows a warning, not a block — the backend's `409 EXPIRY_REQUIRED` at posting is authoritative. `inboundLinePayload()` / `validateInboundLines()` build/check a line.
- **Cost (`inventory.cost`)**: without it the cost columns/inputs don't render and the request body never contains `unitCost`/`costIsEstimated` keys (the backend 403s them; on edit it carries the previous cost over by line position). With it: «بهای واحد (ریال)» (whole Rial), a computed «جمع» column, and on production output a «بها برآوردی است» checkbox (only with a cost).
- Goods receipt form: supplier → purchase-reference select (the supplier's newest 100 — `PURCHASE_OPTIONS_LIMIT`, a hint shows when the window is full; no search), «نیاز به کنترل کیفیت» checkbox, supplier document number.
- Detail pages (`_inbound/InboundLinesTable.tsx`): «ثبت نهایی» (confirm, sends `updatedAt`), edit/delete for drafts, print link. Posted lines resolve a shelf-life-derived expiry from the batch (`_inbound/useBatchExpiry.ts` → `GET /inventory/items/:id/batches`), since the line keeps only typed dates.
- QC release (receipt detail, POSTED + `inspectionRequired`): per-line «مقدار آزادسازی» inputs for lines with remaining = `quantity − releasedQty − rejectedQty` > 0, «پر کردن با کل باقی‌مانده», submit with the receipt's **latest** `updatedAt` (it changes after every release — the page keeps the response). `409 QC_RELEASE_EXCEEDS_REMAINING` / `RECORD_MODIFIED` surface as toasts (+ the stale banner). There is no QC-reject path yet (I8).
- Print (`_inbound/InboundPrintTable.tsx` + `components/print/print-document.tsx`): GRN/PRD sheets; costs print only for `inventory.cost`.
- `shared.tsx`: `GOODS_RECEIPT`/`QC_RELEASE`/`PRODUCTION_OUTPUT` movement types and `GOODS_RECEIPT`/`PRODUCTION_OUTPUT` reference types (labels, movement-browser filters, `referenceHref` → `/inventory/receipts|production/:id`), plus the I5 record/option types.
