import { z } from 'zod';
import { optionalMoney, optionalTrimmedString } from '../../common/zod-fields';

// Shared "empty string means not provided" convention (common/zod-fields.ts)
// — an empty form field is treated as omitted, not validated as empty.

export const ITEM_STATUSES = ['active', 'inactive'] as const;

// Inventory build plan I1, B2: which stock role the item plays.
// FINISHED_GOOD is the only kind Sales pickers show; RAW_MATERIAL/PACKAGING
// are consumed by production and tracked as stock, never sellable.
export const ITEM_KINDS = ['FINISHED_GOOD', 'RAW_MATERIAL', 'PACKAGING'] as const;

const foreignKeyId = (requiredMessage: string) =>
  z.number({ error: requiredMessage }).int(requiredMessage).positive(requiredMessage);

// Secondary unit (واحد فرعی): optional pair — a unit id plus how many stock units
// make ONE of it (carton = 12 pieces → 12). Blank/omitted clears both.
function blankToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return value;
}
const hasAtMostSixDecimals = (value: number) => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 1e-6;

const secondaryUnitIdField = z.preprocess(
  blankToUndefined,
  z.number({ error: 'واحد فرعی نامعتبر است' }).int({ error: 'واحد فرعی نامعتبر است' }).positive({ error: 'واحد فرعی نامعتبر است' }).max(2_147_483_647, { error: 'واحد فرعی نامعتبر است' }).optional(),
);
const secondaryUnitFactorField = z.preprocess(
  blankToUndefined,
  z
    .number({ error: 'ضریب تبدیل باید عدد باشد' })
    .positive({ error: 'ضریب تبدیل باید بزرگ‌تر از صفر باشد' })
    .max(99_999_999, { error: 'ضریب تبدیل بیش از حد مجاز است' })
    .refine(hasAtMostSixDecimals, { error: 'ضریب تبدیل حداکثر می‌تواند شش رقم اعشار داشته باشد' })
    .optional(),
);

const itemBaseSchema = z.object({
  code: z.string().trim().min(1, 'کد کالا الزامی است').max(40),
  name: z.string().trim().min(1, 'نام کالا الزامی است').max(150),
  categoryId: foreignKeyId('دسته‌بندی کالا الزامی است'),
  unitId: foreignKeyId('واحد کالا الزامی است'),
  description: optionalTrimmedString(2000),
  note: optionalTrimmedString(500),
  // Default selling price, whole Rial (Decimal(15,0)) — optional: an item
  // without one is priced manually on each sales line (later Sales batches).
  // Blank/null = no default price.
  sellingPrice: optionalMoney('قیمت فروش'),
  // Unlike Supplier, status is offered on the create form too — defaults
  // to active when omitted.
  status: z.enum(ITEM_STATUSES).default('active'),
  // Defaults to FINISHED_GOOD when omitted (every existing item is one).
  itemKind: z.enum(ITEM_KINDS).default('FINISHED_GOOD'),
  secondaryUnitId: secondaryUnitIdField,
  secondaryUnitFactor: secondaryUnitFactorField,
});

function secondaryUnitRefine(item: { unitId: number; secondaryUnitId?: number; secondaryUnitFactor?: number }, ctx: z.RefinementCtx) {
    const hasUnit = item.secondaryUnitId !== undefined;
    const hasFactor = item.secondaryUnitFactor !== undefined;
    if (hasUnit && !hasFactor) ctx.addIssue({ code: 'custom', path: ['secondaryUnitFactor'], message: 'برای واحد فرعی، ضریب تبدیل را وارد کنید' });
    if (hasFactor && !hasUnit) ctx.addIssue({ code: 'custom', path: ['secondaryUnitId'], message: 'برای ضریب تبدیل، واحد فرعی را انتخاب کنید' });
    if (hasUnit && item.secondaryUnitId === item.unitId) ctx.addIssue({ code: 'custom', path: ['secondaryUnitId'], message: 'واحد فرعی باید با واحد اصلی متفاوت باشد' });
}

export const createItemSchema = itemBaseSchema.superRefine(secondaryUnitRefine);

export const updateItemSchema = itemBaseSchema
  .extend({
    status: z.enum(ITEM_STATUSES),
    itemKind: z.enum(ITEM_KINDS),
  })
  .superRefine(secondaryUnitRefine);

export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
