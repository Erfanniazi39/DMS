import { ConflictException } from '@nestjs/common';
import {
  applyMovements,
  inspectReturn,
  issueForDelivery,
  receiveReturn,
  releaseReserved,
  reserveAvailable,
  STOCK_RESERVED_FOR_OTHERS,
  type MovementInput,
  type StockEventContext,
} from './stock-ledger';
import { balanceOf, createInventoryDb, seedStock, setBucket } from './inventory.spec-helpers';

// stock-ledger.ts applyMovements() — the only writer of StockMovement /
// StockBalance (CLAUDE.md rule 10). Runs against the in-memory fake in
// inventory.spec-helpers.ts, whose $transaction rolls back on error.

const DATE = new Date('2026-10-06T00:00:00.000Z');

function row(overrides: Partial<MovementInput>): MovementInput {
  return {
    itemId: 1,
    locationId: 1,
    bucket: 'ON_HAND',
    movementType: 'MANUAL_RECEIPT',
    quantity: 10,
    movementDate: DATE,
    referenceType: 'STOCK_ADJUSTMENT',
    referenceId: 99,
    ...overrides,
  };
}

describe('applyMovements', () => {
  it('creates the balance row on first receipt, updates it, and appends one movement per input row', async () => {
    const db = createInventoryDb();

    await db.$transaction((tx: never) =>
      applyMovements(tx, [row({ quantity: 10, referenceLineId: 1, referenceNumber: 'ADJ-1405-000001', createdByUserId: 3 }), row({ itemId: 2, quantity: '2.5', referenceLineId: 2 })]),
    );

    expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '0' });
    expect(balanceOf(db, 2)).toEqual({ onHand: '2.5', reserved: '0', qc: '0' });
    expect(db.state.movements).toHaveLength(2);
    expect(db.state.movements[0]).toEqual(
      expect.objectContaining({
        itemId: 1,
        bucket: 'ON_HAND',
        movementType: 'MANUAL_RECEIPT',
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: 99,
        referenceLineId: 1,
        referenceNumber: 'ADJ-1405-000001',
        createdByUserId: 3,
        movementDate: DATE,
      }),
    );
    expect(db.state.movements[0].quantity.toString()).toBe('10');
  });

  it('blocks a movement that would take on-hand negative — 409 NEGATIVE_STOCK, nothing written', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 5);
    const movementsBefore = db.state.movements.length;

    const attempt = db.$transaction((tx: never) => applyMovements(tx, [row({ movementType: 'ADJUSTMENT_OUT', quantity: -6 })]));

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
    expect(balanceOf(db, 1)).toEqual({ onHand: '5', reserved: '0', qc: '0' });
    expect(db.state.movements).toHaveLength(movementsBefore);
    expect(db.stockBalance.update).not.toHaveBeenCalled();
    expect(db.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('allows taking on-hand exactly to zero', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 5);
    await db.$transaction((tx: never) => applyMovements(tx, [row({ movementType: 'ADJUSTMENT_OUT', quantity: -5 })]));
    expect(balanceOf(db, 1)?.onHand).toBe('0');
  });

  it('is atomic: when ONE row of a batch would go negative, NO row of the batch is applied (not just the offending one)', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 100);
    seedStock(db, 2, 1);
    const movementsBefore = db.state.movements.length;

    await expect(
      db.$transaction((tx: never) =>
        applyMovements(tx, [
          row({ itemId: 1, movementType: 'ADJUSTMENT_IN', quantity: 50 }), // fine on its own
          row({ itemId: 2, movementType: 'ADJUSTMENT_OUT', quantity: -3 }), // goes negative
        ]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // Item 1's +50 was NOT applied either.
    expect(balanceOf(db, 1)?.onHand).toBe('100');
    expect(balanceOf(db, 2)?.onHand).toBe('1');
    expect(db.state.movements).toHaveLength(movementsBefore);
    // Validation happens before any write.
    expect(db.stockBalance.update).not.toHaveBeenCalled();
  });

  it('rolls back the whole batch if the CALLER fails after applyMovements returned (same transaction)', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);

    await expect(
      db.$transaction(async (tx: never) => {
        await applyMovements(tx, [row({ movementType: 'ADJUSTMENT_IN', quantity: 5 })]);
        throw new Error('source document write failed');
      }),
    ).rejects.toThrow('source document write failed');

    expect(balanceOf(db, 1)?.onHand).toBe('10');
    expect(db.state.movements).toHaveLength(1); // just the seeded opening movement
  });

  it('judges several lines for the same item together (net change), not one by one', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 5);

    await db.$transaction((tx: never) =>
      applyMovements(tx, [row({ movementType: 'ADJUSTMENT_OUT', quantity: -7 }), row({ movementType: 'ADJUSTMENT_IN', quantity: 3 })]),
    );
    expect(balanceOf(db, 1)?.onHand).toBe('1');

    await expect(
      db.$transaction((tx: never) =>
        applyMovements(tx, [row({ movementType: 'ADJUSTMENT_IN', quantity: 1 }), row({ movementType: 'ADJUSTMENT_OUT', quantity: -2.01 })]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(balanceOf(db, 1)?.onHand).toBe('1');
  });

  it('locks balance rows in a fixed itemId → locationId order regardless of input order (deadlock avoidance)', async () => {
    const db = createInventoryDb();

    await db.$transaction((tx: never) =>
      applyMovements(tx, [row({ itemId: 3 }), row({ itemId: 1, locationId: 2 }), row({ itemId: 1, locationId: 1 }), row({ itemId: 2 }), row({ itemId: 3 })]),
    );

    expect(db.lockOrder).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [3, 1],
    ]);
    // Each key is created at most once (ON CONFLICT DO NOTHING) before locking.
    expect(db.stockBalance.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('applies RESERVE / RELEASE to the reserved bucket and RETURN_RESTOCK as a QC → on-hand transfer', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'QC', 4);

    await db.$transaction((tx: never) =>
      applyMovements(tx, [
        row({ bucket: 'RESERVED', movementType: 'RESERVE', quantity: 6, referenceType: 'SALES_ORDER' }),
        row({ bucket: 'QC', movementType: 'RETURN_RESTOCK', quantity: -4, referenceType: 'SALES_RETURN' }),
        row({ bucket: 'ON_HAND', movementType: 'RETURN_RESTOCK', quantity: 4, referenceType: 'SALES_RETURN' }),
      ]),
    );
    expect(balanceOf(db, 1)).toEqual({ onHand: '14', reserved: '6', qc: '0' });

    // Releasing more than is reserved is refused just like negative on-hand.
    await expect(
      db.$transaction((tx: never) => applyMovements(tx, [row({ bucket: 'RESERVED', movementType: 'RELEASE', quantity: -7 })])),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses rows whose bucket or sign contradicts the movement type, or whose quantity is zero/malformed', async () => {
    const bad: Partial<MovementInput>[] = [
      { movementType: 'ADJUSTMENT_OUT', quantity: 5 }, // OUT must be negative
      { movementType: 'MANUAL_RECEIPT', quantity: -5 }, // receipt must be positive
      { movementType: 'RESERVE', bucket: 'ON_HAND' }, // RESERVE only touches RESERVED
      { movementType: 'OPENING_BALANCE', bucket: 'QC' },
      { quantity: 0 },
      { quantity: 1.005 },
      { quantity: 'abc' },
      { referenceId: 0 },
      { movementDate: new Date('invalid') },
    ];
    for (const overrides of bad) {
      const db = createInventoryDb();
      await expect(db.$transaction((tx: never) => applyMovements(tx, [row(overrides)]))).rejects.toThrow();
      expect(db.state.movements).toHaveLength(0);
      expect(db.state.balances).toHaveLength(0);
    }
  });

  it('does nothing for an empty batch', async () => {
    const db = createInventoryDb();
    await applyMovements(db, []);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.stockMovement.createMany).not.toHaveBeenCalled();
  });
});

