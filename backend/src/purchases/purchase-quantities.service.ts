import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { COUNTABLE_PURCHASE_WHERE } from './purchase-rules';

// Read-only query surface the Purchases module offers other modules for
// purchased quantities — it owns the "what counts as purchased" rule
// (CANCELLED purchases excluded, see COUNTABLE_PURCHASE_WHERE).
//
// Deliberately a separate provider (in its own PurchaseQuantitiesModule),
// not a method on PurchasesService: PurchasesService already injects
// PurchaseRequestsService to trigger recomputeStatus(), so making
// PurchaseRequestsService inject PurchasesService back would be a DI cycle
// needing forwardRef() on both sides. This provider depends only on Prisma,
// so Purchase Requests can use it with no cycle at all.
@Injectable()
export class PurchaseQuantitiesService {
  constructor(private readonly prisma: PrismaService) {}

  // Total purchased quantity per PurchaseRequestItem id, summed over every
  // PurchaseItem linked to it (PurchaseItem.purchaseRequestItemId) on a
  // non-cancelled Purchase. Items with nothing purchased are absent from the
  // map — callers treat a missing id as 0. `excludePurchaseId` leaves one
  // purchase out of the sum (PurchasesService's overage check while that
  // purchase itself is being edited).
  async sumQuantitiesByRequestItem(requestItemIds: number[], excludePurchaseId?: number): Promise<Map<number, number>> {
    if (requestItemIds.length === 0) return new Map();
    const rows = await this.prisma.purchaseItem.groupBy({
      by: ['purchaseRequestItemId'],
      where: {
        purchaseRequestItemId: { in: requestItemIds },
        purchase: excludePurchaseId === undefined ? COUNTABLE_PURCHASE_WHERE : { ...COUNTABLE_PURCHASE_WHERE, id: { not: excludePurchaseId } },
      },
      _sum: { quantity: true },
    });
    return new Map(
      rows
        .filter((row) => row.purchaseRequestItemId !== null)
        .map((row) => [row.purchaseRequestItemId as number, Number(row._sum.quantity ?? 0)]),
    );
  }

  // Which of these PurchaseRequestItem ids are referenced by ANY PurchaseItem
  // at all — cancelled purchases included. Unlike the quantity sum above
  // this is about the historical link itself, not "what counts as
  // purchased": deleting such a request line would silently null those
  // links (purchase_items.purchase_request_item_id is ON DELETE SET NULL),
  // so Purchase Requests uses this to refuse that. QA 2026-10-05.
  async findLinkedRequestItemIds(requestItemIds: number[]): Promise<Set<number>> {
    if (requestItemIds.length === 0) return new Set();
    const rows = await this.prisma.purchaseItem.findMany({
      where: { purchaseRequestItemId: { in: requestItemIds } },
      select: { purchaseRequestItemId: true },
      distinct: ['purchaseRequestItemId'],
    });
    return new Set(rows.map((row) => row.purchaseRequestItemId).filter((id): id is number => id !== null));
  }
}
