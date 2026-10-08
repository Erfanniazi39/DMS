import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SalesDocumentStatus, type SalesPaymentStatus, type SalesSourceType } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { toIsoDay } from '../common/zod-fields';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { getCustomerCreditPolicy } from '../customers/customer-rules';
import { PrismaService } from '../prisma/prisma.service';
import { applyInvoicedQuantities, deriveInvoicePaymentStatus, invoiceOpenAmount, recomputeOrderProgress, type OrderProgress } from './sales-progress';
import {
  EDITABLE_SALES_DOCUMENT_STATUSES,
  formatAddress,
  OPEN_SALES_INVOICE_WHERE,
  OPENING_BALANCE_ITEM_NAME,
  SALES_DOCUMENT_STATUS_LABELS_FA,
  SALES_INVOICE_DOC_TYPE,
  SALES_INVOICE_DRAFT_EXISTS,
  SALES_INVOICING_STATUS_LABELS_FA,
} from './sales-rules';
import { computeLineAmounts, invoiceLineDiscount, sumDocumentTotals } from './sales-totals';
import type { CreateOpeningBalanceInvoiceDto, CreateSalesInvoiceDto, PostSalesInvoiceDto } from './dto/sales-invoice.dto';

export type SalesInvoiceActor = { userId: number | null; ipAddress?: string };

export type SalesInvoiceListFilters = {
  q?: string;
  status?: SalesDocumentStatus;
  sourceType?: SalesSourceType;
  paymentStatus?: SalesPaymentStatus;
  overdue?: boolean;
  customerId?: number;
  salesOrderId?: number;
  deliveryId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

type Money = Prisma.Decimal | number | string;

// Absolute settlement figures for one invoice, recomputed by Receivables
// from the invoice's active allocations (build plan §3 / §6:
// receivables/settlement.ts recomputeInvoiceSettlement() → applySettlement()).
export type InvoiceSettlementSums = { paidAmount: Money; creditedAmount: Money };

export type OpenSalesInvoice = {
  id: number;
  invoiceNumber: string | null;
  sourceType: SalesSourceType;
  salesOrderId: number | null;
  invoiceDate: Date;
  dueDate: Date | null;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  creditedAmount: Prisma.Decimal;
  paymentStatus: SalesPaymentStatus;
  openAmount: Prisma.Decimal;
};

const userSelect = { select: { id: true, username: true } } as const;

const salesInvoiceDetailInclude = {
  customer: { select: { id: true, customerNumber: true, name: true } },
  salesOrder: {
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      status: true,
      invoicingStatus: true,
      customerReference: true,
      customerNote: true,
    },
  },
  createdByUser: userSelect,
  postedByUser: userSelect,
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      deliveryItem: {
        select: { id: true, quantity: true, invoicedQty: true, delivery: { select: { id: true, deliveryNumber: true, deliveryDate: true } } },
      },
      salesOrderItem: { select: { id: true, lineNo: true } },
    },
  },
} satisfies Prisma.SalesInvoiceInclude;

const DAY_MS = 24 * 60 * 60 * 1000;

// Today as a business date (UTC midnight of the calendar day — the same
// convention as every user-entered date, see common/zod-fields.ts toIsoDay()).
function today() {
  return new Date(`${toIsoDay(new Date())}T00:00:00.000Z`);
}

const dec = (value: Money) => new Prisma.Decimal(value);

// The customer's POSTED invoices that still have an open amount
// (total − paid − credited > 0), oldest due first — the order Receivables
// will suggest allocating a receipt in. Includes OPENING_BALANCE invoices
// (they are money owed, just not sales). DI-free so sales-credit.ts
// computeExposure() uses the very same definition of "open".
export async function listOpenInvoices(tx: Prisma.TransactionClient, customerId: number): Promise<OpenSalesInvoice[]> {
  const rows = await tx.salesInvoice.findMany({
    where: { ...OPEN_SALES_INVOICE_WHERE, customerId },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { invoiceDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      invoiceNumber: true,
      sourceType: true,
      salesOrderId: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      paidAmount: true,
      creditedAmount: true,
      paymentStatus: true,
    },
  });
  return rows.map((row) => ({ ...row, openAmount: invoiceOpenAmount(row) })).filter((row) => row.openAmount.greaterThan(0));
}

