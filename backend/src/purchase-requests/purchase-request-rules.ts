import type { Prisma, PurchaseRequestStatus } from '@prisma/client';

// The Purchase Requests module's single definition of which statuses count
// as "open" — still waiting on someone to act: submitted for approval,
// approved but not yet purchased, or only partly purchased. Other modules
// (Dashboard, future Reports) must reference this rather than re-deriving it
// from the raw enum — CLAUDE.md rule 11. Pure values only (no DI).
export const OPEN_PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ['SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED'];

export const OPEN_PURCHASE_REQUEST_WHERE = {
  status: { in: OPEN_PURCHASE_REQUEST_STATUSES },
} satisfies Prisma.PurchaseRequestWhereInput;
