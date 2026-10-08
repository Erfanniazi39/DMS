import { ConflictException } from '@nestjs/common';
import type {
  Prisma,
  ReturnReason,
  SalesDeliveryStatus,
  SalesDocumentStatus,
  SalesInvoicingStatus,
  SalesOrderStatus,
  SalesPaymentStatus,
  SalesReturnStatus,
  SalesSourceType,
} from '@prisma/client';

// The Sales module's single definition of what its statuses *mean*. Pure
// values only (no DI), so other modules (later: Receivables, Dashboard,
// Reports) can import them without a module dependency cycle — same role as
// purchases/purchase-rules.ts (CLAUDE.md rule 11).

// Which status a sales order may move to from its current one
// (docs/sales-module-build-plan.md §5). Every status change goes through a
// dedicated SalesOrdersService action — there is no generic "set status":
//   DRAFT            → CONFIRMED (confirm), PENDING_APPROVAL (confirm, when
//                      approval is required and the user can't approve)
//   PENDING_APPROVAL → CONFIRMED (approve), DRAFT (reject — the only path
//                      back to DRAFT)
//   CONFIRMED        → CLOSED (manual short-close), CANCELLED (only while
//                      nothing has been delivered), COMPLETED (system-only,
//                      see SYSTEM_ONLY_SALES_ORDER_STATUSES)
//   COMPLETED / CLOSED / CANCELLED — terminal.
// A DRAFT is never "cancelled" — it is deleted (it has no number, so no gap).
export const ALLOWED_SALES_ORDER_STATUS_TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CONFIRMED'],
  PENDING_APPROVAL: ['CONFIRMED', 'DRAFT'],
  CONFIRMED: ['COMPLETED', 'CLOSED', 'CANCELLED'],
  COMPLETED: [],
  CLOSED: [],
  CANCELLED: [],
};

// Reached only by the system (every line delivered and invoiced — Batches
// 3/4), never by a user action.
export const SYSTEM_ONLY_SALES_ORDER_STATUSES: SalesOrderStatus[] = ['COMPLETED'];

// Only a DRAFT may be edited or deleted.
export const EDITABLE_SALES_ORDER_STATUSES: SalesOrderStatus[] = ['DRAFT'];

// Orders that are committed but not yet (fully) invoiced — what counts as
// "confirmed-uninvoiced" exposure in sales-credit.ts.
export const CREDIT_EXPOSURE_ORDER_WHERE = {
  status: 'CONFIRMED',
  invoicingStatus: { not: 'INVOICED' },
} satisfies Prisma.SalesOrderWhereInput;

// Orders still owed to the customer in goods — CONFIRMED and not yet fully
// delivered (deriveDeliveryStatus in sales-progress.ts only reaches DELIVERED
// once every line is delivered in full, so "not DELIVERED" is exactly "at
// least one line still has deliveredQty < quantity"). Used by
// sales-reports.ts's getBacklog() (Batch 7) — never re-derive "open for
// delivery" from the raw counters elsewhere.
export const BACKLOG_SALES_ORDER_WHERE = {
  status: 'CONFIRMED',
  deliveryStatus: { not: 'DELIVERED' },
} satisfies Prisma.SalesOrderWhereInput;

// "Real" confirmed sales activity for trend/report purposes: an order that
// was actually confirmed (confirmedAt set) and hasn't since been cancelled.
// Mirrors purchases' COUNTABLE_PURCHASE_WHERE (CANCELLED excluded) — a
// CLOSED order still counts (it was fulfilled, just short-closed). Used by
// sales-reports.ts's getDailySummary() (Batch 7).
export const CONFIRMED_SALES_ORDER_WHERE = {
  confirmedAt: { not: null },
  status: { not: 'CANCELLED' },
} satisfies Prisma.SalesOrderWhereInput;

// Document-number prefix (common/document-sequence.ts): SO-<jalali year>-000001,
// assigned at CONFIRMED — never at draft creation (build plan §9).
export const SALES_ORDER_DOC_TYPE = 'SO';

// --- Deliveries (batch 3) -----------------------------------------------------

// Document-number prefix: DN-<jalali year>-000001, assigned at POSTED —
// never at draft creation.
export const DELIVERY_DOC_TYPE = 'DN';

