import { ConflictException } from '@nestjs/common';
import type { CustomerPaymentDirection, PaymentStatus, Prisma } from '@prisma/client';

// The Receivables module's single definition of what CustomerPayment.status
// means (build plan §5), modeled exactly on sales/sales-rules.ts. Pure
// values only (no DI) — reused by the controller and every service in this
// module.
//
// CustomerPayment.status reuses the shared PaymentStatus enum (Purchases):
//   PENDING    only ever created for method=CHECK (an uncleared cheque, B9).
//              An allocation may already exist against a PENDING payment
//              (it is "reserved" for that invoice) but does NOT settle the
//              invoice yet — see receivables/settlement.ts.
//   COMPLETED  created directly for CASH/BANK_TRANSFER/CARD, or reached from
//              PENDING via «تأیید وصول چک» (clearCheque) — only then does an
//              existing allocation start counting toward the invoice.
//   CANCELLED  terminal. Reached from PENDING via «برگشت چک» (bounceCheque,
//              reason required) or from COMPLETED via «لغو دریافت/پرداخت»
//              (cancel, reason required) — both reverse every active
//              allocation sourced from the payment (the debt/credit
//              reappears), never delete them.
export const ALLOWED_CUSTOMER_PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['CANCELLED'],
  CANCELLED: [],
};

export function ensureCustomerPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (!ALLOWED_CUSTOMER_PAYMENT_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(
      `تغییر وضعیت دریافت/پرداخت از «${CUSTOMER_PAYMENT_STATUS_LABELS_FA[from]}» به «${CUSTOMER_PAYMENT_STATUS_LABELS_FA[to]}» مجاز نیست`,
    );
  }
}

// Document-number prefixes (common/document-sequence.ts), assigned
// immediately on save — unlike Sales documents, a CustomerPayment has no
// draft stage (build plan §4.3).
export const RECEIPT_DOC_TYPE = 'RCP';
export const REFUND_DOC_TYPE = 'RFD';

// Money actually received from a customer right now (B9): a RECEIPT payment
// that has actually cleared. A PENDING (uncleared cheque) or CANCELLED
// payment is not money in hand yet/anymore. Exported as a plain value (no
// DI) so Sales' reporting code (sales/sales-reports.service.ts, Batch 7) can
// import the definition directly without the Sales module depending on
// ReceivablesModule — the dependency direction stays receivables → sales
// (build plan §3); this is the same pattern DashboardService already uses to
// read Purchases' rule constants. Never re-derive "received" yourself.
export const COMPLETED_RECEIPT_PAYMENT_WHERE = {
  direction: 'RECEIPT',
  status: 'COMPLETED',
} satisfies Prisma.CustomerPaymentWhereInput;

// --- Persian labels ----------------------------------------------------------

export const CUSTOMER_PAYMENT_DIRECTION_LABELS_FA: Record<CustomerPaymentDirection, string> = {
  RECEIPT: 'دریافت',
  REFUND: 'بازپرداخت',
};

export const CUSTOMER_PAYMENT_STATUS_LABELS_FA: Record<PaymentStatus, string> = {
  PENDING: 'در انتظار وصول (چک)',
  COMPLETED: 'تکمیل‌شده',
  CANCELLED: 'لغوشده',
};

// Aging buckets (build plan §4.3's customer-balances.service.ts), keyed by
// days overdue relative to the invoice's dueDate as of today.
export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS_FA: Record<AgingBucket, string> = {
  CURRENT: 'جاری',
  D1_30: '۱ تا ۳۰ روز',
  D31_60: '۳۱ تا ۶۰ روز',
  D61_90: '۶۱ تا ۹۰ روز',
  D90_PLUS: 'بیش از ۹۰ روز',
};

/** Which aging bucket an invoice's open amount falls into, given days overdue (today − dueDate, in whole days). */
export function agingBucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return 'D1_30';
  if (daysOverdue <= 60) return 'D31_60';
  if (daysOverdue <= 90) return 'D61_90';
  return 'D90_PLUS';
}
