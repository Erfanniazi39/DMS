import { z } from 'zod';

// Same "empty string means not provided" convention used by the other DTOs
// in this project (see supplier.dto.ts / employee.dto.ts) — an empty form
// field should be treated as omitted, not validated as an empty value.
function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

// Confirmed list — must match the Prisma CustomerType enum.
export const CUSTOMER_TYPES = ['retail', 'wholesale', 'distributor', 'other'] as const;

const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().email('ایمیل معتبر نیست').optional());

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
