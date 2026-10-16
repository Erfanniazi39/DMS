import { z } from 'zod';

// How a document number looks, per document type (settings › قالب شماره‌گذاری).
//   year  → <prefix><sep><jalali year><sep><counter>   SO-1405-000005   (counter restarts every year)
//   fixed → <prefix><sep><fixed text><sep><counter>    SO-7050-000005   (one continuing counter)
//   none  → <prefix><sep><counter>                     SO-000005        (one continuing counter)
// The default of every type is "year", 6 digits, "-" — exactly the numbers the
// system produced before this setting existed. Pure: used by the generator
// (common/document-sequence.ts) and by the settings page preview.

export const MIDDLE_MODES = ['year', 'fixed', 'none'] as const;
export type MiddleMode = (typeof MIDDLE_MODES)[number];
export const SEPARATORS = ['-', '/', '_', '.', ''] as const;

export type DocumentNumberFormat = {
  prefix: string;
  middleMode: MiddleMode;
  middleText: string | null;
  separator: string;
  digits: number;
};

export const DEFAULT_DIGITS = 6;
export const MIN_DIGITS = 3;
export const MAX_DIGITS = 9;
export const DEFAULT_SEPARATOR = '-';

export function defaultDocumentNumberFormat(docType: string): DocumentNumberFormat {
  return { prefix: docType, middleMode: 'year', middleText: null, separator: DEFAULT_SEPARATOR, digits: DEFAULT_DIGITS };
}

// Letters (Latin or Persian) and digits only — no spaces or punctuation inside a part.
const PART_PATTERN = /^[A-Za-z0-9؀-ۿ]{1,10}$/;
const JALALI_YEAR_LOOKALIKE = /^1[34]\d\d$/;

export const documentNumberFormatSchema = z
  .object({
    prefix: z.string().trim().regex(PART_PATTERN, 'پیشوند باید ۱ تا ۱۰ حرف یا رقم (بدون فاصله و علامت) باشد'),
    middleMode: z.enum(MIDDLE_MODES, { error: 'نوع بخش میانی نامعتبر است' }),
    middleText: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value ? value : null)),
    separator: z.enum(SEPARATORS, { error: 'جداکننده نامعتبر است' }),
    digits: z.number({ error: 'تعداد ارقام باید عدد باشد' }).int().min(MIN_DIGITS, `تعداد ارقام حداقل ${MIN_DIGITS} است`).max(MAX_DIGITS, `تعداد ارقام حداکثر ${MAX_DIGITS} است`),
  })
  .superRefine((value, ctx) => {
    if (value.middleMode === 'fixed') {
      if (!value.middleText || !PART_PATTERN.test(value.middleText)) {
        ctx.addIssue({ code: 'custom', path: ['middleText'], message: 'متن ثابت باید ۱ تا ۱۰ حرف یا رقم (بدون فاصله و علامت) باشد' });
      } else if (JALALI_YEAR_LOOKALIKE.test(value.middleText)) {
        // A fixed «1405» would produce the same strings as the yearly series.
        ctx.addIssue({ code: 'custom', path: ['middleText'], message: 'متن ثابت نباید شبیه سال شمسی (۱۳xx یا ۱۴xx) باشد' });
      }
    }
  })
  .transform((value) => ({ ...value, middleText: value.middleMode === 'fixed' ? value.middleText : null }));

/** Which counter row a document of this format uses: the Jalali year, or 0 for a continuing counter. */
export function counterKey(format: DocumentNumberFormat, fiscalYear: number): number {
  return format.middleMode === 'year' ? fiscalYear : 0;
}

export function renderDocumentNumber(format: DocumentNumberFormat, fiscalYear: number, value: number): string {
  const middle = format.middleMode === 'year' ? String(fiscalYear) : format.middleMode === 'fixed' ? (format.middleText ?? '') : '';
  const sep = format.separator;
  const counter = String(value).padStart(format.digits, '0');
  return middle ? `${format.prefix}${sep}${middle}${sep}${counter}` : `${format.prefix}${sep}${counter}`;
}
