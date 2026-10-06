import { ConflictException } from '@nestjs/common';
import type { PurchaseType } from '@prisma/client';

// The Purchase Types module's shared "a purchase type chosen on a record
// must exist and be active" check, used by both Purchases and Purchase
// Requests. Pure function only (no DI), same pattern as units/unit-rules.ts
// and departments/department-rules.ts, so importing it never creates a
// module dependency (PurchaseRequests must never inject PurchasesService —
// Purchases already injects PurchaseRequests). The lookup itself is the
// documented read-only cross-module "does it exist and is it active"
// exception (CLAUDE.md rule 11).
type PurchaseTypeFinder = {
  purchaseType: { findUnique(args: { where: { id: number } }): Promise<PurchaseType | null> };
};

export async function ensureActivePurchaseType(db: PurchaseTypeFinder, id: number) {
  const purchaseType = await db.purchaseType.findUnique({ where: { id } });
  if (!purchaseType || !purchaseType.isActive) throw new ConflictException('نوع خرید انتخاب‌شده معتبر نیست');
}
