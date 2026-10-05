import { updateUserSchema } from './update-user.dto';

// Characterization tests — pin the update-user DTO's current validation so
// shared-helper refactors can't silently change it.

describe('updateUserSchema', () => {
  it('accepts a partial update', () => {
    expect(updateUserSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
  });

  it('turns blank email/phone into undefined', () => {
    const result = updateUserSchema.safeParse({ username: 'test-user', email: '  ', phone: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
    }
  });

  it('rejects invalid email and phone formats', () => {
    expect(updateUserSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ phone: '0912000000' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ phone: '09120000000' }).success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });
});
