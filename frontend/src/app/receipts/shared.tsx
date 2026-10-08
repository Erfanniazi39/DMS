// Shared types, Persian labels, status tones and small display helpers for
// the Receivables module (receipts list/detail, allocation grid, aging
// report, the customer's «حساب مشتری» section). Mirrors the backend's
// src/receivables/receivables-rules.ts labels and
// src/receivables/*.service.ts response shapes — keep the wording/shapes in
// sync there. Not a route: this file has no page.tsx/layout.tsx name.
//
// PaymentMethod / payment-record-status labels are reused from
// ../purchases/shared (the shared PaymentMethod/PaymentStatus enums,
// CLAUDE.md — reused rather than redefined), the same way sales-invoices/
// shared.tsx reuses sales-orders/shared's labels instead of duplicating them.

import type { BadgeTone } from "@/components/ui/status-badge";
export { PAYMENT_METHODS, paymentMethodLabels, type PaymentMethod } from "../purchases/shared";
export { NoAccess } from "../sales-orders/shared";

export type CustomerPaymentDirection = "RECEIPT" | "REFUND";
export type CustomerPaymentStatus = "PENDING" | "COMPLETED" | "CANCELLED";

export const CUSTOMER_PAYMENT_DIRECTIONS: CustomerPaymentDirection[] = ["RECEIPT", "REFUND"];
export const CUSTOMER_PAYMENT_STATUSES: CustomerPaymentStatus[] = ["PENDING", "COMPLETED", "CANCELLED"];

export const customerPaymentDirectionLabels: Record<CustomerPaymentDirection, string> = {
  RECEIPT: "دریافت",
  REFUND: "بازپرداخت",
};

export const customerPaymentStatusLabels: Record<CustomerPaymentStatus, string> = {
  PENDING: "در انتظار وصول (چک)",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export const customerPaymentStatusTone: Record<CustomerPaymentStatus, BadgeTone> = {
  PENDING: "warning",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

export const customerPaymentDirectionTone: Record<CustomerPaymentDirection, BadgeTone> = {
  RECEIPT: "primary",
  REFUND: "accent",
};

// --- Aging buckets (backend receivables-rules.ts AGING_BUCKETS) ----------

export type AgingBucket = "CURRENT" | "D1_30" | "D31_60" | "D61_90" | "D90_PLUS";
export const AGING_BUCKETS: AgingBucket[] = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"];
export const agingBucketLabels: Record<AgingBucket, string> = {
  CURRENT: "جاری",
  D1_30: "۱ تا ۳۰ روز",
  D31_60: "۳۱ تا ۶۰ روز",
  D61_90: "۶۱ تا ۹۰ روز",
  D90_PLUS: "بیش از ۹۰ روز",
};
export type AgingRow = Record<AgingBucket, string> & { total: string };

// --- API record shapes (backend receivables.controller.ts) ---------------
// Decimal columns arrive as JSON strings; dates as ISO strings.

type UserRef = { id: number; username: string } | null;

export type PaymentAllocationRow = {
  id: number;
  customerId: number;
  sourcePaymentId: number | null;
  targetInvoiceId: number | null;
  amount: string;
  allocatedAt: string;
  allocatedByUser: UserRef;
  reversedAt: string | null;
  reversedByUser: UserRef;
  targetInvoice: { id: number; invoiceNumber: string | null } | null;
};

// GET /receivables/payments (paginated with page/pageSize; unpaginated without).
export type CustomerPaymentListItem = {
  id: number;
  paymentNumber: string;
  direction: CustomerPaymentDirection;
  customerId: number;
  paymentDate: string;
  amount: string;
  method: import("../purchases/shared").PaymentMethod;
  status: CustomerPaymentStatus;
  referenceNumber: string | null;
  chequeDueDate: string | null;
  bankName: string | null;
  note: string | null;
  customer: { id: number; customerNumber: string; name: string };
};

// GET /receivables/payments/:id (and the body of every write response).
export type CustomerPaymentDetail = CustomerPaymentListItem & {
  cancelledAt: string | null;
  cancelReason: string | null;
  createdByUser: UserRef;
  cancelledByUser: UserRef;
  createdAt: string;
  // Optimistic-locking token — sent back on cancel/clear/bounce; a mismatch
  // is a 409 with code RECORD_MODIFIED.
  updatedAt: string;
  allocationsAsSource: PaymentAllocationRow[];
};

// GET /receivables/payments/form-options.
export type CustomerPaymentFormOptions = {
  customers: { id: number; customerNumber: string; name: string; status: string }[];
};

export type CustomerPaymentHistoryEntry = {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  user: UserRef;
};

// GET /receivables/customers/:id/open-invoices and /receivables/allocations/suggest.
export type OpenInvoiceRow = {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: string;
  paidAmount: string;
  creditedAmount: string;
  openAmount: string;
};

export type AllocationSuggestion = {
  items: { invoiceId: number; invoiceNumber: string | null; dueDate: string | null; amount: string }[];
  unallocated: string;
};

// --- Display helpers -----------------------------------------------------

export function customerPaymentTitle(payment: { id: number; paymentNumber: string | null }): string {
  return payment.paymentNumber ?? `#${payment.id.toLocaleString("fa-IR")}`;
}

/** amount − Σ active allocations sourced from this payment. */
export function unappliedAmount(payment: CustomerPaymentDetail): number {
  const allocated = payment.allocationsAsSource.filter((row) => row.reversedAt === null).reduce((sum, row) => sum + Number(row.amount), 0);
  return Number(payment.amount) - allocated;
}
