// Shared types, Persian labels, status tones and small display helpers for
// the Sales Orders module (list, form, detail). Mirrors the backend's
// src/sales/sales-rules.ts labels and src/sales/sales-orders.service.ts
// response shapes — keep the wording/shapes in sync there. Not a route: this
// file has no page.tsx/layout.tsx name.

import type { BadgeTone } from "@/components/ui/status-badge";

export type SalesOrderStatus = "DRAFT" | "PENDING_APPROVAL" | "CONFIRMED" | "COMPLETED" | "CLOSED" | "CANCELLED";
export type SalesDeliveryStatus = "NOT_DELIVERED" | "PARTIALLY_DELIVERED" | "DELIVERED";
export type SalesInvoicingStatus = "NOT_INVOICED" | "PARTIALLY_INVOICED" | "INVOICED";
export type SalesPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";
export type SalesOrderApprovalReason = "DISCOUNT" | "CREDIT_LIMIT";

export const SALES_ORDER_STATUSES: SalesOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "COMPLETED", "CLOSED", "CANCELLED"];
export const SALES_DELIVERY_STATUSES: SalesDeliveryStatus[] = ["NOT_DELIVERED", "PARTIALLY_DELIVERED", "DELIVERED"];
export const SALES_INVOICING_STATUSES: SalesInvoicingStatus[] = ["NOT_INVOICED", "PARTIALLY_INVOICED", "INVOICED"];
export const SALES_PAYMENT_STATUSES: SalesPaymentStatus[] = ["UNPAID", "PARTIALLY_PAID", "PAID"];

// Distinct 409 codes from backend sales-rules.ts.
export const SALES_ORDER_APPROVAL_REQUIRED = "SALES_ORDER_APPROVAL_REQUIRED";
export const CREDIT_LIMIT_EXCEEDED = "CREDIT_LIMIT_EXCEEDED";

export const salesOrderStatusLabels: Record<SalesOrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  PENDING_APPROVAL: "در انتظار تأیید",
  CONFIRMED: "تأییدشده",
  COMPLETED: "تکمیل‌شده",
  CLOSED: "بسته‌شده",
  CANCELLED: "لغوشده",
};

export const salesDeliveryStatusLabels: Record<SalesDeliveryStatus, string> = {
  NOT_DELIVERED: "تحویل‌نشده",
  PARTIALLY_DELIVERED: "تحویل جزئی",
  DELIVERED: "تحویل کامل",
};

export const salesInvoicingStatusLabels: Record<SalesInvoicingStatus, string> = {
  NOT_INVOICED: "فاکتورنشده",
  PARTIALLY_INVOICED: "فاکتور جزئی",
  INVOICED: "فاکتور کامل",
};

export const salesPaymentStatusLabels: Record<SalesPaymentStatus, string> = {
  UNPAID: "پرداخت‌نشده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت کامل",
};

export const approvalReasonLabels: Record<SalesOrderApprovalReason, string> = {
  DISCOUNT: "سفارش دارای تخفیف است",
  CREDIT_LIMIT: "سقف اعتبار مشتری کافی نیست",
};

export const salesOrderStatusTone: Record<SalesOrderStatus, BadgeTone> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  CONFIRMED: "primary",
  COMPLETED: "success",
  CLOSED: "muted",
  CANCELLED: "destructive",
};

// The three progress axes share one scale: nothing yet / partly / fully.
export const salesDeliveryStatusTone: Record<SalesDeliveryStatus, BadgeTone> = {
  NOT_DELIVERED: "muted",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
};

export const salesInvoicingStatusTone: Record<SalesInvoicingStatus, BadgeTone> = {
  NOT_INVOICED: "muted",
  PARTIALLY_INVOICED: "warning",
  INVOICED: "success",
};

export const salesPaymentStatusTone: Record<SalesPaymentStatus, BadgeTone> = {
  UNPAID: "muted",
  PARTIALLY_PAID: "warning",
  PAID: "success",
};

// --- API record shapes (backend sales-orders.service.ts) -----------------
// Decimal columns arrive as JSON strings; dates as ISO strings.

type UserRef = { id: number; username: string } | null;

// GET /sales-orders (paginated with page/pageSize).
export type SalesOrderListItem = {
  id: number;
  // null while DRAFT / PENDING_APPROVAL — assigned at CONFIRMED.
  orderNumber: string | null;
  orderDate: string;
  customerId: number;
  customerName: string;
  customerReference: string | null;
  status: SalesOrderStatus;
  deliveryStatus: SalesDeliveryStatus;
  invoicingStatus: SalesInvoicingStatus;
  paymentStatus: SalesPaymentStatus;
  totalAmount: string;
  updatedAt: string;
  customer: { id: number; customerNumber: string };
  salespersonEmployee: { id: number; firstName: string; lastName: string } | null;
  _count: { items: number };
};

