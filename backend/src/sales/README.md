# Sales module (backend)

Built in Sales batch 2 (2026-10-07): **sales orders** (`SalesOrder` / `SalesOrderItem`).
Sales batch 3 (2026-10-07): **deliveries** (`Delivery` / `DeliveryItem`).
Sales batch 4 (2026-10-07): **invoices** (`SalesInvoice` / `SalesInvoiceItem`).
Returns arrive in Batch 6 (see
`docs/sales-module-build-plan.md`, the single source of truth for scope and the
B1–B16 business decisions).

## Which file owns what

| Sub-domain | File | Notes |
|---|---|---|
| Status meaning, transitions, labels | `sales-rules.ts` | `ALLOWED_SALES_ORDER_STATUS_TRANSITIONS` (build plan §5), `ensureSalesOrderTransition()`, `CREDIT_EXPOSURE_ORDER_WHERE`, `SALES_ORDER_DOC_TYPE = 'SO'`, the 409 codes, `*_LABELS_FA`. Pure values, safe to import from any module. |
| Money math | `sales-totals.ts` | `computeLineAmounts()`, `sumOrderTotals()`, `hasAnyDiscount()`. The only place the derived money fields are computed. Whole Rial, rounded half-up per line; header totals are the sum of the rounded lines. |
| Credit rule (B4) | `sales-credit.ts` | `computeExposure(tx, customerId)` = open amount of POSTED invoices (`listOpenInvoices()`) + for each CONFIRMED, not fully INVOICED order, max(0, order total − its POSTED invoices' totals). `evaluateCredit()` locks the customer's financial profile, then compares exposure + order against the limit. A `null` limit means 0 (cash-only). |
| Orders | `sales-orders.service.ts` | list/get/history, DRAFT create/update/remove, confirm, approve/reject, cancel/close, plus the form lookups (`formOptions()`, `customerContext()`). |
| Order progress (derived) | `sales-progress.ts` | The ONE place for counter updates and derived order status: `applyDeliveredQuantities()`, `deriveDeliveryStatus()`, `deriveInvoicingStatus()`, `isOrderFulfilled()`, `recomputeOrderProgress(tx, orderId)` (writes changed `deliveryStatus` / `invoicingStatus`, and CONFIRMED → COMPLETED when every line is delivered in full and invoiced = delivered). DI-free; caller holds the order row lock. Batches 4–6 reuse it. |
| Deliveries | `deliveries.service.ts` | list, work queue, get/history, `orderContext()` (create-form source), DRAFT `createFromOrder` / `update` / `remove`, `post`. |
| Invoices | `sales-invoices.service.ts` | list, work queue, get/history, `formOptions()`, `createFromDelivery(tx, …)` / `create()`, `createOpeningBalance()`, `remove()` (DRAFT), `postWithin(tx, …)` / `post()`, `applySettlement(tx, invoiceId, sums)` (the ONLY writer of paid/credited/paymentStatus), `listOpenForCustomer(tx, customerId)` + the DI-free `listOpenInvoices()`. |
| HTTP | `sales-orders.controller.ts`, `deliveries.controller.ts`, `sales-invoices.controller.ts` | Under `/sales-orders`, `/deliveries` and `/sales-invoices`. |

## Order lifecycle

| Action | Transition | Permission | Effect |
|---|---|---|---|
| create / update / delete | DRAFT only | `sales.manage` | No number, no stock effect. Snapshots (customer name/economic code, address text, payment term, item code/name/unit, `listUnitPrice`) are refreshed on every save. Lines are replaced wholesale on update. Optimistic lock on `updatedAt`. |
| confirm | DRAFT → CONFIRMED, or → PENDING_APPROVAL | `sales.manage` | See "Confirm" below. |
| approve | PENDING_APPROVAL → CONFIRMED | `sales.approve` | Re-runs the customer gate and the credit check. Needs `creditOverrideReason` if still over the limit. |
| reject | PENDING_APPROVAL → DRAFT | `sales.approve` | Optional reason (audit only). |
| cancel | CONFIRMED → CANCELLED | `sales.manage` | Only if Σ`deliveredQty` = 0. Reason required. Releases every reservation. |
| close | CONFIRMED → CLOSED | `sales.manage` | Manual short-close. Reason required. Releases what is still reserved. |
| — | CONFIRMED → COMPLETED | system only | Batches 3/4 (all delivered and invoiced). |

### Confirm

Approval is needed when the order has a discount (B3) or would exceed the credit limit (B4):

- **`sales.approve` holder:** confirms directly. Over the limit, this needs `creditOverrideReason`; without one the response is a 409 `CREDIT_LIMIT_EXCEEDED`.
- **Anyone else:**
  - If approval is needed: a 409 `SALES_ORDER_APPROVAL_REQUIRED` with `details.reasons`. With `submitForApproval: true`, the order moves to `PENDING_APPROVAL` instead.
  - If approval isn't needed: the order is confirmed.
- A non-approver can't send `creditOverrideReason` (403). They also can't confirm a PENDING_APPROVAL order; that's `approve()`.
- `ensureTransactableCustomer()` (inactive customer or credit hold) blocks everyone. There is no override.

Reaching CONFIRMED is one transaction:

1. Lock the order row.
2. Run the customer gate.
3. Run the credit check (under a customer-profile row lock).
4. Claim the number with `nextDocumentNumber(tx, 'SO', orderDate)`, giving `SO-1405-000001`.
5. Reserve stock with `stock-ledger.ts` `reserveAvailable()`: per line, RESERVED += min(qty, onHand − reserved).
6. Set `reservedQty`, mark CONFIRMED, write the audit row(s).

If anything fails, nothing is kept, including the number. A stock shortfall is **not** a block: the response carries `backorders: [{ lineNo, itemId, itemName, quantity, reserved, shortfall }]`.

Credit figures (limit, exposure) appear in errors and in `customerContext()` only for `sales.approve` or `customers.finance` holders.

### Discounts and prices

- **B3:** only a `sales.approve` holder may send a discount (`discountPercent` *or* `discountAmount`). A non-approver also can't save a draft that already carries one (403), because saving replaces lines wholesale.
- **B2:** any `sales.manage` holder may change `unitPrice`. Going below `Item.sellingPrice` (snapshotted as `listUnitPrice`) requires `priceOverrideReason`; going above it doesn't.
- The payment term always comes from the customer's financial profile. It's never chosen on the order.

## Dependencies

`sales → inventory` (imports `InventoryModule` for `InventoryService`).

- Stock writes go only through `inventory/stock-ledger.ts`'s `reserveAvailable()` / `releaseReserved()`, which call `applyMovements()`.
- Customers are read only through `customers/customer-rules.ts`'s `ensureTransactableCustomer()` / `getCustomerCreditPolicy()`. `CustomersModule` is never injected.
- The form lookups read active customers, items and employees directly: read-only display lookups, CLAUDE.md rule 11's documented exception.

## Audit (`AUDIT_ENTITY.SALES_ORDER`)

Each audit row is written in the same transaction as the change it records:

- `SALES_ORDER_CREATED` / `_UPDATED` / `_DELETED`
- `_SUBMITTED_FOR_APPROVAL`
- `_CONFIRMED` / `_APPROVED`
- `_CREDIT_OVERRIDE`, as a separate row with the reason and the excess
- `_REJECTED` / `_CANCELLED` / `_CLOSED`

## Delivery lifecycle (batch 3)

`DRAFT → POSTED` only, one-way; POSTED is immutable and has no delete path.

| Action | Route | Permission | Effect |
|---|---|---|---|
| list | `GET /deliveries?q&status&customerId&salesOrderId&dateFrom&dateTo&page&pageSize` | `sales.view` | Paginated with page/pageSize, a plain array without. |
| work queue | `GET /deliveries/queue?q&page&pageSize` | `sales.view` | CONFIRMED orders with `deliveryStatus ≠ DELIVERED`, with `lineCount`, `openLineCount`, `draftDeliveryCount`. |
| order context | `GET /deliveries/order-context/:salesOrderId` | `sales.deliver` | The order + lines with `undeliveredQty`, `onHand`, `available` (display only), `deliverable`. |
| get / history | `GET /deliveries/:id`, `GET /deliveries/:id/history` | `sales.view` | |
| create | `POST /deliveries` `{ salesOrderId, deliveryDate, carrierNote?, receivedByName?, note?, items?: [{ salesOrderItemId, quantity }] }` | `sales.deliver` | DRAFT against a CONFIRMED order. `items` omitted → every line with undelivered quantity, prefilled with it. Each line ≤ quantity − deliveredQty. `customerId`, `locationId`, `deliveryAddressText` come from the order. No number, no stock effect. |
| update | `PATCH /deliveries/:id` `{ updatedAt, deliveryDate, carrierNote?, receivedByName?, note?, items }` | `sales.deliver` | DRAFT only, order still CONFIRMED; lines replaced wholesale; optimistic lock. |
| delete | `DELETE /deliveries/:id` | `sales.deliver` | DRAFT only. |
| post | `POST /deliveries/:id/post` `{ updatedAt }` | `sales.deliver` | See below. |

**Why `sales.deliver` for every write (not `sales.manage` for drafts):** a delivery note is the warehouse's document. B5 gives WAREHOUSE `sales.deliver` but not `sales.manage`, and SALESPERSON the reverse — gating drafts on `sales.manage` would stop the warehouse from preparing its own delivery notes and let the salesperson draft them, the opposite of the intended separation.

**Post** is one transaction: lock the delivery row → lock the order row and re-read its lines → order must still be CONFIRMED, the customer must not be on credit hold (409 `CUSTOMER_CREDIT_HOLD`, no override — business decision 2026-10-07, extending B4) and each line must still fit `quantity − deliveredQty` (another delivery may have posted meanwhile; 409 otherwise) → `nextDocumentNumber(tx, 'DN', deliveryDate)` → `stock-ledger.ts issueForDelivery()` (409 `NEGATIVE_STOCK` / `STOCK_RESERVED_FOR_OTHERS`, no override) → `sales-progress.ts applyDeliveredQuantities()` + `recomputeOrderProgress()` → POSTED → audit. Anything failing rolls back everything, including the number.

Audit (`AUDIT_ENTITY.DELIVERY`): `DELIVERY_CREATED` / `_UPDATED` / `_DELETED` / `_POSTED`. Posting also writes `SALES_ORDER_DELIVERY_POSTED` (and `SALES_ORDER_COMPLETED` when it completes the order) on the order, so the order's history shows it.

## Invoice lifecycle (batch 4)

`DRAFT → POSTED` only, one-way; POSTED is immutable and has no delete path. B7: **one invoice per delivery** — a delivery with a DRAFT invoice refuses a second one (409 `SALES_INVOICE_DRAFT_EXISTS`, `details.salesInvoiceId`).

| Action | Route | Permission | Effect |
|---|---|---|---|
| list | `GET /sales-invoices?q&status&sourceType&paymentStatus&overdue=true&customerId&salesOrderId&deliveryId&dateFrom&dateTo&page&pageSize` | `sales.view` | Paginated with page/pageSize, a plain array without. `overdue=true`: POSTED, not PAID, `dueDate` before today. |
| work queue | `GET /sales-invoices/queue?q&page&pageSize` | `sales.view` | POSTED deliveries with a line no POSTED invoice covers, with `lineCount`, `openLineCount`, `draftInvoiceId`. |
| form options | `GET /sales-invoices/form-options` | `sales.invoice` | `{ customers: [{ id, customerNumber, name, status }] }` (not ARCHIVED) for the opening-balance form. |
| get / history | `GET /sales-invoices/:id`, `GET /sales-invoices/:id/history` | `sales.view` | |
| create from delivery | `POST /sales-invoices` `{ deliveryId, invoiceDate?, note? }` | `sales.invoice` | DRAFT for a POSTED delivery. Lines = every delivery line's `quantity − invoicedQty`, priced from its order line (unit price; a percent discount re-applied, a fixed discount prorated by quantity; tax rate). Header snapshots: customer name / economic code / default active BILLING address (live, at creation), payment term from the order. `invoiceDate` omitted → today, or the delivery date if later; never before the delivery date. A zero total is allowed (free goods still need invoiced = delivered). |
| create opening balance | `POST /sales-invoices/opening-balance` `{ customerId, invoiceDate, note?, items: [{ itemName?, quantity, unitPrice, taxRate? }] }` | `sales.invoice` | DRAFT, `sourceType = OPENING_BALANCE`, `salesOrderId = null`, lines with no delivery/order/item refs, `itemName` default «مانده افتتاحیه», payment term from the customer's profile. Total must be > 0. |
| delete | `DELETE /sales-invoices/:id` | `sales.invoice` | DRAFT only. |
| post | `POST /sales-invoices/:id/post` `{ updatedAt }` | `sales.invoice` | See below. |

**Post** is one transaction: lock the invoice row → (OPERATIONAL) lock the order row, re-read the delivery lines and re-check each invoice line fits `quantity − invoicedQty` (409 otherwise) → `sales-progress.ts applyInvoicedQuantities()` (DeliveryItem and SalesOrderItem `invoicedQty`) → `nextDocumentNumber(tx, 'INV', invoiceDate)` → `dueDate = invoiceDate + paymentDueDays`, `paymentStatus` derived (a zero-total invoice is PAID) → POSTED → `recomputeOrderProgress()` (invoicingStatus, paymentStatus, CONFIRMED → COMPLETED when every line is delivered = ordered and invoiced = delivered) → audit. An opening-balance invoice gets the number and due date only.

**Settlement** — `applySettlement(tx, invoiceId, { paidAmount, creditedAmount })` takes the absolute sums Receivables recomputes from active allocations; POSTED only; refuses negatives and paid + credited > total; derives `paymentStatus` (UNPAID / PARTIALLY_PAID / PAID) and recomputes the order's `paymentStatus`. No HTTP endpoint — Receivables (Batch 5) is its only caller.

**Credit hold does not block invoicing**: the goods are already issued; billing them is what makes the debt collectable.

**Opening-balance invoices are not sales**: every future sales statistic must filter with `SALES_STATISTICS_INVOICE_WHERE` (POSTED + OPERATIONAL). They are counted as money owed (`listOpenInvoices()`, credit exposure).

Audit (`AUDIT_ENTITY.SALES_INVOICE`): `SALES_INVOICE_CREATED` / `_DELETED` / `_POSTED`. Posting also writes `SALES_ORDER_INVOICE_POSTED` (and `SALES_ORDER_COMPLETED` when it completes the order) on the order and `DELIVERY_INVOICE_POSTED` on the delivery.
