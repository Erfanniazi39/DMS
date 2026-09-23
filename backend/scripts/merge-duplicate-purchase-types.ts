/**
 * One-time cleanup for PurchaseType rows that ended up with a duplicate
 * Persian name (nameFa) — e.g. two "مواد اولیه" rows. This could only have
 * happened through the old "+ add purchase type" form on the Purchase page
 * before it started rejecting a duplicate nameFa (see
 * PurchaseTypesService.create()); existing duplicate rows from before that
 * fix are not cleaned up automatically, since deleting one outright can
 * fail (or silently succeed and orphan data) if any Purchase already
 * references it — PurchaseType.id is a required, restricted foreign key on
 * Purchase.
 *
 * For every nameFa value that has more than one PurchaseType row, this
 * script:
 *   1. Picks one row to keep — preferring whichever duplicate's `code`
 *      matches the original seed list in prisma/seed.ts (PURCHASE_TYPES),
 *      falling back to the lowest id if none match.
 *   2. Re-points every Purchase that referenced a duplicate row onto the
 *      row being kept, so no purchase history is lost or left dangling.
 *   3. Deletes the now-unreferenced duplicate row(s).
 *
 * Nothing about a purchase's items, payments, documents, or any other
 * field changes — only which PurchaseType row it points to.
 *
 * Usage (from the backend folder, with the database reachable — i.e. same
 * as when you run `npx prisma db seed`):
 *
 *   npx ts-node scripts/merge-duplicate-purchase-types.ts
 *
 * Safe to re-run: if there are no duplicates left, it just reports that
 * and does nothing.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Same canonical codes as prisma/seed.ts's PURCHASE_TYPES list — used only
// to prefer the "original" row as the keeper when a nameFa collides.
const CANONICAL_CODES = new Set([
  'raw_material',
  'food_ingredient',
  'packaging',
  'machinery',
  'spare_parts',
  'tools',
  'accessories',
  'transportation',
  'office_supplies',
  'maintenance',
  'other',
]);

type PurchaseTypeRow = {
  id: number;
  code: string;
  nameEn: string;
  nameFa: string;
  isActive: boolean;
  sortOrder: number;
};

async function main() {
  const purchaseTypes: PurchaseTypeRow[] = await prisma.purchaseType.findMany({ orderBy: { id: 'asc' } });

  const byNameFa = new Map<string, PurchaseTypeRow[]>();
  for (const purchaseType of purchaseTypes) {
    const group = byNameFa.get(purchaseType.nameFa) ?? [];
    group.push(purchaseType);
    byNameFa.set(purchaseType.nameFa, group);
  }

  const duplicateGroups = [...byNameFa.values()].filter((group) => group.length > 1);

  if (duplicateGroups.length === 0) {
    console.log('No duplicate purchase-type names found. Nothing to do.');
    return;
  }

  for (const group of duplicateGroups) {
    const keeper = group.find((row) => CANONICAL_CODES.has(row.code)) ?? group[0];
    const duplicates = group.filter((row) => row.id !== keeper.id);

    console.log(
      `"${keeper.nameFa}": keeping id=${keeper.id} (code="${keeper.code}"), ` +
        `merging ${duplicates.map((row) => `id=${row.id} (code="${row.code}")`).join(', ')} into it.`,
    );

    for (const duplicate of duplicates) {
      const { count } = await prisma.purchase.updateMany({
        where: { purchaseTypeId: duplicate.id },
        data: { purchaseTypeId: keeper.id },
      });
      if (count > 0) {
        console.log(`  - moved ${count} purchase(s) from id=${duplicate.id} to id=${keeper.id}`);
      }
      await prisma.purchaseType.delete({ where: { id: duplicate.id } });
      console.log(`  - deleted duplicate id=${duplicate.id}`);
    }
  }

  console.log('Done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
