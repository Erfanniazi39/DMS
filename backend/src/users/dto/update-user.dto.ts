import { z } from 'zod';
import { emptyToUndefined, optionalEmail } from '../../common/zod-fields';

// Partial-update DTO for editing an existing USER account.
// Every field is optional — the caller sends only what changed.
// This intentionally mirrors create-user.dto.ts's validation rules,
// so the same username/password/email/phone rules apply on edit.
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

export const updateUserSchema = z
  .object({
    username: z.string().min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد').optional(),
    password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد').optional(),
    email: optionalEmail,
    phone: optionalPhone,
    roleName: z
      .enum(['ADMIN', 'DATA_OPERATOR', 'PURCHASE_MANAGER', 'SALES_MANAGER', 'VIEWER', 'SALESPERSON', 'WAREHOUSE', 'ACCOUNTANT'])
      .optional(),
    status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'هیچ تغییری برای ذخیره ارسال نشده است',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
