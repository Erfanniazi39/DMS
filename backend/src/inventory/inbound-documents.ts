import { BadRequestException } from '@nestjs/common';
import type { ItemKind, Prisma } from '@prisma/client';
import { ITEM_KIND_LABELS_FA } from './inventory-rules';
import { resolveBatches, type ItemBatchSettings, type ResolvedBatch } from './stock-batches';

// Inventory batch I5: helpers shared by the two inbound documents
// (GoodsReceiptsService, ProductionOutputsService). DI-free plain functions
// — same style as stock-batches.ts / inventory-queries.ts — taking whichever
// Prisma client (plain or transaction) the caller has.

type ItemLookupClient = {
  item: {
    findMany(args: { where: { id: { in: number[] } }; select: { id: true; status: true; name: true; itemKind: true } }): Promise<{ id: number; status: string; name: string; itemKind: ItemKind }[]>;
  };
};

type SettingsLookupClient = {
  inventoryItemSetting: {
    findMany(args: {
      where: { itemId: { in: number[] } };
      select: { itemId: true; batchTracked: true; expiryRequired: true; shelfLifeDays: true };
    }): Promise<{ itemId: number; batchTracked: boolean; expiryRequired: boolean; shelfLifeDays: number | null }[]>;
  };
};

// Read-only "exists, active and of an allowed kind" lookup into Items
// (CLAUDE.md rule 11's documented exception). An item already on the draft
// may stay even if it was deactivated since (same rule as
// StockAdjustmentsService.ensureActiveItems()) — but the kind rule has no
// such exception: a goods receipt never takes a finished good, a production
// output never takes a raw material, whatever the draft already holds.
export async function ensureInboundItems(
  db: ItemLookupClient,
  itemIds: number[],
  allowedKinds: readonly ItemKind[],
  documentLabelFa: string,
  alreadyOnDocument: number[] = [],
) {
  const unique = [...new Set(itemIds)];
  const items = await db.item.findMany({ where: { id: { in: unique } }, select: { id: true, status: true, name: true, itemKind: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = new Set(alreadyOnDocument);
  for (const id of unique) {
    const item = byId.get(id);
    if (!item) throw new BadRequestException('کالای انتخاب‌شده یافت نشد');
    if (item.status !== 'active' && !kept.has(id)) throw new BadRequestException(`کالای «${item.name}» غیرفعال است`);
    if (!allowedKinds.includes(item.itemKind)) {
      const allowed = allowedKinds.map((kind) => `«${ITEM_KIND_LABELS_FA[kind]}»`).join(' یا ');
      throw new BadRequestException({
        statusCode: 400,
        code: 'ITEM_KIND_NOT_ALLOWED',
        message: `کالای «${item.name}» از نوع «${ITEM_KIND_LABELS_FA[item.itemKind]}» است؛ در ${documentLabelFa} فقط کالای ${allowed} مجاز است.`,
        details: { itemId: id, itemKind: item.itemKind, allowedKinds },
      });
    }
  }
}

export type InboundBatchLine = {
  itemId: number;
  batchNumber?: string | null;
  productionDate?: Date | null;
  expiryDate?: Date | null;
};

async function loadSettings(db: SettingsLookupClient, itemIds: number[]): Promise<Map<number, ItemBatchSettings & { batchTracked: boolean }>> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.inventoryItemSetting.findMany({
    where: { itemId: { in: unique } },
    select: { itemId: true, batchTracked: true, expiryRequired: true, shelfLifeDays: true },
  });
  return new Map(rows.map((row) => [row.itemId, row]));
}

// Friendly, per-line check of the batch fields against each item's current
// batch-tracked state (I4): tracked → a batchNumber is required; untracked →
// no batch fields at all. Called at create/update and again at posting (the
// item may have been converted by a BATCH_CUTOVER in between).
// stock-ledger.ts applyMovements() re-checks authoritatively under its lock
// either way (BATCH_REQUIRED / UNEXPECTED_BATCH) — this only turns the
// common case into a clear Persian 400 naming the line.
export async function ensureInboundBatchFields(db: SettingsLookupClient, lines: InboundBatchLine[]) {
  const settings = await loadSettings(db, lines.map((line) => line.itemId));
  lines.forEach((line, index) => {
    const label = `ردیف ${index + 1}`;
    const tracked = settings.get(line.itemId)?.batchTracked ?? false;
    const hasBatch = Boolean(line.batchNumber && line.batchNumber.trim());
    if (tracked && !hasBatch) {
      throw new BadRequestException(`${label}: این کالا ردیابی بچ دارد؛ شمارهٔ بچ را وارد کنید`);
    }
    if (!tracked && (hasBatch || line.productionDate || line.expiryDate)) {
      throw new BadRequestException(`${label}: این کالا ردیابی بچ ندارد؛ برای این ردیف نباید بچ یا تاریخ تولید/انقضا وارد شود`);
    }
  });
}

// At posting: create-or-match a batch for every line that names one (via
// the existing I4 machinery — normalization, expiryRequired, shelf-life
// default, BATCH_DATA_MISMATCH), inside the posting transaction.
// defaultProductionDate (production output, §5.11) fills a line's
// productionDate when it gave none. Returns the resolved batch per line id.
export async function resolveInboundBatches(
  tx: Prisma.TransactionClient,
  lines: (InboundBatchLine & { id: number })[],
  userId: number | null,
  defaultProductionDate?: Date,
): Promise<Map<number, ResolvedBatch>> {
  const toResolve = lines.filter((line) => line.batchNumber && line.batchNumber.trim());
  if (toResolve.length === 0) return new Map();
  const settings = await loadSettings(tx as unknown as SettingsLookupClient, toResolve.map((line) => line.itemId));
  const resolved = await resolveBatches(
    tx as never,
    toResolve.map((line) => ({
      itemId: line.itemId,
      batchNumber: line.batchNumber!,
      productionDate: line.productionDate ?? defaultProductionDate ?? null,
      expiryDate: line.expiryDate ?? null,
    })),
    settings,
    userId,
  );
  return new Map(toResolve.map((line, index) => [line.id, resolved[index]]));
}

// What the caller may do with cost (B15): see it in detail responses and
// set it on create/update. Both are inventory.cost today — decided by the
// controller from the session, enforced by the service.
export type CostAccess = { canViewCost: boolean };

// B15: cost fields are visible only with inventory.cost. Strips them from a
// document's lines for every other caller (the same "pass a flag from the
// controller, decide in the service" pattern as CustomersService.get()'s
// canViewSensitive).
export function maskLineCosts<T extends { items: Record<string, unknown>[] }>(document: T, canViewCost: boolean, costFields: readonly string[]): T {
  if (canViewCost) return document;
  return {
    ...document,
    items: document.items.map((line) => {
      const copy = { ...line };
      for (const field of costFields) delete copy[field];
      return copy;
    }),
  };
}
