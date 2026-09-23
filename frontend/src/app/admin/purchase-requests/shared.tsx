// Shared types, Persian labels, and small display helpers for the Purchase
// Request module (list, create/edit form, detail). Generic UI helpers
// (StatusBadge, selectClass, formatMoney, employeeFullName, and the
// DepartmentOption/EmployeeOption/UnitOption option shapes) are already
// defined in the Purchase module's own shared.tsx and are reused from
// there rather than duplicated — Purchase Request is a small satellite of
// the Purchase module, not a separate system.

// PARTIALLY_PURCHASED is normally set automatically — see
// PurchaseRequestsService.recomputeStatus() on the backend — as a request's
// linked Purchases progress toward fulfilling it. Still a plain, selectable
// value in the edit form's status field like any other, not specially
// restricted there.
export type PurchaseRequestStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "PARTIALLY_PURCHASED" | "REJECTED" | "CANCELLED" | "COMPLETED";
export type PurchaseRequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "PARTIALLY_PURCHASED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
];
export const PURCHASE_REQUEST_PRIORITIES: PurchaseRequestPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export const purchaseRequestStatusLabels: Record<PurchaseRequestStatus, string> = {
  DRAFT: "پیش‌نویس",
  SUBMITTED: "ارسال‌شده",
  APPROVED: "تأییدشده",
  PARTIALLY_PURCHASED: "خرید جزئی",
  REJECTED: "ردشده",
  CANCELLED: "لغوشده",
  COMPLETED: "تکمیل‌شده",
};

export const purchaseRequestPriorityLabels: Record<PurchaseRequestPriority, string> = {
  LOW: "کم",
  NORMAL: "عادی",
  HIGH: "بالا",
  URGENT: "فوری",
};

type BadgeTone = "primary" | "secondary" | "muted" | "accent" | "destructive" | "success" | "warning";

export const purchaseRequestStatusTone: Record<PurchaseRequestStatus, BadgeTone> = {
  DRAFT: "secondary",
  SUBMITTED: "primary",
  APPROVED: "success",
  PARTIALLY_PURCHASED: "warning",
  REJECTED: "destructive",
  CANCELLED: "muted",
  COMPLETED: "accent",
};

export const purchaseRequestPriorityTone: Record<PurchaseRequestPriority, BadgeTone> = {
  LOW: "muted",
  NORMAL: "secondary",
  HIGH: "warning",
  URGENT: "destructive",
};

// --- Shared API record shapes -------------------------------------------

export type PurchaseRequestListItem = {
  id: number;
  requestNumber: string;
  requestDate: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  note: string | null;
  requesterDepartment: { id: number; code: string; name: string };
  // Optional — a request can come from a department in general without
  // naming the specific person who asked for it (see purchase-request.dto.ts).
  requestedByEmployee: { id: number; firstName: string; lastName: string } | null;
  // Just the first item's name plus a total count — enough for a compact
  // list cell, same pattern as PurchaseListItem in the Purchase module.
  items: { name: string }[];
  _count: { items: number; purchases: number };
};

/** "روغن موتور" or "روغن موتور و ۲ مورد دیگر" for a list row. */
export function purchaseRequestItemsSummary(request: PurchaseRequestListItem): string {
  const firstName = request.items[0]?.name;
  if (!firstName) return "-";
  const extra = request._count.items - 1;
  return extra > 0 ? `${firstName} و ${extra.toLocaleString("fa-IR")} مورد دیگر` : firstName;
}

export type PurchaseRequestItemRow = {
  id: number;
  name: string;
  quantity: string;
  requiredDate: string | null;
  note: string | null;
  unit: { id: number; code: string; nameFa: string; nameEn: string };
  // Derived, not stored — computed on every read from the PurchaseItem rows
  // linked back to this item (see PurchaseRequestsService.get()).
  // purchasedQuantity excludes items on a cancelled Purchase.
  // remainingQuantity = max(0, quantity − purchasedQuantity).
  purchasedQuantity: number;
  remainingQuantity: number;
};

// A Purchase this request has already led to — read-only here; a Purchase
// links back to its request via Purchase.purchaseRequestId, never the
// other way around, and one request may lead to zero, one, or (for a
// future partial/consolidated purchasing case) more than one Purchase.
export type LinkedPurchase = {
  id: number;
  purchaseNumber: string;
  purchaseDate: string;
  status: "DRAFT" | "CONFIRMED" | "RECEIVED" | "CLOSED" | "CANCELLED";
  totalAmount: string;
};

export type PurchaseRequestDetail = {
  id: number;
  requestNumber: string;
  requestDate: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  note: string | null;
  createdAt: string;
  requesterDepartment: { id: number; code: string; name: string };
  requestedByEmployee: { id: number; code: string; firstName: string; lastName: string } | null;
  createdByUser: { id: number; username: string } | null;
  items: PurchaseRequestItemRow[];
  purchases: LinkedPurchase[];
};
