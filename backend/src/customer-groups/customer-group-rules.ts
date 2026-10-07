import { ConflictException } from '@nestjs/common';
import type { CustomerGroup } from '@prisma/client';

// The Customer Groups module's shared "a group chosen on a customer must
// exist and be active" check. Pure function only (no DI), same pattern as
// purchase-types/purchase-type-rules.ts, so importing it never creates a
// module dependency. The lookup is the documented read-only cross-module
// "does it exist and is it active" exception (CLAUDE.md rule 11).
type CustomerGroupFinder = {
  customerGroup: { findUnique(args: { where: { id: number } }): Promise<CustomerGroup | null> };
};

export async function ensureActiveCustomerGroup(db: CustomerGroupFinder, id: number) {
  const group = await db.customerGroup.findUnique({ where: { id } });
  if (!group || !group.isActive) throw new ConflictException('گروه مشتری انتخاب‌شده معتبر یا فعال نیست');
}
