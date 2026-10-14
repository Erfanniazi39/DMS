import { LetterLinksService, MAX_RESOLVE_CODES } from './letter-links.service';

// Codes in a letter become links only for records that exist AND that the
// reader may open; never anything else.
function build() {
  // Only the real code exists; any other code resolves to nothing.
  const found = (id: number) => jest.fn().mockImplementation(({ where }) => Promise.resolve(Object.values(where)[0] === REAL_CODES[id] ? { id } : null));
  const missing = () => jest.fn().mockResolvedValue(null);
  const db: any = {
    purchase: { findUnique: found(12) },
    purchaseRequest: { findUnique: missing() },
    salesOrder: { findUnique: found(20) },
    delivery: { findUnique: missing() },
    salesInvoice: { findUnique: missing() },
    salesReturn: { findUnique: missing() },
    customerPayment: { findUnique: found(4) },
    customer: { findUnique: found(3) },
    stockAdjustment: { findUnique: found(7) },
    goodsReceipt: { findUnique: missing() },
    productionOutput: { findUnique: missing() },
    item: { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.code === 'MILK-001' ? { id: 79 } : null)) },
  };
  return { db, service: new LetterLinksService(db) };
}

const REAL_CODES: Record<number, string> = { 12: 'PUR-000012', 20: 'SO-1405-000020', 4: 'RCP-1405-000001', 3: 'CUS-000003', 7: 'ADJ-1405-000002' };

const ALL = ['purchases.view', 'sales.view', 'customers.view', 'inventory.view', 'receivables.view'];

describe('LetterLinksService.resolve', () => {
  it('maps document codes to their pages and item codes to the stock card', async () => {
    const { service } = build();
    expect(await service.resolve(['SO-1405-000020', 'PUR-000012', 'CUS-000003', 'RCP-1405-000001', 'ADJ-1405-000002', 'MILK-001'], ALL)).toEqual([
      { code: 'SO-1405-000020', href: '/sales-orders/20' },
      { code: 'PUR-000012', href: '/purchases/12' },
      { code: 'CUS-000003', href: '/customers/3' },
      { code: 'RCP-1405-000001', href: '/receipts/4' },
      { code: 'ADJ-1405-000002', href: '/inventory/adjustments/7' },
      { code: 'MILK-001', href: '/inventory/items/79' },
    ]);
  });

  it('returns nothing for a code that names no record (it stays plain text)', async () => {
    const { service } = build();
    expect(await service.resolve(['SO-1405-999999', 'DN-1405-000001', '1405-07-21', 'NOPE-1'], ALL)).toEqual([]);
  });

  it('never links a page the reader cannot open — and does not even query it', async () => {
    const { db, service } = build();
    expect(await service.resolve(['SO-1405-000020', 'CUS-000003', 'MILK-001'], ['purchases.view'])).toEqual([]);
    expect(db.salesOrder.findUnique).not.toHaveBeenCalled();
    expect(db.customer.findUnique).not.toHaveBeenCalled();
    expect(db.item.findUnique).not.toHaveBeenCalled();
    expect(await service.resolve(['PUR-000012'], ['purchases.view'])).toEqual([{ code: 'PUR-000012', href: '/purchases/12' }]);
  });

  it('de-duplicates and caps the number of codes looked up', async () => {
    const { db, service } = build();
    await service.resolve(['SO-1405-000020', 'SO-1405-000020', ' SO-1405-000020 '], ALL);
    expect(db.salesOrder.findUnique).toHaveBeenCalledTimes(1);
    const many = Array.from({ length: MAX_RESOLVE_CODES + 20 }, (_, i) => `ZZ-${i}`);
    await service.resolve(many, ALL);
    expect(db.item.findUnique).toHaveBeenCalledTimes(MAX_RESOLVE_CODES);
  });

  it('a lowercase typing of a document code is not guessed at', async () => {
    const { db, service } = build();
    expect(await service.resolve(['so-1405-000020'], ALL)).toEqual([]);
    expect(db.salesOrder.findUnique).not.toHaveBeenCalled();
  });
});
