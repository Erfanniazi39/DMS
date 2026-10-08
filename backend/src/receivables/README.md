# Receivables module (backend)

Built in Sales batch 5 (2026-10-07): **payments** (`CustomerPayment`) and
**open-item allocations** (`PaymentAllocation`). Credit notes
(`CreditNote`/`CreditNoteItem`, and the FKs on `sourceCreditNoteId` /
`targetRefundId`) arrive in Batch 6 (see `docs/sales-module-build-plan.md`,
the single source of truth for scope and the B1–B16 business decisions).

## Which file owns what

| Sub-domain | File | Notes |
|---|---|---|
| Status meaning, transitions, labels | `receivables-rules.ts` | `ALLOWED_CUSTOMER_PAYMENT_STATUS_TRANSITIONS` (build plan §5), `ensureCustomerPaymentTransition()`, `RECEIPT_DOC_TYPE = 'RCP'` / `REFUND_DOC_TYPE = 'RFD'`, the aging-bucket helpers, `*_LABELS_FA`. Pure values, safe to import from any module. |
| Settlement (the one approved cross-module call) | `settlement.ts` | `recomputeInvoiceSettlement(tx, invoiceId, salesInvoices)`: sums this invoice's active allocations whose source payment is COMPLETED, then calls `SalesInvoicesService.applySettlement()`. Never writes `SalesInvoice` columns itself. |
| Payments | `customer-payments.service.ts` | list/get/history/`formOptions()`, `recordReceipt()` / `refund()` (numbered immediately — no draft stage), `cancel()` (COMPLETED → CANCELLED, reason required), `clearCheque()` (PENDING → COMPLETED), `bounceCheque()` (PENDING → CANCELLED, reason required). |
| Allocations | `payment-allocations.service.ts` | `suggestAllocation(customerId, amount)` (oldest-first, via `SalesInvoicesService.listOpenForCustomer()`), `allocate()` (customer-scoped, caps each line at the invoice's current open amount, caps the total at the payment's unapplied amount — the rest stays unapplied, never forced), `reverse()` (stamp, never delete). |
| Balance / statement / aging | `customer-balances.service.ts` | `getBalance()` = Σ posted invoices − Σ completed receipts − Σ posted credit notes (none yet) + Σ completed refunds. `getStatement()`: chronological ledger, running balance only moves on settled rows. `getCustomerAging()` / `getAgingReport()`: current/1-30/31-60/61-90/90+ buckets from `SalesInvoicesService.listOpenForCustomer()` (an acceptable per-customer N+1 loop for this system's scale — CLAUDE.md rule 11 forbids re-deriving "what counts as open" directly against `sales_invoices`). |
| HTTP | `receivables.controller.ts` | Under `/receivables` (`/receivables/payments`, `/receivables/refunds`, `/receivables/allocations`, `/receivables/customers/:id/...`, `/receivables/aging`). |

## B9 — cheques

A cheque receipt is created `PENDING` (not `COMPLETED`) and **does not reduce
AR until it clears**: an allocation can already exist against a `PENDING`
payment (so it can be "reserved" for an invoice ahead of time), but
`settlement.ts` only counts allocations whose source payment is
`COMPLETED`. `clearCheque()` flips the status and recomputes every invoice
the cheque is allocated to — only then does the invoice's `paidAmount` move.
`bounceCheque()` cancels the payment and reverses its allocations (the debt
reappears); since they were never counted, the invoice doesn't change, but
the allocation rows are still stamped `reversedAt` so the amount is free to
allocate elsewhere.

## Allocation invariants

- **Customer-scoped**: every target invoice must belong to the same
  customer as the source payment.
- **Never exceeds the invoice**: a line can't push `paidAmount + creditedAmount`
  past the invoice's `totalAmount` — checked against the invoice's current
  open amount, under its own row lock.
- **Never exceeds the payment**: the sum of one `allocate()` call's lines
  can't exceed the payment's `amount` minus its already-active allocations.
  Any amount the user doesn't allocate simply stays on the receipt as
  unapplied credit (build plan §3) — never forced onto an invoice.
- **Reversal is a stamp**, never a delete — `reversedAt` / `reversedByUserId`.

## Dependencies

`receivables → sales → inventory` (imports `SalesModule` for
`SalesInvoicesService`). `SalesModule` does not import `ReceivablesModule` —
no cycle. Customers are checked with a plain Prisma existence lookup
(CLAUDE.md rule 11's documented read-only exception) — `CustomersModule` is
never injected, same as Sales.

## Permissions (B5)

`receivables.view` — reads (balance/statement/aging/payment list+history).
`receivables.manage` — recording/allocating/cancelling/clearing/bouncing
payments. `SALES_MANAGER` gets `receivables.view` only (separation of
duties — a manager can see money owed but not record or allocate it).

## Audit (`AUDIT_ENTITY.CUSTOMER_PAYMENT`)

Each row is written in the same transaction as the change it records:
`CUSTOMER_PAYMENT_RECEIVED` / `_REFUNDED` / `_CANCELLED`, `CHEQUE_CLEARED` /
`_BOUNCED`, `PAYMENT_ALLOCATED` / `PAYMENT_ALLOCATION_REVERSED`. Allocating
or reversing also writes a mirrored `SALES_INVOICE_PAYMENT_ALLOCATED` /
`_REVERSED` row under `AUDIT_ENTITY.SALES_INVOICE`, so the invoice's own
history tab shows it too (same pattern `SalesInvoicesService.postWithin()`
already uses for the order/delivery it touches).
