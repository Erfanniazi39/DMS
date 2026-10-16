import { z } from 'zod';

// Persian/Arabic digits → Latin, so «۰۲۱» and «021» are the same value.
function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `حداکثر ${max} نویسه مجاز است`)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalDigits = (label: string, pattern: RegExp, hint: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? toLatinDigits(v).replace(/[\s-]/g, '') : null))
    .refine((v) => v === null || pattern.test(v), `${label} باید ${hint} باشد`);

// Phone / fax: digits plus + ( ) - and spaces; kept as typed (Latin digits).
const optionalPhone = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? toLatinDigits(v) : null))
    .refine((v) => v === null || /^[0-9+()\-\s]{3,30}$/.test(v), `${label} معتبر نیست`);

export const updateCompanyProfileSchema = z.object({
  legalName: z.string().trim().min(1, 'نام رسمی شرکت الزامی است').max(200),
  brandName: optionalText(200),
  companyType: optionalText(100),
  nationalId: optionalDigits('شناسه ملی', /^\d{11}$/, 'یک عدد ۱۱ رقمی'),
  economicCode: optionalDigits('کد اقتصادی', /^\d{12,14}$/, 'یک عدد ۱۲ تا ۱۴ رقمی'),
  registrationNumber: optionalText(50),
  province: optionalText(100),
  city: optionalText(100),
  postalCode: optionalDigits('کد پستی', /^\d{10}$/, 'یک عدد ۱۰ رقمی'),
  address: optionalText(500),
  phone1: optionalPhone('تلفن'),
  phone2: optionalPhone('تلفن ۲'),
  fax: optionalPhone('فکس'),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'ایمیل معتبر نیست'),
  website: optionalText(200),
  documentFooter: optionalText(500),
});

export type UpdateCompanyProfileDto = z.infer<typeof updateCompanyProfileSchema>;
