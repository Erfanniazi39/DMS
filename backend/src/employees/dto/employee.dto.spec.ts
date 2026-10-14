import { createEmployeeContractSchema, createEmployeeSchema, terminateEmployeeSchema, updateEmployeeSchema } from './employee.dto';

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
    expect(updateEmployeeSchema.safeParse({ ...validEmployee, status: 'active', code: 'IT-0007' }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse(validEmployee).success).toBe(false);
  });
});

describe('education rules', () => {
  const update = { ...validEmployee, status: 'active', code: 'IT-0007' };

  it('under_diploma needs only the grade and drops the field of study', () => {
    expect(updateEmployeeSchema.safeParse({ ...update, educationLevel: 'under_diploma' }).success).toBe(false);
    const ok = updateEmployeeSchema.safeParse({ ...update, educationLevel: 'under_diploma', belowDiplomaGrade: 'نهم', fieldOfStudy: 'برق' });
    expect(ok.success).toBe(true);
    if (ok.success) expect([ok.data.belowDiplomaGrade, ok.data.fieldOfStudy]).toEqual(['نهم', null]);
  });

  it('diploma has neither grade nor field; associate and above keep an optional field', () => {
    const diploma = updateEmployeeSchema.safeParse({ ...update, educationLevel: 'diploma', belowDiplomaGrade: 'نهم', fieldOfStudy: 'برق' });
    expect(diploma.success && [diploma.data.belowDiplomaGrade, diploma.data.fieldOfStudy]).toEqual([null, null]);
    const bachelor = createEmployeeSchema.safeParse({ ...validEmployee, educationLevel: 'bachelor', fieldOfStudy: 'حسابداری' });
    expect(bachelor.success && [bachelor.data.belowDiplomaGrade, bachelor.data.fieldOfStudy]).toEqual([null, 'حسابداری']);
    const bare = createEmployeeSchema.safeParse({ ...validEmployee, educationLevel: 'master' });
    expect(bare.success && bare.data.fieldOfStudy).toBeNull();
  });
});

describe('contract + termination schemas', () => {
  it('a temporary contract needs an end date no earlier than the start; a permanent one never keeps an end date', () => {
    expect(createEmployeeContractSchema.safeParse({ contractType: 'temporary', startDate: '2024-01-01' }).success).toBe(false);
    expect(createEmployeeContractSchema.safeParse({ contractType: 'temporary', startDate: '2024-02-01', endDate: '2024-01-01' }).success).toBe(false);
    expect(createEmployeeContractSchema.safeParse({ contractType: 'fixed_task', startDate: '2024-01-01', endDate: '2024-03-01' }).success).toBe(true);
    const permanent = createEmployeeContractSchema.safeParse({ contractType: 'permanent', startDate: '2024-01-01', endDate: '2030-01-01' });
    expect(permanent.success && (permanent.data as { endDate: Date | null }).endDate).toBeNull();
  });

  it('the initial contract on create follows the same rules', () => {
    expect(createEmployeeSchema.safeParse({ ...validEmployee, contractType: 'temporary', contractStartDate: '2024-01-01' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...validEmployee, contractType: 'permanent', contractStartDate: '2024-01-01' }).success).toBe(true);
    expect(createEmployeeSchema.safeParse({ ...validEmployee, contractType: 'permanent' }).success).toBe(false);
  });

  it('termination needs a date, a type and a written reason', () => {
    const ok = { terminationDate: '2025-06-01', terminationType: 'fired', terminationReason: 'غیبت مکرر' };
    expect(terminateEmployeeSchema.safeParse(ok).success).toBe(true);
    expect(terminateEmployeeSchema.safeParse({ ...ok, terminationReason: '  ' }).success).toBe(false);
    expect(terminateEmployeeSchema.safeParse({ ...ok, terminationType: 'vacation' }).success).toBe(false);
    expect(terminateEmployeeSchema.safeParse({ ...ok, terminationDate: '' }).success).toBe(false);
  });
});

describe('employee code on update', () => {
  const base = { ...validEmployee, status: 'active' };
  it('is required and limited to Latin letters, digits, dash and underscore', () => {
    expect(updateEmployeeSchema.safeParse(base).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ ...base, code: ' IT-0100 ' }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse({ ...base, code: 'کد' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ ...base, code: 'A' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ ...base, code: 'IT 0100' }).success).toBe(false);
  });
});
