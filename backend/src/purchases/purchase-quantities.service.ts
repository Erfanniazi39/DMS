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
  // map — callers treat a missing id as 0.
  async sumQuantitiesByRequestItem(requestItemIds: number[]): Promise<Map<number, number>> {
    if (requestItemIds.length === 0) return new Map();
    const rows = await this.prisma.purchaseItem.groupBy({
      by: ['purchaseRequestItemId'],
      where: { purchaseRequestItemId: { in: requestItemIds }, purchase: COUNTABLE_PURCHASE_WHERE },
      _sum: { quantity: true },
    });
    return new Map(
      rows
        .filter((row) => row.purchaseRequestItemId !== null)
        .map((row) => [row.purchaseRequestItemId as number, Number(row._sum.quantity ?? 0)]),
    );
  }
}
