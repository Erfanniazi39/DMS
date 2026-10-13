import { z } from 'zod';
import { emptyToUndefined } from '../../common/zod-fields';

// I4 (build plan §5.4/§5.4a): PUT /inventory/item-settings/:itemId.
// expiryRequired/shelfLifeDays are editable anytime. batchTracked is NOT a
// plain field edit — InventoryItemSettingsService enforces false→true is
// only allowed with zero stock everywhere (otherwise 409 pointing at
// BATCH_CUTOVER) and true→false is always refused (cutover is one-way in I4).

function toNumberInput(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return value;
}

// NULL or > 0 — mirrors the migration's hand-added CHECK constraint.
const shelfLifeDaysSchema = z.preprocess(
  emptyToUndefined,
  z.preprocess(
    toNumberInput,
    z
      .number({ error: 'طول عمر انبارداری باید عدد باشد' })
      .int({ error: 'طول عمر انبارداری باید عدد صحیح (روز) باشد' })
      .positive({ error: 'طول عمر انبارداری باید بزرگ‌تر از صفر باشد' })
      .optional()
      .nullable(),
  ),
);

export const upsertInventoryItemSettingSchema = z.object({
  expiryRequired: z.boolean({ error: 'الزامی بودن تاریخ انقضا را مشخص کنید' }),
  shelfLifeDays: shelfLifeDaysSchema,
  // Omitted = leave unchanged. true = ask for batch tracking to turn on
  // (only allowed with zero stock); false = refused if currently true.
  batchTracked: z.boolean().optional(),
});

export type UpsertInventoryItemSettingDto = z.infer<typeof upsertInventoryItemSettingSchema>;

// GET /inventory/reports/expiry
export const expiryReportQuerySchema = z.object({
  withinDays: z.preprocess(
    toNumberInput,
    z.number({ error: 'بازهٔ روز نامعتبر است' }).int().min(0).optional(),
  ),
  includeExpired: z.preprocess(emptyToUndefined, z.enum(['true', 'false'], { error: 'فیلتر منقضی‌شده‌ها نامعتبر است' }).optional()),
});

export type ExpiryReportQuery = z.infer<typeof expiryReportQuerySchema>;
