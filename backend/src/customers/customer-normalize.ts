import { Prisma } from '@prisma/client';
import { toAsciiDigits } from '../common/persian-text';

// Persian text normalization for customer search and duplicate detection.
// Users type the same name several ways: Arabic ي/ك vs Persian ی/ک, a
// zero-width non-joiner (ZWNJ, U+200C) vs a space vs nothing between word
// parts, Persian (۰-۹) or Arabic-Indic (٠-٩) digits vs ASCII. Stored values
// are NOT rewritten — only the comparison is normalized, on both sides
// (JS here, and the identical SQL expression in searchKeySql()).

const ARABIC_YEH = /ي/g; // ي
const ARABIC_KAF = /ك/g; // ك
const ZWNJ = /‌/g;

// Persian/Arabic digits -> ASCII lives in common/ (shared with Suppliers);
// re-exported so existing imports keep working.
export { toAsciiDigits };

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
