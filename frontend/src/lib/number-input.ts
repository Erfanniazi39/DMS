// Numeric form input parsing that accepts what a Persian keyboard types.
// `Number("۴۰")` is NaN, which silently broke totals/quantities — every
// numeric text input in the Purchases / Purchase Requests forms goes through
// parseNumberInput() instead of a bare Number().

const PERSIAN_ZERO = 0x06f0; // ۰
const ARABIC_INDIC_ZERO = 0x0660; // ٠

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII; Persian/Arabic decimal separator (٫) → "."; thousands separators (٬ and ,) removed. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/٫/g, ".")
    .replace(/[٬,]/g, "");
}

/** Same contract as Number(value), after normalizeDigits(). */
export function parseNumberInput(value: string): number {
  return Number(normalizeDigits(value).trim());
}
