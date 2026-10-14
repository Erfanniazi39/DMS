const PERSIAN_DIGITS = /[۰-۹]/g; // ۰-۹
const ARABIC_INDIC_DIGITS = /[٠-٩]/g; // ٠-٩

// Persian/Arabic-Indic digits -> ASCII. Used on numeric identifiers (phone,
// national id, economic code, postal code, Sheba) before validation and storage.
export function toAsciiDigits(value: string): string {
  return value
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));
}
