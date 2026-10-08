// Shared types, Persian labels, status tones and small display helpers for
// the Sales Returns (مرجوعی) module (request form, list/approval queue,
// detail, receive/inspect dialogs, credit notes). Mirrors the backend's
// src/sales/sales-rules.ts labels and src/sales/sales-returns.service.ts /
// src/receivables/credit-notes.service.ts response shapes — keep the
// wording/shapes in sync there. Not a route: this file has no
// page.tsx/layout.tsx name.

import type { BadgeTone } from "@/components/ui/status-badge";
export { NoAccess, formatQuantity } from "../sales-orders/shared";

export type SalesReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "RECEIVED" | "INSPECTED" | "COMPLETED" | "CANCELLED";
export type ReturnReason = "DAMAGED" | "EXPIRED" | "WRONG_ITEM" | "QUALITY" | "CUSTOMER_REFUSED" | "OTHER";
export type CreditNoteStatus = "DRAFT" | "POSTED";

export const SALES_RETURN_STATUSES: SalesReturnStatus[] = ["REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "INSPECTED", "COMPLETED", "CANCELLED"];
export const RETURN_REASONS: ReturnReason[] = ["DAMAGED", "EXPIRED", "WRONG_ITEM", "QUALITY", "CUSTOMER_REFUSED", "OTHER"];

export const salesReturnStatusLabels: Record<SalesReturnStatus, string> = {
  REQUESTED: "درخواست‌شده",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
  RECEIVED: "دریافت‌شده",
  INSPECTED: "بازرسی‌شده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export const salesReturnStatusTone: Record<SalesReturnStatus, BadgeTone> = {
  REQUESTED: "warning",
  APPROVED: "primary",
  REJECTED: "destructive",
  RECEIVED: "accent",
  INSPECTED: "secondary",
  COMPLETED: "success",
  CANCELLED: "muted",
};

export const returnReasonLabels: Record<ReturnReason, string> = {
  DAMAGED: "آسیب‌دیده",
  EXPIRED: "تاریخ‌گذشته",
  WRONG_ITEM: "کالای اشتباه",
  QUALITY: "ایراد کیفیت",
  CUSTOMER_REFUSED: "عدم‌پذیرش مشتری",
  OTHER: "سایر",
};

export const creditNoteStatusLabels: Record<CreditNoteStatus, string> = { DRAFT: "پیش‌نویس", POSTED: "ثبت‌شده" };
export const creditNoteStatusTone: Record<CreditNoteStatus, BadgeTone> = { DRAFT: "secondary", POSTED: "success" };

// Distinct 409 code (backend sales-rules.ts): a DRAFT credit note already
// exists for this return — details.creditNoteId points to it.
export const CREDIT_NOTE_DRAFT_EXISTS = "CREDIT_NOTE_DRAFT_EXISTS";

// --- API record shapes ----------------------------------------------------
// Decimal columns arrive as JSON strings; dates as ISO strings.

type UserRef = { id: number; username: string } | null;

export type CreditNoteRef = { id: number; creditNoteNumber: string | null; status: CreditNoteStatus; totalAmount: string; createdAt: string };

// GET /sales-returns (paginated with page/pageSize; unpaginated without).
export type SalesReturnListItem = {
  id: number;
  returnNumber: string | null;
  customerId: number;
  salesOrderId: number | null;
  deliveryId: number | null;
  requestDate: string;
  reason: ReturnReason;
  status: SalesReturnStatus;
  updatedAt: string;
  customer: { id: number; customerNumber: string };
  salesOrder: { id: number; orderNumber: string | null } | null;
  delivery: { id: number; deliveryNumber: string | null } | null;
  _count: { items: number };
};

export type SalesReturnLine = {
  id: number;
  deliveryItemId: number | null;
  itemId: number;
  itemName: string;
  unitName: string;
  unitPrice: string;
  requestedQty: string;
  receivedQty: string;
  restockQty: string;
  writeOffQty: string;
  creditedQty: string;
  conditionNote: string | null;
  deliveryItem: { id: number; quantity: string; returnedQty: string; salesOrderItemId: number } | null;
};

// GET /sales-returns/:id (and the body of every write response).
export type SalesReturnDetail = {
  id: number;
  returnNumber: string | null;
  customerId: number;
  salesOrderId: number | null;
  deliveryId: number | null;
  locationId: number;
  requestDate: string;
  reason: ReturnReason;
  status: SalesReturnStatus;
  rejectReason: string | null;
  note: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  inspectedAt: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on every write; a mismatch is a
  // 409 with code RECORD_MODIFIED.
  updatedAt: string;
  customer: { id: number; customerNumber: string; name: string };
  salesOrder: { id: number; orderNumber: string | null } | null;
  delivery: { id: number; deliveryNumber: string | null; deliveryDate: string } | null;
  location: { id: number; code: string; name: string };
  requestedByUser: UserRef;
  approvedByUser: UserRef;
  receivedByUser: UserRef;
  inspectedByUser: UserRef;
  items: SalesReturnLine[];
  creditNotes: CreditNoteRef[];
};

// GET /sales-returns/delivery-context/:deliveryId (sales.manage) — the
// request form's source. returnableQty is display only; request()
// re-checks it server-side.
export type SalesReturnDeliveryContext = {
  id: number;
  deliveryNumber: string | null;
  deliveryDate: string;
  status: string;
  customerId: number;
  salesOrderId: number;
  locationId: number;
  returnable: boolean;
  items: {
    id: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    unitName: string;
    unitPrice: string;
    quantity: string;
    returnedQty: string;
    returnableQty: string;
  }[];
};

export type SalesReturnHistoryEntry = { id: number; action: string; details: string | null; createdAt: string; user: UserRef };

// GET /credit-notes/:id.
export type CreditNoteLine = {
  id: number;
  quantity: string | null;
  unitPrice: string | null;
  taxAmount: string;
  lineTotal: string;
  salesInvoiceItem: { id: number; itemName: string; unitName: string | null } | null;
  salesReturnItem: { id: number; itemName: string } | null;
};

export type CreditNoteDetail = {
  id: number;
  creditNoteNumber: string | null;
  customerId: number;
  salesInvoiceId: number;
  salesReturnId: number | null;
  creditDate: string;
  reason: string;
  status: CreditNoteStatus;
  subtotal: string;
  taxTotal: string;
  totalAmount: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; customerNumber: string; name: string };
  salesInvoice: { id: number; invoiceNumber: string | null; totalAmount: string; paidAmount: string; creditedAmount: string; paymentStatus: string };
  salesReturn: { id: number; returnNumber: string | null; status: SalesReturnStatus } | null;
  createdByUser: UserRef;
  postedByUser: UserRef;
  items: CreditNoteLine[];
};

// --- Display helpers -----------------------------------------------------

/** "RMA-1405-000001", or a placeholder (numbers are assigned at APPROVED). */
export function salesReturnTitle(salesReturn: { id: number; returnNumber: string | null }): string {
  return salesReturn.returnNumber ?? `درخواست #${salesReturn.id.toLocaleString("fa-IR")}`;
}

/** "CN-1405-000001", or a draft placeholder (numbers are assigned at posting). */
export function creditNoteTitle(creditNote: { id: number; creditNoteNumber: string | null }): string {
  return creditNote.creditNoteNumber ?? `پیش‌نویس #${creditNote.id.toLocaleString("fa-IR")}`;
}
