# Deliveries module (frontend)

Built in Sales batch 3. Backend contract: `backend/src/sales/README.md` ("Delivery lifecycle").
Business rules: `docs/sales-module-build-plan.md` (§5 stock effects). All calls go through
`apiFetch`. Layout, labels and patterns mirror `../sales-orders/` (and reuse its `shared.tsx`
helpers and `_form/FormSection.tsx`).

## File map

- `layout.tsx` re-exports the shared `AppShell`. `error.tsx` is the route error fallback.
- `page.tsx`: two tabs. «صف تحویل» = `GET /deliveries/queue` (confirmed orders with lines still
  to deliver; «ایجاد تحویل» per row for `sales.deliver`). «حواله‌های تحویل» = `GET /deliveries`
  with search / status / date filters; edit and delete only for a DRAFT with `sales.deliver`.
- `new/page.tsx` (`?orderId=`) and `[id]/edit/page.tsx` wrap `<DeliveryForm>` in
  `<RequirePermission sales.deliver>`.
- `DeliveryForm.tsx`: DRAFT create/edit. Loads `GET /deliveries/order-context/:orderId`. Each
  order line shows ordered / delivered / remaining / this order's reservation / free stock and
  takes a quantity (prefilled with the remaining quantity on create). Lines at 0 aren't sent. A
  line asking for more than reservation + free stock is tinted as a warning (display only; the
  backend refuses it at posting).
- `[id]/page.tsx`: detail. `_sections/StatusActions.tsx` («ثبت حواله», ویرایش, حذف, چاپ),
  `_sections/ItemsSection.tsx`, `_sections/HistorySection.tsx`.
- `[id]/print/page.tsx`: browser-print delivery note built from `components/print/print-document.tsx`
  (`PrintToolbar`, `PrintSheet`, `PrintHeader`, `PrintFields`, `PrintSignatures`). A DRAFT prints
  with a «پیش‌نویس — فاقد اعتبار» marker. Reuse those components for invoices / credit notes.
- `shared.tsx`: response types, labels, tones, `deliveryTitle()`.

## Status actions

| Status | Button | Call | Permission |
|---|---|---|---|
| DRAFT | ثبت حواله / ویرایش / حذف | `POST :id/post`, `/edit`, `DELETE :id` | `sales.deliver` |
| any | چاپ | `/deliveries/:id/print` | `sales.view` |

A stock block on posting (409 `NEGATIVE_STOCK` or `STOCK_RESERVED_FOR_OTHERS`) or a customer
credit hold (409 `CUSTOMER_CREDIT_HOLD`, batch 4) is shown inside the dialog; there is no override.

A POSTED delivery's detail page also shows `_sections/InvoicesSection.tsx` («فاکتورها», batch 4):
its invoices, its own invoicing status, and «ایجاد فاکتور» (`sales.invoice`) while it has
uninvoiced quantity and no draft invoice. `RECORD_MODIFIED` shows the stale-record banner and disables actions.

## Printing

`globals.css` sets an A4 `@page`; `AppShell` hides its header and sidebar with `print:hidden`.
No PDF library.
