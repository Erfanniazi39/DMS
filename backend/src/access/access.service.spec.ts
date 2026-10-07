import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccessService, PERMISSION_CATALOG } from './access.service';

// Covers the Users & Access module: role CRUD, the permission-catalog
// allowlist (a permission code must exist in PERMISSION_CATALOG before it
// can be attached to a role or a user — see access.service.ts's own
// comment and CLAUDE.md's stack-convention rule), and effective-permission
// derivation for a user (role permissions + per-user additional
// permissions, de-duplicated).

function createPrismaMock() {
  const mock = {
    role: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    permission: { findMany: jest.fn() },
    rolePermission: { deleteMany: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    userPermission: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  // updateRole() runs its delete+recreate inside a $transaction — same
  // convention as employees.service.spec.ts / purchases.service.spec.ts.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

describe('AccessService', () => {
  it('rejects creating a role that already exists by name', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue({ id: 1, name: 'ADMIN' });

    await expect(service.createRole('ADMIN', [])).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).role.create).not.toHaveBeenCalled();
  });

  it('rejects a permission code that is not in PERMISSION_CATALOG', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue(null);

    // (Was 'inventory.view' until that became a real permission in Sales
    // batch 1 — 'products.manage' is still a phantom code.)
    await expect(service.createRole('MANAGER', ['products.manage'])).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).permission.findMany).not.toHaveBeenCalled();
    expect((prisma as any).role.create).not.toHaveBeenCalled();
  });

  it('creates a role with only catalog-listed permissions', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue(null);
    (prisma as any).permission.findMany.mockResolvedValue([{ id: 5, name: 'purchases.manage' }]);
    (prisma as any).role.create.mockResolvedValue({ id: 2, name: 'MANAGER' });

    await service.createRole('MANAGER', ['purchases.manage']);

    expect((prisma as any).role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'MANAGER',
          permissions: { create: [{ permissionId: 5 }] },
        }),
      }),
    );
  });

  it('de-duplicates repeated permission codes before validating them against the catalog', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue(null);
    (prisma as any).permission.findMany.mockResolvedValue([{ id: 5, name: 'purchases.manage' }]);
    (prisma as any).role.create.mockResolvedValue({ id: 2, name: 'MANAGER' });

    await service.createRole('MANAGER', ['purchases.manage', 'purchases.manage']);

    expect((prisma as any).permission.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['purchases.manage'] } },
    });
  });

  it('rejects updating a role that does not exist', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue(null);

    await expect(service.updateRole(999, [])).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as any).rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces a role\'s permission set (delete-all then recreate) inside a single transaction', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).role.findUnique.mockResolvedValue({ id: 3, name: 'MANAGER' });
    (prisma as any).permission.findMany.mockResolvedValue([{ id: 7, name: 'reports.view' }]);
    (prisma as any).role.update.mockResolvedValue({ id: 3, name: 'MANAGER' });

    await service.updateRole(3, ['reports.view']);

    expect((prisma as any).rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 3 } });
    expect((prisma as any).role.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: { permissions: { create: [{ permissionId: 7 }] } } }),
    );
  });

  it('rejects setting permissions on a user that does not exist', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).user.findUnique.mockResolvedValue(null);

    await expect(service.setUserPermissions(999, [])).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as any).userPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('derives a user\'s effective permissions as the de-duplicated union of role permissions and per-user extra permissions', async () => {
    const prisma = createPrismaMock();
    const service = new AccessService(prisma as never);
    (prisma as any).user.findMany.mockResolvedValue([
      {
        id: 1,
        username: 'alishniazi',
        email: 'a@example.com',
        role: {
          name: 'MANAGER',
          permissions: [
            { permission: { name: 'purchases.manage' } },
            { permission: { name: 'reports.view' } },
          ],
        },
        permissions: [
          { permission: { name: 'reports.view' } }, // overlaps a role permission
          { permission: { name: 'suppliers.manage' } },
        ],
      },
    ]);

    const result = await service.listUserPermissions();

    expect(result).toEqual([
      {
        id: 1,
        username: 'alishniazi',
        email: 'a@example.com',
        role: 'MANAGER',
        rolePermissions: ['purchases.manage', 'reports.view'],
        additionalPermissions: ['reports.view', 'suppliers.manage'],
        effectivePermissions: ['purchases.manage', 'reports.view', 'suppliers.manage'],
      },
    ]);
  });

  it('every permission code referenced by PERMISSION_CATALOG is unique', () => {
    const codes = PERMISSION_CATALOG.map((permission) => permission.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
