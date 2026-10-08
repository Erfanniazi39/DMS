import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { agingBucketOf, AGING_BUCKETS, type AgingBucket } from './receivables-rules';

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

function daysBetween(from: Date, to: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function today() {
  const now = new Date();
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export type AgingRow = Record<AgingBucket, string> & { total: string };

export type StatementEntry = {
  date: string;
  kind: 'INVOICE' | 'RECEIPT' | 'REFUND';
  // Positive increases what the customer owes (an invoice); negative
  // decreases it (a completed receipt/refund in the obvious direction).
  amount: string;
  // Only COMPLETED receipts/refunds and POSTED invoices move the running
  // balance — a PENDING cheque or a CANCELLED payment is still listed (for
  // visibility) with a null runningBalance and settled=false.
  settled: boolean;
  runningBalance: string | null;
  number: string | null;
  id: number;
  note: string | null;
};

// Customer balance / statement / aging — build plan §3/§4.3. Reads Sales
// data only through SalesInvoicesService (the owning module's service, per
// CLAUDE.md rule 11 — never re-derives "what counts as posted/open" from
// the sales_invoices table directly); CustomerPayment/PaymentAllocation are
// this module's own tables, read directly. Never injects CustomersModule —
// a customer's existence is checked by the caller (the controller 404s via
// get()/formOptions() elsewhere), these methods just compute over whatever
// id they're given.
@Injectable()
export class CustomerBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesInvoices: SalesInvoicesService,
  ) {}

  // Σ posted invoices − Σ completed receipts − Σ posted credit notes
  // (Sales batch 6 — unconditional on allocation, same as how a completed
  // receipt counts here in full regardless of how much of it is actually
  // allocated to an invoice) + Σ completed refunds (build plan §3).
  async getBalance(customerId: number): Promise<string> {
    const invoices = (await this.salesInvoices.list({ customerId, status: 'POSTED' })) as unknown as { totalAmount: string }[];
    const invoicedTotal = invoices.reduce((sum, invoice) => sum.plus(dec(invoice.totalAmount)), new Prisma.Decimal(0));
    const [receipts, refunds, creditNotes] = await Promise.all([
      this.prisma.customerPayment.aggregate({ where: { customerId, direction: 'RECEIPT', status: 'COMPLETED' }, _sum: { amount: true } }),
      this.prisma.customerPayment.aggregate({ where: { customerId, direction: 'REFUND', status: 'COMPLETED' }, _sum: { amount: true } }),
      this.prisma.creditNote.aggregate({ where: { customerId, status: 'POSTED' }, _sum: { totalAmount: true } }),
    ]);
    const balance = invoicedTotal
      .minus(dec(receipts._sum.amount ?? 0))
      .minus(dec(creditNotes._sum.totalAmount ?? 0))
      .plus(dec(refunds._sum.amount ?? 0));
    return balance.toString();
  }

  // Chronological ledger: every POSTED invoice and every CustomerPayment
  // (any status — PENDING/CANCELLED rows are shown but don't move the
  // running balance), oldest first.
  async getStatement(customerId: number): Promise<StatementEntry[]> {
    const [invoicesRaw, payments] = await Promise.all([
      this.salesInvoices.list({ customerId, status: 'POSTED' }),
      this.prisma.customerPayment.findMany({ where: { customerId }, orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }] }),
    ]);
    const invoices = invoicesRaw as unknown as { id: number; invoiceNumber: string | null; invoiceDate: Date; totalAmount: string }[];

    const rows: { date: Date; entry: Omit<StatementEntry, 'runningBalance'> }[] = [];
    for (const invoice of invoices) {
      rows.push({
        date: invoice.invoiceDate,
        entry: { date: invoice.invoiceDate.toISOString(), kind: 'INVOICE', amount: invoice.totalAmount, settled: true, number: invoice.invoiceNumber, id: invoice.id, note: null },
      });
    }
    for (const payment of payments) {
      const settled = payment.status === 'COMPLETED';
      const signedAmount = payment.direction === 'RECEIPT' ? dec(payment.amount).negated() : dec(payment.amount);
      rows.push({
        date: payment.paymentDate,
        entry: {
          date: payment.paymentDate.toISOString(),
          kind: payment.direction,
          amount: signedAmount.toString(),
          settled,
          number: payment.paymentNumber,
          id: payment.id,
          note: payment.status === 'PENDING' ? 'در انتظار وصول چک' : payment.status === 'CANCELLED' ? 'لغوشده — در مانده حساب نیست' : null,
        },
      });
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    let running = new Prisma.Decimal(0);
    return rows.map(({ entry }) => {
      if (entry.settled) running = running.plus(dec(entry.amount));
      return { ...entry, runningBalance: entry.settled ? running.toString() : null };
    });
  }

  // The customer's open invoices (SalesInvoicesService.listOpenForCustomer(),
  // oldest-due-first) — used by both the receipt form's allocation grid and
  // the customer's "حساب مشتری" section.
  async getOpenInvoices(customerId: number) {
    return this.prisma.$transaction((tx) => this.salesInvoices.listOpenForCustomer(tx, customerId));
  }

  // Single customer's aging buckets, from SalesInvoicesService.listOpenForCustomer().
  async getCustomerAging(customerId: number): Promise<AgingRow> {
    const open = await this.prisma.$transaction((tx) => this.salesInvoices.listOpenForCustomer(tx, customerId));
    return this.bucketize(open.map((invoice) => ({ dueDate: invoice.dueDate, openAmount: invoice.openAmount })));
  }

  // All customers with at least one open invoice, for the «سالمندی مطالبات»
  // report page — a per-customer loop over listOpenForCustomer() (the
  // owning module's method), not a direct query against sales_invoices for
  // "what counts as open" (CLAUDE.md rule 11). Acceptable N+1 for this
  // system's scale (an on-premise, small-team ERP — build plan §1).
  async getAgingReport(): Promise<{ customerId: number; customerNumber: string; customerName: string; aging: AgingRow }[]> {
    const customers = await this.prisma.customer.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: { id: true, customerNumber: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const rows: { customerId: number; customerNumber: string; customerName: string; aging: AgingRow }[] = [];
    for (const customer of customers) {
      const open = await this.prisma.$transaction((tx) => this.salesInvoices.listOpenForCustomer(tx, customer.id));
      if (open.length === 0) continue;
      rows.push({
        customerId: customer.id,
        customerNumber: customer.customerNumber,
        customerName: customer.name,
        aging: this.bucketize(open.map((invoice) => ({ dueDate: invoice.dueDate, openAmount: invoice.openAmount }))),
      });
    }
    return rows;
  }

  private bucketize(lines: { dueDate: Date | null; openAmount: Prisma.Decimal }[]): AgingRow {
    const now = today();
    const sums: Record<AgingBucket, Prisma.Decimal> = {
      CURRENT: new Prisma.Decimal(0),
      D1_30: new Prisma.Decimal(0),
      D31_60: new Prisma.Decimal(0),
      D61_90: new Prisma.Decimal(0),
      D90_PLUS: new Prisma.Decimal(0),
    };
    for (const line of lines) {
      const daysOverdue = line.dueDate ? daysBetween(line.dueDate, now) : 0;
      const bucket = agingBucketOf(daysOverdue);
      sums[bucket] = sums[bucket].plus(line.openAmount);
    }
    const total = AGING_BUCKETS.reduce((sum, bucket) => sum.plus(sums[bucket]), new Prisma.Decimal(0));
    return { ...(Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, sums[bucket].toString()])) as Record<AgingBucket, string>), total: total.toString() };
  }
}
