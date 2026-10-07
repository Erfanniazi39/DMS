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
