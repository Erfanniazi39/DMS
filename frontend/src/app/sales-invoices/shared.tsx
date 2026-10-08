// Shared types, Persian labels, status tones and small display helpers for
// the Sales Invoices module (queue/list, detail, print, opening-balance
// form). Mirrors the backend's src/sales/sales-rules.ts labels and
// src/sales/sales-invoices.service.ts response shapes — keep the wording /
// shapes in sync there. Not a route: this file has no page.tsx/layout.tsx
// name. Order-side labels/helpers (payment-status axis, formatQuantity,
// NoAccess) are reused from ../sales-orders/shared rather than duplicated.

import type { BadgeTone } from "@/components/ui/status-badge";
import { todayIso } from "@/lib/format";
import type { SalesInvoicingStatus, SalesOrderStatus, SalesPaymentStatus } from "../sales-orders/shared";

export type SalesInvoiceStatus = "DRAFT" | "POSTED";
export type SalesSourceType = "OPERATIONAL" | "OPENING_BALANCE";

export const SALES_INVOICE_STATUSES: SalesInvoiceStatus[] = ["DRAFT", "POSTED"];
export const SALES_SOURCE_TYPES: SalesSourceType[] = ["OPERATIONAL", "OPENING_BALANCE"];

export const salesInvoiceStatusLabels: Record<SalesInvoiceStatus, string> = {
  DRAFT: "پیش‌نویس",
  POSTED: "ثبت‌شده",
};

export const salesInvoiceStatusTone: Record<SalesInvoiceStatus, BadgeTone> = {
  DRAFT: "secondary",
  POSTED: "success",
};

export const salesSourceTypeLabels: Record<SalesSourceType, string> = {
  OPERATIONAL: "عملیاتی",
  OPENING_BALANCE: "مانده افتتاحیه",
};

// Distinct 409 code: the delivery already has a DRAFT invoice (B7: one
// invoice per delivery) — details.salesInvoiceId points to it.
export const SALES_INVOICE_DRAFT_EXISTS = "SALES_INVOICE_DRAFT_EXISTS";

// --- API record shapes (backend sales-invoices.service.ts) ---------------
// Decimal columns arrive as JSON strings; dates as ISO strings.

type UserRef = { id: number; username: string } | null;

type InvoiceMoney = {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  totalAmount: string;
  // Settlement — written only by Receivables (Batch 5); 0 until then.
  paidAmount: string;
  creditedAmount: string;
  paymentStatus: SalesPaymentStatus;
};

// GET /sales-invoices (paginated with page/pageSize; unpaginated without).
export type SalesInvoiceListItem = InvoiceMoney & {
  id: number;
  // null while DRAFT — assigned at POSTED.
  invoiceNumber: string | null;
  sourceType: SalesSourceType;
  customerId: number;
  salesOrderId: number | null;
  invoiceDate: string;
  // Set at POSTED: invoiceDate + paymentDueDays.
  dueDate: string | null;
  status: SalesInvoiceStatus;
  customerName: string;
  paymentTermName: string | null;
  paymentDueDays: number;
  updatedAt: string;
  customer: { id: number; customerNumber: string };
  salesOrder: { id: number; orderNumber: string | null } | null;
  _count: { items: number };
};

// GET /sales-invoices/queue — POSTED deliveries not yet invoiced.
export type SalesInvoiceQueueRow = {
  id: number;
  deliveryNumber: string | null;
  deliveryDate: string;
  customerId: number;
  salesOrderId: number;
  salesOrder: { id: number; orderNumber: string | null; customerName: string };
  customer: { id: number; customerNumber: string };
  lineCount: number;
  openLineCount: number;
  draftInvoiceId: number | null;
};

export type SalesInvoiceLine = {
  id: number;
  lineNo: number;
  deliveryItemId: number | null;
  salesOrderItemId: number | null;
  itemId: number | null;
  itemCode: string | null;
  itemName: string;
  unitName: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  creditedQty: string;
  deliveryItem: {
    id: number;
    quantity: string;
    invoicedQty: string;
    delivery: { id: number; deliveryNumber: string | null; deliveryDate: string };
  } | null;
  salesOrderItem: { id: number; lineNo: number } | null;
};

// GET /sales-invoices/:id (and the body of every write response).
export type SalesInvoiceDetail = InvoiceMoney & {
  id: number;
  invoiceNumber: string | null;
  sourceType: SalesSourceType;
  customerId: number;
  salesOrderId: number | null;
  invoiceDate: string;
  dueDate: string | null;
  status: SalesInvoiceStatus;
  customerName: string;
  customerEconomicCode: string | null;
  billingAddressText: string | null;
  paymentTermName: string | null;
  paymentDueDays: number;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on «ثبت فاکتور»; a mismatch is a
  // 409 with code RECORD_MODIFIED.
  updatedAt: string;
  customer: { id: number; customerNumber: string; name: string };
  salesOrder: {
    id: number;
    orderNumber: string | null;
    orderDate: string;
    status: SalesOrderStatus;
    invoicingStatus: SalesInvoicingStatus;
    customerReference: string | null;
    customerNote: string | null;
  } | null;
  createdByUser: UserRef;
  postedByUser: UserRef;
  items: SalesInvoiceLine[];
};

// GET /sales-invoices/form-options (sales.invoice) — opening-balance form.
export type SalesInvoiceFormOptions = {
  customers: { id: number; customerNumber: string; name: string; status: string }[];
};

// GET /sales-invoices/:id/history.
export type SalesInvoiceHistoryEntry = {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  user: UserRef;
};

// --- Display helpers -----------------------------------------------------

/** "INV-1405-000001", or a draft placeholder (numbers are assigned at posting). */
export function salesInvoiceTitle(invoice: { id: number; invoiceNumber: string | null }): string {
  return invoice.invoiceNumber ?? `پیش‌نویس #${invoice.id.toLocaleString("fa-IR")}`;
}

/** total − paid − credited. */
export function invoiceOpenAmount(invoice: { totalAmount: string; paidAmount: string; creditedAmount: string }): number {
  return Number(invoice.totalAmount) - Number(invoice.paidAmount) - Number(invoice.creditedAmount);
}

/**
 * "Overdue" is not a stored status (build plan §4.2) — a POSTED invoice that
 * isn't fully paid and whose due date is before today.
 */
export function isInvoiceOverdue(invoice: { status: SalesInvoiceStatus; paymentStatus: SalesPaymentStatus; dueDate: string | null }): boolean {
  return invoice.status === "POSTED" && invoice.paymentStatus !== "PAID" && invoice.dueDate !== null && invoice.dueDate.slice(0, 10) < todayIso();
}

/** Unique delivery notes behind an invoice's lines, in line order. */
export function invoiceDeliveries(invoice: SalesInvoiceDetail): { id: number; deliveryNumber: string | null; deliveryDate: string }[] {
  const seen = new Map<number, { id: number; deliveryNumber: string | null; deliveryDate: string }>();
  for (const line of invoice.items) {
    if (line.deliveryItem && !seen.has(line.deliveryItem.delivery.id)) seen.set(line.deliveryItem.delivery.id, line.deliveryItem.delivery);
  }
  return [...seen.values()];
}