// A delivery may be drafted and posted only against an order in one of
// these statuses. A CLOSED / CANCELLED / COMPLETED order takes no more
// deliveries; a draft left behind on such an order can only be deleted.
export const DELIVERABLE_SALES_ORDER_STATUSES: SalesOrderStatus[] = ['CONFIRMED'];

// Delivery (and later SalesInvoice / CreditNote): DRAFT → POSTED only,
// one-way; POSTED is immutable and terminal (build plan §5). Only a DRAFT
// may be edited or deleted.
export const EDITABLE_SALES_DOCUMENT_STATUSES: SalesDocumentStatus[] = ['DRAFT'];

// --- Invoices (batch 4) ------------------------------------------------------

// Document-number prefix: INV-<jalali year>-000001, assigned at POSTED —
// never at draft creation.
export const SALES_INVOICE_DOC_TYPE = 'INV';

// The single line of an opening-balance invoice (historical AR, build plan
// §4.2) when the user doesn't name it.
export const OPENING_BALANCE_ITEM_NAME = 'مانده افتتاحیه';

// What counts as a sale for statistics/reports: posted, operational
// invoices. OPENING_BALANCE invoices are receivables, not sales (build plan
// §4.2) — every sales figure must filter through this (Batch 7).
export const SALES_STATISTICS_INVOICE_WHERE = {
  status: 'POSTED',
  sourceType: 'OPERATIONAL',
} satisfies Prisma.SalesInvoiceWhereInput;

// A posted invoice that still has an open amount (total − paid − credited
// > 0). paymentStatus is PAID exactly when nothing is open (see
// sales-progress.ts deriveInvoicePaymentStatus()), so this is expressible
// without a column comparison.
export const OPEN_SALES_INVOICE_WHERE = {
  status: 'POSTED',
  paymentStatus: { not: 'PAID' },
} satisfies Prisma.SalesInvoiceWhereInput;

// 409 code: a delivery already has a DRAFT invoice (B7: one invoice per
// delivery) — details.salesInvoiceId points to it.
export const SALES_INVOICE_DRAFT_EXISTS = 'SALES_INVOICE_DRAFT_EXISTS';

// Why a DRAFT needs a sales.approve holder before it can be CONFIRMED
// (build plan §5 row 1, B3, B4).
export type SalesOrderApprovalReason = 'DISCOUNT' | 'CREDIT_LIMIT';

export const SALES_ORDER_APPROVAL_REASON_LABELS_FA: Record<SalesOrderApprovalReason, string> = {
  DISCOUNT: 'سفارش دارای تخفیف است',
  CREDIT_LIMIT: 'سقف اعتبار مشتری کافی نیست',
};

// Distinct, frontend-detectable 409 codes.
export const SALES_ORDER_APPROVAL_REQUIRED = 'SALES_ORDER_APPROVAL_REQUIRED';
export const CREDIT_LIMIT_EXCEEDED = 'CREDIT_LIMIT_EXCEEDED';
// Posting a delivery for a customer currently on credit hold (business
// decision 2026-10-07, extends B4: a hold blocks delivery posting too, not
// just order confirmation — no override path).
export const CUSTOMER_CREDIT_HOLD = 'CUSTOMER_CREDIT_HOLD';

// One-line text snapshot of a CustomerAddress, as printed on sales
// documents (order delivery address, invoice billing address).
export function formatAddress(address: { province: string | null; city: string | null; addressLine: string; postalCode: string | null }) {
  return [address.province, address.city, address.addressLine, address.postalCode ? `کد پستی ${address.postalCode}` : null]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join('، ');
}

export function ensureSalesOrderTransition(from: SalesOrderStatus, to: SalesOrderStatus) {
  if (!ALLOWED_SALES_ORDER_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(
      `تغییر وضعیت سفارش فروش از «${SALES_ORDER_STATUS_LABELS_FA[from]}» به «${SALES_ORDER_STATUS_LABELS_FA[to]}» مجاز نیست`,
    );
  }
}

// --- Returns + Credit Notes (batch 6) ----------------------------------------

