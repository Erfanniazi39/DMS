import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toIsoDay } from '../common/zod-fields';

// Batch create-or-match, DI-free (no NestJS provider) like inventory-queries.ts
// — takes the caller's transaction client. Inventory build plan I4 (§5.4/§5.4a).

const MS_PER_DAY = 86_400_000;

// Persian and Arabic-Indic digits → Latin, so the same lot number typed with
// a different digit set normalizes to one value before the uniqueness check
// (§5.4a R9) — trim and collapse internal whitespace too.
const DIGIT_MAP: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export function normalizeBatchNumber(raw: string): string {
  const converted = raw.replace(/[۰-۹٠-٩]/g, (ch) => DIGIT_MAP[ch] ?? ch);
  return converted.trim().replace(/\s+/g, ' ');
}

export type ItemBatchSettings = { itemId: number; expiryRequired: boolean; shelfLifeDays: number | null };

export type BatchResolveInput = {
  itemId: number;
  batchNumber: string;
  productionDate?: Date | null;
  expiryDate?: Date | null;
};

export type ResolvedBatch = { batchId: number; batchNumber: string; expiryDate: Date | null };

type StockBatchRow = { id: number; batchNumber: string; productionDate: Date | null; expiryDate: Date | null };

type BatchClient = {
  stockBatch: {
    findFirst(args: { where: { itemId: number; batchNumber: string } }): Promise<StockBatchRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<StockBatchRow>;
  };
};

function daysToExpiry(productionDate: Date, shelfLifeDays: number): Date {
  return new Date(productionDate.getTime() + shelfLifeDays * MS_PER_DAY);
}

// Create-or-match a batch per line, in order. Two lines in the same call
// sharing (itemId, normalized batchNumber) resolve to the same batch (one
// create, not two) via an in-call cache — relevant when BATCH_CUTOVER or a
// multi-line receipt names the same lot twice.
export async function resolveBatches(
  tx: Prisma.TransactionClient & BatchClient,
  lines: BatchResolveInput[],
  settingsByItem: Map<number, ItemBatchSettings>,
  userId: number | null,
): Promise<ResolvedBatch[]> {
  const cache = new Map<string, ResolvedBatch>();
  const results: ResolvedBatch[] = [];

  for (const line of lines) {
    const batchNumber = normalizeBatchNumber(line.batchNumber ?? '');
    if (!batchNumber) throw new Error(`resolveBatches: itemId ${line.itemId} has an empty batchNumber`);

    const settings = settingsByItem.get(line.itemId);
    const expiryRequired = settings?.expiryRequired ?? false;
    const shelfLifeDays = settings?.shelfLifeDays ?? null;

    let expiryDate = line.expiryDate ?? null;
    if (!expiryDate && line.productionDate && shelfLifeDays) {
      expiryDate = daysToExpiry(line.productionDate, shelfLifeDays);
    }
    if (expiryRequired && !expiryDate) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EXPIRY_REQUIRED',
        message: `برای این کالا تاریخ انقضا الزامی است (بچ «${batchNumber}»)؛ تاریخ انقضا یا تاریخ تولید را وارد کنید.`,
      });
    }

    const cacheKey = `${line.itemId}:${batchNumber}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      results.push(cached);
      continue;
    }

    const existing = await tx.stockBatch.findFirst({ where: { itemId: line.itemId, batchNumber } });
    let resolved: ResolvedBatch;
    if (existing) {
      const existingProduction = existing.productionDate ? toIsoDay(existing.productionDate) : null;
      const existingExpiry = existing.expiryDate ? toIsoDay(existing.expiryDate) : null;
      const incomingProduction = line.productionDate ? toIsoDay(line.productionDate) : null;
      const incomingExpiry = expiryDate ? toIsoDay(expiryDate) : null;
      const productionMismatch = incomingProduction !== null && existingProduction !== null && incomingProduction !== existingProduction;
      const expiryMismatch = incomingExpiry !== null && existingExpiry !== null && incomingExpiry !== existingExpiry;
      if (productionMismatch || expiryMismatch) {
        throw new ConflictException({
          statusCode: 409,
          code: 'BATCH_DATA_MISMATCH',
          message: `بچ «${batchNumber}» قبلاً با تاریخ‌های متفاوتی برای این کالا ثبت شده است؛ شمارهٔ بچ یا تاریخ‌های واردشده را بررسی کنید.`,
          details: { batchId: existing.id, batchNumber },
        });
      }
      resolved = { batchId: existing.id, batchNumber: existing.batchNumber, expiryDate: existing.expiryDate };
    } else {
      const created = await tx.stockBatch.create({
        data: {
          itemId: line.itemId,
          batchNumber,
          productionDate: line.productionDate ?? null,
          expiryDate,
          createdByUserId: userId,
        },
      });
      resolved = { batchId: created.id, batchNumber: created.batchNumber, expiryDate: created.expiryDate };
    }
    cache.set(cacheKey, resolved);
    results.push(resolved);
  }

  return results;
}
