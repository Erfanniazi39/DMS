# Sales Invoices module (frontend)

Built in Sales batch 4. Backend contract: `backend/src/sales/README.md` ("Invoice lifecycle").
Business rules: `docs/sales-module-build-plan.md` (B7 one invoice per delivery, §4.2 opening
balance, §5). All calls go through `apiFetch`. Layout, labels and patterns mirror `../deliveries/`
(and reuse `../sales-orders/shared.tsx` helpers and `_form/FormSection.tsx`).

## File map

- `layout.tsx` re-exports the shared `AppShell`. `error.tsx` is the route error fallback.
- `page.tsx`: two tabs. «صف فاکتور» = `GET /sales-invoices/queue` (posted deliveries not yet
  invoiced; one-click «ایجاد فاکتور» per row for `sales.invoice`, or a link to the existing draft).
  «فاکتورها» = `GET /sales-invoices` with search / status / payment status / type / overdue /
  date filters; overdue rows (posted, not PAID, due date passed) are tinted. Delete only for a
  DRAFT with `sales.invoice`. Header button «فاکتور مانده افتتاحیه» (`sales.invoice`).
- `create-invoice.ts`: `createInvoiceFromDelivery(deliveryId)` — `POST /sales-invoices`; on 409
  `SALES_INVOICE_DRAFT_EXISTS` resolves to the existing draft's id. Used by the queue and the
  delivery page's «فاکتورها» section.
- `InvoicesTable.tsx`: compact table used by `deliveries/[id]/_sections/InvoicesSection.tsx` and
  `sales-orders/[id]/_sections/InvoicesSection.tsx`.
- `[id]/page.tsx`: detail. `_sections/StatusActions.tsx` («ثبت فاکتور» dialog showing the total
  and the due date it will get, حذف, چاپ), `_sections/ItemsSection.tsx` (lines + money summary;
  paid / credited / open once POSTED), `_sections/HistorySection.tsx`. No draft edit: a wrong
  draft is deleted and re-created from the delivery.
- `[id]/print/page.tsx`: browser-print invoice built from `components/print/print-document.tsx`.
  Prints the economic code, never the national ID (B14). A DRAFT prints with the
  «پیش‌نویس — فاقد اعتبار» marker.
- `opening-balance/page.tsx`: minimal DRAFT opening-balance form (customer, date, note, manual lines
  of description / quantity / unit price / tax rate) behind `<RequirePermission sales.invoice>`.
  Customer picker is a native `<select>` (no Base-UI Select/Dialog landmine).
- `shared.tsx`: response types, labels, tones, `salesInvoiceTitle()`, `invoiceOpenAmount()`,
  `isInvoiceOverdue()`, `invoiceDeliveries()`.

## Status actions

| Status | Button | Call | Permission |
|---|---|---|---|
| DRAFT | ثبت فاکتور / حذف | `POST :id/post`, `DELETE :id` | `sales.invoice` |
| any | چاپ | `/sales-invoices/:id/print` | `sales.view` |

`RECORD_MODIFIED` shows the stale-record banner and disables actions. Settlement fields
(paid / credited / payment status) have no UI action — Receivables (Batch 5) writes them.