// Document-number prefixes: RMA-<jalali year>-000001 (assigned at APPROVED —
// a REQUESTED return that's rejected/cancelled before approval never gets
// one, no gap) and CN-<jalali year>-000001 (assigned at posting, like every
// other SalesDocumentStatus document).
export const SALES_RETURN_DOC_TYPE = 'RMA';
export const CREDIT_NOTE_DOC_TYPE = 'CN';

// Transitions per build plan §5: REQUESTED → APPROVED|REJECTED|CANCELLED,
// APPROVED → RECEIVED|CANCELLED, RECEIVED → INSPECTED, INSPECTED → COMPLETED
// (set when the return's credit note posts, or by an explicit no-credit
// close with a reason — SalesReturnsService.completeWithoutCredit()).
export const ALLOWED_SALES_RETURN_STATUS_TRANSITIONS: Record<SalesReturnStatus, SalesReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['RECEIVED', 'CANCELLED'],
  REJECTED: [],
  RECEIVED: ['INSPECTED'],
  INSPECTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function ensureSalesReturnTransition(from: SalesReturnStatus, to: SalesReturnStatus) {
  if (!ALLOWED_SALES_RETURN_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(
      `تغییر وضعیت مرجوعی از «${SALES_RETURN_STATUS_LABELS_FA[from]}» به «${SALES_RETURN_STATUS_LABELS_FA[to]}» مجاز نیست`,
    );
  }
}

// A return may be requested only against a POSTED delivery (B8: every
// return references a delivery; a DRAFT delivery has issued no stock yet).
export const RETURNABLE_DELIVERY_STATUSES: SalesDocumentStatus[] = ['POSTED'];

// Distinct 409 codes.
export const CREDIT_NOTE_DRAFT_EXISTS = 'CREDIT_NOTE_DRAFT_EXISTS';

// --- Persian labels ---------------------------------------------------------

export const SALES_ORDER_STATUS_LABELS_FA: Record<SalesOrderStatus, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تأیید',
  CONFIRMED: 'تأییدشده',
  COMPLETED: 'تکمیل‌شده',
  CLOSED: 'بسته‌شده',
  CANCELLED: 'لغوشده',
};

export const SALES_DELIVERY_STATUS_LABELS_FA: Record<SalesDeliveryStatus, string> = {
  NOT_DELIVERED: 'تحویل‌نشده',
  PARTIALLY_DELIVERED: 'تحویل جزئی',
  DELIVERED: 'تحویل کامل',
};

export const SALES_INVOICING_STATUS_LABELS_FA: Record<SalesInvoicingStatus, string> = {
  NOT_INVOICED: 'فاکتورنشده',
  PARTIALLY_INVOICED: 'فاکتور جزئی',
  INVOICED: 'فاکتور کامل',
};

export const SALES_PAYMENT_STATUS_LABELS_FA: Record<SalesPaymentStatus, string> = {
  UNPAID: 'پرداخت‌نشده',
  PARTIALLY_PAID: 'پرداخت جزئی',
  PAID: 'پرداخت کامل',
};

export const SALES_DOCUMENT_STATUS_LABELS_FA: Record<SalesDocumentStatus, string> = {
  DRAFT: 'پیش‌نویس',
  POSTED: 'ثبت‌شده',
};

export const SALES_SOURCE_TYPE_LABELS_FA: Record<SalesSourceType, string> = {
  OPERATIONAL: 'عملیاتی',
  OPENING_BALANCE: 'مانده افتتاحیه',
};

export const SALES_RETURN_STATUS_LABELS_FA: Record<SalesReturnStatus, string> = {
  REQUESTED: 'درخواست‌شده',
  APPROVED: 'تأییدشده',
  REJECTED: 'ردشده',
  RECEIVED: 'دریافت‌شده',
  INSPECTED: 'بازرسی‌شده',
  COMPLETED: 'تکمیل‌شده',
  CANCELLED: 'لغوشده',
};

export const RETURN_REASON_LABELS_FA: Record<ReturnReason, string> = {
  DAMAGED: 'آسیب‌دیده',
  EXPIRED: 'تاریخ‌گذشته',
  WRONG_ITEM: 'کالای اشتباه',
  QUALITY: 'ایراد کیفیت',
  CUSTOMER_REFUSED: 'عدم‌پذیرش مشتری',
  OTHER: 'سایر',
};
