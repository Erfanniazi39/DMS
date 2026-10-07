import { ConflictException } from '@nestjs/common';
import type { PaymentTerm } from '@prisma/client';

// The Payment Terms module's shared "a payment term chosen on a customer's
// financial profile must exist and be active" check. Pure function only
// (no DI), same pattern as purchase-types/purchase-type-rules.ts. The lookup
// is the documented read-only cross-module "exists and active" exception
// (CLAUDE.md rule 11).
type PaymentTermFinder = {
  paymentTerm: { findUnique(args: { where: { id: number } }): Promise<PaymentTerm | null> };
};

export async function ensureActivePaymentTerm(db: PaymentTermFinder, id: number) {
  const term = await db.paymentTerm.findUnique({ where: { id } });
  if (!term || !term.isActive) throw new ConflictException('شرایط پرداخت انتخاب‌شده معتبر یا فعال نیست');
}
