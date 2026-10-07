// Shared types, Persian labels, and small display helpers for the Inventory
// module (stock list + stock adjustments). Mirrors the backend's
// src/inventory/inventory-rules.ts labels — keep the wording in sync there.
// Not a route: this file has no page.tsx/layout.tsx name.

import type { BadgeTone } from "@/components/ui/status-badge";

export type StockAdjustmentKind = "OPENING" | "RECEIPT" | "CORRECTION";
export type StockDocumentStatus = "DRAFT" | "POSTED";

export const STOCK_ADJUSTMENT_KINDS: StockAdjustmentKind[] = ["OPENING", "RECEIPT", "CORRECTION"];
export const STOCK_DOCUMENT_STATUSES: StockDocumentStatus[] = ["DRAFT", "POSTED"];

export const stockAdjustmentKindLabels: Record<StockAdjustmentKind, string> = {
  OPENING: "موجودی اول دوره",
  RECEIPT: "رسید موجودی",
  CORRECTION: "اصلاح موجودی",
};

// One-line explanation shown under the kind select on the form.
export const stockAdjustmentKindHints: Record<StockAdjustmentKind, string> = {
  OPENING: "ثبت موجودی ابتدای کار با سیستم یا ابتدای دوره — مقادیر مثبت.",
  RECEIPT: "ورود کالا به انبار — مقادیر مثبت.",
  CORRECTION: "اصلاح موجودی (مثلاً پس از شمارش یا ضایعات) — مقدار مثبت یعنی افزایش و مقدار منفی یعنی کاهش.",
};

// Kinds whose lines must be positive — mirrors INBOUND_ONLY_ADJUSTMENT_KINDS
// on the backend (which stays authoritative).
export const INBOUND_ONLY_KINDS: StockAdjustmentKind[] = ["OPENING", "RECEIPT"];

export const stockDocumentStatusLabels: Record<StockDocumentStatus, string> = {
  DRAFT: "پیش‌نویس",
  POSTED: "ثبت‌شده",
};

export const stockDocumentStatusTone: Record<StockDocumentStatus, BadgeTone> = {
  DRAFT: "secondary",
  POSTED: "success",
};

export const stockAdjustmentKindTone: Record<StockAdjustmentKind, BadgeTone> = {
  OPENING: "muted",
  RECEIPT: "primary",
  CORRECTION: "warning",
};

// --- API record shapes (backend inventory.controller.ts) -----------------

type ItemRef = { id: number; code: string; name: string; status?: "active" | "inactive"; unit: { id: number; nameFa: string } };
type LocationRef = { id: number; code: string; name: string };
type UserRef = { id: number; username: string } | null;

export type InventoryLocation = LocationRef & { isActive: boolean; isDefault: boolean; note: string | null };

// GET /inventory/item-options
export type ItemOption = ItemRef;

// GET /inventory/balances — quantities are Prisma Decimal → JSON strings.
export type StockBalanceRow = {
  id: number;
  itemId: number;
  locationId: number;
  onHand: string;
  reserved: string;
  qc: string;
  updatedAt: string;
  item: ItemRef;
  location: LocationRef;
};

// GET /inventory/stock-adjustments
export type StockAdjustmentListItem = {
  id: number;
  // null until posted — numbers are assigned only at posting.
  adjustmentNumber: string | null;
  kind: StockAdjustmentKind;
  status: StockDocumentStatus;
  locationId: number;
  adjustmentDate: string;
  reason: string;
  note: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: LocationRef;
  createdByUser: UserRef;
  _count: { items: number };
};

// GET /inventory/stock-adjustments/:id
export type StockAdjustmentDetail = Omit<StockAdjustmentListItem, "_count"> & {
  postedByUser: UserRef;
  items: { id: number; itemId: number; quantity: string; note: string | null; item: ItemRef }[];
};

// --- Display helpers -----------------------------------------------------

/** Quantities (Decimal(12,2)) — up to two decimals, Persian digits. */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/** A signed quantity with an explicit sign for increases (CORRECTION lines). */
export function formatSignedQuantity(value: string | number): string {
  const number = Number(value);
  return number > 0 ? `+${formatQuantity(number)}` : formatQuantity(number);
}

/** "ADJ-1405-000001", or a draft placeholder (drafts have no number yet). */
export function adjustmentTitle(adjustment: { id: number; adjustmentNumber: string | null }): string {
  return adjustment.adjustmentNumber ?? `پیش‌نویس #${adjustment.id.toLocaleString("fa-IR")}`;
}

/** Available-to-sell, for display only: onHand − reserved. */
export function availableQuantity(row: { onHand: string; reserved: string }): number {
  return Math.round((Number(row.onHand) - Number(row.reserved)) * 100) / 100;
}

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
