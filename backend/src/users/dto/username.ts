import { z } from 'zod';

// Usernames are Latin only: letters, digits and . _ - (no Persian, Arabic,
// Cyrillic or any other script, no spaces). Must start with a letter.
// Applies to creating and renaming; login itself stays permissive so older
// accounts that predate this rule can still sign in until an admin renames them.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'نام کاربری باید حداقل ۳ کاراکتر باشد')
  .max(50, 'نام کاربری حداکثر ۵۰ کاراکتر است')
  .regex(
    /^[A-Za-z][A-Za-z0-9._-]*$/,
    'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد و نمادهای . _ - باشد و باید با حرف انگلیسی شروع شود',
  );
