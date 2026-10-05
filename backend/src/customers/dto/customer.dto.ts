import { z } from 'zod';
import { optionalEmail, optionalTrimmedString } from '../../common/zod-fields';

// Shared "empty string means not provided" convention (common/zod-fields.ts)
// — an empty form field is treated as omitted, not validated as empty.

// Confirmed list — must match the Prisma CustomerType enum.
export const CUSTOMER_TYPES = ['retail', 'wholesale', 'distributor', 'other'] as const;

// Phone is required for a customer (database_plan.txt does not mark it
// "blank allowed", unlike email/address/note). Same digits-only 6–15 rule as
// Supplier's phone.
export const createCustomerSchema = z.object({
  code: z.string().trim().min(1, 'کد مشتری الزامی است').max(40),
  name: z.string().trim().min(1, 'نام مشتری الزامی است').max(150),
  customerType: z.enum(CUSTOMER_TYPES, { message: 'نوع مشتری نامعتبر است' }),
  phone: z
    .string({ message: 'تلفن الزامی است' })
    .trim()
    .min(1, 'تلفن الزامی است')
    .regex(/^[0-9]{6,15}$/, 'تلفن معتبر نیست'),
  email: optionalEmail,
  address: optionalTrimmedString(500),
  note: optionalTrimmedString(500),
});

export const updateCustomerSchema = createCustomerSchema;

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
