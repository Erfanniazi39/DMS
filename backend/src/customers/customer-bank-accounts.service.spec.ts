import { AuditService } from '../audit/audit.service';
import { CustomerBankAccountsService } from './customer-bank-accounts.service';
import { buildCustomersService, createPrismaMock, detailRow } from './customers.spec-helpers';

function build() {
  const prisma = createPrismaMock() as ReturnType<typeof createPrismaMock> & { customerBankAccount: Record<string, jest.Mock> };
  prisma.customerBankAccount = { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() };
  prisma.customer.findUnique.mockResolvedValue({ id: 5 });
  return { prisma, service: new CustomerBankAccountsService(prisma as never, new AuditService(prisma as never)) };
}

describe('CustomerBankAccountsService', () => {
  const dto = { bankName: 'ملی', accountNumber: '12345678', shebaNumber: 'IR062960000000100324200001', isDefault: true, isActive: true };

  it('unsets the previous default when a new default is added, and audits without the full number', async () => {
    const { prisma, service } = build();
    prisma.customerBankAccount.create.mockResolvedValue({ id: 1, ...dto, accountHolderName: null });
    await service.create(5, dto as never, 1);
    expect(prisma.customerBankAccount.updateMany).toHaveBeenCalledWith({ where: { customerId: 5, isDefault: true }, data: { isDefault: false } });
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('CUSTOMER_BANK_ACCOUNT_ADDED');
    expect(audit.details).toBe('ملی …0001');
    expect(audit.details).not.toContain('IR06');
  });

  it('update clears omitted optionals and excludes itself from the default reset', async () => {
    const { prisma, service } = build();
    prisma.customerBankAccount.findFirst.mockResolvedValue({ id: 7, customerId: 5 });
    prisma.customerBankAccount.update.mockResolvedValue({ id: 7, bankName: null, accountNumber: '1', shebaNumber: null });
    await service.update(5, 7, { accountNumber: '1', isDefault: true, isActive: true } as never, 1);
    expect(prisma.customerBankAccount.updateMany).toHaveBeenCalledWith({ where: { customerId: 5, isDefault: true, NOT: { id: 7 } }, data: { isDefault: false } });
    expect(prisma.customerBankAccount.update.mock.calls[0][0].data).toMatchObject({ bankName: null, shebaNumber: null, accountHolderName: null, note: null });
  });

  it('404s on an account of another customer', async () => {
    const { prisma, service } = build();
    prisma.customerBankAccount.findFirst.mockResolvedValue(null);
    await expect(service.remove(5, 99, 1)).rejects.toThrow('حساب بانکی پیدا نشد');
  });
});

describe('CustomersService.get — party master data', () => {
  const account = { id: 1, accountNumber: '1234567890', shebaNumber: 'IR062960000000100324200001' };

  it('masks bank numbers for view-only callers and shows them in full otherwise', async () => {
    const prisma = createPrismaMock();
    const service = buildCustomersService(prisma);
    prisma.customer.findUnique.mockResolvedValue({ ...detailRow, nationalId: '10101010101', economicCode: '411234567890', bankAccounts: [account] });
    const full = await service.get(5, { canViewSensitive: true });
    expect(full.bankAccounts[0].shebaNumber).toBe(account.shebaNumber);
    const masked = await service.get(5, { canViewSensitive: false });
    expect(masked.bankAccounts[0].accountNumber).toBe('******7890');
    expect(masked.bankAccounts[0].shebaNumber).toBe(`${'*'.repeat(22)}0001`);
  });

  it('reports the identity fields an old record is missing', async () => {
    const prisma = createPrismaMock();
    const service = buildCustomersService(prisma);
    prisma.customer.findUnique.mockResolvedValue({ ...detailRow, nationalId: null, economicCode: null });
    expect((await service.get(5)).missingIdentityFields).toEqual(['شناسه ملی', 'کد اقتصادی']);
    prisma.customer.findUnique.mockResolvedValue({ ...detailRow, nationalId: '10101010101', economicCode: '411234567890' });
    expect((await service.get(5)).missingIdentityFields).toEqual([]);
  });
});
