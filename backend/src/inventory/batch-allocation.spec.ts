import { Prisma } from '@prisma/client';
import { allocateFefo, isExpiredBatch, type FefoCandidateBatch } from './batch-allocation';

// Pure logic, no DB (build plan §16 resume step 2). Mirrors sales-totals.spec.ts's
// style for a pure-function module.

const DAY = new Date('2026-10-10T00:00:00.000Z');

function batch(overrides: Partial<FefoCandidateBatch> = {}): FefoCandidateBatch {
  return { batchId: 1, batchNumber: 'B1', expiryDate: null, onHand: 10, ...overrides };
}

describe('isExpiredBatch', () => {
  it('has no expiry → never expired', () => {
    expect(isExpiredBatch(null, DAY)).toBe(false);
    expect(isExpiredBatch(undefined, DAY)).toBe(false);
  });

  it('expiry date strictly before the as-of day → expired', () => {
    expect(isExpiredBatch(new Date('2026-10-09T00:00:00.000Z'), DAY)).toBe(true);
  });

  it('expiry date equal to the as-of day → still deliverable (not expired)', () => {
    expect(isExpiredBatch(new Date('2026-10-10T00:00:00.000Z'), DAY)).toBe(false);
  });

  it('expiry date after the as-of day → not expired', () => {
    expect(isExpiredBatch(new Date('2026-10-11T00:00:00.000Z'), DAY)).toBe(false);
  });

  it('compares by calendar day, not time-of-day', () => {
    // Expiry recorded at UTC midnight (the stored convention); asOfDate with
    // a later time on the SAME day must still count as "on its expiry day".
    const lateSameDay = new Date('2026-10-10T18:30:00.000Z');
    expect(isExpiredBatch(new Date('2026-10-10T00:00:00.000Z'), lateSameDay)).toBe(false);
  });
});

describe('allocateFefo', () => {
  it('orders by expiry date ascending', () => {
    const candidates = [
      batch({ batchId: 2, batchNumber: 'B2', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 10 }),
      batch({ batchId: 1, batchNumber: 'B1', expiryDate: new Date('2026-11-01T00:00:00.000Z'), onHand: 10 }),
    ];
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 5 }], candidates, DAY);
    expect(shortfall.isZero()).toBe(true);
    expect(allocations).toEqual([{ referenceLineId: 1, batchId: 1, batchNumber: 'B1', expiryDate: candidates[1].expiryDate, quantity: new Prisma.Decimal(5) }]);
  });

  it('sorts a batch with no expiry date last, after every dated batch', () => {
    const candidates = [
      batch({ batchId: 1, batchNumber: 'NO_EXPIRY', expiryDate: null, onHand: 10 }),
      batch({ batchId: 2, batchNumber: 'DATED', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 10 }),
    ];
    const { allocations } = allocateFefo([{ referenceLineId: 1, quantity: 15 }], candidates, DAY);
    expect(allocations.map((a) => a.batchId)).toEqual([2, 1]);
    expect(allocations.map((a) => a.quantity.toString())).toEqual(['10', '5']);
  });

  it('excludes expired batches from the pool entirely, reporting the uncovered amount as shortfall', () => {
    const candidates = [
      batch({ batchId: 1, batchNumber: 'EXPIRED', expiryDate: new Date('2026-10-01T00:00:00.000Z'), onHand: 10 }),
      batch({ batchId: 2, batchNumber: 'FRESH', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 3 }),
    ];
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 5 }], candidates, DAY);
    expect(allocations).toEqual([{ referenceLineId: 1, batchId: 2, batchNumber: 'FRESH', expiryDate: candidates[1].expiryDate, quantity: new Prisma.Decimal(3) }]);
    expect(shortfall.toString()).toBe('2');
  });

  it('still allocates from a batch expiring exactly on the delivery day (B8)', () => {
    const candidates = [batch({ batchId: 1, batchNumber: 'ON_EXPIRY_DAY', expiryDate: DAY, onHand: 10 })];
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 4 }], candidates, DAY);
    expect(shortfall.isZero()).toBe(true);
    expect(allocations).toEqual([{ referenceLineId: 1, batchId: 1, batchNumber: 'ON_EXPIRY_DAY', expiryDate: DAY, quantity: new Prisma.Decimal(4) }]);
  });

  it('two lines of the same item share one pool, consumed in line order', () => {
    const candidates = [batch({ batchId: 1, batchNumber: 'B1', expiryDate: new Date('2026-11-01T00:00:00.000Z'), onHand: 8 })];
    const lines = [
      { referenceLineId: 1, quantity: 5 },
      { referenceLineId: 2, quantity: 5 },
    ];
    const { allocations, shortfall } = allocateFefo(lines, candidates, DAY);
    expect(allocations).toEqual([
      { referenceLineId: 1, batchId: 1, batchNumber: 'B1', expiryDate: candidates[0].expiryDate, quantity: new Prisma.Decimal(5) },
      { referenceLineId: 2, batchId: 1, batchNumber: 'B1', expiryDate: candidates[0].expiryDate, quantity: new Prisma.Decimal(3) },
    ]);
    expect(shortfall.toString()).toBe('2');
  });

  it('splits one line across two batches when the first is exhausted', () => {
    const candidates = [
      batch({ batchId: 1, batchNumber: 'EARLY', expiryDate: new Date('2026-11-01T00:00:00.000Z'), onHand: 3 }),
      batch({ batchId: 2, batchNumber: 'LATE', expiryDate: new Date('2026-12-01T00:00:00.000Z'), onHand: 10 }),
    ];
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 5 }], candidates, DAY);
    expect(shortfall.isZero()).toBe(true);
    expect(allocations.map((a) => [a.batchId, a.quantity.toString()])).toEqual([
      [1, '3'],
      [2, '2'],
    ]);
  });

  it('skips zero/negative-quantity lines without touching the pool', () => {
    const candidates = [batch({ batchId: 1, onHand: 10 })];
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 0 }], candidates, DAY);
    expect(allocations).toEqual([]);
    expect(shortfall.isZero()).toBe(true);
  });

  it('empty candidate pool: every requested quantity becomes shortfall', () => {
    const { allocations, shortfall } = allocateFefo([{ referenceLineId: 1, quantity: 7 }], [], DAY);
    expect(allocations).toEqual([]);
    expect(shortfall.toString()).toBe('7');
  });
});
