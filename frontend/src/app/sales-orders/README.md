# Sales Orders module (frontend)

Built in Sales batch 2. Backend contract: `backend/src/sales/README.md`. Business rules
(B1–B16): `docs/sales-module-build-plan.md`. All calls go through `apiFetch`. The frontend
never computes money or status as truth. The form shows a labelled live *estimate*
(same formula as `sales-totals.ts`); the detail page shows only what the backend returns.

## File map

- `layout.tsx` re-exports the shared `AppShell`. `error.tsx` is the route error fallback.
- `page.tsx`: the list. Server-side pagination and filters (`q`, status, delivery, invoicing, payment, date range). It shows the status plus the three progress axes. Edit and delete appear only for a DRAFT, and only with `sales.manage`.
- `new/page.tsx` and `[id]/edit/page.tsx` wrap `<SalesOrderForm>` in `<RequirePermission sales.manage>`.
- `SalesOrderForm.tsx`: create and edit of a **DRAFT** only.
  - Loads `GET /sales-orders/form-options` (customers, items with `available`, employees, default warehouse).
  - Loads `GET /sales-orders/customer-context/:id` on each customer change. That gives addresses, payment term, credit hold, and credit figures for `sales.approve`/`customers.finance`.
  - In edit mode it merges the draft's own customer/item/salesperson into the options in case they were deactivated since.
  - It has no "save and confirm"; confirming happens on the detail page.
- `_form/ItemsGrid.tsx`: the line table. Each line has a main row and a sub-row. The sub-row holds the price-override reason (shown and required when the price is below the list price, B2) and the line note. Discount inputs (percent *or* amount) are rendered only for `sales.approve` (B3).
- `_form/CustomerPanel.tsx`: the read-only customer facts under the header fields.
- `[id]/page.tsx`: the detail page. It holds the loaded order, the stale-record flag, the backorder list from the last confirm/approve response, and the history reload key.
  - `_sections/StatusActions.tsx`: every status button and its Dialog, described below.
  - `_sections/ItemsSection.tsx`: lines plus totals. On a CONFIRMED order, a line whose open quantity isn't fully reserved is tinted as a backorder.
  - `_sections/HistorySection.tsx`: `GET /sales-orders/:id/history`.
- `shared.tsx`: types matching the backend response shapes (decimals are strings), Persian labels, tones, and helpers.

## Status actions

| Status | Button | Call | Permission |
|---|---|---|---|
| DRAFT | تأیید سفارش / ویرایش / حذف | `POST :id/confirm`, `/edit`, `DELETE :id` | `sales.manage` |
| PENDING_APPROVAL | تأیید / رد | `POST :id/approve`, `POST :id/reject` | `sales.approve` |
| CONFIRMED | بستن سفارش, لغو سفارش (only if nothing delivered) | `POST :id/close`, `POST :id/cancel` (reason required) | `sales.manage` |

Confirm and approve are two-step dialogs driven by the backend's 409 codes:

- `SALES_ORDER_APPROVAL_REQUIRED` (user without `sales.approve`): the dialog shows the reasons and offers «ارسال برای تأیید». That re-posts with `submitForApproval: true`.
- `CREDIT_LIMIT_EXCEEDED` (`sales.approve` holder): the dialog shows the credit figures and asks for a required «علت عبور از سقف اعتبار». That re-posts with `creditOverrideReason`.
- `RECORD_MODIFIED`: a stale-record banner appears and every action is disabled until reload.

Confirm/approve responses carry `backorders[]`. The page shows them as a dismissable banner. A shortfall never blocks confirmation.

## Deliveries section (batch 3)

`[id]/_sections/DeliveriesSection.tsx` lists the order's delivery notes
(`GET /deliveries?salesOrderId=`) once the order is confirmed. «ایجاد تحویل» (`sales.deliver`)
appears while the order is CONFIRMED with undelivered quantity and opens
`/deliveries/new?orderId=…`. See `../deliveries/README.md`.

## Not here yet

Invoices and returns sections are deliberately absent, not shown as disabled placeholders.
They arrive with Batches 4 and 6.

## Landmine

The Base UI Select→Dialog landmine (`purchases/README.md`) can't occur here: every picker
is a native `<select>`, and every Dialog is opened from a button. Keep it that way. If a
Base UI Select is ever introduced, never open a Dialog or `window.confirm()` from its
`onValueChange`.