// Sales batch 2: the reserve/release stock events.
describe('reserveAvailable / releaseReserved', () => {
  const context: StockEventContext = { locationId: 1, movementDate: DATE, referenceType: 'SALES_ORDER', referenceId: 11, referenceNumber: 'SO-1405-000001', createdByUserId: 3 };

  it('reserves min(requested, onHand − reserved) per line, lines of the same item sharing availability, and reports shortfalls', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'RESERVED', 4); // 6 free
    seedStock(db, 2, 3);

    const results = await reserveAvailable(db, context, [
      { referenceLineId: 101, itemId: 1, quantity: 5 },
      { referenceLineId: 102, itemId: 2, quantity: 2 },
      { referenceLineId: 103, itemId: 1, quantity: 5 },
    ]);

    expect(results.map((r) => [r.referenceLineId, r.reserved.toString(), r.shortfall.toString()])).toEqual([
      [101, '5', '0'],
      [102, '2', '0'],
      [103, '1', '4'],
    ]);
    expect(balanceOf(db, 1)?.reserved).toBe('10');
    expect(balanceOf(db, 2)?.reserved).toBe('2');
    const reserves = db.state.movements.filter((m: any) => m.movementType === 'RESERVE');
    expect(reserves).toEqual([
      expect.objectContaining({ itemId: 1, bucket: 'RESERVED', referenceLineId: 101, referenceNumber: 'SO-1405-000001' }),
      expect.objectContaining({ itemId: 2, referenceLineId: 102 }),
      expect.objectContaining({ itemId: 1, referenceLineId: 103 }),
    ]);
  });

  it('reads availability under a FOR UPDATE lock, in itemId order', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 1);
    seedStock(db, 2, 1);
    await reserveAvailable(db, context, [
      { referenceLineId: 1, itemId: 2, quantity: 1 },
      { referenceLineId: 2, itemId: 1, quantity: 1 },
    ]);
    expect(db.lockOrder.slice(0, 2)).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FOR UPDATE');
  });

  it('nothing available (no balance row, or everything already reserved) → shortfall, no movement, no balance row created', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 5);
    setBucket(db, 1, 'RESERVED', 5);
    const results = await reserveAvailable(db, context, [
      { referenceLineId: 1, itemId: 1, quantity: 2 },
      { referenceLineId: 2, itemId: 9, quantity: 2 },
    ]);
    expect(results.map((r) => r.shortfall.toString())).toEqual(['2', '2']);
    expect(db.stockMovement.createMany).not.toHaveBeenCalled();
    expect(balanceOf(db, 9)).toBeNull();
  });

  it('releaseReserved writes RELEASE (negative) movements, skips zero lines, and refuses to release more than is reserved', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'RESERVED', 5);
    await releaseReserved(db, context, [
      { referenceLineId: 101, itemId: 1, quantity: 5 },
      { referenceLineId: 102, itemId: 2, quantity: 0 },
    ]);
    expect(balanceOf(db, 1)?.reserved).toBe('0');
    const release = db.state.movements.filter((m: any) => m.movementType === 'RELEASE');
    expect(release).toHaveLength(1);
    expect(release[0].quantity.toString()).toBe('-5');

    await expect(db.$transaction((tx: unknown) => releaseReserved(tx as never, context, [{ referenceLineId: 101, itemId: 1, quantity: 1 }]))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('issueForDelivery (DELIVERY_ISSUE, Sales batch 3)', () => {
  const context: StockEventContext = {
    locationId: 1,
    movementDate: DATE,
    referenceType: 'DELIVERY',
    referenceId: 31,
    referenceNumber: 'DN-1405-000001',
    createdByUserId: 4,
  };

  it('takes ON_HAND −q and RESERVED −min(q, reservedQty), as DELIVERY_ISSUE rows with the same reference', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'RESERVED', 6);

    const results = await db.$transaction((tx: never) =>
      issueForDelivery(tx, context, [{ referenceLineId: 301, itemId: 1, quantity: 4, reservedQty: 6 }]),
    );

    expect(results[0].reservedConsumed.toString()).toBe('4');
    expect(balanceOf(db, 1)).toEqual({ onHand: '6', reserved: '2', qc: '0' });
    const issues = db.state.movements.filter((m: any) => m.movementType === 'DELIVERY_ISSUE');
    expect(issues.map((m: any) => [m.bucket, m.quantity.toString(), m.referenceType, m.referenceLineId, m.referenceNumber])).toEqual([
      ['ON_HAND', '-4', 'DELIVERY', 301, 'DN-1405-000001'],
      ['RESERVED', '-4', 'DELIVERY', 301, 'DN-1405-000001'],
    ]);
  });

  it('a backordered (unreserved) quantity can be delivered from FREE stock that arrived later — no re-reservation needed', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'RESERVED', 3); // this order holds 3, 7 are free

    const results = await db.$transaction((tx: never) =>
      issueForDelivery(tx, context, [{ referenceLineId: 301, itemId: 1, quantity: 8, reservedQty: 3 }]),
    );
    expect(results[0].reservedConsumed.toString()).toBe('3');
    expect(balanceOf(db, 1)).toEqual({ onHand: '2', reserved: '0', qc: '0' });
    // No reserved part → only the ON_HAND row.
    const db2 = createInventoryDb();
    seedStock(db2, 1, 5);
    await db2.$transaction((tx: never) => issueForDelivery(tx, context, [{ referenceLineId: 1, itemId: 1, quantity: 5, reservedQty: 0 }]));
    expect(db2.state.movements.filter((m: any) => m.movementType === 'DELIVERY_ISSUE').map((m: any) => m.bucket)).toEqual(['ON_HAND']);
  });

  it('never takes stock reserved for ANOTHER order (409 STOCK_RESERVED_FOR_OTHERS), nothing written', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'RESERVED', 8); // this order holds 2, another order 6 → free 2

    await expect(
      db.$transaction((tx: never) => issueForDelivery(tx, context, [{ referenceLineId: 301, itemId: 1, quantity: 5, reservedQty: 2 }])),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: STOCK_RESERVED_FOR_OTHERS }) });
    expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '8', qc: '0' });
    expect(db.state.movements.filter((m: any) => m.movementType === 'DELIVERY_ISSUE')).toHaveLength(0);

    // Exactly the free amount is fine.
    await db.$transaction((tx: never) => issueForDelivery(tx, context, [{ referenceLineId: 301, itemId: 1, quantity: 4, reservedQty: 2 }]));
    expect(balanceOf(db, 1)).toEqual({ onHand: '6', reserved: '6', qc: '0' });
  });

  it('is blocked if ON_HAND would go negative (409 NEGATIVE_STOCK, no override) — including an item with no balance row', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 3);
    setBucket(db, 1, 'RESERVED', 3);
    await expect(
      db.$transaction((tx: never) => issueForDelivery(tx, context, [{ referenceLineId: 301, itemId: 1, quantity: 4, reservedQty: 3 }])),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
    expect(balanceOf(db, 1)).toEqual({ onHand: '3', reserved: '3', qc: '0' });

    await expect(
      db.$transaction((tx: never) => issueForDelivery(tx, context, [{ referenceLineId: 302, itemId: 7, quantity: 1, reservedQty: 0 }])),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
    expect(balanceOf(db, 7)).toBeNull();
  });

  it('judges several lines of one item together and locks balance rows in (itemId, locationId) order', async () => {
    const db = createInventoryDb();
    seedStock(db, 2, 10);
    seedStock(db, 1, 10);

    await expect(
      db.$transaction((tx: never) =>
        issueForDelivery(tx, context, [
          { referenceLineId: 1, itemId: 2, quantity: 6, reservedQty: 0 },
          { referenceLineId: 2, itemId: 2, quantity: 6, reservedQty: 0 },
        ]),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(balanceOf(db, 2)).toEqual({ onHand: '10', reserved: '0', qc: '0' });

    db.lockOrder.length = 0;
    await db.$transaction((tx: never) =>
      issueForDelivery(tx, context, [
        { referenceLineId: 1, itemId: 2, quantity: 1, reservedQty: 0 },
        { referenceLineId: 2, itemId: 1, quantity: 1, reservedQty: 0 },
      ]),
    );
    expect(db.lockOrder.slice(0, 2)).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });
});

