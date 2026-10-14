import { createSupplierSchema, supplierBankAccountSchema, updateSupplierSchema } from './supplier.dto';

// Pins the Supplier DTO's validation (party master data, 2026-10-13).

const org = { code: 'SUP-1', name: 'تأمین‌کننده نمونه', supplierKind: 'ORGANIZATION', nationalId: '10101234567', economicCode: '411234567890' };
const person = { code: 'SUP-2', name: 'علی', supplierKind: 'INDIVIDUAL', nationalId: '0010350829' };

describe('createSupplierSchema', () => {
  it('accepts a valid organization and a valid individual', () => {
    expect(createSupplierSchema.safeParse(org).success).toBe(true);
    expect(createSupplierSchema.safeParse(person).success).toBe(true);
  });

  it('turns blank optional strings into undefined and trims the rest', () => {
    const result = createSupplierSchema.safeParse({ ...org, phone: '  ', email: '', address: '', title: '  شرکت  ', website: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeUndefined();
      expect(result.data.email).toBeUndefined();
      expect(result.data.address).toBeUndefined();
      expect(result.data.title).toBe('شرکت');
    }
  });

  it('requires supplierKind and the identity for an active supplier', () => {
    expect(createSupplierSchema.safeParse({ ...org, supplierKind: undefined }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...org, economicCode: undefined }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...org, nationalId: '1234567890' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...person, nationalId: '0010350828' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...person, nationalId: undefined }).success).toBe(false);
  });

  it('exempts a foreign supplier from the Iranian identifier and postal-code formats', () => {
    expect(createSupplierSchema.safeParse({ code: 'F-1', name: 'Foreign', supplierKind: 'ORGANIZATION', country: 'ترکیه', postalCode: 'SW1A 1AA' }).success).toBe(true);
    expect(createSupplierSchema.safeParse({ ...org, postalCode: 'SW1A 1AA' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...org, postalCode: '۱۲۳۴۵۶۷۸۹۰' }).success).toBe(true);
  });

  it('rejects invalid email and phone, accepts Persian digits', () => {
    expect(createSupplierSchema.safeParse({ ...org, email: 'nope' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...org, phone: '123' }).success).toBe(false);
    expect(createSupplierSchema.parse({ ...org, phone: '۰۲۱۱۲۳۴۵۶۷۸', mobile: '09121234567', fax: '02188888888' }).phone).toBe('02112345678');
  });

  it('rejects an over-long optional text field', () => {
    expect(createSupplierSchema.safeParse({ ...org, note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accepts the new party fields and an optional first bank account (needs a number or Sheba)', () => {
    const parsed = createSupplierSchema.parse({
      ...org,
      registrationNumber: '12345',
      address2: 'طبقه دوم',
      cityCode: '021',
      locationName: 'انبار',
      taxOfficeProvince: 'تهران',
      firstBankAccount: { bankName: 'ملی', shebaNumber: '062960000000100324200001' },
    });
    expect(parsed.firstBankAccount?.shebaNumber).toBe('IR062960000000100324200001');
    expect(createSupplierSchema.safeParse({ ...org, firstBankAccount: { bankName: 'ملی' } }).success).toBe(false);
  });

  it('no longer accepts the legacy bank fields (stripped)', () => {
    const parsed = createSupplierSchema.parse({ ...org, bankName: 'x', bankAccountNumber: '1', bankShebaNumber: 'y' });
    expect(parsed).not.toHaveProperty('bankName');
    expect(parsed).not.toHaveProperty('bankShebaNumber');
  });
});

describe('updateSupplierSchema', () => {
  it('requires a valid status', () => {
    expect(updateSupplierSchema.safeParse({ ...org, status: 'blacklisted' }).success).toBe(true);
    expect(updateSupplierSchema.safeParse({ ...org, status: 'unknown' }).success).toBe(false);
  });

  it('enforces identity only while the status is active (old records can still be deactivated)', () => {
    const bare = { code: 'OLD-1', name: 'قدیمی' };
    expect(updateSupplierSchema.safeParse({ ...bare, status: 'active' }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ ...bare, status: 'inactive' }).success).toBe(true);
    expect(updateSupplierSchema.safeParse({ ...bare, status: 'blacklisted' }).success).toBe(true);
  });
});

describe('supplierBankAccountSchema', () => {
  it('needs an account number or Sheba; Sheba is normalized and checksummed', () => {
    expect(supplierBankAccountSchema.safeParse({ bankName: 'ملت' }).success).toBe(false);
    expect(supplierBankAccountSchema.parse({ accountNumber: '۱۲۳۴' }).accountNumber).toBe('1234');
    expect(supplierBankAccountSchema.safeParse({ shebaNumber: 'IR062960000000100324200002' }).success).toBe(false);
    expect(supplierBankAccountSchema.parse({ accountNumber: '1' })).toMatchObject({ isDefault: false, isActive: true });
  });
});
