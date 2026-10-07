import { ConflictException } from '@nestjs/common';
import type { Territory } from '@prisma/client';

// The Territories module's shared "a territory chosen on a customer must
// exist and be active" check. Pure function only (no DI), same pattern as
// purchase-types/purchase-type-rules.ts, so importing it never creates a
// module dependency. The lookup is the documented read-only cross-module
// "does it exist and is it active" exception (CLAUDE.md rule 11).
type TerritoryFinder = {
  territory: { findUnique(args: { where: { id: number } }): Promise<Territory | null> };
};

export async function ensureActiveTerritory(db: TerritoryFinder, id: number) {
  const territory = await db.territory.findUnique({ where: { id } });
  if (!territory || !territory.isActive) throw new ConflictException('منطقهٔ فروش انتخاب‌شده معتبر یا فعال نیست');
}
