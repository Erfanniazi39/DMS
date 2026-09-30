// Shared types, Persian labels, and small display helpers used by every
// page in this module (list, create/edit form, detail). Kept in one place
// so the wording (status labels, badge colors, ...) never drifts between
// pages — deliberately not exported as a route: this file has no
// `page.tsx`/`layout.tsx` name, so Next.js does not treat it as one.

import { formatJalali } from "@/lib/jalali";

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

type BadgeTone = "primary" | "secondary" | "muted" | "accent" | "destructive" | "success" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-secondary-foreground/15 bg-secondary text-secondary-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  accent: "border-accent-foreground/15 bg-accent text-accent-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
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

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

/** Rial amounts arrive from the API as Prisma Decimal → JSON strings. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("fa-IR");
}

export const textareaClass =
  "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";
export const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

// --- Shared API record shapes -------------------------------------------

export type PurchaseTypeOption = { id: number; code: string; nameFa: string; nameEn: string };
export type UnitOption = { id: number; code: string; nameFa: string; nameEn: string };
export type SupplierOption = { id: number; code: string; name: string; status: "active" | "inactive" | "blacklisted" };
export type DepartmentOption = { id: number; code: string; name: string; status: "active" | "inactive" };
export type EmployeeOption = {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  status: "active" | "on_leave" | "terminated";
};

export function employeeFullName(employee: { firstName: string; lastName: string }): string {
  return `${employee.firstName} ${employee.lastName}`;
}

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
  requesterDepartment: { id: number; name: string } | null;
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
  supplier: { id: number; code: string; name: string; phone: string | null; email: string | null };
  purchaseRequest: PurchaseRequestOption | null;
  items: PurchaseItemRow[];
  payments: PurchasePaymentRow[];
  documents: PurchaseDocumentRow[];
};
