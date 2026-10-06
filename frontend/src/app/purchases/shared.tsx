// Shared types, Persian labels, and small display helpers used by every
// page in this module (list, create/edit form, detail). Kept in one place
// so the wording (status labels, badge colors, ...) never drifts between
// pages — deliberately not exported as a route: this file has no
// `page.tsx`/`layout.tsx` name, so Next.js does not treat it as one.

import { formatJalali } from "@/lib/jalali";
import type { BadgeTone } from "@/components/ui/status-badge";
import type { PurchaseTypeOption, UnitOption } from "@/lib/reference-options";
import type { PurchaseRequestStatus } from "@/app/purchase-requests/shared";

// Generic UI primitives and master-data option shapes used to live in this
// file. They now have canonical homes (components/ui/status-badge.tsx,
// components/ui/form-field.tsx, lib/format.ts, lib/reference-options.ts) and
// are re-exported here only so existing Purchases-module imports keep
// working. New code should import them from the canonical locations.
export { StatusBadge, ColorLegend, toneCellClasses, type BadgeTone } from "@/components/ui/status-badge";
export { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
export { formatMoney } from "@/lib/format";
export {
  employeeFullName,
  type DepartmentOption,
  type EmployeeOption,
  type PurchaseTypeOption,
  type SupplierOption,
  type UnitOption,
} from "@/lib/reference-options";

export type PurchaseStatus = "DRAFT" | "CONFIRMED" | "RECEIVED" | "CLOSED" | "CANCELLED";
export type PurchasePaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CHECK" | "CARD";
// Status of an individual PurchasePayment row — distinct from
// PurchasePaymentStatus above, which lives on the Purchase itself.
export type PaymentRecordStatus = "PENDING" | "COMPLETED" | "CANCELLED";
export type DocumentType = "INVOICE" | "CONTRACT" | "DELIVERY_NOTE" | "WARRANTY" | "RECEIPT" | "OTHER";
// OPERATIONAL = entered as it happened. HISTORICAL_IMPORT = an old paper
// record digitized after the fact — both live in the same Purchase list.
export type PurchaseSourceType = "OPERATIONAL" | "HISTORICAL_IMPORT";

export const PURCHASE_STATUSES: PurchaseStatus[] = ["DRAFT", "CONFIRMED", "RECEIVED", "CLOSED", "CANCELLED"];
export const PURCHASE_PAYMENT_STATUSES: PurchasePaymentStatus[] = ["UNPAID", "PARTIAL", "PAID"];
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "BANK_TRANSFER", "CHECK", "CARD"];
export const PAYMENT_RECORD_STATUSES: PaymentRecordStatus[] = ["PENDING", "COMPLETED", "CANCELLED"];
export const DOCUMENT_TYPES: DocumentType[] = ["INVOICE", "CONTRACT", "DELIVERY_NOTE", "WARRANTY", "RECEIPT", "OTHER"];
export const PURCHASE_SOURCE_TYPES: PurchaseSourceType[] = ["OPERATIONAL", "HISTORICAL_IMPORT"];

export const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  DRAFT: "پیش‌نویس",
  CONFIRMED: "تأییدشده",
  RECEIVED: "دریافت‌شده",
  CLOSED: "بسته‌شده",
  CANCELLED: "لغوشده",
};

export const purchasePaymentStatusLabels: Record<PurchasePaymentStatus, string> = {
  UNPAID: "پرداخت‌نشده",
  PARTIAL: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "نقدی",
  BANK_TRANSFER: "انتقال بانکی",
  CHECK: "چک",
  CARD: "کارت",
};

