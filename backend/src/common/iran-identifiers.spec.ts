import { z } from 'zod';
import { paymentReceiptInfoFields } from './payment-receipt-fields';
import {
  isIranCountry,
  isValidEconomicCode,
  isValidLegalNationalId,
  isValidNationalCode,
  isValidPostalCode,
  isValidSheba,
  shebaProblem,
  normalizeSheba,
} from './iran-identifiers';
import { checkPartyIdentity, missingPartyIdentityFields, optionalTime } from './party-fields';
import { rialToPersianWords } from './persian-words';
import { toAsciiDigits } from './persian-text';

describe('iran identifiers', () => {
  it('validates کد ملی with the check digit', () => {
    expect(isValidNationalCode('0010350829')).toBe(true);
    expect(isValidNationalCode('0010350828')).toBe(false);
    expect(isValidNationalCode('1111111111')).toBe(false);
    expect(isValidNationalCode('123')).toBe(false);
  });
  it('validates شناسه ملی / postal / economic code lengths', () => {
    expect(isValidLegalNationalId('10101234567')).toBe(true);
    expect(isValidLegalNationalId('1010123456')).toBe(false);
    expect(isValidPostalCode('1234567890')).toBe(true);
    expect(isValidPostalCode('123456789')).toBe(false);
    expect(isValidEconomicCode('411234567890')).toBe(true);
    expect(isValidEconomicCode('41123456789012')).toBe(true);
    expect(isValidEconomicCode('4112345678901')).toBe(false);
  });
  it('normalizes and checks Sheba (mod-97)', () => {
    expect(normalizeSheba(' 06 2960000000100324200001 ')).toBe('IR062960000000100324200001');
    expect(isValidSheba('IR062960000000100324200001')).toBe(true);
    expect(isValidSheba('IR062960000000100324200002')).toBe(false);
    expect(isValidSheba('062960000000100324200001')).toBe(false);
  });
  it('treats empty country and Iran as Iranian', () => {
    expect(isIranCountry(undefined)).toBe(true);
    expect(isIranCountry(' ایران ')).toBe(true);
    expect(isIranCountry('Turkey')).toBe(false);
  });
  it('converts Persian digits', () => {
    expect(toAsciiDigits('۱۲۳٤')).toBe('1234');
  });
});

describe('party identity rule', () => {
  it('requires شناسه ملی + کد اقتصادی for organizations', () => {
    expect(checkPartyIdentity({ kind: 'ORGANIZATION' }).map((i) => i.path)).toEqual(['nationalId', 'economicCode']);
    expect(checkPartyIdentity({ kind: 'ORGANIZATION', nationalId: '10101234567', economicCode: '411234567890' })).toEqual([]);
  });
  it('requires a valid کد ملی for individuals, economic code optional', () => {
    expect(checkPartyIdentity({ kind: 'INDIVIDUAL', nationalId: '0010350829' })).toEqual([]);
    expect(checkPartyIdentity({ kind: 'INDIVIDUAL', nationalId: '0010350828' })).toHaveLength(1);
    expect(checkPartyIdentity({ kind: 'INDIVIDUAL', nationalId: '0010350829', economicCode: '12' })).toHaveLength(1);
  });
  it('exempts non-Iranian countries', () => {
    expect(checkPartyIdentity({ kind: 'ORGANIZATION', country: 'ترکیه' })).toEqual([]);
  });
  it('lists missing field labels', () => {
    expect(missingPartyIdentityFields({ kind: 'ORGANIZATION' })).toEqual(['شناسه ملی', 'کد اقتصادی']);
  });
});

describe('optionalTime', () => {
  it('pads and validates', () => {
    expect(optionalTime.parse('9:05')).toBe('09:05');
    expect(optionalTime.parse('۱۴:۳۰')).toBe('14:30');
    expect(optionalTime.parse('')).toBeUndefined();
    expect(() => optionalTime.parse('25:00')).toThrow();
  });
});

describe('rialToPersianWords', () => {
  it('spells amounts', () => {
    expect(rialToPersianWords(0)).toBe('صفر ریال');
    expect(rialToPersianWords(1)).toBe('یک ریال');
    expect(rialToPersianWords(1000)).toBe('یک هزار ریال');
    expect(rialToPersianWords(1250000)).toBe('یک میلیون و دویست و پنجاه هزار ریال');
    expect(rialToPersianWords('100000000000000')).toBe('صد تریلیون ریال');
  });
});

describe('paymentReceiptInfoFields', () => {
  const schema = z.object(paymentReceiptInfoFields);
  it('every field is optional; type is a fixed list; time is HH:MM', () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ transactionType: 'ساتنا', transactionTime: '۹:05', depositId: ' 12 ' })).toMatchObject({ transactionType: 'ساتنا', transactionTime: '09:05', depositId: '12' });
    expect(schema.parse({ transactionType: '' }).transactionType).toBeUndefined();
    expect(schema.safeParse({ transactionType: 'چیز دیگر' }).success).toBe(false);
    expect(schema.safeParse({ transactionTime: '24:01' }).success).toBe(false);
  });
});

describe('Sheba as people actually type or paste it', () => {
  const base = 'IR062960000000100324200001';
  const groups = (value: string, separator: string) => value.match(/.{1,4}/g)!.join(separator);
  const persian = (value: string) => value.replace(/[0-9]/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)));
  const normalize = (value: string) => normalizeSheba(toAsciiDigits(value));

  it.each([
    ['spaces', groups(base, ' ')],
    ['dashes', groups(base, '-')],
    ['slashes', groups(base, '/')],
    ['no-break spaces', groups(base, '\u00A0')],
    ['lowercase', base.toLowerCase()],
    ['Persian digits', 'IR' + persian(base.slice(2))],
    ['no IR prefix', base.slice(2)],
    ['RLM/LRM marks around it', '\u200F' + base + '\u200E'],
    ['direction marks between groups', groups(base, '\u200E ')],
    ['a ZWNJ inside', base.slice(0, 10) + '\u200C' + base.slice(10)],
    ['a trailing newline', base + '\n'],
  ])('accepts %s', (_label, typed) => {
    expect(isValidSheba(normalize(typed))).toBe(true);
  });

  it('tells a wrong shape from a wrong check digit', () => {
    expect(shebaProblem(normalize(base))).toBeNull();
    expect(shebaProblem(normalize(base.slice(0, 20)))).toContain('۲۴ رقم');
    expect(shebaProblem(normalize('IR000000000000000000000000'))).toContain('رقم کنترلی');
  });
});
