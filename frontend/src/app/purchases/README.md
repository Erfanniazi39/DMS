# Purchases module (frontend)

This module is the reference implementation of the ERP UI conventions. Backend
contract: `backend/src/purchases/README.md`. All calls go through `apiFetch`/`apiUpload`.
The frontend never computes `totalAmount`, `paidAmount`, or `paymentStatus` as truth. It
shows what the backend returns.

## File map

- `layout.tsx`: re-exports the shared `AppShell`. `error.tsx`: route error fallback.
- `page.tsx`: list with filters, pagination, and tone-tinted status/payment cells.
- `new/page.tsx` → `<RequirePermission purchases.manage>` + `<PurchaseForm mode="create">`.
- `[id]/edit/page.tsx` → `<RequirePermission purchases.edit>` + `<PurchaseForm mode="edit">`.
- `[id]/page.tsx`: the detail page. All page state (the loaded purchase, every dialog's open/form/saving state, the returns list) lives here and is passed down to:
  - `[id]/_sections/StatusActions.tsx`: header status-transition buttons. Status changes happen only here, never in the edit form. They call the status-only `PATCH /purchases/:id/status` (`{ status, updatedAt }`) and handle `RECORD_MODIFIED`. `PATCH /purchases/:id` (the edit form) refuses any status change.
  - `[id]/_sections/PaymentsSection.tsx`, `DocumentsSection.tsx`, `ReturnsSection.tsx`: each section plus its dialog. Payable and returnable statuses mirror backend `purchase-rules.ts`.
  - `[id]/_sections/DetailSection.tsx`: section chrome plus the shared toast-callback type.
- `PurchaseForm.tsx`: create/edit form. It owns all form state and handlers: `?prefill=` from a purchase request, request-picker state, the overage-confirm Dialog (on submit), and staged document upload after create. Presentational pieces are in:
  - `_form/FormSection.tsx`: section chrome.
  - `_form/ItemsGrid.tsx`: section 2, the items table.
  - `_form/RequestPicker.tsx`: the "درخواست خرید مرتبط" Select plus its inline overwrite banner.
  - `_form/StagedDocuments.tsx`: section 4, create mode only. It mirrors the backend's extension list and 10 MB limit.
- `shared.tsx`: module types, Persian labels, status→tone maps, `purchaseRequestOptionLabel`. It also re-exports the generic primitives that moved to `components/ui/` and `lib/` (see `frontend/README.md`).

## LANDMINE: RequestPicker and the Base UI Select

The warning comment in `_form/RequestPicker.tsx` (and on `pendingPurchaseRequestId` in
`PurchaseForm.tsx`) describes this rule:

When re-picking a request would overwrite items already in the form, the "replace
items?" confirmation is triggered from the Base UI Select's `onValueChange`. That
confirmation **must stay a plain inline banner**: a conditional `<div>` with
"جایگزین کن"/"انصراف". The Select stays `disabled` while the banner is showing.

- **Never use `window.confirm()` here.** It freezes the tab while the Select popup is still closing. The queued events replay afterwards, which duplicated selections.
- **Never use a modal `Dialog`, Popover, or any portal here.** It collides with the Select's exit-animation tracking and gets stuck in `[data-ending-style]`. That leaves an invisible full-viewport overlay that swallows every click on the page.

Both were shipped once and broke the page. A `setTimeout` deferral did not fix it. Full
incident: `docs/project-knowledge-archive.md` §18.3. This applies to any confirmation
opened synchronously from inside a Base UI Select value-change callback. Other dialogs in
this module (overage confirm on submit, payment/return/document dialogs) are opened from
buttons and are fine.

## Before changing this module

- Check the backend DTO and response shape first. Do not invent fields.
- Keep the UI mirrors of backend rules (payable/returnable statuses, linkable request statuses in `app/purchase-requests/shared.tsx`, upload limits) in sync with the backend.
- After a change, run `npm run build && npm run lint`. E2E specs: `e2e/purchases.spec.ts` and `e2e/purchase-workflow-qa.spec.ts`. Any change to `PurchaseForm`/`RequestPicker` needs a real browser click-through: pick request A, then re-pick B, confirm, and check that the page still responds to clicks.