export const paymentRecordStatusLabels: Record<PaymentRecordStatus, string> = {
  PENDING: "در انتظار",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export const documentTypeLabels: Record<DocumentType, string> = {
  INVOICE: "فاکتور",
  CONTRACT: "قرارداد",
  DELIVERY_NOTE: "حواله/رسید تحویل",
  WARRANTY: "ضمانت‌نامه",
  RECEIPT: "رسید",
  OTHER: "سایر",
};

export const purchaseSourceTypeLabels: Record<PurchaseSourceType, string> = {
  OPERATIONAL: "عملیاتی",
  HISTORICAL_IMPORT: "ثبت تاریخی",
};

export const purchaseStatusTone: Record<PurchaseStatus, BadgeTone> = {
  DRAFT: "secondary",
  CONFIRMED: "primary",
  RECEIVED: "accent",
  CLOSED: "muted",
  CANCELLED: "destructive",
};

export const purchasePaymentStatusTone: Record<PurchasePaymentStatus, BadgeTone> = {
  UNPAID: "destructive",
  PARTIAL: "warning",
  PAID: "success",
};

export const paymentRecordStatusTone: Record<PaymentRecordStatus, BadgeTone> = {
  PENDING: "warning",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

export const purchaseSourceTypeTone: Record<PurchaseSourceType, BadgeTone> = {
  OPERATIONAL: "primary",
  HISTORICAL_IMPORT: "muted",
};

// --- Shared API record shapes -------------------------------------------

// A Purchase Request as offered in the Purchase form's optional "originating
// request" picker — just enough to identify it, full detail lives on its
// own module (see ../purchase-requests/shared.tsx).
export type PurchaseRequestOption = { id: number; requestNumber: string };

// The same request as it actually arrives from GET /purchase-requests (the
// list endpoint — see PurchaseRequestsService.list()), with just the extra
// fields the Purchase form's picker uses to label each option. Nothing here
// needs a backend change: the list response already carries all of it.
export type PurchaseRequestPickerOption = PurchaseRequestOption & {
  requestDate: string;
  status: PurchaseRequestStatus;
  requesterDepartment: { id: number; name: string } | null;
  // Scalar FK on the list row — the ?prefill= flow defaults the Purchase
  // form's purchase type from it.
  purchaseTypeId: number;
  items: { name: string }[];
  _count: { items: number };
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "REQ-000042 — تولید — روغن موتور و ۲ مورد دیگر — ۱۴۰۴/۰۱/۰۱" for the picker. */
export function purchaseRequestOptionLabel(request: PurchaseRequestPickerOption): string {
  const parts = [request.requestNumber];
  if (request.requesterDepartment) parts.push(request.requesterDepartment.name);
  const firstItem = request.items[0]?.name;
  if (firstItem) {
    const extra = request._count.items - 1;
    parts.push(extra > 0 ? `${truncate(firstItem, 30)} و ${extra.toLocaleString("fa-IR")} مورد دیگر` : truncate(firstItem, 30));
  }
  parts.push(formatJalali(request.requestDate));
  return parts.join(" — ");
}

export type PurchaseListItem = {
  id: number;
  purchaseNumber: string;
  purchaseDate: string;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  sourceType: PurchaseSourceType;
  totalAmount: string;
  note: string | null;
  purchaseType: PurchaseTypeOption;
  supplier: { id: number; code: string; name: string };
  // Nullable — a HISTORICAL_IMPORT purchase (an old paper record) may not
  // name a buyer; the application never fabricates an Employee row to fill
  // this in. Always present for a normal (OPERATIONAL) purchase.
  buyerEmployee: { id: number; firstName: string; lastName: string } | null;
  // Just the first item's name plus a total count (see PurchasesService.list()) —
  // enough for a compact list cell, full detail stays on the detail page.
  items: { name: string }[];
  _count: { items: number };
};

/** "روغن موتور" or "روغن موتور و ۲ مورد دیگر" for a list row. */
export function purchaseItemsSummary(purchase: PurchaseListItem): string {
  const firstName = purchase.items[0]?.name;
  if (!firstName) return "-";
  const extra = purchase._count.items - 1;
  return extra > 0 ? `${firstName} و ${extra.toLocaleString("fa-IR")} مورد دیگر` : firstName;
}

export type PurchaseItemRow = {
  id: number;
  name: string;
  quantity: string;
  // Optional — some items (exceptions, lump-sum pricing) have no
  // meaningful per-unit price. totalPrice is what's actually billed and
  // is always present.
  unitPrice: string | null;
  totalPrice: string;
  unit: UnitOption;
  // The Purchase Request item this line fulfills, if this purchase (or this
  // specific line) originated from one — null for most items. Carried
  // through on edit so re-saving a purchase doesn't silently drop its link
  // back to the request (see PurchaseForm's edit-mode item mapping).
  purchaseRequestItemId: number | null;
};

export type PurchasePaymentRow = {
  id: number;
  amount: string;
  paymentDate: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  status: PaymentRecordStatus;
  note: string | null;
};

export type PurchaseDocumentRow = {
  id: number;
  documentNumber: string | null;
  documentType: DocumentType;
  date: string;
  filePath: string | null;
  note: string | null;
};

// Return to Vendor (RTV) — loaded separately from GET /purchases/:id/returns
// (gated on purchases.manage), not part of PurchaseDetail. A return never
// changes the Purchase's totalAmount/paidAmount/paymentStatus.
export type PurchaseReturnItemRow = {
  id: number;
  purchaseItemId: number;
  quantity: string;
  creditAmount: string;
  note: string | null;
  purchaseItem: { id: number; name: string; quantity: string; unit: UnitOption };
};

export type PurchaseReturnRow = {
  id: number;
  returnNumber: string;
  returnDate: string;
  reason: string;
  note: string | null;
  createdAt: string;
  createdByUser: { id: number; username: string } | null;
  items: PurchaseReturnItemRow[];
};

export type PurchaseDetail = {
  id: number;
  purchaseNumber: string;
  purchaseDate: string;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  sourceType: PurchaseSourceType;
  totalAmount: string;
  paidAmount: string;
  note: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on PATCH; a mismatch is a 409
  // with code RECORD_MODIFIED (someone else saved in between).
  updatedAt: string;
  purchaseType: PurchaseTypeOption;
  // Nullable for the same HISTORICAL_IMPORT reason as buyerEmployee below.
  requesterDepartment: { id: number; code: string; name: string } | null;
  buyerEmployee: {
    id: number;
    code: string;
    firstName: string;
    lastName: string;
    department: { id: number; name: string };
  } | null;
  // Display fields only — GET /purchases/:id no longer returns supplier
  // contact/bank/national-ID fields (PII narrowed to purchases.view, QA
  // 2026-10-05).
  supplier: { id: number; code: string; name: string };
  purchaseRequest: PurchaseRequestOption | null;
  items: PurchaseItemRow[];
  payments: PurchasePaymentRow[];
  documents: PurchaseDocumentRow[];
};
