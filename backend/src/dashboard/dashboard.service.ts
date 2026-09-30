import { Injectable } from '@nestjs/common';
import { Prisma, PurchasePaymentStatus, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardPeriod, PurchasesSummaryQueryDto } from './dto/purchases-summary.dto';

const MS_PER_DAY = 86_400_000;

// The company operates in Iran — "today", "this week" and "this month" are
// decided on the Tehran calendar day, not the server's own timezone.
const BUSINESS_TIMEZONE = 'Asia/Tehran';

// Ranges up to this many days are charted per day; longer custom ranges are
// bucketed per 7 days so the chart stays readable.
const DAILY_BUCKET_MAX_DAYS = 62;

const RECENT_PURCHASES_LIMIT = 10;
const RECENT_ACTIVITY_LIMIT = 10;

// The activity feed is gated on purchases.manage, so it only shows audit
// entries about the entities that permission covers. Auth events (LOGIN,
// LOGOUT, LOGIN_FAILED:<username>:<reason>) are deliberately left out —
// they carry attempted usernames and belong to user administration, not
// to everyone who manages purchases.
const ACTIVITY_ENTITY_TYPES = ['Purchase', 'PurchaseRequest'] as const;

// "Open" = still waiting on someone to act: submitted for approval,
// approved but not yet purchased, or only partly purchased.
const OPEN_PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ['SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED'];
const OUTSTANDING_PAYMENT_STATUSES: PurchasePaymentStatus[] = ['UNPAID', 'PARTIAL'];

// Same convention as PurchaseRequestsService.recomputeStatus(): a CANCELLED
// purchase never counts toward any quantity/amount aggregate.
const NOT_CANCELLED: Prisma.PurchaseWhereInput = { status: { not: 'CANCELLED' } };

