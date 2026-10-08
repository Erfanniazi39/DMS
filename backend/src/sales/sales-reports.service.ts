import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePeriodRange } from '../dashboard/dashboard.service';
import { COMPLETED_RECEIPT_PAYMENT_WHERE } from '../receivables/receivables-rules';
import { computeLineAmounts, invoiceLineDiscount } from './sales-totals';
import { BACKLOG_SALES_ORDER_WHERE, CONFIRMED_SALES_ORDER_WHERE, SALES_STATISTICS_INVOICE_WHERE } from './sales-rules';
import type { SalesReportPeriodQuery } from './dto/sales-reports.dto';

// Read-only Sales reports (build plan §6/§8, Batch 7) — Prisma
// aggregate/groupBy only, rows are never loaded wholesale (same discipline as
// dashboard/dashboard.service.ts, the direct precedent). Nothing here
// writes. Every business-rule-laden filter ("open for delivery", "confirmed
// sales activity", "what counts as a sale", "money actually received") is
// imported from its owning module's rule file (sales-rules.ts,
// receivables-rules.ts) — never re-derived here (CLAUDE.md rule 11).
const MS_PER_DAY = 86_400_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const ZERO = new Prisma.Decimal(0);

type Bucket = { date: Date; amount: Prisma.Decimal; count: number };

function makeBuckets(from: Date, count: number, bucketDays: number): Bucket[] {
  return Array.from({ length: count }, (_, index) => ({ date: addDays(from, index * bucketDays), amount: ZERO, count: 0 }));
}

function fold(buckets: Bucket[], from: Date, bucketDays: number, date: Date, amount: Prisma.Decimal | null, count: number) {
  const index = Math.floor((date.getTime() - from.getTime()) / (bucketDays * MS_PER_DAY));
  const bucket = buckets[Math.min(Math.max(index, 0), buckets.length - 1)];
  bucket.amount = bucket.amount.plus(amount ?? ZERO);
  bucket.count += count;
}

