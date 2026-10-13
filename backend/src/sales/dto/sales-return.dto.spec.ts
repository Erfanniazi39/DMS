import {
  approveSalesReturnSchema,
  cancelSalesReturnSchema,
  inspectSalesReturnSchema,
  receiveSalesReturnSchema,
  rejectSalesReturnSchema,
  requestSalesReturnSchema,
  salesReturnListQuerySchema,
} from './sales-return.dto';

const base = { deliveryId: 41, requestDate: '2026-10-06', reason: 'DAMAGED' };

describe('sales-return DTOs', () => {
  it('accepts a request; client-only fields (returnNumber, status, price snapshots) are stripped', () => {
    const parsed = requestSalesReturnSchema.parse({
      ...base,
      returnNumber: 'RMA-1',
      status: 'APPROVED',
      items: [{ deliveryItemId: 401, quantity: 2, itemName: 'x', unitPrice: 1000 }],
    });
    for (const key of ['returnNumber', 'status']) expect(parsed).not.toHaveProperty(key);
    expect(parsed.items[0]).not.toHaveProperty('itemName');
    expect(parsed.items[0]).not.toHaveProperty('unitPrice');
  });

  it('refuses duplicate delivery lines, zero/negative/3-decimal quantities, an empty line list, and a bad reason', () => {
    expect(requestSalesReturnSchema.safeParse({ ...base, items: [{ deliveryItemId: 1, quantity: 1 }, { deliveryItemId: 1, quantity: 2 }] }).success).toBe(false);
    for (const quantity of [0, -1, 1.005, '']) {
      expect(requestSalesReturnSchema.safeParse({ ...base, items: [{ deliveryItemId: 1, quantity }] }).success).toBe(false);
    }
    expect(requestSalesReturnSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(requestSalesReturnSchema.safeParse({ ...base, reason: 'NOT_A_REASON', items: [{ deliveryItemId: 1, quantity: 1 }] }).success).toBe(false);
  });

  it('approve requires the version; reject/cancel require a non-empty reason', () => {
    expect(approveSalesReturnSchema.safeParse({}).success).toBe(false);
    expect(approveSalesReturnSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(true);
    expect(rejectSalesReturnSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(false);
    expect(rejectSalesReturnSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', reason: '' }).success).toBe(false);
    expect(rejectSalesReturnSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', reason: 'x' }).success).toBe(true);
    expect(cancelSalesReturnSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', reason: 'x' }).success).toBe(true);
  });

  it('receive allows an omitted per-line receivedQty (defaults server-side) but refuses a negative one', () => {
    const version = '2026-10-01T10:00:00.000Z';
    expect(receiveSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1 }] }).success).toBe(true);
    expect(receiveSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, receivedQty: 0 }] }).success).toBe(true);
    expect(receiveSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, receivedQty: -1 }] }).success).toBe(false);
  });

  it('inspect requires at least one line and allows zero restock/write-off quantities', () => {
    const version = '2026-10-01T10:00:00.000Z';
    expect(inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [] }).success).toBe(false);
    expect(inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, restockQty: 0, writeOffQty: 0 }] }).success).toBe(true);
    expect(inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, restockQty: -1, writeOffQty: 0 }] }).success).toBe(false);
  });

  // I8 (build plan §5.8, B9): damagedQty joins restock/write-off — optional,
  // defaults to 0 (omitting it behaves exactly as before I8), rejects a
  // negative value the same way the other two counters do.
  it('inspect: damagedQty defaults to 0 when omitted, and rejects a negative value', () => {
    const version = '2026-10-01T10:00:00.000Z';
    const omitted = inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, restockQty: 2, writeOffQty: 0 }] });
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.items[0].damagedQty).toBe(0);
    expect(
      inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, restockQty: 0, writeOffQty: 0, damagedQty: 3 }] }).success,
    ).toBe(true);
    expect(
      inspectSalesReturnSchema.safeParse({ updatedAt: version, items: [{ salesReturnItemId: 1, restockQty: 0, writeOffQty: 0, damagedQty: -1 }] }).success,
    ).toBe(false);
  });

  it('list query refuses a bad status filter and strips an empty one', () => {
    expect(salesReturnListQuerySchema.safeParse({ status: 'NOT_A_STATUS' }).success).toBe(false);
    expect(salesReturnListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });
});
