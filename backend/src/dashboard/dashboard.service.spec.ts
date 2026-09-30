import { Prisma } from '@prisma/client';
import { DashboardService, resolvePeriodRange } from './dashboard.service';
import { purchasesSummaryQuerySchema } from './dto/purchases-summary.dto';

// Admin dashboard's purchases summary — read-only aggregates only. Same
// hand-rolled Prisma mock style as the Purchases/PurchaseRequests specs.

function createPrismaMock() {
  return {
    purchase: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    purchaseRequest: { count: jest.fn(), findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
  };
}

// Wednesday 30 Sep 2026, midday in Tehran — Jalali 8 Mehr 1405.
const NOW = new Date('2026-09-30T08:00:00Z');

function parse(query: Record<string, string>) {
  return purchasesSummaryQuerySchema.parse(query);
}

describe('resolvePeriodRange', () => {
  it('today = the current Tehran calendar day', () => {
    const range = resolvePeriodRange(parse({ period: 'today' }), NOW);
    expect(range.from.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.days).toBe(1);
  });

  it('uses the Tehran date, not UTC, just after local midnight', () => {
    // 21:00 UTC = 00:30 on 1 Oct in Tehran.
    const range = resolvePeriodRange(parse({ period: 'today' }), new Date('2026-09-30T21:00:00Z'));
    expect(range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('week starts on Saturday (Iranian week)', () => {
    const range = resolvePeriodRange(parse({ period: 'week' }), NOW);
    expect(range.from.toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(range.days).toBe(5);
  });

  it('month = the current Jalali month (1 Mehr 1405 = 23 Sep 2026)', () => {
    const range = resolvePeriodRange(parse({ period: 'month' }), NOW);
    expect(range.from.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(range.bucket).toBe('day');
  });

  it('custom ranges are inclusive and switch to weekly buckets when long', () => {
    const range = resolvePeriodRange(parse({ period: 'custom', from: '2026-01-01', to: '2026-06-30' }), NOW);
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(range.bucket).toBe('week');
  });
});

describe('purchasesSummaryQuerySchema', () => {
  it('defaults to the current month', () => {
    expect(parse({}).period).toBe('month');
  });

  it('rejects a custom period without both dates, reversed, or too long', () => {
    expect(purchasesSummaryQuerySchema.safeParse({ period: 'custom', from: '2026-01-01' }).success).toBe(false);
    expect(purchasesSummaryQuerySchema.safeParse({ period: 'custom', from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(purchasesSummaryQuerySchema.safeParse({ period: 'custom', from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(purchasesSummaryQuerySchema.safeParse({ period: 'yesterday' }).success).toBe(false);
  });
});

describe('DashboardService.getPurchasesSummary', () => {
  it('aggregates the period excluding CANCELLED, buckets the trend, and computes outstanding across all purchases', async () => {
    const prisma = createPrismaMock();
    const service = new DashboardService(prisma as never);

    prisma.purchase.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: new Prisma.Decimal(3500) }, _count: { _all: 3 } })
      .mockResolvedValueOnce({
        _sum: { totalAmount: new Prisma.Decimal(10000), paidAmount: new Prisma.Decimal(2500) },
        _count: { _all: 4 },
      });
    prisma.purchase.groupBy.mockResolvedValue([
      { purchaseDate: new Date('2026-09-26T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(1000) }, _count: { _all: 1 } },
      { purchaseDate: new Date('2026-09-30T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(2500) }, _count: { _all: 2 } },
    ]);
    prisma.purchaseRequest.count.mockResolvedValue(6);
    prisma.purchase.findMany.mockResolvedValue([{ id: 1, purchaseNumber: 'PUR-000001' }]);

    const result = await service.getPurchasesSummary(parse({ period: 'week' }), NOW);

    // Period aggregate: CANCELLED excluded, half-open date range.
    expect(prisma.purchase.aggregate.mock.calls[0][0].where).toEqual({
      status: { not: 'CANCELLED' },
      purchaseDate: { gte: new Date('2026-09-26T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
    });
    // Outstanding: not period-scoped, UNPAID/PARTIAL only, CANCELLED excluded.
    expect(prisma.purchase.aggregate.mock.calls[1][0].where).toEqual({
      status: { not: 'CANCELLED' },
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
    });
    expect(prisma.purchaseRequest.count).toHaveBeenCalledWith({
      where: { status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED'] } },
    });
    expect(prisma.purchase.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));

    expect(result.period).toEqual({ key: 'week', from: '2026-09-26', to: '2026-09-30', bucket: 'day' });
    expect(result.totals).toEqual({ purchaseAmount: '3500', purchaseCount: 3 });
    expect(result.outstanding).toEqual({ amount: '7500', purchaseCount: 4 });
    expect(result.openPurchaseRequestCount).toBe(6);
    // Every day in the range is present, zero-filled where nothing was bought.
    expect(result.trend).toEqual([
      { date: '2026-09-26', amount: '1000', count: 1 },
      { date: '2026-09-27', amount: '0', count: 0 },
      { date: '2026-09-28', amount: '0', count: 0 },
      { date: '2026-09-29', amount: '0', count: 0 },
      { date: '2026-09-30', amount: '2500', count: 2 },
    ]);
    expect(result.recentPurchases).toEqual([{ id: 1, purchaseNumber: 'PUR-000001' }]);
  });

  it('returns zeros (not nulls) for an empty period and no outstanding purchases', async () => {
    const prisma = createPrismaMock();
    const service = new DashboardService(prisma as never);
    prisma.purchase.aggregate.mockResolvedValue({ _sum: { totalAmount: null, paidAmount: null }, _count: { _all: 0 } });
    prisma.purchase.groupBy.mockResolvedValue([]);
    prisma.purchaseRequest.count.mockResolvedValue(0);
    prisma.purchase.findMany.mockResolvedValue([]);

    const result = await service.getPurchasesSummary(parse({ period: 'today' }), NOW);

    expect(result.totals).toEqual({ purchaseAmount: '0', purchaseCount: 0 });
    expect(result.outstanding).toEqual({ amount: '0', purchaseCount: 0 });
    expect(result.trend).toEqual([{ date: '2026-09-30', amount: '0', count: 0 }]);
  });

  it('folds days into 7-day buckets for long custom ranges', async () => {
    const prisma = createPrismaMock();
    const service = new DashboardService(prisma as never);
    prisma.purchase.aggregate.mockResolvedValue({ _sum: { totalAmount: null, paidAmount: null }, _count: { _all: 0 } });
    prisma.purchase.groupBy.mockResolvedValue([
      { purchaseDate: new Date('2026-01-02T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(100) }, _count: { _all: 1 } },
      { purchaseDate: new Date('2026-01-07T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(50) }, _count: { _all: 1 } },
      { purchaseDate: new Date('2026-01-08T00:00:00Z'), _sum: { totalAmount: new Prisma.Decimal(25) }, _count: { _all: 1 } },
    ]);
    prisma.purchaseRequest.count.mockResolvedValue(0);
    prisma.purchase.findMany.mockResolvedValue([]);

    const result = await service.getPurchasesSummary(parse({ period: 'custom', from: '2026-01-01', to: '2026-03-31' }), NOW);

    expect(result.period.bucket).toBe('week');
    expect(result.trend).toHaveLength(13);
    expect(result.trend[0]).toEqual({ date: '2026-01-01', amount: '150', count: 2 });
    expect(result.trend[1]).toEqual({ date: '2026-01-08', amount: '25', count: 1 });
  });
});

describe('DashboardService.getRecentActivity', () => {
  it('returns the latest purchase/purchase-request audit entries with their document numbers', async () => {
    const prisma = createPrismaMock();
    const service = new DashboardService(prisma as never);
    const createdAt = new Date('2026-09-30T08:00:00Z');
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 3, action: 'PURCHASE_CREATED', entityType: 'Purchase', entityId: '12', details: null, createdAt, user: { id: 1, username: 'ali' } },
      { id: 2, action: 'PURCHASE_REQUEST_CREATED', entityType: 'PurchaseRequest', entityId: '5', details: null, createdAt, user: null },
      { id: 1, action: 'PURCHASE_DELETED', entityType: 'Purchase', entityId: '9', details: 'PUR-000009', createdAt, user: { id: 1, username: 'ali' } },
    ]);
    prisma.purchase.findMany.mockResolvedValue([{ id: 12, purchaseNumber: 'PUR-000012' }]);
    prisma.purchaseRequest.findMany.mockResolvedValue([{ id: 5, requestNumber: 'PR-000005' }]);

    const result = await service.getRecentActivity();

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: { in: ['Purchase', 'PurchaseRequest'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
    );
    // Never exposes the IP address.
    expect(prisma.auditLog.findMany.mock.calls[0][0].select).not.toHaveProperty('ipAddress');
    expect(prisma.purchase.findMany).toHaveBeenCalledWith({ where: { id: { in: [12, 9] } }, select: { id: true, purchaseNumber: true } });
    expect(result.map((entry) => entry.entityNumber)).toEqual(['PUR-000012', 'PR-000005', null]);
  });

  it('skips the number lookups when there is no activity', async () => {
    const prisma = createPrismaMock();
    const service = new DashboardService(prisma as never);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await expect(service.getRecentActivity()).resolves.toEqual([]);
    expect(prisma.purchase.findMany).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.findMany).not.toHaveBeenCalled();
  });
});
