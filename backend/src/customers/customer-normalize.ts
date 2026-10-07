import { Prisma } from '@prisma/client';

// Persian text normalization for customer search and duplicate detection.
// Users type the same name several ways: Arabic ي/ك vs Persian ی/ک, a
// zero-width non-joiner (ZWNJ, U+200C) vs a space vs nothing between word
// parts, Persian (۰-۹) or Arabic-Indic (٠-٩) digits vs ASCII. Stored values
// are NOT rewritten — only the comparison is normalized, on both sides
// (JS here, and the identical SQL expression in searchKeySql()).

const ARABIC_YEH = /ي/g; // ي
const ARABIC_KAF = /ك/g; // ك
const PERSIAN_DIGITS = /[۰-۹]/g; // ۰-۹
const ARABIC_INDIC_DIGITS = /[٠-٩]/g; // ٠-٩
const ZWNJ = /‌/g;

// Persian/Arabic-Indic digits -> ASCII. Used on numeric identifiers
// (phone, national id, economic code) before validation and storage.
export function toAsciiDigits(value: string): string {
  return value
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

// ي→ی, ك→ک, digits→ASCII, ZWNJ→space, runs of whitespace collapsed, trimmed.
export function normalizePersianText(value: string): string {
  return toAsciiDigits(value)
    .replace(ARABIC_YEH, 'ی')
    .replace(ARABIC_KAF, 'ک')
    .replace(ZWNJ, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The comparison key: normalizePersianText() with every space/ZWNJ removed
// and Latin letters lowercased, so "خرده‌فروشی", "خرده فروشی" and
// "خردهفروشی" all compare equal.
export function searchKey(value: string): string {
  return normalizePersianText(value).replace(/\s+/g, '').toLowerCase();
}

// Escapes LIKE wildcards so user input is matched literally.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// SQL twin of searchKey() for a column. `column` must be a trusted,
// hard-coded identifier (never user input) — it's spliced in raw.
const SQL_FROM = 'يك۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
const SQL_TO = 'یک01234567890123456789';
export function searchKeySql(column: string): Prisma.Sql {
  return Prisma.raw(
    `regexp_replace(translate(lower(coalesce(${column}, '')), '${SQL_FROM}', '${SQL_TO}'), '[[:space:]' || chr(8204) || ']+', '', 'g')`,
  );
}