// فاکتور فروش — lifecycle per docs/sales-module-build-plan.md §5:
//
//   createFromDelivery  DRAFT for a POSTED delivery (B7: one invoice per
//                       delivery — a second draft is refused). Lines = every
//                       delivery line's not-yet-invoiced quantity
//                       (quantity − invoicedQty), priced from its order line
//                       (unit price, discount, tax rate). No number, no effect.
//   createOpeningBalance DRAFT, sourceType OPENING_BALANCE, no order /
//                       delivery: historical receivables (build plan §4.2).
//   remove              DRAFT only.
//   post                DRAFT → POSTED, one-way; POSTED is immutable.
//   applySettlement     the ONLY writer of paidAmount / creditedAmount /
//                       paymentStatus — called by Receivables (Batch 5).
//
// Posting is one transaction: lock the invoice, lock its order (if any) and
// re-check each line still fits its delivery line's uninvoiced quantity
// (quantity − invoicedQty), claim the gap-free INV-<jalali year>-NNNNNN
// number, set dueDate = invoiceDate + paymentDueDays, add the quantities to
// DeliveryItem.invoicedQty and SalesOrderItem.invoicedQty and recompute the
// order's derived statuses (invoicingStatus, CONFIRMED → COMPLETED) via
// sales-progress.ts, mark POSTED, audit. Any failure rolls all of it back —
// including the number (no gap).
//
// Lock order: invoice → sales order (same direction as delivery → sales
// order in DeliveriesService.post(); neither path locks the other's
// document after the order, so they can't deadlock).
//
// A customer on credit hold does NOT block invoicing: the goods have already
// been issued, and billing them is what makes the debt collectable (the hold
// blocks new orders and deliveries).
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as the other list endpoints.
  async list(filters: SalesInvoiceListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.SalesInvoiceWhereInput = {};
    const and: Prisma.SalesInvoiceWhereInput[] = [];
    if (filters.q) {
      and.push({
        OR: [
          { invoiceNumber: { contains: filters.q, mode: 'insensitive' } },
          { customerName: { contains: filters.q, mode: 'insensitive' } },
          { salesOrder: { orderNumber: { contains: filters.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (filters.status) where.status = filters.status;
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;
    if (filters.deliveryId) and.push({ items: { some: { deliveryItem: { deliveryId: filters.deliveryId } } } });
    if (filters.overdue) and.push({ status: 'POSTED', paymentStatus: { not: 'PAID' }, dueDate: { lt: today() } });
    if (filters.dateFrom || filters.dateTo) {
      where.invoiceDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    if (and.length > 0) where.AND = and;
    const query = {
      where,
      orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, customerNumber: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.SalesInvoiceFindManyArgs;

    if (!pagination) return this.prisma.salesInvoice.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.salesInvoice.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  // Work queue: POSTED deliveries with at least one line that no POSTED
  // invoice covers yet (with one invoice per delivery covering every
  // uninvoiced line — B7 — that is exactly "not yet invoiced"), oldest
  // first. draftInvoiceId: an existing draft for the delivery, if any.
  async queue(q?: string, pagination?: PaginationParams) {
    const where: Prisma.DeliveryWhereInput = {
      status: 'POSTED',
      items: { some: { invoiceItems: { none: { salesInvoice: { status: 'POSTED' } } } } },
    };
    if (q) {
      where.OR = [
        { deliveryNumber: { contains: q, mode: 'insensitive' } },
        { salesOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { salesOrder: { customerName: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const query = {
      where,
      orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        deliveryNumber: true,
        deliveryDate: true,
        customerId: true,
        salesOrderId: true,
        salesOrder: { select: { id: true, orderNumber: true, customerName: true } },
        customer: { select: { id: true, customerNumber: true } },
        items: {
          select: {
            quantity: true,
            invoicedQty: true,
            invoiceItems: { where: { salesInvoice: { status: 'DRAFT' } }, select: { salesInvoiceId: true } },
          },
        },
      },
    } satisfies Prisma.DeliveryFindManyArgs;

    const shape = (rows: Prisma.DeliveryGetPayload<typeof query>[]) =>
      rows.map(({ items, ...delivery }) => ({
        ...delivery,
        lineCount: items.length,
        openLineCount: items.filter((line) => dec(line.quantity).greaterThan(dec(line.invoicedQty))).length,
        draftInvoiceId: items.flatMap((line) => line.invoiceItems.map((entry) => entry.salesInvoiceId))[0] ?? null,
      }));

    if (!pagination) return shape(await this.prisma.delivery.findMany(query));
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items: shape(rows), total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const invoice = await this.prisma.salesInvoice.findUnique({ where: { id }, include: salesInvoiceDetailInclude });
    if (!invoice) throw new NotFoundException('فاکتور فروش پیدا نشد');
    return invoice;
  }

  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.SALES_INVOICE, id);
  }

  // Opening-balance form picker: every customer that isn't archived (an
  // inactive or held customer may still owe historical money). Read-only
  // display lookup (CLAUDE.md rule 11's documented exception).
  async formOptions() {
    const customers = await this.prisma.customer.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: { id: true, customerNumber: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { customers };
  }

  // The customer's open invoices (see listOpenInvoices()) — the method
  // Receivables (Batch 5) calls.
  listOpenForCustomer(tx: Prisma.TransactionClient, customerId: number) {
    return listOpenInvoices(tx, customerId);
  }

  // HTTP entry point: one transaction around createFromDelivery().
  async create(dto: CreateSalesInvoiceDto, actor: SalesInvoiceActor) {
    const id = await this.prisma.$transaction((tx) => this.createFromDelivery(tx, dto.deliveryId, { invoiceDate: dto.invoiceDate, note: dto.note }, actor));
    return this.get(id);
  }

  // DRAFT invoice for a POSTED delivery, inside the caller's transaction
  // (the future quick-sale screen chains order → delivery → invoice →
  // payment in one). Returns the new invoice's id.
  async createFromDelivery(
    tx: Prisma.TransactionClient,
    deliveryId: number,
    input: { invoiceDate?: Date; note?: string },
    actor: SalesInvoiceActor,
  ): Promise<number> {
    // Serializes two "create invoice" clicks for the same delivery — the
    // second sees the first's draft and is refused.
    await tx.$queryRaw`SELECT id FROM deliveries WHERE id = ${deliveryId} FOR UPDATE`;
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        deliveryNumber: true,
        deliveryDate: true,
        status: true,
        customerId: true,
        salesOrder: { select: { id: true, orderNumber: true, paymentTermName: true, paymentDueDays: true } },
        items: {
          orderBy: { salesOrderItem: { lineNo: 'asc' } },
          select: {
            id: true,
            itemId: true,
            quantity: true,
            invoicedQty: true,
            salesOrderItem: {
              select: {
                id: true,
                lineNo: true,
                itemCode: true,
                itemName: true,
                unitName: true,
                quantity: true,
                unitPrice: true,
                discountPercent: true,
                discountAmount: true,
                taxRate: true,
              },
            },
            invoiceItems: { where: { salesInvoice: { status: 'DRAFT' } }, select: { salesInvoiceId: true } },
          },
        },
      },
    });
    if (!delivery) throw new NotFoundException('حواله تحویل پیدا نشد');
    if (delivery.status !== 'POSTED') throw new ConflictException('فقط برای حوالهٔ «ثبت‌شده» می‌توان فاکتور صادر کرد');

    const existingDraft = delivery.items.flatMap((line) => line.invoiceItems.map((entry) => entry.salesInvoiceId))[0];
    if (existingDraft) {
      throw new ConflictException({
        statusCode: 409,
        code: SALES_INVOICE_DRAFT_EXISTS,
        message: 'برای این حواله یک فاکتور پیش‌نویس وجود دارد؛ همان را ثبت یا حذف کنید.',
        details: { salesInvoiceId: existingDraft },
      });
    }

    const open = delivery.items
      .map((line) => ({ line, remaining: dec(line.quantity).minus(dec(line.invoicedQty)) }))
      .filter((entry) => entry.remaining.greaterThan(0));
    if (open.length === 0) throw new ConflictException('همهٔ اقلام این حواله فاکتور شده است');

    const invoiceDate = input.invoiceDate ?? (today() < delivery.deliveryDate ? delivery.deliveryDate : today());
    if (invoiceDate.getTime() < delivery.deliveryDate.getTime()) throw new BadRequestException('تاریخ فاکتور نمی‌تواند پیش از تاریخ تحویل باشد');

    const lines = open.map(({ line, remaining }, index) => {
      const orderLine = line.salesOrderItem;
      const amounts = computeLineAmounts(
        { quantity: remaining, unitPrice: orderLine.unitPrice, taxRate: orderLine.taxRate, ...invoiceLineDiscount(orderLine, remaining) },
        `ردیف ${orderLine.lineNo}`,
      );
      return {
        amounts,
        data: {
          lineNo: index + 1,
          deliveryItemId: line.id,
          salesOrderItemId: orderLine.id,
          itemId: line.itemId,
          itemCode: orderLine.itemCode,
          itemName: orderLine.itemName,
          unitName: orderLine.unitName,
          quantity: remaining,
          unitPrice: orderLine.unitPrice,
          discountAmount: amounts.discountAmount,
          taxRate: amounts.taxRate,
          taxAmount: amounts.taxAmount,
          lineTotal: amounts.lineTotal,
        },
      };
    });
    const totals = sumDocumentTotals(
      lines.map((line) => line.amounts),
      { documentLabel: 'فاکتور', requirePositive: false },
    );
    const customer = await this.customerSnapshot(tx, delivery.customerId);

    const invoice = await tx.salesInvoice.create({
      data: {
        sourceType: 'OPERATIONAL',
        customerId: delivery.customerId,
        salesOrderId: delivery.salesOrder.id,
        invoiceDate,
        status: 'DRAFT',
        ...customer,
        // The terms agreed on the order (snapshotted there at confirmation).
        paymentTermName: delivery.salesOrder.paymentTermName,
        paymentDueDays: delivery.salesOrder.paymentDueDays,
        ...totals,
        note: input.note ?? null,
        createdByUserId: actor.userId,
        items: { create: lines.map((line) => line.data) },
      },
      select: { id: true },
    });
    await this.audit.log(
      {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: 'SALES_INVOICE_CREATED',
        entityType: AUDIT_ENTITY.SALES_INVOICE,
        entityId: invoice.id,
        details: `پیش‌نویس — حواله ${delivery.deliveryNumber ?? `#${delivery.id}`}، ${lines.length} ردیف، جمع ${totals.totalAmount.toString()}`,
      },
      tx,
    );
    return invoice.id;
  }

  // DRAFT opening-balance invoice: historical receivables, no order or
  // delivery (build plan §4.2). Payment term from the customer's current
  // financial profile. Excluded from every sales statistic
  // (SALES_STATISTICS_INVOICE_WHERE) but counted as money owed.
  async createOpeningBalance(dto: CreateOpeningBalanceInvoiceDto, actor: SalesInvoiceActor) {
    const lines = dto.items.map((line, index) => {
      const amounts = computeLineAmounts({ quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate }, `ردیف ${index + 1}`);
      return {
        amounts,
        data: {
          lineNo: index + 1,
          itemName: line.itemName ?? OPENING_BALANCE_ITEM_NAME,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: 0,
          taxRate: amounts.taxRate,
          taxAmount: amounts.taxAmount,
          lineTotal: amounts.lineTotal,
        },
      };
    });
    const totals = sumDocumentTotals(
      lines.map((line) => line.amounts),
      { documentLabel: 'فاکتور', requirePositive: true },
    );

    const id = await this.prisma.$transaction(async (tx) => {
      const customer = await this.customerSnapshot(tx, dto.customerId);
      const policy = await getCustomerCreditPolicy(tx, dto.customerId);
      const invoice = await tx.salesInvoice.create({
        data: {
          sourceType: 'OPENING_BALANCE',
          customerId: dto.customerId,
          salesOrderId: null,
          invoiceDate: dto.invoiceDate,
          status: 'DRAFT',
          ...customer,
          paymentTermName: policy.paymentTerm?.nameFa ?? null,
          paymentDueDays: policy.paymentTerm?.dueDays ?? 0,
          ...totals,
          note: dto.note ?? null,
          createdByUserId: actor.userId,
          items: { create: lines.map((line) => line.data) },
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_INVOICE_CREATED',
          entityType: AUDIT_ENTITY.SALES_INVOICE,
          entityId: invoice.id,
          details: `پیش‌نویس مانده افتتاحیه — ${customer.customerName}، ${lines.length} ردیف، جمع ${totals.totalAmount.toString()}`,
        },
        tx,
      );
      return invoice.id;
    });
    return this.get(id);
  }

  // DRAFT only — it has no number, so deleting it leaves no gap. Lines
  // cascade. A POSTED invoice has no delete path — ever.
  async remove(id: number, actor: SalesInvoiceActor) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, id);
      const invoice = await tx.salesInvoice.findUnique({ where: { id }, select: { id: true, status: true, customerName: true, sourceType: true } });
      if (!invoice) throw new NotFoundException('فاکتور فروش پیدا نشد');
      if (!EDITABLE_SALES_DOCUMENT_STATUSES.includes(invoice.status)) {
        throw new ConflictException(
          `فقط فاکتور «پیش‌نویس» قابل حذف است؛ این فاکتور «${SALES_DOCUMENT_STATUS_LABELS_FA[invoice.status]}» است و قابل حذف نیست.`,
        );
      }
      await tx.salesInvoice.delete({ where: { id } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_INVOICE_DELETED',
          entityType: AUDIT_ENTITY.SALES_INVOICE,
          entityId: id,
          details: `پیش‌نویس${invoice.sourceType === 'OPENING_BALANCE' ? ' مانده افتتاحیه' : ''} — ${invoice.customerName}`,
        },
        tx,
      );
    });
    return { success: true };
  }

  // HTTP entry point: DRAFT → POSTED in one transaction (optimistic lock on
  // updatedAt).
  async post(id: number, dto: PostSalesInvoiceDto, actor: SalesInvoiceActor) {
    await this.prisma.$transaction((tx) => this.postWithin(tx, id, actor, { expectedVersion: dto.updatedAt }));
    return this.get(id);
  }

  // DRAFT → POSTED inside the caller's transaction. See the class comment.
  async postWithin(tx: Prisma.TransactionClient, id: number, actor: SalesInvoiceActor, options: { expectedVersion?: Date } = {}) {
    await this.lockInvoice(tx, id);
    const invoice = await tx.salesInvoice.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } } } });
    if (!invoice) throw new NotFoundException('فاکتور فروش پیدا نشد');
    if (invoice.status === 'POSTED') throw new ConflictException('این فاکتور قبلاً ثبت شده است');
    if (options.expectedVersion && !isSameVersion(invoice.updatedAt, options.expectedVersion)) throw recordModifiedConflict();
    if (invoice.items.length === 0) throw new BadRequestException('فاکتور بدون ردیف قابل ثبت نیست');

    let order: { id: number; orderNumber: string | null } | null = null;
    const deliveryNumbers = new Map<number, string | null>();
    if (invoice.sourceType === 'OPERATIONAL') {
      if (invoice.salesOrderId === null) throw new ConflictException('این فاکتور به سفارش فروش متصل نیست');
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${invoice.salesOrderId} FOR UPDATE`;
      const loaded = await tx.salesOrder.findUnique({
        where: { id: invoice.salesOrderId },
        select: { id: true, orderNumber: true, items: { select: { id: true, lineNo: true, invoicedQty: true } } },
      });
      if (!loaded) throw new NotFoundException('سفارش فروش پیدا نشد');
      order = loaded;

      // Re-check against the counters as they are NOW (another invoice for
      // the same delivery lines may have been posted since this draft).
      const deliveryItemIds = invoice.items.map((line) => line.deliveryItemId).filter((value): value is number => value !== null);
      const deliveryItems = await tx.deliveryItem.findMany({
        where: { id: { in: deliveryItemIds } },
        select: { id: true, salesOrderItemId: true, quantity: true, invoicedQty: true, delivery: { select: { id: true, status: true, deliveryNumber: true } } },
      });
      const deliveryItemById = new Map(deliveryItems.map((line) => [line.id, line]));
      const orderLineById = new Map(loaded.items.map((line) => [line.id, line]));
      // Several invoice lines on one delivery line (not produced today) are
      // checked against their running total.
      const claimed = new Map<number, Prisma.Decimal>();
      const updates = invoice.items.map((line) => {
        const deliveryItem = line.deliveryItemId === null ? undefined : deliveryItemById.get(line.deliveryItemId);
        if (!deliveryItem || deliveryItem.delivery.status !== 'POSTED') {
          throw new ConflictException(`ردیف ${line.lineNo} («${line.itemName}»): ردیف حوالهٔ ثبت‌شدهٔ مربوط پیدا نشد`);
        }
        const orderLine = orderLineById.get(deliveryItem.salesOrderItemId);
        if (!orderLine) throw new ConflictException(`ردیف ${line.lineNo} («${line.itemName}»): ردیف سفارش مربوط پیدا نشد`);
        const already = claimed.get(deliveryItem.id) ?? new Prisma.Decimal(0);
        const open = dec(deliveryItem.quantity).minus(dec(deliveryItem.invoicedQty)).minus(already);
        if (dec(line.quantity).greaterThan(open)) {
          throw new ConflictException(
            `ردیف ${line.lineNo} («${line.itemName}»): مقدار این فاکتور (${dec(line.quantity).toString()}) از مقدار فاکتورنشدهٔ حواله (${open.toString()}) بیشتر است — احتمالاً فاکتور دیگری برای این حواله ثبت شده است. این پیش‌نویس را حذف و دوباره ایجاد کنید.`,
          );
        }
        claimed.set(deliveryItem.id, already.plus(dec(line.quantity)));
        deliveryNumbers.set(deliveryItem.delivery.id, deliveryItem.delivery.deliveryNumber);
        return {
          deliveryItemId: deliveryItem.id,
          deliveryItemInvoicedQty: dec(deliveryItem.invoicedQty).plus(already),
          salesOrderItemId: orderLine.id,
          salesOrderItemInvoicedQty: orderLine.invoicedQty,
          quantity: line.quantity,
        };
      });
      await applyInvoicedQuantities(tx, updates);
    }

    const invoiceNumber = await nextDocumentNumber(tx, SALES_INVOICE_DOC_TYPE, invoice.invoiceDate);
    const dueDate = new Date(invoice.invoiceDate.getTime() + invoice.paymentDueDays * DAY_MS);
    await tx.salesInvoice.update({
      where: { id },
      data: {
        status: 'POSTED',
        invoiceNumber,
        dueDate,
        // Nothing is settled yet; a zero-total invoice is PAID from the start.
        paymentStatus: deriveInvoicePaymentStatus(invoice),
        postedByUserId: actor.userId,
        postedAt: new Date(),
      },
    });
    const progress: OrderProgress | null = order ? await recomputeOrderProgress(tx, order.id) : null;

    const deliveryLabels = [...deliveryNumbers.entries()].map(([deliveryId, number]) => number ?? `#${deliveryId}`);
    await this.audit.log(
      {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: 'SALES_INVOICE_POSTED',
        entityType: AUDIT_ENTITY.SALES_INVOICE,
        entityId: id,
        details: `${invoiceNumber} — ${order ? `سفارش ${order.orderNumber ?? `#${order.id}`}، حواله ${deliveryLabels.join('، ')}` : 'مانده افتتاحیه'}، جمع ${invoice.totalAmount.toString()}، سررسید ${toIsoDay(dueDate)}`,
      },
      tx,
    );
    if (order && progress) {
      const orderLabel = order.orderNumber ?? `#${order.id}`;
      // The order's and each delivery's own history show the invoice.
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_INVOICE_POSTED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: order.id,
          details: `فاکتور ${invoiceNumber} — وضعیت فاکتور: ${SALES_INVOICING_STATUS_LABELS_FA[progress.invoicingStatus]}`,
        },
        tx,
      );
      for (const deliveryId of deliveryNumbers.keys()) {
        await this.audit.log(
          {
            userId: actor.userId,
            ipAddress: actor.ipAddress,
            action: 'DELIVERY_INVOICE_POSTED',
            entityType: AUDIT_ENTITY.DELIVERY,
            entityId: deliveryId,
            details: `فاکتور ${invoiceNumber}`,
          },
          tx,
        );
      }
      if (progress.completed) {
        await this.audit.log(
          {
            userId: actor.userId,
            ipAddress: actor.ipAddress,
            action: 'SALES_ORDER_COMPLETED',
            entityType: AUDIT_ENTITY.SALES_ORDER,
            entityId: order.id,
            details: `${orderLabel} — همهٔ اقلام تحویل و فاکتور شده است`,
          },
          tx,
        );
      }
    }
    return { invoiceNumber, dueDate, progress };
  }

  // The ONLY writer of SalesInvoice.paidAmount / creditedAmount /
  // paymentStatus (build plan §3). Receivables (Batch 5) recomputes the
  // absolute sums from the invoice's active allocations and calls this
  // inside its own transaction; the invoice's paymentStatus is derived here
  // (deriveInvoicePaymentStatus), and the order's paymentStatus is
  // recomputed with it. The caller audits its own event (the payment /
  // allocation / credit note) — this only applies the consequence.
  //
  // Lock order: invoice → sales order (same as post()).
  async applySettlement(tx: Prisma.TransactionClient, invoiceId: number, sums: InvoiceSettlementSums) {
    await this.lockInvoice(tx, invoiceId);
    const invoice = await tx.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, salesOrderId: true, totalAmount: true, paidAmount: true, creditedAmount: true, paymentStatus: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور فروش پیدا نشد');
    if (invoice.status !== 'POSTED') throw new ConflictException('فقط فاکتور «ثبت‌شده» قابل تسویه است');

    const paidAmount = dec(sums.paidAmount);
    const creditedAmount = dec(sums.creditedAmount);
    if (paidAmount.isNegative() || creditedAmount.isNegative()) throw new BadRequestException('مبلغ تسویهٔ فاکتور نمی‌تواند منفی باشد');
    if (paidAmount.plus(creditedAmount).greaterThan(dec(invoice.totalAmount))) {
      throw new ConflictException('جمع دریافت‌ها و اعتبارهای تخصیص‌یافته از مبلغ فاکتور بیشتر است');
    }
    const settled = { totalAmount: invoice.totalAmount, paidAmount, creditedAmount };
    const paymentStatus = deriveInvoicePaymentStatus(settled);
    const changed =
      !paidAmount.equals(dec(invoice.paidAmount)) || !creditedAmount.equals(dec(invoice.creditedAmount)) || paymentStatus !== invoice.paymentStatus;
    if (changed) await tx.salesInvoice.update({ where: { id: invoiceId }, data: { paidAmount, creditedAmount, paymentStatus } });

    if (invoice.salesOrderId !== null) {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${invoice.salesOrderId} FOR UPDATE`;
      await recomputeOrderProgress(tx, invoice.salesOrderId);
    }
    return { paidAmount, creditedAmount, openAmount: invoiceOpenAmount(settled), paymentStatus };
  }

  // --- internals ----------------------------------------------------------------

  private async lockInvoice(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id} FOR UPDATE`;
  }

  // Customer snapshots for the invoice header: current name and economic
  // code (B14: the economic code is snapshotted, the national ID never is),
  // and the default active BILLING address as text (none → null).
  private async customerSnapshot(tx: Prisma.TransactionClient, customerId: number) {
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, economicCode: true } });
    if (!customer) throw new ConflictException('مشتری انتخاب‌شده یافت نشد');
    const address = await tx.customerAddress.findFirst({
      where: { customerId, isActive: true, addressType: 'BILLING' },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      select: { province: true, city: true, addressLine: true, postalCode: true },
    });
    return {
      customerName: customer.name,
      customerEconomicCode: customer.economicCode ?? null,
      billingAddressText: address ? formatAddress(address) : null,
    };
  }
}
