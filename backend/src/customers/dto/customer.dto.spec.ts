import { createCustomerSchema } from './customer.dto';

// Characterization tests — pin the Customer DTO's current validation so
// shared-helper refactors can't silently change it.

const validCustomer = { code: 'CUS-1', name: 'مشتری نمونه', customerType: 'retail', phone: '02112345678' };

describe('createCustomerSchema', () => {
  it('accepts a minimal valid customer', () => {
    expect(createCustomerSchema.safeParse(validCustomer).success).toBe(true);
  });

  it('turns blank optional strings into undefined and trims the rest', () => {
    const result = createCustomerSchema.safeParse({ ...validCustomer, email: '  ', address: '', note: '  یادداشت  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.address).toBeUndefined();
      expect(result.data.note).toBe('یادداشت');
    }
  });

  it('rejects an invalid email, a malformed phone, and a missing phone', () => {
    expect(createCustomerSchema.safeParse({ ...validCustomer, email: 'nope' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validCustomer, phone: '12a45' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validCustomer, phone: '' }).success).toBe(false);
  });

  it('rejects an unknown customer type and an over-long note', () => {
    expect(createCustomerSchema.safeParse({ ...validCustomer, customerType: 'vip' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ ...validCustomer, note: 'x'.repeat(501) }).success).toBe(false);
  });
});
