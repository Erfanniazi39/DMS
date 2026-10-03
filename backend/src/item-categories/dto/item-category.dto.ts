import { z } from 'zod';

// Item Category admin (see /item-categories page). Same field shape as Unit
// — code, nameEn, nameFa, isActive, sortOrder. sortOrder is optional on
// create (appended after the current highest one) but required on update,
// which is a full replace of the editable fields.
const sortOrderSchema = z
  .number({ error: 'ترتیب نمایش باید عدد باشد' })
  .int('ترتیب نمایش باید عدد صحیح باشد')
  .min(0, 'ترتیب نمایش نمی‌تواند منفی باشد')
  .max(100000);

const baseItemCategorySchema = z.object({
  code: z.string().trim().min(1, 'کد الزامی است').max(50),
  nameEn: z.string().trim().min(1, 'نام انگلیسی الزامی است').max(100),
  nameFa: z.string().trim().min(1, 'نام فارسی الزامی است').max(100),
  isActive: z.boolean().default(true),
});

export const createItemCategorySchema = baseItemCategorySchema.extend({
  sortOrder: sortOrderSchema.optional(),
});

export const updateItemCategorySchema = baseItemCategorySchema.extend({
  sortOrder: sortOrderSchema,
});

export type CreateItemCategoryDto = z.infer<typeof createItemCategorySchema>;
export type UpdateItemCategoryDto = z.infer<typeof updateItemCategorySchema>;
