import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// The Units module's single definition of an "active" unit, plus the shared
// "units chosen for line items must be active" check used by Purchases and
// Purchase Requests. Pure values/functions only (no DI), same pattern as
// purchases/purchase-rules.ts. The check is the documented read-only
// cross-module "does it exist and is it active" lookup (CLAUDE.md rule 11).
export const ACTIVE_UNIT_WHERE = { isActive: true } satisfies Prisma.UnitWhereInput;

type UnitCounter = { unit: { count(args: { where: Prisma.UnitWhereInput }): Promise<number> } };

// Every unit in `unitIds` must be active — except ones already assigned on
// the record being edited (`alreadyAssigned`), which stay valid even if the
// unit was deactivated since, so an existing line never becomes unsaveable.
// `message` is the caller's Persian conflict message.
export async function ensureActiveUnits(db: UnitCounter, unitIds: number[], alreadyAssigned: number[], message: string) {
  const kept = new Set(alreadyAssigned);
  const toCheck = [...new Set(unitIds)].filter((id) => !kept.has(id));
  if (toCheck.length === 0) return;
  const count = await db.unit.count({ where: { id: { in: toCheck }, ...ACTIVE_UNIT_WHERE } });
  if (count !== toCheck.length) throw new ConflictException(message);
}
