import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

function createPrismaMock() {
  const mock = {
    employee: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    employeeContract: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) },
    department: { findUnique: jest.fn() },
  };
  // create() runs inside a $transaction — the mock just invokes the
  // callback with itself, so the same jest.fn() mocks above are used.
  (mock as any).$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mock));
  return mock;
}

describe('EmployeesService', () => {
  it('creates an employee, generates its code from the department and records the first contract', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findFirst.mockResolvedValue(null);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2, code: 'IT', status: 'active' });
    (prisma as any).employee.create.mockResolvedValue({ id: 3, departmentId: 2 });
    (prisma as any).employee.update.mockResolvedValue({});
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, departmentId: 2, code: 'IT-0003', hireDate: null, terminationDate: null, contracts: [] });

    const created = await service.create({
      firstName: 'رضا', lastName: 'محمدی', departmentId: 2, mobilePhone: '09121234567',
      contractType: 'temporary', contractStartDate: new Date('2024-01-01'), contractEndDate: new Date('2024-01-31'),
    } as never);

    expect(created).toEqual(expect.objectContaining({ id: 3, code: 'IT-0003', currentContract: null }));
    expect((prisma as any).employee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: { code: 'IT-0003' } }));
    // The single-contract fields never reach the employee row — they become the first history entry.
    expect((prisma as any).employee.create.mock.calls[0][0].data.contractType).toBeUndefined();
    expect((prisma as any).employeeContract.create).toHaveBeenCalledWith({ data: { employeeId: 3, contractType: 'temporary', startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31') } });
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
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, departmentId: 4, code: 'IT-0003', status: 'active', hireDate: null, terminationDate: null, contracts: [] });
    (prisma as any).employee.findFirst.mockResolvedValue(null);
    (prisma as any).department.findUnique.mockResolvedValue({ id: 4, code: 'SALES', status: 'active' });
    (prisma as any).employee.update.mockResolvedValue({});

    await expect(service.update(3, { firstName: 'رضا', lastName: 'محمدی', departmentId: 4, mobilePhone: '09121234567', status: 'active', code: 'IT-0003' } as never)).resolves.toEqual(expect.objectContaining({ id: 3, code: 'IT-0003' }));
    const updateCallArgs = (prisma as any).employee.update.mock.calls[0][0];
    expect(updateCallArgs.where).toEqual({ id: 3 });
    expect(updateCallArgs.data.departmentId).toBe(4);
    // An unchanged code is neither re-checked nor altered by a department move.
    expect(updateCallArgs.data.code).toBe('IT-0003');
    expect((prisma as any).employee.findFirst).not.toHaveBeenCalled();
  });

  it('lets the code be edited, but refuses one that another employee already has', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, departmentId: 2, code: 'IT-0003', status: 'active', hireDate: null, terminationDate: null, contracts: [] });
    (prisma as any).department.findUnique.mockResolvedValue({ id: 2, code: 'IT', status: 'active' });
    (prisma as any).employee.update.mockResolvedValue({});
    const dto = { firstName: 'رضا', lastName: 'محمدی', departmentId: 2, mobilePhone: '09121234567', status: 'active', code: 'IT-0100' } as never;

    (prisma as any).employee.findFirst.mockResolvedValue({ id: 8 });
    await expect(service.update(3, dto)).rejects.toBeInstanceOf(ConflictException);
    expect((prisma as any).employee.update).not.toHaveBeenCalled();

    (prisma as any).employee.findFirst.mockResolvedValue(null);
    await service.update(3, dto);
    expect((prisma as any).employee.update.mock.calls[0][0].data.code).toBe('IT-0100');
  });

  it('sets and clears the employee photo path', async () => {
    const prisma = createPrismaMock();
    const service = new EmployeesService(prisma as never);
    (prisma as any).employee.findUnique.mockResolvedValue({ id: 3, photoPath: null, hireDate: null, terminationDate: null, contracts: [] });
    (prisma as any).employee.update.mockResolvedValue({});

    await service.updatePhoto(3, '/uploads/employees/new.jpg');
    expect((prisma as any).employee.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { photoPath: '/uploads/employees/new.jpg' } });
    await service.updatePhoto(3, null);
    expect((prisma as any).employee.update).toHaveBeenLastCalledWith({ where: { id: 3 }, data: { photoPath: null } });
  });

  describe('termination', () => {
    const base = { id: 3, hireDate: new Date('2020-01-01'), terminationDate: null, contracts: [] };
    const dto = { terminationDate: new Date('2025-06-01'), terminationType: 'resigned', terminationReason: 'استعفا به دلیل مهاجرت' } as never;

    it('terminate() disables the employee and stores the date, type and reason', async () => {
      const prisma = createPrismaMock();
      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'active' });
      (prisma as any).employee.update.mockResolvedValue({});
      await new EmployeesService(prisma as never).terminate(3, dto);
      expect((prisma as any).employee.update).toHaveBeenCalledWith({
        where: { id: 3},
        data: { status: 'terminated', terminationDate: new Date('2025-06-01'), terminationType: 'resigned', terminationReason: 'استعفا به دلیل مهاجرت' },
      });
    });

    it('refuses to terminate twice, before the hire date, or to flip the status from the edit form', async () => {
      const prisma = createPrismaMock();
      const service = new EmployeesService(prisma as never);
      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'terminated' });
      await expect(service.terminate(3, dto)).rejects.toBeInstanceOf(ConflictException);

      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'active' });
      await expect(service.terminate(3, { ...(dto as object), terminationDate: new Date('2019-01-01') } as never)).rejects.toBeInstanceOf(BadRequestException);

      // update(): active → terminated is refused (it would skip the reason) …
      await expect(service.update(3, { status: 'terminated', departmentId: 1 } as never)).rejects.toBeInstanceOf(ConflictException);
      // … and so is terminated → active.
      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'terminated' });
      await expect(service.update(3, { status: 'active', departmentId: 1 } as never)).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).employee.update).not.toHaveBeenCalled();
    });

    it('reactivate() clears the termination record and only works on a terminated employee', async () => {
      const prisma = createPrismaMock();
      const service = new EmployeesService(prisma as never);
      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'active' });
      await expect(service.reactivate(3)).rejects.toBeInstanceOf(ConflictException);

      (prisma as any).employee.findUnique.mockResolvedValue({ ...base, status: 'terminated' });
      (prisma as any).employee.update.mockResolvedValue({});
      await service.reactivate(3);
      expect((prisma as any).employee.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'active', terminationDate: null, terminationType: null, terminationReason: null } });
    });
  });

  describe('contract history', () => {
    const employee = { id: 3, hireDate: null, terminationDate: null, contracts: [] };
    const dto = (start: string, end: string | null) => ({ contractType: 'temporary', startDate: new Date(start), endDate: end ? new Date(end) : null, note: undefined }) as never;

    it('adds an extension that starts right after the previous contract', async () => {
      const prisma = createPrismaMock();
      (prisma as any).employee.findUnique.mockResolvedValue(employee);
      (prisma as any).employeeContract.findMany.mockResolvedValue([{ id: 1, startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31') }]);
      await new EmployeesService(prisma as never).addContract(3, dto('2024-02-01', '2025-01-31'));
      expect((prisma as any).employeeContract.create).toHaveBeenCalledWith({ data: expect.objectContaining({ employeeId: 3, startDate: new Date('2024-02-01'), endDate: new Date('2025-01-31') }) });
    });

    it('refuses a contract that overlaps another one (it would double-count the tenure)', async () => {
      const prisma = createPrismaMock();
      (prisma as any).employee.findUnique.mockResolvedValue(employee);
      (prisma as any).employeeContract.findMany.mockResolvedValue([{ id: 1, startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31') }]);
      await expect(new EmployeesService(prisma as never).addContract(3, dto('2024-01-20', '2024-03-01'))).rejects.toBeInstanceOf(ConflictException);
      expect((prisma as any).employeeContract.create).not.toHaveBeenCalled();
    });

    it("404s another employee's contract on update / delete", async () => {
      const prisma = createPrismaMock();
      (prisma as any).employee.findUnique.mockResolvedValue(employee);
      (prisma as any).employeeContract.findFirst.mockResolvedValue(null);
      const service = new EmployeesService(prisma as never);
      await expect(service.updateContract(3, 99, dto('2024-01-01', '2024-02-01'))).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.removeContract(3, 99)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('get() exposes the current contract, its expiry and the tenure computed from the contracts', async () => {
      const prisma = createPrismaMock();
      (prisma as any).employee.findUnique.mockResolvedValue({
        id: 3, hireDate: new Date('2024-01-01'), terminationDate: null,
        contractType: 'permanent', contractStartDate: new Date('2000-01-01'), contractEndDate: null, contractDocumentPath: '/old',
        contracts: [{ id: 2, contractType: 'temporary', startDate: new Date('2024-02-01'), endDate: new Date('2024-02-10') }, { id: 1, contractType: 'temporary', startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31') }],
      });
      const result = await new EmployeesService(prisma as never).get(3);
      expect(result.currentContract?.id).toBe(2);
      expect(result.contractExpired).toBe(true);
      expect(result.tenure).toEqual(expect.objectContaining({ basis: 'contracts', days: 41 }));
      expect(result).not.toHaveProperty('contractType'); // the legacy columns are not exposed
    });
  });
});
