import { z } from 'zod';
import { optionalMoney, optionalTrimmedString } from '../../common/zod-fields';

// Shared "empty string means not provided" convention (common/zod-fields.ts)
// — an empty form field is treated as omitted, not validated as empty.

export const ITEM_STATUSES = ['active', 'inactive'] as const;

const foreignKeyId = (requiredMessage: string) =>
  z.number({ error: requiredMessage }).int(requiredMessage).positive(requiredMessage);

export const createItemSchema = z.object({
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
});

export const updateItemSchema = createItemSchema.extend({
  status: z.enum(ITEM_STATUSES),
});

export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