export type SalesOrderItemRow = {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unitId: number;
  unitName: string;
  quantity: string;
  listUnitPrice: string | null;
  unitPrice: string;
  priceOverrideReason: string | null;
  discountPercent: string | null;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  reservedQty: string;
  deliveredQty: string;
  invoicedQty: string;
  returnedQty: string;
  note: string | null;
};

// GET /sales-orders/:id (and the body of every action response).
export type SalesOrderDetail = {
  id: number;
  orderNumber: string | null;
  orderDate: string;
  customerId: number;
  customerName: string;
  customerEconomicCode: string | null;
  deliveryAddressId: number | null;
  deliveryAddressText: string | null;
  paymentTermId: number | null;
  paymentTermName: string | null;
  paymentDueDays: number;
  salespersonEmployeeId: number | null;
  locationId: number;
  customerReference: string | null;
  requestedDeliveryDate: string | null;
  status: SalesOrderStatus;
  deliveryStatus: SalesDeliveryStatus;
  invoicingStatus: SalesInvoicingStatus;
  paymentStatus: SalesPaymentStatus;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  totalAmount: string;
  approvalReason: string | null;
  approvedAt: string | null;
  creditOverrideAt: string | null;
  creditOverrideReason: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  internalNote: string | null;
  customerNote: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on every write; a mismatch is a
  // 409 with code RECORD_MODIFIED.
  updatedAt: string;
  customer: { id: number; customerNumber: string; name: string; status: string };
  deliveryAddress: { id: number; addressType: string; label: string | null; isActive: boolean } | null;
  paymentTerm: { id: number; code: string; nameFa: string; dueDays: number } | null;
  salespersonEmployee: { id: number; code: string; firstName: string; lastName: string } | null;
  location: { id: number; code: string; name: string };
  createdByUser: UserRef;
  approvedByUser: UserRef;
  creditOverrideByUser: UserRef;
  confirmedByUser: UserRef;
  cancelledByUser: UserRef;
  closedByUser: UserRef;
  items: SalesOrderItemRow[];
};

// A line that couldn't be fully reserved at confirmation — returned only by
// POST /:id/confirm and /:id/approve, never stored on the order.
export type SalesOrderBackorder = {
  lineNo: number;
  itemId: number;
  itemName: string;
  quantity: string;
  reserved: string;
  shortfall: string;
};

export type SalesOrderActionResult = SalesOrderDetail & { backorders: SalesOrderBackorder[] };

// Credit figures in the 409 details — present only for sales.approve /
// customers.finance holders.
export type CreditDetails = {
  creditLimit: string | null;
  exposure: string;
  orderAmount: string;
  projected: string;
  excess: string;
};

// GET /sales-orders/form-options (sales.manage).
export type SalesFormOptions = {
  location: { id: number; code: string; name: string };
  customers: { id: number; customerNumber: string; name: string; creditHold: boolean }[];
  items: { id: number; code: string; name: string; sellingPrice: string | null; unit: { id: number; nameFa: string }; available: string }[];
  employees: { id: number; code: string; firstName: string; lastName: string }[];
};

export type SalesItemOption = SalesFormOptions["items"][number];

// GET /sales-orders/customer-context/:customerId (sales.manage).
export type CustomerContext = {
  customer: { id: number; customerNumber: string; name: string; status: string; economicCode: string | null };
  creditHold: boolean;
  paymentTerm: { id: number; nameFa: string; dueDays: number } | null;
  addresses: {
    id: number;
    addressType: string;
    label: string | null;
    province: string | null;
    city: string | null;
    addressLine: string;
    postalCode: string | null;
    isDefault: boolean;
    text: string;
  }[];
  // null unless the user holds sales.approve or customers.finance.
  credit: { creditLimit: string | null; exposure: string; available: string } | null;
};

// GET /sales-orders/:id/history.
export type SalesOrderHistoryEntry = {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  user: UserRef;
};

// --- Display helpers -----------------------------------------------------

/** "SO-1405-000001", or a draft placeholder (numbers are assigned at confirmation). */
export function salesOrderTitle(order: { id: number; orderNumber: string | null }): string {
  return order.orderNumber ?? `پیش‌نویس #${order.id.toLocaleString("fa-IR")}`;
}

/** Quantities (Decimal(12,2)) — up to two decimals, Persian digits. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/** Percentages (Decimal(5,2)). */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 })}٪`;
}

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
