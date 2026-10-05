import { createEmployeeSchema, updateEmployeeSchema } from './employee.dto';

// Characterization tests — pin the current validation behavior of the
// Employee DTO (blank optional fields → undefined, regex/format checks, the
// deliberately loose `z.coerce.date()` on optional contract dates) so
// refactors of shared helpers can't silently change it.

const validEmployee = {
  firstName: 'علی',
  lastName: 'رضایی',
  departmentId: 1,
  nationalId: '0012345678',
  mobilePhone: '09120000000',
  birthDate: '1990-01-01',
  hireDate: '2020-01-01',
};

describe('createEmployeeSchema', () => {
  it('accepts a minimal valid employee', () => {
    const result = createEmployeeSchema.safeParse(validEmployee);
    expect(result.success).toBe(true);
  });

  it('turns blank optional strings into undefined and trims the rest', () => {
    const result = createEmployeeSchema.safeParse({
      ...validEmployee,
      email: '   ',
      note: '',
      landlinePhone: '',
      address: '  تهران  ',
      contractStartDate: '',
      fatherName: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.note).toBeUndefined();
      expect(result.data.landlinePhone).toBeUndefined();
      expect(result.data.contractStartDate).toBeUndefined();
      expect(result.data.fatherName).toBeUndefined();
      expect(result.data.address).toBe('تهران');
    }
  });

  it('rejects an invalid email, mobile phone, and national ID', () => {
    expect(createEmployeeSchema.safeParse({ ...validEmployee, email: 'not-an-email' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...validEmployee, mobilePhone: '0912' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...validEmployee, nationalId: '12345' }).success).toBe(false);
  });

  it('rejects an over-long optional text field', () => {
    expect(createEmployeeSchema.safeParse({ ...validEmployee, note: 'x'.repeat(1001) }).success).toBe(false);
  });

  // Optional contract dates use loose z.coerce.date(): anything Date-coercible
  // passes (including a number), only unparseable input is rejected. This is
  // intentionally looser than common/zod-fields.ts's optionalDate().
  it('coerces optional contract dates loosely', () => {
    const fromString = createEmployeeSchema.safeParse({ ...validEmployee, contractStartDate: '2024-01-01' });
    expect(fromString.success).toBe(true);
    if (fromString.success) expect(fromString.data.contractStartDate).toEqual(new Date('2024-01-01'));

    const fromNumber = createEmployeeSchema.safeParse({ ...validEmployee, contractStartDate: 0 });
    expect(fromNumber.success).toBe(true);
    if (fromNumber.success) expect(fromNumber.data.contractStartDate).toEqual(new Date(0));

    expect(createEmployeeSchema.safeParse({ ...validEmployee, contractStartDate: 'not-a-date' }).success).toBe(false);
  });

  it('rejects a contract end date before its start date', () => {
    const result = createEmployeeSchema.safeParse({ ...validEmployee, contractStartDate: '2024-02-01', contractEndDate: '2024-01-01' });
    expect(result.success).toBe(false);
  });
});

describe('updateEmployeeSchema', () => {
  it('requires a valid status', () => {
    expect(updateEmployeeSchema.safeParse({ ...validEmployee, status: 'active' }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse(validEmployee).success).toBe(false);
  });
});