@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Open sales-order lines still owed to the customer: CONFIRMED orders not
  // yet fully delivered (BACKLOG_SALES_ORDER_WHERE), oldest order first.
  // Each undelivered line's remaining value reuses the exact same math
  // SalesInvoicesService.createFromDelivery() already uses for a
  // partially-delivered line (sales-totals.ts's computeLineAmounts +
  // invoiceLineDiscount, prorating a fixed discount by quantity) — not a new
  // formula invented for this report.
  async getBacklog() {
    const orders = await this.prisma.salesOrder.findMany({
      where: BACKLOG_SALES_ORDER_WHERE,
      orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        customer: { select: { id: true, customerNumber: true, name: true } },
        items: {
          orderBy: { lineNo: 'asc' },
          select: {
            id: true,
            lineNo: true,
            itemId: true,
            itemName: true,
            unitName: true,
            quantity: true,
            deliveredQty: true,
            unitPrice: true,
            discountPercent: true,
            discountAmount: true,
            taxRate: true,
          },
        },
      },
    });

    return orders
      .map((order) => {
        const lines = order.items
          .map((line) => {
            const remainingQty = dec(line.quantity).minus(dec(line.deliveredQty));
            if (!remainingQty.greaterThan(0)) return null;
            const amounts = computeLineAmounts(
              { quantity: remainingQty, unitPrice: line.unitPrice, taxRate: line.taxRate, ...invoiceLineDiscount(line, remainingQty) },
              `ردیف ${line.lineNo}`,
            );
            return {
              id: line.id,
              lineNo: line.lineNo,
              itemId: line.itemId,
              itemName: line.itemName,
              unitName: line.unitName,
              remainingQty: remainingQty.toString(),
              remainingValue: amounts.lineTotal.toString(),
            };
          })
          .filter((line): line is NonNullable<typeof line> => line !== null);
        if (lines.length === 0) return null;
        const totalRemainingValue = lines.reduce((sum, line) => sum.plus(line.remainingValue), ZERO);
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          customer: order.customer,
          lines,
          totalRemainingValue: totalRemainingValue.toString(),
        };
      })
      .filter((order): order is NonNullable<typeof order> => order !== null);
  }

  // Revenue + quantity sold per item over a date period — only POSTED
  // operational invoices (SALES_STATISTICS_INVOICE_WHERE excludes
  // OPENING_BALANCE per B1/B7). Highest revenue first.
  async getSalesByItem(query: SalesReportPeriodQuery, now: Date = new Date()) {
    const range = resolvePeriodRange(query, now);
    const invoiceWhere: Prisma.SalesInvoiceWhereInput = {
      ...SALES_STATISTICS_INVOICE_WHERE,
      invoiceDate: { gte: range.from, lt: range.toExclusive },
    };

    const rows = await this.prisma.salesInvoiceItem.groupBy({
      by: ['itemId'],
      where: { itemId: { not: null }, salesInvoice: invoiceWhere },
      _sum: { quantity: true, lineTotal: true },
      _count: { _all: true },
      orderBy: [{ _sum: { lineTotal: 'desc' } }, { itemId: 'asc' }],
    });
    const itemIds = rows.map((row) => row.itemId).filter((id): id is number => id !== null);
    const items = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, code: true, name: true, unit: { select: { nameFa: true } } },
        })
      : [];
    const itemsById = new Map(items.map((item) => [item.id, item]));

    return {
      period: this.periodEcho(range),
      rows: rows.map((row) => ({
        item: itemsById.get(row.itemId as number) ?? { id: row.itemId as number, code: '', name: '', unit: null },
        quantity: (row._sum.quantity ?? ZERO).toString(),
        revenue: (row._sum.lineTotal ?? ZERO).toString(),
        invoiceLineCount: row._count._all,
      })),
    };
  }

  // Revenue + quantity sold per customer over the same period/filter.
  // SalesInvoiceItem has no customerId of its own, so quantity is folded
  // onto each customer via a small id→customerId lookup (ids only, not full
  // rows) rather than re-deriving the join with raw SQL — same two-step
  // groupBy-then-small-lookup shape DashboardService.getTopSuppliers() already
  // uses for its own per-supplier breakdown.
  async getSalesByCustomer(query: SalesReportPeriodQuery, now: Date = new Date()) {
    const range = resolvePeriodRange(query, now);
    const invoiceWhere: Prisma.SalesInvoiceWhereInput = {
      ...SALES_STATISTICS_INVOICE_WHERE,
      invoiceDate: { gte: range.from, lt: range.toExclusive },
    };

    const [revenueRows, invoices] = await Promise.all([
      this.prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: invoiceWhere,
        _sum: { totalAmount: true },
        _count: { _all: true },
        orderBy: [{ _sum: { totalAmount: 'desc' } }, { customerId: 'asc' }],
      }),
      this.prisma.salesInvoice.findMany({ where: invoiceWhere, select: { id: true, customerId: true } }),
    ]);

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const quantityRows = invoiceIds.length
      ? await this.prisma.salesInvoiceItem.groupBy({ by: ['salesInvoiceId'], where: { salesInvoiceId: { in: invoiceIds } }, _sum: { quantity: true } })
      : [];
    const customerByInvoice = new Map(invoices.map((invoice) => [invoice.id, invoice.customerId]));
    const quantityByCustomer = new Map<number, Prisma.Decimal>();
    for (const row of quantityRows) {
      const customerId = customerByInvoice.get(row.salesInvoiceId);
      if (customerId === undefined) continue;
      quantityByCustomer.set(customerId, (quantityByCustomer.get(customerId) ?? ZERO).plus(row._sum.quantity ?? ZERO));
    }

    const customerIds = revenueRows.map((row) => row.customerId);
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, customerNumber: true, name: true } })
      : [];
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));

    return {
      period: this.periodEcho(range),
      rows: revenueRows.map((row) => ({
        customer: customersById.get(row.customerId) ?? { id: row.customerId, customerNumber: '', name: '' },
        quantity: (quantityByCustomer.get(row.customerId) ?? ZERO).toString(),
        revenue: (row._sum.totalAmount ?? ZERO).toString(),
        invoiceCount: row._count._all,
      })),
    };
  }

  // Daily (or weekly, for long ranges — same DAILY_BUCKET_MAX_DAYS threshold
  // resolvePeriodRange() already applies) trend over three independent
  // series on the same date axis: confirmed-order amount/count
  // (CONFIRMED_SALES_ORDER_WHERE, bucketed by confirmedAt), invoiced revenue
  // (SALES_STATISTICS_INVOICE_WHERE, bucketed by invoiceDate), and payments
  // actually received (COMPLETED_RECEIPT_PAYMENT_WHERE from Receivables,
  // bucketed by paymentDate — a PENDING uncleared cheque never counts, B9).
  async getDailySummary(query: SalesReportPeriodQuery, now: Date = new Date()) {
    const range = resolvePeriodRange(query, now);
    const confirmedWhere: Prisma.SalesOrderWhereInput = {
      ...CONFIRMED_SALES_ORDER_WHERE,
      confirmedAt: { gte: range.from, lt: range.toExclusive },
    };
    const invoiceWhere: Prisma.SalesInvoiceWhereInput = {
      ...SALES_STATISTICS_INVOICE_WHERE,
      invoiceDate: { gte: range.from, lt: range.toExclusive },
    };
    const paymentWhere: Prisma.CustomerPaymentWhereInput = {
      ...COMPLETED_RECEIPT_PAYMENT_WHERE,
      paymentDate: { gte: range.from, lt: range.toExclusive },
    };

    const [confirmedRows, invoiceRows, paymentRows] = await Promise.all([
      this.prisma.salesOrder.groupBy({ by: ['confirmedAt'], where: confirmedWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.salesInvoice.groupBy({ by: ['invoiceDate'], where: invoiceWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.customerPayment.groupBy({ by: ['paymentDate'], where: paymentWhere, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const bucketDays = range.bucket === 'day' ? 1 : 7;
    const bucketCount = Math.ceil(range.days / bucketDays);
    const confirmedBuckets = makeBuckets(range.from, bucketCount, bucketDays);
    const invoiceBuckets = makeBuckets(range.from, bucketCount, bucketDays);
    const paymentBuckets = makeBuckets(range.from, bucketCount, bucketDays);

    for (const row of confirmedRows) {
      if (!row.confirmedAt) continue;
      fold(confirmedBuckets, range.from, bucketDays, row.confirmedAt, row._sum.totalAmount, row._count._all);
    }
    for (const row of invoiceRows) fold(invoiceBuckets, range.from, bucketDays, row.invoiceDate, row._sum.totalAmount, row._count._all);
    for (const row of paymentRows) fold(paymentBuckets, range.from, bucketDays, row.paymentDate, row._sum.amount, row._count._all);

    return {
      period: { ...this.periodEcho(range), bucket: range.bucket },
      trend: confirmedBuckets.map((bucket, index) => ({
        date: toIsoDate(bucket.date),
        confirmedOrderAmount: bucket.amount.toString(),
        confirmedOrderCount: bucket.count,
        invoicedAmount: invoiceBuckets[index].amount.toString(),
        invoicedCount: invoiceBuckets[index].count,
        paymentAmount: paymentBuckets[index].amount.toString(),
        paymentCount: paymentBuckets[index].count,
      })),
    };
  }

  private periodEcho(range: ReturnType<typeof resolvePeriodRange>) {
    return { key: range.period, from: toIsoDate(range.from), to: toIsoDate(addDays(range.toExclusive, -1)) };
  }
}
