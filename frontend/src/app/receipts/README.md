# Receivables module (frontend)

Built in Sales batch 5. Backend contract: `backend/src/receivables/README.md`.
Business rules: `docs/sales-module-build-plan.md` (B9 cheques, §3 "how the money
works", §5, §7). All calls go through `apiFetch`. Layout, labels and patterns
mirror `../sales-invoices/` (and reuse `../sales-orders/shared.tsx`'s
`NoAccess`, `../purchases/shared.tsx`'s `PaymentMethod` labels).

## Routes

- `/receipts` (`layout.tsx`/`error.tsx` here cover `/receipts/*`) — list of
  `CustomerPayment` rows (both RECEIPT and REFUND) with direction/status/
  method/date filters, and «ثبت دریافت» (`RecordReceiptDialog.tsx`,
  `receivables.manage`). There is no refund-creation form yet — out of this
  batch's explicit scope (backend support exists; a refund row can only
  appear here via the API today).
- `/receipts/[id]` — detail: header fields (cheque fields only when
  `method === "CHECK"`), `_sections/StatusActions.tsx` (لغو / تأیید وصول چک /
  برگشت چک), `_sections/AllocationsSection.tsx` (every allocation this
  payment has sourced, active and reversed; «افزودن تخصیص» opens the same
  oldest-first-suggestion grid as the record-receipt dialog, scoped to the
  payment's remaining unapplied amount; «برگشت» on an active row), `_sections/HistorySection.tsx`.
- `/receivables/aging` (own `layout.tsx`/`error.tsx`, a sibling top-level
  segment) — `GET /receivables/aging` as a collections worklist, sorted by
  total outstanding.
- `customers/[id]/_sections/AccountSection.tsx` — balance, open invoices, and
  an in-place expandable full statement. Calls `/receivables/...` directly;
  the Customers module has no backend dependency on Receivables (build plan
  §4).

## File map

- `shared.tsx`: response types, labels, tones, `customerPaymentTitle()`,
  `unappliedAmount()`. Re-exports `PaymentMethod`/labels from
  `../purchases/shared` and `NoAccess` from `../sales-orders/shared` instead
  of duplicating them.
- `RecordReceiptDialog.tsx`: one dialog that both records a RECEIPT
  (`POST /receivables/payments`) and allocates as much of it as the user
  wants to the customer's open invoices in the same action
  (`POST /receivables/allocations`) — an oldest-first suggestion
  (`GET /receivables/allocations/suggest`) prefills the grid, every row stays
  editable, and any leftover amount simply isn't sent (it stays as unapplied
  credit on the receipt). Cheque fields (due date, bank name) only render
  when `method === "CHECK"`.

Native `<select>`s only for the customer/invoice pickers — no Base-UI
Select/Dialog landmine (see `app/purchases/README.md`).

## Status actions (`/receipts/[id]`)

| Status | Button | Call | Permission |
|---|---|---|---|
| COMPLETED | لغو | `POST :id/cancel` (reason required) | `receivables.manage` |
| PENDING (cheque) | تأیید وصول چک | `POST :id/clear-cheque` | `receivables.manage` |
| PENDING (cheque) | برگشت چک | `POST :id/bounce-cheque` (reason required) | `receivables.manage` |
