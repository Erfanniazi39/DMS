import { z } from 'zod';

// Unit admin (see admin/units page). Same field shape as PurchaseType —
// code, nameEn, nameFa, isActive, sortOrder. sortOrder is optional on
// create (appended after the current highest one, like PurchaseType) but
// required on update, which is a full replace of the editable fields.
const sortOrderSchema = z
  .number({ error: 'ترتیب نمایش باید عدد باشد' })
  .int('ترتیب نمایش باید عدد صحیح باشد')
  .min(0, 'ترتیب نمایش نمی‌تواند منفی باشد')
  .max(100000);

const baseUnitSchema = z.object({
  code: z.string().trim().min(1, 'کد الزامی است').max(50),
  nameEn: z.string().trim().min(1, 'نام انگلیسی الزامی است').max(100),
  nameFa: z.string().trim().min(1, 'نام فارسی الزامی است').max(100),
  isActive: z.boolean().default(true),
});

export const createUnitSchema = baseUnitSchema.extend({
  sortOrder: sortOrderSchema.optional(),
});

export const updateUnitSchema = baseUnitSchema.extend({
  sortOrder: sortOrderSchema,
});

export type CreateUnitDto = z.infer<typeof createUnitSchema>;
export type UpdateUnitDto = z.infer<typeof updateUnitSchema>;
