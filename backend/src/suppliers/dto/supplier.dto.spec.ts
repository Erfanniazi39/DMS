import { createSupplierSchema, updateSupplierSchema } from './supplier.dto';

// Characterization tests — pin the Supplier DTO's current validation so
// shared-helper refactors can't silently change it.

const validSupplier = { code: 'SUP-1', name: 'تأمین‌کننده نمونه' };

describe('createSupplierSchema', () => {
  it('accepts a minimal valid supplier', () => {
    expect(createSupplierSchema.safeParse(validSupplier).success).toBe(true);
  });

  it('turns blank optional strings into undefined and trims the rest', () => {
    const result = createSupplierSchema.safeParse({
      ...validSupplier,
      nationalId: '',
      phone: '  ',
      email: '',
      address: '',
      bankName: '  بانک ملت  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nationalId).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
      expect(result.data.email).toBeUndefined();
      expect(result.data.address).toBeUndefined();
      expect(result.data.bankName).toBe('بانک ملت');
    }
  });

  it('rejects invalid email, phone, and national ID formats', () => {
    expect(createSupplierSchema.safeParse({ ...validSupplier, email: 'nope' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...validSupplier, phone: '123' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...validSupplier, nationalId: '123456789' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...validSupplier, nationalId: '12345678901' }).success).toBe(true);
  });

  it('rejects an over-long optional text field', () => {
    expect(createSupplierSchema.safeParse({ ...validSupplier, note: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('updateSupplierSchema', () => {
  it('requires a valid status', () => {
    expect(updateSupplierSchema.safeParse({ ...validSupplier, status: 'blacklisted' }).success).toBe(true);
    expect(updateSupplierSchema.safeParse({ ...validSupplier, status: 'unknown' }).success).toBe(false);
  });
});
