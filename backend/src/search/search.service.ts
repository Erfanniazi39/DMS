import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_PER_GROUP = 5;

export type SearchHit = { id: number; title: string; subtitle: string | null; href: string };
export type SearchGroup = { key: string; label: string; hits: SearchHit[] };

type Provider = {
  key: string;
  label: string;
  // The view permission of the page the hit opens — a hit is only returned to
  // someone who could open that page anyway (nothing is revealed).
  permission: string;
  run: (db: PrismaService, q: string, take: number) => Promise<SearchHit[]>;
};

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const orEmpty = (value: string | null | undefined) => (value && value.trim() ? value : null);

// Header search (جستجو در سامانه). Read-only lookups on the owning tables for
// display — the same documented exception to rule 11 as letter-links.service.ts
// (existence/display lookups; no business rule is re-derived). Letters are
// deliberately NOT searched: their visibility is per-letter (sender/recipient)
// and lives in the Letters module.
const PROVIDERS: Provider[] = [
  {
    key: 'purchases', label: 'خریدها', permission: 'purchases.view',
    run: async (db, q, take) =>
      (await db.purchase.findMany({
        where: { purchaseNumber: contains(q) }, take, orderBy: { id: 'desc' },
        select: { id: true, purchaseNumber: true, supplier: { select: { name: true } } },
      })).map((r) => ({ id: r.id, title: r.purchaseNumber, subtitle: orEmpty(r.supplier?.name), href: `/purchases/${r.id}` })),
  },
  {
    key: 'purchaseRequests', label: 'درخواست‌های خرید', permission: 'purchases.view',
    run: async (db, q, take) =>
      (await db.purchaseRequest.findMany({ where: { requestNumber: contains(q) }, take, orderBy: { id: 'desc' }, select: { id: true, requestNumber: true } }))
        .map((r) => ({ id: r.id, title: r.requestNumber, subtitle: null, href: `/purchase-requests/${r.id}` })),
  },
  {
    key: 'salesOrders', label: 'سفارش‌های فروش', permission: 'sales.view',
    run: async (db, q, take) =>
      (await db.salesOrder.findMany({
        where: { OR: [{ orderNumber: contains(q) }, { customerName: contains(q) }] }, take, orderBy: { id: 'desc' },
        select: { id: true, orderNumber: true, customerName: true },
      })).map((r) => ({ id: r.id, title: r.orderNumber ?? `پیش‌نویس #${r.id}`, subtitle: r.customerName, href: `/sales-orders/${r.id}` })),
  },
  {
    key: 'deliveries', label: 'تحویل‌ها', permission: 'sales.view',
    run: async (db, q, take) =>
      (await db.delivery.findMany({ where: { deliveryNumber: contains(q) }, take, orderBy: { id: 'desc' }, select: { id: true, deliveryNumber: true } }))
        .map((r) => ({ id: r.id, title: r.deliveryNumber ?? `#${r.id}`, subtitle: null, href: `/deliveries/${r.id}` })),
  },
  {
    key: 'salesInvoices', label: 'فاکتورهای فروش', permission: 'sales.view',
    run: async (db, q, take) =>
      (await db.salesInvoice.findMany({
        where: { OR: [{ invoiceNumber: contains(q) }, { customerName: contains(q) }] }, take, orderBy: { id: 'desc' },
        select: { id: true, invoiceNumber: true, customerName: true },
      })).map((r) => ({ id: r.id, title: r.invoiceNumber ?? `پیش‌نویس #${r.id}`, subtitle: r.customerName, href: `/sales-invoices/${r.id}` })),
  },
  {
    key: 'receipts', label: 'دریافت‌ها', permission: 'receivables.view',
    run: async (db, q, take) =>
      (await db.customerPayment.findMany({ where: { paymentNumber: contains(q) }, take, orderBy: { id: 'desc' }, select: { id: true, paymentNumber: true } }))
        .map((r) => ({ id: r.id, title: r.paymentNumber, subtitle: null, href: `/receipts/${r.id}` })),
  },
  {
    key: 'customers', label: 'مشتریان', permission: 'customers.view',
    run: async (db, q, take) =>
      (await db.customer.findMany({
        where: { OR: [{ customerNumber: contains(q) }, { name: contains(q) }, { legalName: contains(q) }] }, take, orderBy: { id: 'desc' },
        select: { id: true, customerNumber: true, name: true },
      })).map((r) => ({ id: r.id, title: r.name, subtitle: r.customerNumber, href: `/customers/${r.id}` })),
  },
  {
    key: 'suppliers', label: 'تأمین‌کنندگان', permission: 'suppliers.view',
    run: async (db, q, take) =>
      (await db.supplier.findMany({ where: { OR: [{ code: contains(q) }, { name: contains(q) }] }, take, orderBy: { id: 'desc' }, select: { id: true, code: true, name: true } }))
        .map((r) => ({ id: r.id, title: r.name, subtitle: r.code, href: `/suppliers/${r.id}` })),
  },
  {
    key: 'items', label: 'کالاها', permission: 'items.view',
    run: async (db, q, take) =>
      (await db.item.findMany({ where: { OR: [{ code: contains(q) }, { name: contains(q) }] }, take, orderBy: { id: 'desc' }, select: { id: true, code: true, name: true } }))
        .map((r) => ({ id: r.id, title: r.name, subtitle: r.code, href: `/items?q=${encodeURIComponent(r.code)}` })),
  },
  {
    key: 'adjustments', label: 'اصلاح موجودی', permission: 'inventory.view',
    run: async (db, q, take) =>
      (await db.stockAdjustment.findMany({ where: { adjustmentNumber: contains(q) }, take, orderBy: { id: 'desc' }, select: { id: true, adjustmentNumber: true } }))
        .map((r) => ({ id: r.id, title: r.adjustmentNumber ?? `#${r.id}`, subtitle: null, href: `/inventory/adjustments/${r.id}` })),
  },
  {
    key: 'goodsReceipts', label: 'رسیدهای انبار', permission: 'inventory.view',
    run: async (db, q, take) =>
      (await db.goodsReceipt.findMany({
        where: { OR: [{ receiptNumber: contains(q) }, { supplierName: contains(q) }] }, take, orderBy: { id: 'desc' },
        select: { id: true, receiptNumber: true, supplierName: true },
      })).map((r) => ({ id: r.id, title: r.receiptNumber ?? `پیش‌نویس #${r.id}`, subtitle: r.supplierName, href: `/inventory/receipts/${r.id}` })),
  },
  {
    key: 'productionOutputs', label: 'رسیدهای تولید', permission: 'inventory.view',
    run: async (db, q, take) =>
      (await db.productionOutput.findMany({ where: { outputNumber: contains(q) }, take, orderBy: { id: 'desc' }, select: { id: true, outputNumber: true } }))
        .map((r) => ({ id: r.id, title: r.outputNumber ?? `#${r.id}`, subtitle: null, href: `/inventory/production/${r.id}` })),
  },
  {
    key: 'users', label: 'کاربران', permission: 'users.create',
    run: async (db, q, take) => {
      const where: Prisma.UserWhereInput = { OR: [{ username: contains(q) }, { fullName: contains(q) }] };
      return (await db.user.findMany({ where, take, orderBy: { id: 'asc' }, select: { id: true, username: true, fullName: true } }))
        .map((r) => ({ id: r.id, title: r.username, subtitle: orEmpty(r.fullName), href: `/admin/users/${r.id}` }));
    },
  },
];

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(rawQuery: string, permissions: readonly string[]): Promise<{ query: string; groups: SearchGroup[] }> {
    const q = rawQuery.trim().slice(0, 80);
    if (q.length < SEARCH_MIN_LENGTH) return { query: q, groups: [] };
    const allowed = PROVIDERS.filter((provider) => permissions.includes(provider.permission));
    const results = await Promise.all(allowed.map(async (provider) => ({ provider, hits: await provider.run(this.prisma, q, SEARCH_PER_GROUP) })));
    return {
      query: q,
      groups: results.filter((r) => r.hits.length > 0).map((r) => ({ key: r.provider.key, label: r.provider.label, hits: r.hits })),
    };
  }
}
