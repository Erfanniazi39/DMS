import { z } from 'zod';
import { emptyToUndefined, optionalEmail } from '../../common/zod-fields';
import { usernameSchema } from './username';

// USER is created independently of EMPLOYEE — no employee reference is
// accepted here. See docs/database_plan.txt for the current model.
// optionalEmail / emptyToUndefined: common/zod-fields.ts.

// Phone numbers are exactly 11 digits, Latin numerals only — no symbols,
// spaces, or Persian/Arabic-indic digits.
const optionalPhone = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(/^[0-9]{11}$/, 'شماره تلفن باید دقیقاً ۱۱ رقم انگلیسی باشد')
    .optional(),
);

// Display name for pickers and letters; plain account data, never an Employee link.
const optionalFullName = z.preprocess(emptyToUndefined, z.string().trim().max(100, 'نام و نام خانوادگی حداکثر ۱۰۰ کاراکتر است').optional());

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: optionalFullName,
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
  email: optionalEmail,
  phone: optionalPhone,
  roleName: z.enum([
    'ADMIN',
    'DATA_OPERATOR',
    'PURCHASE_MANAGER',
    'SALES_MANAGER',
    'VIEWER',
    // Sales batch 1 (2026-10-06) — seeded in prisma/seed.ts.
    'SALESPERSON',
    'WAREHOUSE',
    'ACCOUNTANT',
    // Inventory batch I2 (2026-10-10, B20) — seeded in prisma/seed.ts.
    'INVENTORY_MANAGER',
  ]),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).default('ACTIVE'),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
