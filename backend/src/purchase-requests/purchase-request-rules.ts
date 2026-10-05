import type { Prisma, PurchaseRequestStatus } from '@prisma/client';

// The Purchase Requests module's single definition of which statuses count
// as "open" — still waiting on someone to act: submitted for approval,
// approved but not yet purchased, or only partly purchased. Other modules
// (Dashboard, future Reports) must reference this rather than re-deriving it
// from the raw enum — CLAUDE.md rule 11. Pure values only (no DI).
export const OPEN_PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ['SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED'];

// Which request statuses a Purchase may be (newly) linked to — APPROVED or
// PARTIALLY_PURCHASED only (business decision 2026-10-05): not a
// DRAFT/SUBMITTED request nobody approved, nor a REJECTED/CANCELLED/
// COMPLETED one. PurchasesService enforces it; the frontend mirrors it in
// app/purchase-requests/shared.tsx (LINKABLE_PURCHASE_REQUEST_STATUSES).
export const LINKABLE_PURCHASE_REQUEST_STATUSES: readonly PurchaseRequestStatus[] = ['APPROVED', 'PARTIALLY_PURCHASED'];

export const OPEN_PURCHASE_REQUEST_WHERE = {
  status: { in: OPEN_PURCHASE_REQUEST_STATUSES },
} satisfies Prisma.PurchaseRequestWhereInput;
