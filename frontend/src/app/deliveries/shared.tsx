// Shared types, Persian labels, status tones and small display helpers for
// the Deliveries module (queue/list, form, detail, print). Mirrors the
// backend's src/sales/sales-rules.ts labels and src/sales/deliveries.service.ts
// response shapes — keep the wording/shapes in sync there. Not a route: this
// file has no page.tsx/layout.tsx name. Order-side labels/helpers
// (delivery-status axis, formatQuantity, NoAccess) are reused from
// ../sales-orders/shared rather than duplicated.

import type { BadgeTone } from "@/components/ui/status-badge";
import type { SalesDeliveryStatus, SalesOrderStatus } from "../sales-orders/shared";

export type DeliveryStatus = "DRAFT" | "POSTED";

export const DELIVERY_STATUSES: DeliveryStatus[] = ["DRAFT", "POSTED"];

export const deliveryStatusLabels: Record<DeliveryStatus, string> = {
  DRAFT: "پیش‌نویس",
  POSTED: "ثبت‌شده",
};

export const deliveryStatusTone: Record<DeliveryStatus, BadgeTone> = {
  DRAFT: "secondary",
  POSTED: "success",
};

// Distinct 409 codes the post action can return (backend
// inventory/stock-ledger.ts).
export const NEGATIVE_STOCK = "NEGATIVE_STOCK";
export const STOCK_RESERVED_FOR_OTHERS = "STOCK_RESERVED_FOR_OTHERS";
// The order's customer is on credit hold (backend sales-rules.ts) — posting
// is refused, no override (business decision 2026-10-07).
export const CUSTOMER_CREDIT_HOLD = "CUSTOMER_CREDIT_HOLD";

// --- API record shapes (backend deliveries.service.ts) -------------------
// Decimal columns arrive as JSON strings; dates as ISO strings.

type UserRef = { id: number; username: string } | null;

// GET /deliveries (paginated with page/pageSize; unpaginated without).
export type DeliveryListItem = {
  id: number;
  // null while DRAFT — assigned at POSTED.
  deliveryNumber: string | null;
  salesOrderId: number;
  customerId: number;
  deliveryDate: string;
  status: DeliveryStatus;
  receivedByName: string | null;
  updatedAt: string;
  salesOrder: { id: number; orderNumber: string | null; customerName: string };
  customer: { id: number; customerNumber: string };
  _count: { items: number };
};

// GET /deliveries/queue — CONFIRMED orders with something left to deliver.
export type DeliveryQueueRow = {
  id: number;
  orderNumber: string | null;
  orderDate: string;
  requestedDeliveryDate: string | null;
  customerId: number;
  customerName: string;
  deliveryStatus: SalesDeliveryStatus;
  customer: { id: number; customerNumber: string };
  lineCount: number;
  openLineCount: number;
  draftDeliveryCount: number;
};

export type OrderLineRef = {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unitName: string;
  quantity: string;
  reservedQty: string;
  deliveredQty: string;
};

// GET /deliveries/:id (and the body of every write response).
export type DeliveryDetail = {
  id: number;
  deliveryNumber: string | null;
  salesOrderId: number;
  customerId: number;
  locationId: number;
  deliveryDate: string;
  status: DeliveryStatus;
  deliveryAddressText: string | null;
  carrierNote: string | null;
  receivedByName: string | null;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on every write; a mismatch is a
  // 409 with code RECORD_MODIFIED.
  updatedAt: string;
  salesOrder: {
    id: number;
    orderNumber: string | null;
    orderDate: string;
    status: SalesOrderStatus;
    deliveryStatus: SalesDeliveryStatus;
    customerName: string;
    customerEconomicCode: string | null;
    customerReference: string | null;
    customerNote: string | null;
  };
  customer: { id: number; customerNumber: string; name: string };
  location: { id: number; code: string; name: string };
  createdByUser: UserRef;
  postedByUser: UserRef;
  items: {
    id: number;
    salesOrderItemId: number;
    itemId: number;
    quantity: string;
    invoicedQty: string;
    returnedQty: string;
    salesOrderItem: OrderLineRef;
  }[];
};

// GET /deliveries/order-context/:salesOrderId (sales.deliver) — the create /
// edit form's source. Availability is display only.
export type DeliveryOrderContext = {
  id: number;
  orderNumber: string | null;
  orderDate: string;
  status: SalesOrderStatus;
  deliveryStatus: SalesDeliveryStatus;
  customerId: number;
  customerName: string;
  deliveryAddressText: string | null;
  requestedDeliveryDate: string | null;
  locationId: number;
  location: { id: number; code: string; name: string };
  deliverable: boolean;
  items: (OrderLineRef & { undeliveredQty: string; onHand: string; available: string })[];
};

// GET /deliveries/:id/history.
export type DeliveryHistoryEntry = {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  user: UserRef;
};

// --- Display helpers -----------------------------------------------------

/** "DN-1405-000001", or a draft placeholder (numbers are assigned at posting). */
export function deliveryTitle(delivery: { id: number; deliveryNumber: string | null }): string {
  return delivery.deliveryNumber ?? `پیش‌نویس #${delivery.id.toLocaleString("fa-IR")}`;
}
