import { z } from 'zod';
import {
  isIranCountry,
  isValidEconomicCode,
  isValidLegalNationalId,
  isValidNationalCode,
  isValidPostalCode,
  shebaProblem,
  normalizeSheba,
} from './iran-identifiers';
import { toAsciiDigits } from './persian-text';
import { emptyToUndefined, optionalTrimmedString } from './zod-fields';

// Zod builders shared by Customers and Suppliers (stateless — each module
// wraps them in its own schema; neither imports the other). Persian/Arabic
// digits are accepted and stored as ASCII. Blank = not provided.

export type PartyKind = 'INDIVIDUAL' | 'ORGANIZATION';

export function asciiDigitsInput(value: unknown) {
  const blankless = emptyToUndefined(value);
  return typeof blankless === 'string' ? toAsciiDigits(blankless).trim() : blankless;
}

// Digits-only 6–15 (the existing customer/supplier phone rule).
const PHONE_PATTERN = /^[0-9]{6,15}$/;
export const requiredPhone = z.preprocess(
  asciiDigitsInput,
  z.string({ error: 'تلفن الزامی است' }).regex(PHONE_PATTERN, { error: 'تلفن معتبر نیست' }),
);
export const optionalPhone = z.preprocess(asciiDigitsInput, z.string().regex(PHONE_PATTERN, { error: 'تلفن معتبر نیست' }).optional());

// Digits-only text; exact formats (national id, economic code, postal code)
// depend on kind/country and are checked in the refines below.
export const optionalDigitsText = (maxLength: number, message: string) =>
  z.preprocess(
    asciiDigitsInput,
    z.string().regex(/^[0-9]+$/, { error: message }).max(maxLength, { error: `حداکثر ${maxLength} رقم مجاز است` }).optional(),
  );

export const optionalWebsite = optionalTrimmedString(200);

// Sheba: normalized to "IR" + 24 digits and checked with mod-97.
export const optionalSheba = z.preprocess(
  (value) => {
    const blankless = emptyToUndefined(value);
    return typeof blankless === 'string' ? normalizeSheba(toAsciiDigits(blankless)) : blankless;
  },
  z
    .string()
    .superRefine((value, ctx) => {
      const problem = shebaProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional(),
);

// "HH:MM" Tehran wall clock; "9:05" is padded to "09:05".
export const optionalTime = z.preprocess(
  (value) => {
    const blankless = asciiDigitsInput(value);
    if (typeof blankless !== 'string') return blankless;
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(blankless);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : blankless;
  },
  z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { error: 'ساعت معتبر نیست (قالب ۱۴:۳۰)' }).optional(),
);

// Bank account — the same shape for a customer's and a supplier's account.
export const bankAccountFields = {
  bankName: optionalTrimmedString(100),
  accountNumber: z.preprocess(asciiDigitsInput, z.string().regex(/^[0-9\-]+$/, { error: 'شماره حساب معتبر نیست' }).max(40).optional()),
  shebaNumber: optionalSheba,
  accountHolderName: optionalTrimmedString(150),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  note: optionalTrimmedString(500),
};

export function refineBankAccountHasNumber(value: { accountNumber?: string; shebaNumber?: string }, ctx: z.RefinementCtx) {
  if (!value.accountNumber && !value.shebaNumber) {
    ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'شماره حساب یا شماره شبا باید وارد شود' });
  }
}

// --- Identity -------------------------------------------------------------

interface IdentityInput {
  kind: PartyKind;
  nationalId?: string | null;
  economicCode?: string | null;
  // Suppliers only: a non-Iranian country exempts the party from the
  // Iranian identifier formats (owner decision, 2026-10-13).
  country?: string | null;
}

export interface IdentityIssue {
  path: 'nationalId' | 'economicCode';
  message: string;
}

// The single identity rule. Used by the DTO refines (400 on save) and by
// missingPartyIdentityFields() (the «ناقص» indicator on existing records).
//  - ORGANIZATION: شناسه ملی (11 digits) and کد اقتصادی (12/14) required.
//  - INDIVIDUAL: کد ملی (10 digits, check digit) required; کد اقتصادی
//    optional but format-checked when present.
export function checkPartyIdentity({ kind, nationalId, economicCode, country }: IdentityInput): IdentityIssue[] {
  if (!isIranCountry(country)) return [];
  const issues: IdentityIssue[] = [];
  if (kind === 'ORGANIZATION') {
    if (!nationalId) issues.push({ path: 'nationalId', message: 'شناسه ملی شخص حقوقی الزامی است' });
    else if (!isValidLegalNationalId(nationalId)) issues.push({ path: 'nationalId', message: 'شناسه ملی شخص حقوقی باید ۱۱ رقم باشد' });
    if (!economicCode) issues.push({ path: 'economicCode', message: 'کد اقتصادی شخص حقوقی الزامی است' });
  } else {
    if (!nationalId) issues.push({ path: 'nationalId', message: 'کد ملی شخص حقیقی الزامی است' });
    else if (!isValidNationalCode(nationalId)) issues.push({ path: 'nationalId', message: 'کد ملی معتبر نیست (۱۰ رقم با رقم کنترلی صحیح)' });
  }
  if (economicCode && !isValidEconomicCode(economicCode)) {
    issues.push({ path: 'economicCode', message: 'کد اقتصادی باید ۱۲ یا ۱۴ رقم باشد' });
  }
  return issues;
}

export function partyIdentityRefine(
  value: { nationalId?: string; economicCode?: string; country?: string },
  kind: PartyKind,
  ctx: z.RefinementCtx,
) {
  for (const issue of checkPartyIdentity({ kind, nationalId: value.nationalId, economicCode: value.economicCode, country: value.country })) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
}

// Labels of the identity fields an existing record fails (empty = complete).
export function missingPartyIdentityFields(input: IdentityInput): string[] {
  return checkPartyIdentity(input).map((issue) => (issue.path === 'nationalId' ? (input.kind === 'ORGANIZATION' ? 'شناسه ملی' : 'کد ملی') : 'کد اقتصادی'));
}

export function postalCodeRefine(postalCode: string | undefined, country: string | undefined, ctx: z.RefinementCtx, path: (string | number)[] = ['postalCode']) {
  if (postalCode && isIranCountry(country) && !isValidPostalCode(postalCode)) {
    ctx.addIssue({ code: 'custom', path, message: 'کد پستی باید ۱۰ رقم باشد' });
  }
}
