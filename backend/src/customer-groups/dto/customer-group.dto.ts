import { z } from 'zod';

// Customer Group admin (see /customer-groups page). Same field shape as
// Item Category — code, nameEn, nameFa, isActive, sortOrder. sortOrder is
// optional on create (appended after the current highest one) and on update
// (omitted = unchanged). The admin screen no longer shows it. nameEn is
// optional too (stored as '' when not given).
const sortOrderSchema = z
  .number({ error: 'ترتیب نمایش باید عدد باشد' })
  .int('ترتیب نمایش باید عدد صحیح باشد')
  .min(1, 'ترتیب نمایش باید حداقل ۱ باشد')
  .max(100000);

const baseCustomerGroupSchema = z.object({
  code: z.string().trim().min(1, 'کد الزامی است').max(50),
  nameEn: z.string().trim().max(100).default(''),
  nameFa: z.string().trim().min(1, 'نام فارسی الزامی است').max(100),
  isActive: z.boolean().default(true),
});

export const createCustomerGroupSchema = baseCustomerGroupSchema.extend({
  sortOrder: sortOrderSchema.optional(),
});

export const updateCustomerGroupSchema = baseCustomerGroupSchema.extend({
  sortOrder: sortOrderSchema.optional(),
});

export type CreateCustomerGroupDto = z.infer<typeof createCustomerGroupSchema>;
export type UpdateCustomerGroupDto = z.infer<typeof updateCustomerGroupSchema>;
