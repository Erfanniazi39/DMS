import type { Prisma, PurchasePaymentStatus, PurchaseStatus } from '@prisma/client';

// The Purchases module's single definition of what its statuses *mean* for
// anything that counts, sums, or lists purchases. Other modules (Purchase
// Requests, Dashboard, future Reports) must reference these rather than
// re-deriving them from the raw enum — CLAUDE.md rule 11. Pure values only
// (no DI), so importing them never creates a module dependency cycle.

// A CANCELLED purchase never delivered or cost anything, so it is excluded
// from every quantity and amount aggregate (fulfilled request quantities,
// spend, outstanding balances, aging).
export const COUNTABLE_PURCHASE_WHERE = { status: { not: 'CANCELLED' } } satisfies Prisma.PurchaseWhereInput;

// Purchases whose status still says work is pending. Status is only ever set
// manually (there is no auto-close), so a RECEIVED + fully PAID purchase that
// nobody closed still counts as open — this reflects the real status field.
export const OPEN_PURCHASE_STATUSES: PurchaseStatus[] = ['DRAFT', 'CONFIRMED', 'RECEIVED'];

// Payment statuses that mean money is still owed (see derivePaymentStatus()
// in purchase-totals.ts, which is the only place these are assigned).
export const OUTSTANDING_PAYMENT_STATUSES: PurchasePaymentStatus[] = ['UNPAID', 'PARTIAL'];

// A non-cancelled purchase with money still owed on it.
export const OUTSTANDING_PURCHASE_WHERE = {
  ...COUNTABLE_PURCHASE_WHERE,
  paymentStatus: { in: OUTSTANDING_PAYMENT_STATUSES },
} satisfies Prisma.PurchaseWhereInput;

export const OPEN_PURCHASE_WHERE = { status: { in: OPEN_PURCHASE_STATUSES } } satisfies Prisma.PurchaseWhereInput;

// Business decision 2026-10-05: money can only be recorded against a
// purchase that's actually been committed to — never a DRAFT or CANCELLED one.
export const PAYABLE_PURCHASE_STATUSES: PurchaseStatus[] = ['CONFIRMED', 'RECEIVED', 'CLOSED'];

// Business decision 2026-10-05: a return represents goods that were actually
// received, so only a RECEIVED or CLOSED purchase can have one.
export const RETURNABLE_PURCHASE_STATUSES: PurchaseStatus[] = ['RECEIVED', 'CLOSED'];

// Which status a purchase may move to from its current one, via
// PATCH /purchases/:id/status (PurchasesService.changeStatus()) — the only
// path that changes an existing purchase's status. One step forward at a
// time (DRAFT → CONFIRMED → RECEIVED → CLOSED), or cancel from any
// non-terminal status. CLOSED and CANCELLED are terminal. Same-status and
// "back to DRAFT" are never transitions.
export const ALLOWED_PURCHASE_STATUS_TRANSITIONS: Record<PurchaseStatus, PurchaseStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

// Target statuses refused while the purchase has any Return-to-Vendor record
// (business decisions 2026-10-05 #10 and 2026-10-06): a cancelled purchase
// "never delivered anything", which contradicts goods having been returned.
// Closing a purchase with returns IS allowed — it's the normal end of a
// reconciled purchase.
export const RETURN_BLOCKED_TARGET_STATUSES: PurchaseStatus[] = ['CANCELLED'];

// Persian status names for the user-facing errors the payment and return
// status gates above raise (PurchasePaymentsService / PurchaseReturnsService)
// and for the status-transition errors in PurchasesService.changeStatus().
export const PURCHASE_STATUS_LABELS_FA: Record<PurchaseStatus, string> = {
  DRAFT: 'پیش‌نویس',
  CONFIRMED: 'تأییدشده',
  RECEIVED: 'دریافت‌شده',
  CLOSED: 'بسته‌شده',
  CANCELLED: 'لغوشده',
};
