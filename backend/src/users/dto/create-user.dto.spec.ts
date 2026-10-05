import { createUserSchema } from './create-user.dto';

describe('createUserSchema', () => {
  it('creates a user from account fields alone, with no employee or department reference', () => {
    const result = createUserSchema.safeParse({
      username: 'test-user',
      password: '12345678',
      roleName: 'VIEWER',
      email: 'test@example.com',
      phone: '09120000000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('employeeId');
      expect(result.data).not.toHaveProperty('departmentId');
      expect(result.data.status).toBe('ACTIVE');
    }
  });

  it('does not require email or phone', () => {
    const result = createUserSchema.safeParse({
      username: 'test-user',
      password: '12345678',
      roleName: 'VIEWER',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = createUserSchema.safeParse({
      username: 'test-user',
      password: '12345678',
      roleName: 'VIEWER',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an explicit account status', () => {
    const result = createUserSchema.safeParse({
      username: 'test-user',
      password: '12345678',
      roleName: 'VIEWER',
      status: 'DISABLED',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('DISABLED');
  });

  it('treats blank email/phone as not provided', () => {
    const result = createUserSchema.safeParse({
      username: 'test-user',
      password: '12345678',
      roleName: 'VIEWER',
      email: '   ',
      phone: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
    }
  });
});
