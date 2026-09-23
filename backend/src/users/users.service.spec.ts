import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    role: { findUnique: jest.fn() },
  } as never;
}

describe('UsersService', () => {
  it('creates a user without referencing or creating an employee', async () => {
    const prisma = createPrismaMock();
    const service = new UsersService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue(null);
    (prisma as any).role.findUnique.mockResolvedValue({ id: 1, name: 'VIEWER' });
    (prisma as any).user.create.mockResolvedValue({
      id: 5,
      username: 'newuser',
      email: null,
      phone: null,
      status: 'ACTIVE',
      role: { name: 'VIEWER' },
    });

    const result = await service.create({
      username: 'newuser',
      password: '12345678',
      roleName: 'VIEWER',
      status: 'ACTIVE',
    } as never);

    expect(result).toEqual({ id: 5, username: 'newuser', email: null, phone: null, role: 'VIEWER', status: 'ACTIVE' });
    const createArgs = (prisma as any).user.create.mock.calls[0][0];
    expect(createArgs.data).not.toHaveProperty('employeeId');
    expect(createArgs.data).not.toHaveProperty('employee');
  });

  it('rejects a duplicate username without creating a user', async () => {
    const prisma = createPrismaMock();
    const service = new UsersService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.create({ username: 'existing', password: '12345678', roleName: 'VIEWER', status: 'ACTIVE' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).user.create).not.toHaveBeenCalled();
  });

  it('lists users without any employee data', async () => {
    const prisma = createPrismaMock();
    const service = new UsersService(prisma as never);
    (prisma as any).user.findMany.mockResolvedValue([
      {
        id: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: { name: 'ADMIN' },
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        lastLoginAt: null,
      },
    ]);

    const result = await service.list();
    expect(result[0]).not.toHaveProperty('employee');
    expect(result[0]).toMatchObject({ id: 1, username: 'admin', role: 'ADMIN' });
  });
});
