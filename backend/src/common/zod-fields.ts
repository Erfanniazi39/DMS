import { z } from 'zod';

// Strict Zod field builders for request bodies. Introduced in the QA pass of
// 2026-10-05 to replace bare `z.coerce.*` on required fields, which silently
// turned bad input into real data: `null`/`""` → 0, `null`/`0` → 1970-01-01,
// `true` → 1. Here a missing/blank/wrong-type value is a validation error
// (400, Persian message), never a fabricated default.

// Same "empty string means not provided" convention used by the other DTOs
// in this project (see employee.dto.ts).
export function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

// Column bounds — keep in sync with schema.prisma.
// Decimal(15,0): money (Rial) — no fractional part, 15 digits.
export const MAX_MONEY = 999_999_999_999_999;
// Decimal(12,2): quantities — 2 decimal places, 10 integer digits.
export const MAX_QUANTITY = 9_999_999_999.99;
export const MIN_QUANTITY = 0.01;

// null/undefined/blank → undefined (so a required field reports "required"
// and an optional one counts as "not provided"); numeric strings → number;
// numbers pass through; anything else (booleans, objects, arrays) is passed
// on unchanged so z.number() rejects it instead of coercing it.
function toNumberInput(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return value;
}

// Same idea for dates: only a Date or a date string is accepted. A number
// (e.g. 0 → 1970-01-01) or boolean is rejected; an unparseable string
// becomes an Invalid Date, which z.date() rejects.
function toDateInput(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : new Date(trimmed);
  }
  return value;
}

function hasAtMostTwoDecimals(value: number) {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function requiredId(message: string) {
  return z.preprocess(toNumberInput, z.number({ error: message }).int({ error: message }).positive({ error: message }));
}

export function optionalId(message: string) {
  return z.preprocess(toNumberInput, z.number({ error: message }).int({ error: message }).positive({ error: message }).optional());
}

// A whole-Rial amount >= 0 (or > 0 with `positive`), within Decimal(15,0).
function moneySchema(label: string, options: { positive?: boolean } = {}) {
  let schema = z
    .number({ error: `${label} باید عدد باشد` })
    .int({ error: `${label} باید عدد صحیح (ریال، بدون اعشار) باشد` })
    .max(MAX_MONEY, { error: `${label} بیش از حد مجاز است` });
  schema = options.positive
    ? schema.positive({ error: `${label} باید بزرگ‌تر از صفر باشد` })
    : schema.min(0, { error: `${label} نمی‌تواند منفی باشد` });
  return schema;
}

export function requiredMoney(label: string, options: { positive?: boolean } = {}) {
  return z.preprocess(toNumberInput, moneySchema(label, options));
}

export function optionalMoney(label: string) {
  return z.preprocess(toNumberInput, moneySchema(label).optional());
}

// A quantity > 0 that survives Decimal(12,2) unchanged: at least 0.01, at
// most two decimal places (0.001 would otherwise be stored as 0.00).
export function requiredQuantity(label: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${label} باید عدد باشد` })
      .positive({ error: `${label} باید بزرگ‌تر از صفر باشد` })
      .min(MIN_QUANTITY, { error: `${label} باید حداقل ۰٫۰۱ باشد` })
      .max(MAX_QUANTITY, { error: `${label} بیش از حد مجاز است` })
      .refine(hasAtMostTwoDecimals, { error: `${label} حداکثر می‌تواند دو رقم اعشار داشته باشد` }),
  );
}

// Plausible business-date range for every date a user enters on Purchases /
// Purchase Requests (purchase, request, payment, return, required-by and
// document dates): Jalali 1300/01/01 – 1499/12/end, i.e. Gregorian
// 1921-03-21 (inclusive) – 2121-03-21 (exclusive). Wide enough for old paper
// records being digitized and for years-out post-dated cheques; rejects
// 9999-style typos and a Jalali year typed into a Gregorian field (e.g.
// 1404-01-01 → year 1404 AD is before the range). The Jalali date picker is
// clamped to the same 1300–1499 years (frontend lib/jalali.ts).
export const MIN_BUSINESS_DATE = new Date('1921-03-21T00:00:00.000Z');
export const MAX_BUSINESS_DATE_EXCLUSIVE = new Date('2121-03-21T00:00:00.000Z');
const BUSINESS_DATE_RANGE_MESSAGE = 'تاریخ باید بین سال‌های ۱۳۰۰ تا ۱۴۹۹ شمسی باشد';

function isWithinBusinessRange(date: Date) {
  return date.getTime() >= MIN_BUSINESS_DATE.getTime() && date.getTime() < MAX_BUSINESS_DATE_EXCLUSIVE.getTime();
}

export function requiredBusinessDate(message: string) {
  return z.preprocess(toDateInput, z.date({ error: message }).refine(isWithinBusinessRange, { error: BUSINESS_DATE_RANGE_MESSAGE }));
}

export function optionalBusinessDate(message: string) {
  return z.preprocess(
    toDateInput,
    z.date({ error: message }).refine(isWithinBusinessRange, { error: BUSINESS_DATE_RANGE_MESSAGE }).optional(),
  );
}

// "YYYY-MM-DD" of a date, for day-level comparisons (all business dates are
// entered as plain calendar dates and stored at UTC midnight).
export function toIsoDay(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10);
}

// Unbounded variants — for list filters and the optimistic-locking token,
// which aren't business dates a user enters.
export function requiredDate(message: string) {
  return z.preprocess(toDateInput, z.date({ error: message }));
}

export function optionalDate(message: string) {
  return z.preprocess(toDateInput, z.date({ error: message }).optional());
}

export function requiredText(maxLength: number, requiredMessage: string) {
  return z
    .string({ error: requiredMessage })
    .trim()
    .min(1, { error: requiredMessage })
    .max(maxLength, { error: `حداکثر ${maxLength} کاراکتر مجاز است` });
}

export function optionalTrimmedString(maxLength: number) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string({ error: 'مقدار متنی نامعتبر است' })
      .trim()
      .max(maxLength, { error: `حداکثر ${maxLength} کاراکتر مجاز است` })
      .optional(),
  );
}

// Optional email: blank → undefined (not provided), otherwise trimmed and
// format-checked. Shared by every DTO with an optional email field.
export const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().email('ایمیل معتبر نیست').optional());

export function enumField<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.enum(values, { error: message });
}