export type PeriodRange = {
  period: DashboardPeriod;
  // UTC midnight of the first calendar day in the range (inclusive).
  from: Date;
  // UTC midnight of the day AFTER the last day in the range (exclusive).
  toExclusive: Date;
  days: number;
  bucket: 'day' | 'week';
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function partsOf(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const gregorianInTehran = new Intl.DateTimeFormat('en-US-u-nu-latn', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
// Node ships full ICU, so the Persian (Jalali) calendar is available
// without porting frontend/src/lib/jalali.ts — only the day-of-month is
// needed here (to find the first day of the current Jalali month).
const jalaliInTehran = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

// Purchase.purchaseDate is stored as UTC midnight of its calendar date (the
// DTO coerces "YYYY-MM-DD"), so every boundary here is computed in that same
// "calendar day as UTC midnight" space.
export function resolvePeriodRange(query: PurchasesSummaryQueryDto, now: Date = new Date()): PeriodRange {
  let from: Date;
  let toExclusive: Date;

  if (query.period === 'custom') {
    // Presence/order/length already enforced by purchasesSummaryQuerySchema.
    from = new Date(`${query.from}T00:00:00Z`);
    toExclusive = addDays(new Date(`${query.to}T00:00:00Z`), 1);
  } else {
    const { year, month, day } = partsOf(gregorianInTehran, now);
    const today = new Date(Date.UTC(year, month - 1, day));
    toExclusive = addDays(today, 1);
    if (query.period === 'today') {
      from = today;
    } else if (query.period === 'week') {
      // Iranian week starts on Saturday (getUTCDay() === 6).
      from = addDays(today, -((today.getUTCDay() + 1) % 7));
    } else {
      // Current Jalali month.
      from = addDays(today, -(partsOf(jalaliInTehran, now).day - 1));
    }
  }

  const days = Math.round((toExclusive.getTime() - from.getTime()) / MS_PER_DAY);
  return { period: query.period, from, toExclusive, days, bucket: days <= DAILY_BUCKET_MAX_DAYS ? 'day' : 'week' };
}

// Read-only analytics for the admin dashboard. Every figure is computed with
// Prisma aggregate/groupBy/count — purchase rows are never loaded wholesale.
// Nothing here writes; the derived Purchase fields (totalAmount, paidAmount,
// paymentStatus) are only read, exactly as PurchasesService persisted them.
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getPurchasesSummary(query: PurchasesSummaryQueryDto, now: Date = new Date()) {
    const range = resolvePeriodRange(query, now);
    const periodWhere: Prisma.PurchaseWhereInput = {
      ...NOT_CANCELLED,
      purchaseDate: { gte: range.from, lt: range.toExclusive },
    };

    const [periodTotals, perDate, outstanding, openPurchaseRequestCount, recentPurchases] = await Promise.all([
      this.prisma.purchase.aggregate({
        where: periodWhere,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      // One row per distinct purchaseDate in the period (i.e. per day, since
      // dates are stored at midnight) — folded into chart buckets below.
      this.prisma.purchase.groupBy({
        by: ['purchaseDate'],
        where: periodWhere,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      // Current state, not period-scoped: everything still owed right now.
      this.prisma.purchase.aggregate({
        where: { ...NOT_CANCELLED, paymentStatus: { in: OUTSTANDING_PAYMENT_STATUSES } },
        _sum: { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseRequest.count({ where: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } } }),
      // Latest purchases in the system regardless of period or status — the
      // transactions table is a "what just happened" log, so a CANCELLED one
      // still shows up (with its status badge).
      this.prisma.purchase.findMany({
        orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
        take: RECENT_PURCHASES_LIMIT,
        select: {
          id: true,
          purchaseNumber: true,
          purchaseDate: true,
          totalAmount: true,
          status: true,
          paymentStatus: true,
          supplier: { select: { id: true, name: true } },
        },
      }),
    ]);

    const bucketDays = range.bucket === 'day' ? 1 : 7;
    const bucketCount = Math.ceil(range.days / bucketDays);
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      date: addDays(range.from, index * bucketDays),
      amount: new Prisma.Decimal(0),
      count: 0,
    }));
    for (const row of perDate) {
      const index = Math.floor((row.purchaseDate.getTime() - range.from.getTime()) / (bucketDays * MS_PER_DAY));
      const bucket = buckets[Math.min(Math.max(index, 0), bucketCount - 1)];
      bucket.amount = bucket.amount.plus(row._sum.totalAmount ?? 0);
      bucket.count += row._count._all;
    }

    const outstandingTotal = outstanding._sum.totalAmount ?? new Prisma.Decimal(0);
    const outstandingPaid = outstanding._sum.paidAmount ?? new Prisma.Decimal(0);

    return {
      period: {
        key: range.period,
        from: toIsoDate(range.from),
        to: toIsoDate(addDays(range.toExclusive, -1)),
        bucket: range.bucket,
      },
      totals: {
        purchaseAmount: (periodTotals._sum.totalAmount ?? new Prisma.Decimal(0)).toString(),
        purchaseCount: periodTotals._count._all,
      },
      outstanding: {
        amount: outstandingTotal.minus(outstandingPaid).toString(),
        purchaseCount: outstanding._count._all,
      },
      openPurchaseRequestCount,
      trend: buckets.map((bucket) => ({ date: toIsoDate(bucket.date), amount: bucket.amount.toString(), count: bucket.count })),
      recentPurchases,
    };
  }

  // Latest audit entries about purchases/purchase requests, newest first.
  // entityId is a loosely-typed string on AuditLog (no FK), so the document
  // number is resolved with one batched lookup per entity type; a deleted
  // row simply resolves to null (PURCHASE_DELETED keeps its number in details).
  async getRecentActivity() {
    const entries = await this.prisma.auditLog.findMany({
      where: { entityType: { in: [...ACTIVITY_ENTITY_TYPES] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        details: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    });

    const idsOf = (entityType: string) => [
      ...new Set(
        entries
          .filter((entry) => entry.entityType === entityType)
          .map((entry) => Number(entry.entityId))
          .filter((id) => Number.isInteger(id)),
      ),
    ];
    const purchaseIds = idsOf('Purchase');
    const requestIds = idsOf('PurchaseRequest');

    const [purchases, requests] = await Promise.all([
      purchaseIds.length
        ? this.prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, purchaseNumber: true } })
        : [],
      requestIds.length
        ? this.prisma.purchaseRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, requestNumber: true } })
        : [],
    ]);
    const purchaseNumbers = new Map(purchases.map((row) => [String(row.id), row.purchaseNumber]));
    const requestNumbers = new Map(requests.map((row) => [String(row.id), row.requestNumber]));

    return entries.map((entry) => ({
      ...entry,
      entityNumber:
        (entry.entityType === 'Purchase'
          ? purchaseNumbers.get(entry.entityId ?? '')
          : requestNumbers.get(entry.entityId ?? '')) ?? null,
    }));
  }
}
