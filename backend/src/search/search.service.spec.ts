import { SearchService } from './search.service';

function prismaWithNoHits() {
  const empty = () => jest.fn().mockResolvedValue([]);
  return {
    purchase: { findMany: empty() }, purchaseRequest: { findMany: empty() }, salesOrder: { findMany: empty() }, delivery: { findMany: empty() },
    salesInvoice: { findMany: empty() }, customerPayment: { findMany: empty() }, customer: { findMany: empty() }, supplier: { findMany: empty() },
    item: { findMany: empty() }, stockAdjustment: { findMany: empty() }, goodsReceipt: { findMany: empty() }, productionOutput: { findMany: empty() },
    user: { findMany: empty() },
  };
}

describe('SearchService', () => {
  it('ignores queries shorter than 2 characters without touching the database', async () => {
    const prisma = prismaWithNoHits();
    await expect(new SearchService(prisma as never).search(' a ', ['purchases.view'])).resolves.toEqual({ query: 'a', groups: [] });
    expect(prisma.purchase.findMany).not.toHaveBeenCalled();
  });

  it('only queries the groups the caller holds the view permission for', async () => {
    const prisma = prismaWithNoHits();
    prisma.customer.findMany.mockResolvedValue([{ id: 3, customerNumber: 'CUS-000003', name: 'شرکت الف' }]);
    const result = await new SearchService(prisma as never).search('الف', ['customers.view']);
    expect(result.groups).toEqual([{ key: 'customers', label: 'مشتریان', hits: [{ id: 3, title: 'شرکت الف', subtitle: 'CUS-000003', href: '/customers/3' }] }]);
    expect(prisma.purchase.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
  });

  it('exposes user results only to users.create holders', async () => {
    const prisma = prismaWithNoHits();
    prisma.user.findMany.mockResolvedValue([{ id: 2, username: 'erfan01', fullName: null }]);
    const withPermission = await new SearchService(prisma as never).search('erf', ['users.create']);
    expect(withPermission.groups[0]).toMatchObject({ key: 'users', hits: [{ href: '/admin/users/2', subtitle: null }] });
    prisma.user.findMany.mockClear();
    await new SearchService(prisma as never).search('erf', ['sales.view']);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
