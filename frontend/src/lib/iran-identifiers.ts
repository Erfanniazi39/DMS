// Mirror of backend/src/common/iran-identifiers.ts + party-fields.ts, used
// ONLY for inline hints before submit. The server decides; keep in sync.

export type PartyKind = "INDIVIDUAL" | "ORGANIZATION";

export function isValidNationalCode(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(value[i]) * (10 - i);
  const remainder = sum % 11;
  const check = Number(value[9]);
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

export const isValidPostalCode = (value: string) => /^[0-9]{10}$/.test(value);
export const isValidEconomicCode = (value: string) => /^([0-9]{12}|[0-9]{14})$/.test(value);

export function normalizeSheba(value: string): string {
  // Letters and digits only: drops spaces, dashes, slashes and the invisible
  // direction/joiner marks (RLM, LRM, ZWNJ) that pasted Persian text carries.
  const compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[0-9]{24}$/.test(compact) ? `IR${compact}` : compact;
}

export function isValidSheba(value: string): boolean {
  if (!/^IR[0-9]{24}$/.test(value)) return false;
  const numeric = (value.slice(4) + value.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** Why a normalized Sheba is rejected (null = valid). */
export function shebaProblem(normalized: string): string | null {
  if (!/^IR[0-9]{24}$/.test(normalized)) return "شماره شبا باید IR و ۲۴ رقم باشد (در مجموع ۲۶ کاراکتر).";
  if (!isValidSheba(normalized)) return "رقم کنترلی شماره شبا صحیح نیست — شماره را دوباره بررسی کنید.";
  return null;
}

export function isIranCountry(country: string | null | undefined): boolean {
  if (!country) return true;
  const key = country.replace(/[\s‌]/g, "").toLowerCase();
  return key === "" || key === "ایران" || key === "iran" || key === "ir";
}

/** Persian error messages for the identity rule (empty = fine). */
export function identityErrors(input: { kind: PartyKind; nationalId: string; economicCode: string; country?: string }): string[] {
  if (!isIranCountry(input.country)) return [];
  const errors: string[] = [];
  const { kind, nationalId, economicCode } = input;
  if (kind === "ORGANIZATION") {
    if (!nationalId) errors.push("شناسه ملی شخص حقوقی الزامی است.");
    else if (!/^[0-9]{11}$/.test(nationalId)) errors.push("شناسه ملی شخص حقوقی باید ۱۱ رقم باشد.");
    if (!economicCode) errors.push("کد اقتصادی شخص حقوقی الزامی است.");
  } else if (!nationalId) errors.push("کد ملی شخص حقیقی الزامی است.");
  else if (!isValidNationalCode(nationalId)) errors.push("کد ملی معتبر نیست (۱۰ رقم با رقم کنترلی صحیح).");
  if (economicCode && !isValidEconomicCode(economicCode)) errors.push("کد اقتصادی باید ۱۲ یا ۱۴ رقم باشد.");
  return errors;
}
