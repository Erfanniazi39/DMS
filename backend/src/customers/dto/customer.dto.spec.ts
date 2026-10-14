import {
  changeCustomerStatusSchema,
  createCustomerComplaintSchema,
  createCustomerSchema,
  customerAddressSchema,
  customerBankAccountSchema,
  customerDocumentSchema,
  customerListQuerySchema,
  updateCustomerFinancialSchema,
  updateCustomerSchema,
} from './customer.dto';

// Pins the Customer DTOs' validation (2026-10-06 rewrite).

const valid = { customerKind: 'ORGANIZATION', name: 'شرکت نمونه', phone: '02112345678', customerGroupId: 1, nationalId: '10101010101', economicCode: '411234567890' };
const individual = { ...valid, customerKind: 'INDIVIDUAL', nationalId: '0010350829', economicCode: undefined };
const VERSION = '2026-01-01T10:00:00.000Z';

describe('createCustomerSchema', () => {
  it('accepts a minimal valid customer and turns blank optionals into undefined', () => {
    const result = createCustomerSchema.safeParse({ ...valid, email: '  ', legalName: '', territoryId: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.legalName).toBeUndefined();
      expect(result.data.territoryId).toBeUndefined();
    }
  });

  it('never accepts a client-supplied customerNumber or legacy code (stripped)', () => {
    const result = createCustomerSchema.parse({ ...valid, customerNumber: 'CUS-999999', legacyCode: 'X' });
    expect(result).not.toHaveProperty('customerNumber');
    expect(result).not.toHaveProperty('legacyCode');
  });

  it('identity: organization needs 11-digit شناسه ملی + 12/14-digit کد اقتصادی', () => {
    expect(createCustomerSchema.safeParse(valid).success).toBe(true);
    expect(createCustomerSchema.safeParse({ ...valid, nationalId: '0010350829' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, nationalId: undefined }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, economicCode: undefined }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, economicCode: '12345' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, nationalId: '1010101010a' }).success).toBe(false);
  });

  it('identity: individual needs a valid کد ملی (check digit); economic code optional', () => {
    expect(createCustomerSchema.safeParse(individual).success).toBe(true);
    expect(createCustomerSchema.safeParse({ ...individual, nationalId: '0010350828' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...individual, nationalId: '10101010101' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...individual, nationalId: undefined }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...individual, economicCode: '123' }).success).toBe(false);
  });

  it('Persian/Arabic digits in phone and nationalId are accepted and stored as ASCII', () => {
    const parsed = createCustomerSchema.parse({ ...individual, phone: '۰۲۱۱۲۳۴۵۶۷۸', nationalId: '٠٠١٠٣٥٠٨٢٩' });
    expect(parsed.phone).toBe('02112345678');
    expect(parsed.nationalId).toBe('0010350829');
  });

  it('accepts the new party fields', () => {
    const parsed = createCustomerSchema.parse({ ...valid, title: 'شرکت', registrationNumber: '۱۲۳۴۵', phone2: '02188888888', mobile: '09121234567', fax: '02177777777', website: 'example.com', taxOfficeProvince: 'تهران', taxOfficeCity: 'تهران' });
    expect(parsed).toMatchObject({ title: 'شرکت', registrationNumber: '12345', mobile: '09121234567', taxOfficeCity: 'تهران' });
  });

  it('rejects a missing/invalid phone, unknown kind, missing group and invalid email', () => {
    expect(createCustomerSchema.safeParse({ ...valid, phone: '' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, phone: '12a45' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, customerKind: 'retail' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, customerGroupId: undefined }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('accepts an optional first address/contact; a first address needs an address line', () => {
    expect(createCustomerSchema.safeParse({ ...valid, firstAddress: { addressType: 'DELIVERY', addressLine: 'تهران' }, firstContact: { name: 'علی' } }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ ...valid, firstAddress: { addressType: 'DELIVERY', addressLine: '' } }).success).toBe(false);
  });
});

describe('updateCustomerSchema', () => {
  it('requires updatedAt (optimistic lock)', () => {
    expect(updateCustomerSchema.safeParse(valid).success).toBe(false);
    expect(updateCustomerSchema.safeParse({ ...valid, updatedAt: VERSION }).success).toBe(true);
    // An old incomplete record is rejected on its next header edit.
    expect(updateCustomerSchema.safeParse({ ...valid, economicCode: undefined, updatedAt: VERSION }).success).toBe(false);
  });
});

describe('changeCustomerStatusSchema', () => {
  it('requires a reason for SUSPENDED and ARCHIVED only', () => {
    expect(changeCustomerStatusSchema.safeParse({ status: 'SUSPENDED', updatedAt: VERSION }).success).toBe(false);
    expect(changeCustomerStatusSchema.safeParse({ status: 'ARCHIVED', reason: '  ', updatedAt: VERSION }).success).toBe(false);
    expect(changeCustomerStatusSchema.safeParse({ status: 'ARCHIVED', reason: 'تعطیل شد', updatedAt: VERSION }).success).toBe(true);
    expect(changeCustomerStatusSchema.safeParse({ status: 'INACTIVE', updatedAt: VERSION }).success).toBe(true);
    expect(changeCustomerStatusSchema.safeParse({ status: 'INACTIVE' }).success).toBe(false);
  });
});

describe('customerListQuerySchema', () => {
  it('accepts ALL / a status / blanks, rejects unknown values', () => {
    expect(customerListQuerySchema.parse({ status: '' }).status).toBeUndefined();
    expect(customerListQuerySchema.parse({ status: 'ALL', customerGroupId: '2' })).toMatchObject({ status: 'ALL', customerGroupId: 2 });
    expect(customerListQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ customerGroupId: 'abc' }).success).toBe(false);
  });
});

