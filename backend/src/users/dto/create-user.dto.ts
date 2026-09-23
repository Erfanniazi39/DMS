import { z } from 'zod';

// USER is created independently of EMPLOYEE — no employee reference is
// accepted here. See docs/database_plan.txt for the current model.
const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().email('ایمیل معتبر نیست').optional(),
);

// Phone numbers are exactly 11 digits, Latin numerals only — no symbols,
// spaces, or Persian/Arabic-indic digits.
const optionalPhone = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^[0-9]{11}$/, 'شماره تلفن باید دقیقاً ۱۱ رقم انگلیسی باشد')
    .optional(),
);

export const createUserSchema = z.object({
  username: z.string().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد'),
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
  email: optionalEmail,
  phone: optionalPhone,
  roleName: z.enum([
    'ADMIN',
    'DATA_OPERATOR',
    'PURCHASE_MANAGER',
    'SALES_MANAGER',
    'VIEWER',
  ]),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).default('ACTIVE'),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