describe('receiveReturn / inspectReturn (RETURN_RECEIPT / RETURN_RESTOCK / RETURN_WRITE_OFF, Sales batch 6)', () => {
  const context: StockEventContext = {
    locationId: 1,
    movementDate: DATE,
    referenceType: 'SALES_RETURN',
    referenceId: 81,
    referenceNumber: 'RMA-1405-000001',
    createdByUserId: 4,
  };

  it('receiveReturn: QC += q, skipping zero/negative lines', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);

    await db.$transaction((tx: never) =>
      receiveReturn(tx, context, [
        { referenceLineId: 801, itemId: 1, quantity: 3 },
        { referenceLineId: 802, itemId: 1, quantity: 0 },
      ]),
    );

    expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '3' });
    const receipts = db.state.movements.filter((m: any) => m.movementType === 'RETURN_RECEIPT');
    expect(receipts.map((m: any) => [m.bucket, m.quantity.toString(), m.referenceLineId])).toEqual([['QC', '3', 801]]);
  });

  it('inspectReturn: splits a line between RETURN_RESTOCK (QC −r, ON_HAND +r) and RETURN_WRITE_OFF (QC −w)', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'QC', 5);

    await db.$transaction((tx: never) => inspectReturn(tx, context, [{ referenceLineId: 801, itemId: 1, restockQty: 3, writeOffQty: 2 }]));

    expect(balanceOf(db, 1)).toEqual({ onHand: '13', reserved: '0', qc: '0' });
    const restock = db.state.movements.filter((m: any) => m.movementType === 'RETURN_RESTOCK');
    expect(restock.map((m: any) => [m.bucket, m.quantity.toString()]).sort()).toEqual([
      ['ON_HAND', '3'],
      ['QC', '-3'],
    ]);
    const writeOff = db.state.movements.filter((m: any) => m.movementType === 'RETURN_WRITE_OFF');
    expect(writeOff.map((m: any) => [m.bucket, m.quantity.toString()])).toEqual([['QC', '-2']]);
  });

  it('inspectReturn is blocked if it disposes of more QC than was received (409 NEGATIVE_STOCK), nothing written', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'QC', 2);

    await expect(
      db.$transaction((tx: never) => inspectReturn(tx, context, [{ referenceLineId: 801, itemId: 1, restockQty: 3, writeOffQty: 0 }])),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK' }) });
    expect(balanceOf(db, 1)).toEqual({ onHand: '10', reserved: '0', qc: '2' });
  });

  it('inspectReturn writes only a restock row when writeOffQty is 0, and only a write-off row when restockQty is 0', async () => {
    const db = createInventoryDb();
    seedStock(db, 1, 10);
    setBucket(db, 1, 'QC', 5);

    await db.$transaction((tx: never) =>
      inspectReturn(tx, context, [
        { referenceLineId: 801, itemId: 1, restockQty: 2, writeOffQty: 0 },
        { referenceLineId: 802, itemId: 1, restockQty: 0, writeOffQty: 3 },
      ]),
    );
    expect(balanceOf(db, 1)).toEqual({ onHand: '12', reserved: '0', qc: '0' });
    expect(db.state.movements.filter((m: any) => m.movementType === 'RETURN_RESTOCK')).toHaveLength(2);
    expect(db.state.movements.filter((m: any) => m.movementType === 'RETURN_WRITE_OFF')).toHaveLength(1);
  });
});