describe('child schemas', () => {
  it('address: type required, defaults isDefault=false/isActive=true, postal code digits only (no 10-digit rule in the old test)', () => {
    expect(customerAddressSchema.parse({ addressType: 'BILLING', addressLine: 'x' })).toMatchObject({ isDefault: false, isActive: true });
    expect(customerAddressSchema.safeParse({ addressLine: 'x' }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ addressType: 'BILLING', addressLine: 'x', postalCode: '12-34' }).success).toBe(false);
  });

  it('address: postal code must be exactly 10 digits for Iran, any format for another country', () => {
    expect(customerAddressSchema.safeParse({ addressType: 'BILLING', addressLine: 'x', postalCode: '1234567890' }).success).toBe(true);
    expect(customerAddressSchema.safeParse({ addressType: 'BILLING', addressLine: 'x', postalCode: '12345' }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ addressType: 'BILLING', addressLine: 'x', postalCode: '12345', country: 'ترکیه' }).success).toBe(true);
    expect(customerAddressSchema.parse({ addressType: 'BILLING', addressLine: 'x', cityCode: '021', locationName: 'انبار' })).toMatchObject({ cityCode: '021', locationName: 'انبار' });
  });

  it('bank account: needs an account number or Sheba; Sheba is normalized and checksummed', () => {
    expect(customerBankAccountSchema.safeParse({ bankName: 'ملی' }).success).toBe(false);
    expect(customerBankAccountSchema.parse({ accountNumber: '۱۲۳۴۵' }).accountNumber).toBe('12345');
    expect(customerBankAccountSchema.parse({ shebaNumber: '062960000000100324200001' }).shebaNumber).toBe('IR062960000000100324200001');
    expect(customerBankAccountSchema.safeParse({ shebaNumber: 'IR062960000000100324200002' }).success).toBe(false);
  });

  it('complaint: date/category/description required; severity/status default MEDIUM/OPEN', () => {
    const parsed = createCustomerComplaintSchema.parse({ date: '2026-05-01', category: 'کیفیت', description: 'شرح' });
    expect(parsed).toMatchObject({ severity: 'MEDIUM', status: 'OPEN' });
    expect(createCustomerComplaintSchema.safeParse({ date: '2026-05-01', category: '', description: 'x' }).success).toBe(false);
    expect(createCustomerComplaintSchema.safeParse({ category: 'x', description: 'x' }).success).toBe(false);
  });

  it('financial: creditHold + updatedAt required; null clears optional fields; credit limit whole Rials >= 0', () => {
    const parsed = updateCustomerFinancialSchema.parse({ creditHold: false, paymentTermId: null, preferredPaymentMethod: null, creditLimit: null, updatedAt: VERSION });
    expect(parsed.paymentTermId).toBeUndefined();
    expect(parsed.preferredPaymentMethod).toBeUndefined();
    expect(parsed.creditLimit).toBeUndefined();
    expect(updateCustomerFinancialSchema.safeParse({ updatedAt: VERSION }).success).toBe(false);
    expect(updateCustomerFinancialSchema.safeParse({ creditHold: false, creditLimit: -1, updatedAt: VERSION }).success).toBe(false);
    expect(updateCustomerFinancialSchema.safeParse({ creditHold: false, creditLimit: 10.5, updatedAt: VERSION }).success).toBe(false);
    expect(updateCustomerFinancialSchema.safeParse({ creditHold: true, preferredPaymentMethod: 'BITCOIN', updatedAt: VERSION }).success).toBe(false);
  });
});

describe('create-form extras and document dates', () => {
  it('requires the first entry before a second address/bank account/contact', () => {
    const base = { ...valid };
    expect(createCustomerSchema.safeParse({ ...base, additionalContacts: [{ name: 'دوم' }] }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...base, firstContact: { name: 'اول' }, additionalContacts: [{ name: 'دوم' }] }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ ...base, firstContact: { name: 'اول' }, additionalContacts: Array.from({ length: 11 }, () => ({ name: 'x' })) }).success).toBe(false);
  });

  it('rejects a document whose expiry date is before its issue date', () => {
    const doc = { documentType: 'OTHER' };
    expect(customerDocumentSchema.safeParse({ ...doc, date: '2026-05-10', expiresAt: '2026-05-01' }).success).toBe(false);
    expect(customerDocumentSchema.safeParse({ ...doc, date: '2026-05-10', expiresAt: '2026-05-10' }).success).toBe(true);
    expect(customerDocumentSchema.safeParse({ ...doc, expiresAt: '2026-05-01' }).success).toBe(true);
  });
});
