import { AuditService } from '../audit/audit.service';
import { SupplierBankAccountsService } from './supplier-bank-accounts.service';

function build() {
  const prisma: any = {
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 5 }) },
    supplierBankAccount: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(prisma));
  return { prisma, service: new SupplierBankAccountsService(prisma, new AuditService(prisma)) };
}

describe('SupplierBankAccountsService', () => {
  it('unsets the previous default, audits with the last 4 digits only', async () => {
    const { prisma, service } = build();
    prisma.supplierBankAccount.create.mockResolvedValue({ id: 1, bankName: 'ملی', accountNumber: '123456', shebaNumber: 'IR062960000000100324200001' });
    await service.create(5, { shebaNumber: 'IR062960000000100324200001', isDefault: true, isActive: true } as never, 1);
    expect(prisma.supplierBankAccount.updateMany).toHaveBeenCalledWith({ where: { supplierId: 5, isDefault: true }, data: { isDefault: false } });
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'SUPPLIER_BANK_ACCOUNT_ADDED', entityType: 'Supplier', details: 'ملی …0001' });
  });

  it('update clears omitted optionals; unknown account or supplier is a 404', async () => {
    const { prisma, service } = build();
    prisma.supplierBankAccount.findFirst.mockResolvedValue({ id: 7, supplierId: 5 });
    prisma.supplierBankAccount.update.mockResolvedValue({ id: 7, bankName: null, accountNumber: '1', shebaNumber: null });
    await service.update(5, 7, { accountNumber: '1', isDefault: false, isActive: true } as never, 1);
    expect(prisma.supplierBankAccount.update.mock.calls[0][0].data).toMatchObject({ bankName: null, shebaNumber: null, accountHolderName: null, note: null });

    prisma.supplierBankAccount.findFirst.mockResolvedValue(null);
    await expect(service.remove(5, 99, 1)).rejects.toThrow('حساب بانکی پیدا نشد');
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(service.create(404, { accountNumber: '1' } as never, 1)).rejects.toThrow('تأمین‌کننده پیدا نشد');
  });
});
