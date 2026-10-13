import { Prisma } from '@prisma/client';
import { toIsoDay } from '../common/zod-fields';

// Pure FEFO (first-expiry-first-out) allocation — no DB access, same role as
// sales/sales-totals.ts for money math. Called by stock-ledger.ts
// issueForDelivery() (Inventory build plan I4, B8/§6/§5.4a R7). Unit-tested
// in isolation (batch-allocation.spec.ts) since this is the core allocation
// logic the rest of the batch feature depends on.

export type FefoCandidateBatch = {
  batchId: number;
  batchNumber: string;
  expiryDate: Date | null;
  // Current on-hand at the location, BEFORE this allocation.
  onHand: Prisma.Decimal | number | string;
};

export type FefoLine = {
  referenceLineId: number;
  quantity: Prisma.Decimal | number | string;
};

export type FefoAllocation = {
  referenceLineId: number;
  batchId: number;
  batchNumber: string;
  expiryDate: Date | null;
  quantity: Prisma.Decimal;
};

export type FefoResult = {
  allocations: FefoAllocation[];
  // Total requested quantity that could not be covered by non-expired
  // batches (summed across all lines) — the caller turns this into the
  // EXPIRED_STOCK_ONLY 409 when it's greater than zero.
  shortfall: Prisma.Decimal;
};

// A batch is expired, for delivery purposes, when its expiry date is
// strictly earlier than the delivery/reference date — compared by calendar
// day, not by time-of-day. Still deliverable ON its expiry date itself (B8).
// A batch with no expiry date never expires.
export function isExpiredBatch(expiryDate: Date | null | undefined, asOfDate: Date): boolean {
  if (!expiryDate) return false;
  return toIsoDay(expiryDate) < toIsoDay(asOfDate);
}

// Ascending expiry date, nulls (no expiry) sorted last, then batchId as a
// stable tiebreaker — the exact order build plan §6/§5.4a specify.
function compareForFefo(a: FefoCandidateBatch, b: FefoCandidateBatch): number {
  if (a.expiryDate === null && b.expiryDate === null) return a.batchId - b.batchId;
  if (a.expiryDate === null) return 1;
  if (b.expiryDate === null) return -1;
  const diff = a.expiryDate.getTime() - b.expiryDate.getTime();
  return diff !== 0 ? diff : a.batchId - b.batchId;
}

// Allocates `lines` (in the given order) against `candidates` (one item's
// batches at one location), excluding anything expired as of `asOfDate`.
// Lines for the same item share one pool, consumed in line order — a line
// earlier in the array can exhaust a batch before a later line gets to it,
// matching how delivery lines are processed today.
export function allocateFefo(lines: FefoLine[], candidates: FefoCandidateBatch[], asOfDate: Date): FefoResult {
  const zero = new Prisma.Decimal(0);
  const pool = candidates
    .filter((batch) => !isExpiredBatch(batch.expiryDate, asOfDate))
    .slice()
    .sort(compareForFefo)
    .map((batch) => ({ ...batch, remaining: new Prisma.Decimal(batch.onHand) }));

  const allocations: FefoAllocation[] = [];
  let shortfall = zero;

  for (const line of lines) {
    let need = new Prisma.Decimal(line.quantity);
    if (need.lessThanOrEqualTo(0)) continue;
    for (const batch of pool) {
      if (need.lessThanOrEqualTo(0)) break;
      if (batch.remaining.lessThanOrEqualTo(0)) continue;
      const take = Prisma.Decimal.min(need, batch.remaining);
      allocations.push({
        referenceLineId: line.referenceLineId,
        batchId: batch.batchId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity: take,
      });
      batch.remaining = batch.remaining.minus(take);
      need = need.minus(take);
    }
    if (need.greaterThan(0)) shortfall = shortfall.plus(need);
  }

  return { allocations, shortfall };
}
