// Pure format validators for Iranian party identifiers. No Nest/Prisma
// imports — shared by Customers and Suppliers (and mirrored, for inline
// hints only, in frontend/src/lib/iran-identifiers.ts; the server decides).

// کد ملی (natural person): 10 digits + check digit. Rejects the ten
// all-identical-digit strings, which satisfy the checksum but are not issued.
export function isValidNationalCode(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  if (/^(\d)\1{9}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(value[i]) * (10 - i);
  const remainder = sum % 11;
  const check = Number(value[9]);
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

// شناسه ملی (legal person): 11 digits. Format only, per the business owner.
export function isValidLegalNationalId(value: string): boolean {
  return /^[0-9]{11}$/.test(value);
}

export function isValidPostalCode(value: string): boolean {
  return /^[0-9]{10}$/.test(value);
}

// کد اقتصادی: 12 digits (older) or 14 digits.
export function isValidEconomicCode(value: string): boolean {
  return /^([0-9]{12}|[0-9]{14})$/.test(value);
}

// Keep only letters and digits (so spaces, dashes, slashes and the invisible
// direction/joiner marks — RLM, LRM, ZWNJ — that pasted Persian text carries
// all disappear), uppercase, and add the IR prefix when only the 24 digits
// were typed. ASCII digits are expected (toAsciiDigits first).
export function normalizeSheba(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[0-9]{24}$/.test(compact) ? `IR${compact}` : compact;
}

// IR + 24 digits and the ISO 7064 mod-97 checksum.
export function isValidSheba(value: string): boolean {
  if (!/^IR[0-9]{24}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

// Why a normalized Sheba is rejected (null = valid): wrong shape vs a wrong
// check digit — they need different fixes from the user.
export function shebaProblem(normalized: string): string | null {
  if (!/^IR[0-9]{24}$/.test(normalized)) return 'شماره شبا باید IR و ۲۴ رقم باشد (در مجموع ۲۶ کاراکتر)';
  if (!isValidSheba(normalized)) return 'رقم کنترلی شماره شبا صحیح نیست — شماره را دوباره بررسی کنید';
  return null;
}

// A party with an empty country, or Iran, is held to the Iranian formats.
// Any other country is exempt (owner decision, 2026-10-13).
export function isIranCountry(country: string | null | undefined): boolean {
  if (!country) return true;
  const key = country.replace(/[\s‌]/g, '').toLowerCase();
  return key === '' || key === 'ایران' || key === 'iran' || key === 'ir';
}
