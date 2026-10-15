import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

function createPrismaMock() {
  return {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    role: { findUnique: jest.fn() },
  } as never;
}

describe('UsersService', () => {
  it('creates a user without referencing or creating an employee', async () => {
    const prisma = createPrismaMock();
    const service = new UsersService(prisma as never, { log: jest.fn() } as never);
    (prisma as any).user.findFirst.mockResolvedValue(null);
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
    const service = new UsersService(prisma as never, { log: jest.fn() } as never);
    (prisma as any).user.findFirst.mockResolvedValue({ id: 1 });

    await expect(
      service.create({ username: 'existing', password: '12345678', roleName: 'VIEWER', status: 'ACTIVE' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).user.create).not.toHaveBeenCalled();
  });

  it('lists users without any employee data', async () => {
    const prisma = createPrismaMock();
    const service = new UsersService(prisma as never, { log: jest.fn() } as never);
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
  describe('editing administrator accounts', () => {
    const adminRow = { id: 1, username: 'admin', status: 'ACTIVE', role: { name: 'ADMIN' } };
    const updatedRow = { ...adminRow, fullName: null, email: null, phone: null };

    it('lets an admin edit another admin account', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue({ ...adminRow, id: 2, username: 'second' });
      (prisma as any).user.update.mockResolvedValue({ ...updatedRow, id: 2, username: 'second', email: 'a@b.c' });

      await expect(service.update(2, { email: 'a@b.c' } as never, 1)).resolves.toMatchObject({ id: 2, role: 'ADMIN' });
    });

    it('refuses to demote or disable the last active admin', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue(adminRow);
      (prisma as any).user.count.mockResolvedValue(0);

      await expect(service.update(1, { status: 'DISABLED' } as never, 9)).rejects.toBeInstanceOf(ConflictException);
      (prisma as any).role.findUnique.mockResolvedValue({ id: 3, name: 'VIEWER' });
      await expect(service.update(1, { roleName: 'VIEWER' } as never, 9)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).user.update).not.toHaveBeenCalled();
    });

    it('allows demoting an admin while another active admin remains', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue(adminRow);
      (prisma as any).user.count.mockResolvedValue(1);
      (prisma as any).role.findUnique.mockResolvedValue({ id: 3, name: 'VIEWER' });
      (prisma as any).user.update.mockResolvedValue({ ...updatedRow, role: { name: 'VIEWER' } });

      await expect(service.update(1, { roleName: 'VIEWER' } as never, 9)).resolves.toMatchObject({ role: 'VIEWER' });
    });

    it('refuses to let a user disable their own account', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue({ id: 5, username: 'x', status: 'ACTIVE', role: { name: 'VIEWER' } });

      await expect(service.update(5, { status: 'LOCKED' } as never, 5)).rejects.toBeInstanceOf(ConflictException);
    });
  });
  describe('case-insensitive usernames', () => {
    it('treats «Ali» and «ali» as the same username when creating', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findFirst.mockResolvedValue({ id: 3, username: 'ali' });

      await expect(service.create({ username: 'Ali', password: '12345678', roleName: 'VIEWER', status: 'ACTIVE' } as never)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).user.findFirst.mock.calls[0][0].where.username).toEqual({ equals: 'Ali', mode: 'insensitive' });
    });

    it('lets a user change only the letter case of their own username, but not take another account\'s', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue({ id: 5, username: 'ali', status: 'ACTIVE', role: { name: 'VIEWER' } });
      (prisma as any).user.findFirst.mockResolvedValue(null);
      (prisma as any).user.update.mockResolvedValue({ id: 5, username: 'Ali', status: 'ACTIVE', role: { name: 'VIEWER' } });
      await service.update(5, { username: 'Ali' } as never, 1);
      expect((prisma as any).user.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: 5 });

      (prisma as any).user.findFirst.mockResolvedValue({ id: 6 });
      await expect(service.update(5, { username: 'BOB' } as never, 1)).rejects.toBeInstanceOf(ConflictException);
    });
  });
  describe('ending sessions (security review H1)', () => {
    const viewer = { id: 5, username: 'x', status: 'ACTIVE', role: { name: 'VIEWER' } };
    const updated = { ...viewer, fullName: null, email: null, phone: null };

    it('deletes the stored sessions of a user that is disabled or locked', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue(viewer);
      (prisma as any).user.update.mockResolvedValue({ ...updated, status: 'DISABLED' });
      await service.update(5, { status: 'DISABLED' } as never, 1, '1.1.1.1', 'admin-sid');
      expect((prisma as any).$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('deletes the sessions after a password change, but keeps the admin\'s own current session when they change their own', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue(viewer);
      (prisma as any).user.update.mockResolvedValue(updated);
      await service.update(5, { password: 'Another#Pass2026' } as never, 1, undefined, 'admin-sid');
      expect((prisma as any).$executeRaw.mock.calls[0].slice(1)).toEqual([[5], '']);
      await service.update(5, { password: 'Another#Pass2026' } as never, 5, undefined, 'my-sid');
      expect((prisma as any).$executeRaw.mock.calls[1].slice(1)).toEqual([[5], 'my-sid']);
    });

    it('leaves sessions alone for an ordinary edit', async () => {
      const prisma = createPrismaMock();
      const service = new UsersService(prisma as never, { log: jest.fn() } as never);
      (prisma as any).user.findUnique.mockResolvedValue(viewer);
      (prisma as any).user.update.mockResolvedValue({ ...updated, email: 'a@b.c' });
      await service.update(5, { email: 'a@b.c' } as never, 1);
      expect((prisma as any).$executeRaw).not.toHaveBeenCalled();
    });
  });
});
