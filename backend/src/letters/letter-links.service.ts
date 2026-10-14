import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

type Resolver = {
  // The view permission of the page the link opens — a link is only returned
  // to a reader who could open that page anyway (nothing is revealed).
  permission: string;
  href: (id: number) => string;
  find: (db: Db, code: string) => Promise<{ id: number } | null>;
};

// Document code → the page it opens. Read-only "does this code exist" lookups
// straight on the owning tables (CLAUDE.md rule 11's documented exception for
// simple existence lookups); no business rule is re-derived here.
const SELECT_ID = { select: { id: true } } as const;
const DOCUMENT_RESOLVERS: Record<string, Resolver> = {
  PUR: { permission: 'purchases.view', href: (id) => `/purchases/${id}`, find: (db, code) => db.purchase.findUnique({ where: { purchaseNumber: code }, ...SELECT_ID }) },
  REQ: { permission: 'purchases.view', href: (id) => `/purchase-requests/${id}`, find: (db, code) => db.purchaseRequest.findUnique({ where: { requestNumber: code }, ...SELECT_ID }) },
  SO: { permission: 'sales.view', href: (id) => `/sales-orders/${id}`, find: (db, code) => db.salesOrder.findUnique({ where: { orderNumber: code }, ...SELECT_ID }) },
  DN: { permission: 'sales.view', href: (id) => `/deliveries/${id}`, find: (db, code) => db.delivery.findUnique({ where: { deliveryNumber: code }, ...SELECT_ID }) },
  INV: { permission: 'sales.view', href: (id) => `/sales-invoices/${id}`, find: (db, code) => db.salesInvoice.findUnique({ where: { invoiceNumber: code }, ...SELECT_ID }) },
  RMA: { permission: 'sales.view', href: (id) => `/sales-returns/${id}`, find: (db, code) => db.salesReturn.findUnique({ where: { returnNumber: code }, ...SELECT_ID }) },
  RCP: { permission: 'receivables.view', href: (id) => `/receipts/${id}`, find: (db, code) => db.customerPayment.findUnique({ where: { paymentNumber: code }, ...SELECT_ID }) },
  RFD: { permission: 'receivables.view', href: (id) => `/receipts/${id}`, find: (db, code) => db.customerPayment.findUnique({ where: { paymentNumber: code }, ...SELECT_ID }) },
  CUS: { permission: 'customers.view', href: (id) => `/customers/${id}`, find: (db, code) => db.customer.findUnique({ where: { customerNumber: code }, ...SELECT_ID }) },
  ADJ: { permission: 'inventory.view', href: (id) => `/inventory/adjustments/${id}`, find: (db, code) => db.stockAdjustment.findUnique({ where: { adjustmentNumber: code }, ...SELECT_ID }) },
  GRN: { permission: 'inventory.view', href: (id) => `/inventory/receipts/${id}`, find: (db, code) => db.goodsReceipt.findUnique({ where: { receiptNumber: code }, ...SELECT_ID }) },
  PRD: { permission: 'inventory.view', href: (id) => `/inventory/production/${id}`, find: (db, code) => db.productionOutput.findUnique({ where: { outputNumber: code }, ...SELECT_ID }) },
};

// Anything that is not a document code is tried as an item code (the stock card).
const ITEM_RESOLVER: Resolver = {
  permission: 'inventory.view',
  href: (id) => `/inventory/items/${id}`,
  find: (db, code) => db.item.findUnique({ where: { code }, ...SELECT_ID }),
};

export const MAX_RESOLVE_CODES = 30;

export type ResolvedLetterLink = { code: string; href: string };

// Letters carry only the CODE (SO-1405-000020, CUS-000003, an item code…), never
// a copy of the data — at view time a code that names a real record the reader
// may open becomes a one-click link to it; anything else stays plain text.
@Injectable()
export class LetterLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(codes: string[], permissions: readonly string[]): Promise<ResolvedLetterLink[]> {
    const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))].slice(0, MAX_RESOLVE_CODES);
    const results = await Promise.all(unique.map((code) => this.resolveOne(code, permissions)));
    return results.filter((link): link is ResolvedLetterLink => link !== null);
  }

  private async resolveOne(code: string, permissions: readonly string[]): Promise<ResolvedLetterLink | null> {
    const documentResolver = DOCUMENT_RESOLVERS[code.split('-')[0].toUpperCase()];
    // Document numbers are always uppercase; match them exactly (case-insensitive typing is not guessed at).
    if (documentResolver && code === code.toUpperCase() && permissions.includes(documentResolver.permission)) {
      const found = await documentResolver.find(this.prisma, code);
      if (found) return { code, href: documentResolver.href(found.id) };
    }
    if (permissions.includes(ITEM_RESOLVER.permission)) {
      const item = await ITEM_RESOLVER.find(this.prisma, code);
      if (item) return { code, href: ITEM_RESOLVER.href(item.id) };
    }
    return null;
  }
}
