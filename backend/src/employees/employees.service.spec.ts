import { ConflictException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

function createPrismaMock() {
  const mock = {
    employee: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    department: { findUnique: jest.fn() },
  };
  // create() runs inside a $transaction — the mock just invokes the
  // callback with itself, so the same jest.fn() mocks above are used.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

describe('EmployeesService', () => {
  it('creates an employee and generates its code from the department', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findFirst.mockResolvedValue(null);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2, code: 'IT', status: 'active' });
    (prisma as any).employee.create.mockResolvedValue({ id: 3, departmentId: 2 });
    (prisma as any).employee.update.mockResolvedValue({ id: 3, departmentId: 2, code: 'IT-0003' });

    await expect(
      service.create({ firstName: 'رضا', lastName: 'محمدی', departmentId: 2, mobilePhone: '09121234567' } as never),
    ).resolves.toEqual({ id: 3, departmentId: 2, code: 'IT-0003' });
    expect((prisma as any).employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: { code: 'IT-0003' } }),
    );
  });

  it('rejects an inactive department', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findFirst.mockResolvedValue(null);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2, code: 'IT', status: 'inactive' });

    await expect(
      service.create({ firstName: 'رضا', lastName: 'محمدی', departmentId: 2, mobilePhone: '09121234567' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).employee.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate national ID', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.nationalId ? { id: 99 } : null),
    );
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2, code: 'IT', status: 'active' });

    await expect(
      service.create({ firstName: 'سارا', lastName: 'احمدی', departmentId: 2, mobilePhone: '09121234567', nationalId: '1234567890' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).employee.create).not.toHaveBeenCalled();
  });

  it('updates an employee department without changing its already-generated code', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, departmentId: 2, code: 'IT-0003' });
    (prisma as any).employee.findFirst.mockResolvedValue(null);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 4, code: 'SALES', status: 'active' });
    (prisma as any).employee.update.mockResolvedValue({ id: 3, departmentId: 4, code: 'IT-0003' });

    await expect(
      service.update(3, { firstName: 'رضا', lastName: 'محمدی', departmentId: 4, mobilePhone: '09121234567', status: 'active' } as never),
    ).resolves.toEqual({ id: 3, departmentId: 4, code: 'IT-0003' });
    const updateCallArgs = (prisma as any).employee.update.mock.calls[0][0];
    expect(updateCallArgs.where).toEqual({ id: 3 });
    expect(updateCallArgs.data.departmentId).toBe(4);
    // "code" must never be part of an update payload — it is fixed at creation.
    expect(updateCallArgs.data.code).toBeUndefined();
  });

  it('sets the employee photo path', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, photoPath: null });
    (prisma as any).employee.update.mockResolvedValue({ id: 3, photoPath: '/uploads/employees/new.jpg' });

    await expect(service.updatePhoto(3, '/uploads/employees/new.jpg')).resolves.toEqual({ id: 3, photoPath: '/uploads/employees/new.jpg' });
    expect((prisma as any).employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: { photoPath: '/uploads/employees/new.jpg' } }),
    );
  });

  it('clears the employee photo path', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, photoPath: '/uploads/employees/old.jpg' });
    (prisma as any).employee.update.mockResolvedValue({ id: 3, photoPath: null });

    await expect(service.updatePhoto(3, null)).resolves.toEqual({ id: 3, photoPath: null });
  });
});
