import { ConflictException } from '@nestjs/common';
import { applyMovements, type MovementInput } from './stock-ledger';
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
