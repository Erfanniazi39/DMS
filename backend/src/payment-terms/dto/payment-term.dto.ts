import { z } from 'zod';

// Payment Term admin (see /payment-terms page). Same shape as Customer Group
// plus dueDays (0 = cash). sortOrder optional on create, required on update.
const sortOrderSchema = z
  .number({ error: 'ترتیب نمایش باید عدد باشد' })
  .int('ترتیب نمایش باید عدد صحیح باشد')
  .min(0, 'ترتیب نمایش نمی‌تواند منفی باشد')
  .max(100000);

const basePaymentTermSchema = z.object({
  code: z.string().trim().min(1, 'کد الزامی است').max(50),
  nameEn: z.string().trim().min(1, 'نام انگلیسی الزامی است').max(100),
  nameFa: z.string().trim().min(1, 'نام فارسی الزامی است').max(100),
  dueDays: z
    .number({ error: 'مهلت پرداخت (روز) باید عدد باشد' })
    .int('مهلت پرداخت (روز) باید عدد صحیح باشد')
    .min(0, 'مهلت پرداخت (روز) نمی‌تواند منفی باشد')
    .max(3650, 'مهلت پرداخت (روز) بیش از حد مجاز است'),
  isActive: z.boolean().default(true),
});

export const createPaymentTermSchema = basePaymentTermSchema.extend({
  sortOrder: sortOrderSchema.optional(),
});

export const updatePaymentTermSchema = basePaymentTermSchema.extend({
  sortOrder: sortOrderSchema,
});

export type CreatePaymentTermDto = z.infer<typeof createPaymentTermSchema>;
export type UpdatePaymentTermDto = z.infer<typeof updatePaymentTermSchema>;
