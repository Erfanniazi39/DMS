import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CREDIT_NOTE_DOC_TYPE, EDITABLE_SALES_DOCUMENT_STATUSES, SALES_DOCUMENT_STATUS_LABELS_FA, CREDIT_NOTE_DRAFT_EXISTS } from '../sales/sales-rules';
import { SalesReturnsService } from '../sales/sales-returns.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PaymentAllocationsService } from './payment-allocations.service';
import type { CreateCreditNoteDto, PostCreditNoteDto } from './dto/credit-note.dto';

export type CreditNoteActor = { userId: number | null; ipAddress?: string };

export type CreditNoteListFilters = {
  q?: string;
  status?: Prisma.CreditNoteWhereInput['status'];
  customerId?: number;
  salesInvoiceId?: number;
  salesReturnId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

const userSelect = { select: { id: true, username: true } } as const;
const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

function today() {
  const now = new Date();
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const creditNoteDetailInclude = {
  customer: { select: { id: true, customerNumber: true, name: true } },
  salesInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, creditedAmount: true, paymentStatus: true } },
  salesReturn: { select: { id: true, returnNumber: true, status: true } },
  createdByUser: userSelect,
  postedByUser: userSelect,
  items: {
    include: {
      salesInvoiceItem: { select: { id: true, itemName: true, unitName: true } },
      salesReturnItem: { select: { id: true, itemName: true } },
    },
  },
} satisfies Prisma.CreditNoteInclude;

// یادداشت اعتباری — lifecycle per docs/sales-module-build-plan.md §5/§6:
//
//   create   DRAFT, built from an INSPECTED SalesReturn's lines (B15: only
//            return-based credit notes this batch). One credit note per
//            return (409 CREDIT_NOTE_DRAFT_EXISTS if a DRAFT already
//            exists; refused outright if the return isn't INSPECTED or
//            already has a credit note). Line quantity = the return line's
//            receivedQty (the customer is credited for what physically came
//            back, regardless of restock/write-off disposition); unitPrice
//            = the return line's snapshot (itself from the invoice/order
//            line). No tax: SalesReturnItem carries no taxRate, so
//            CreditNoteItem.taxAmount stays 0 for every return-based line in
//            this batch (documented simplification).
//   post     DRAFT → POSTED, one-way; assigns the gap-free CN number, then:
//              1. SalesInvoiceItem.creditedQty += line quantity per line.
//              2. Auto-allocates min(totalAmount, invoice's open amount) to
//                 the originating invoice via
//                 PaymentAllocationsService.allocateCreditNoteToInvoice()
//                 (which itself calls settlement.ts →
//                 SalesInvoicesService.applySettlement() — the credit note
//                 never writes SalesInvoice.creditedAmount directly). Any
//                 excess over the invoice's open amount is simply not
//                 allocated — same "stays as credit held on account" idea
//                 build plan §3 already uses for an overpaid receipt.
//              3. SalesReturnsService.markCredited() — INSPECTED → COMPLETED.
//   remove   DRAFT only (no number, no gap).
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesReturns: SalesReturnsService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly allocations: PaymentAllocationsService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: CreditNoteListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.CreditNoteWhereInput = {};
    if (filters.q) {
      where.OR = [
        { creditNoteNumber: { contains: filters.q, mode: 'insensitive' } },
        { customer: { name: { contains: filters.q, mode: 'insensitive' } } },
        { salesInvoice: { invoiceNumber: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salesInvoiceId) where.salesInvoiceId = filters.salesInvoiceId;
    if (filters.salesReturnId) where.salesReturnId = filters.salesReturnId;
    if (filters.dateFrom || filters.dateTo) {
      where.creditDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    const query = {
      where,
      orderBy: [{ creditDate: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, customerNumber: true } },
        salesInvoice: { select: { id: true, invoiceNumber: true } },
        salesReturn: { select: { id: true, returnNumber: true } },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.CreditNoteFindManyArgs;

    if (!pagination) return this.prisma.creditNote.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.creditNote.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.creditNote.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const creditNote = await this.prisma.creditNote.findUnique({ where: { id }, include: creditNoteDetailInclude });
    if (!creditNote) throw new NotFoundException('یادداشت اعتباری پیدا نشد');
    return creditNote;
  }

  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.CREDIT_NOTE, id);
  }

  async create(dto: CreateCreditNoteDto, actor: CreditNoteActor) {
    const id = await this.prisma.$transaction(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id: dto.salesReturnId },
        select: {
          id: true,
          returnNumber: true,
          status: true,
          customerId: true,
          items: { select: { id: true, itemId: true, itemName: true, unitName: true, unitPrice: true, receivedQty: true, creditedQty: true, deliveryItemId: true } },
          creditNotes: { select: { id: true, status: true } },
        },
      });
      if (!salesReturn) throw new NotFoundException('مرجوعی پیدا نشد');
      if (salesReturn.status !== 'INSPECTED') {
        throw new ConflictException('فقط برای مرجوعی «بازرسی‌شده» می‌توان یادداشت اعتباری صادر کرد');
      }
      const existingDraft = salesReturn.creditNotes.find((note) => note.status === 'DRAFT');
      if (existingDraft) {
        throw new ConflictException({
          statusCode: 409,
          code: CREDIT_NOTE_DRAFT_EXISTS,
          message: 'برای این مرجوعی یک یادداشت اعتباری پیش‌نویس وجود دارد؛ همان را ثبت یا حذف کنید.',
          details: { creditNoteId: existingDraft.id },
        });
      }
      if (salesReturn.creditNotes.some((note) => note.status === 'POSTED')) {
        throw new ConflictException('برای این مرجوعی قبلاً یادداشت اعتباری ثبت شده است');
      }

      const creditedLines = salesReturn.items.filter((line) => dec(line.receivedQty).greaterThan(dec(line.creditedQty)));
      if (creditedLines.length === 0) throw new ConflictException('هیچ ردیف قابل‌اعتباردهی در این مرجوعی وجود ندارد');

      // Every credited line must map to a POSTED invoice line (via the
      // delivery item it was returned from) — a return can't be credited
      // for a quantity that was never billed. B7 (one invoice per delivery)
      // means every deliveryItemId maps to at most one POSTED invoice.
      const deliveryItemIds = creditedLines.map((line) => line.deliveryItemId).filter((value): value is number => value !== null);
      const invoiceLines = await tx.salesInvoiceItem.findMany({
        where: { deliveryItemId: { in: deliveryItemIds }, salesInvoice: { status: 'POSTED' } },
        select: { id: true, deliveryItemId: true, itemName: true, unitName: true, creditedQty: true, quantity: true, salesInvoiceId: true },
      });
      const invoiceLineByDeliveryItem = new Map(invoiceLines.map((row) => [row.deliveryItemId, row]));

      let salesInvoiceId: number | null = null;
      const lines = creditedLines.map((line) => {
        const invoiceLine = line.deliveryItemId === null ? undefined : invoiceLineByDeliveryItem.get(line.deliveryItemId);
        if (!invoiceLine) throw new ConflictException(`ردیف «${line.itemName}»: این ردیف هنوز فاکتور نشده است؛ صدور یادداشت اعتباری برای آن امکان‌پذیر نیست`);
        if (salesInvoiceId === null) salesInvoiceId = invoiceLine.salesInvoiceId;
        else if (salesInvoiceId !== invoiceLine.salesInvoiceId) {
          throw new ConflictException('ردیف‌های این مرجوعی به بیش از یک فاکتور تعلق دارند؛ صدور یادداشت اعتباری یکجا برای آن‌ها امکان‌پذیر نیست');
        }
        const quantity = dec(line.receivedQty).minus(dec(line.creditedQty));
        const lineTotal = quantity.times(dec(line.unitPrice)).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
        return {
          data: {
            salesInvoiceItemId: invoiceLine.id,
            salesReturnItemId: line.id,
            quantity,
            unitPrice: line.unitPrice,
            taxAmount: 0,
            lineTotal,
          },
          lineTotal,
        };
      });
      if (salesInvoiceId === null) throw new ConflictException('فاکتور مرجوع مربوط پیدا نشد');

      const subtotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
      const creditNote = await tx.creditNote.create({
        data: {
          customerId: salesReturn.customerId,
          salesInvoiceId,
          salesReturnId: salesReturn.id,
          creditDate: dto.creditDate ?? today(),
          reason: dto.reason,
          status: 'DRAFT',
          subtotal,
          taxTotal: 0,
          totalAmount: subtotal,
          createdByUserId: actor.userId,
          items: { create: lines.map((line) => line.data) },
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'CREDIT_NOTE_CREATED',
          entityType: AUDIT_ENTITY.CREDIT_NOTE,
          entityId: creditNote.id,
          details: `پیش‌نویس — مرجوعی ${salesReturn.returnNumber ?? `#${salesReturn.id}`}، ${lines.length} ردیف، جمع ${subtotal.toString()}`,
        },
        tx,
      );
      return creditNote.id;
    });
    return this.get(id);
  }

  async remove(id: number, actor: CreditNoteActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${id} FOR UPDATE`;
      const creditNote = await tx.creditNote.findUnique({ where: { id }, select: { id: true, status: true, creditNoteNumber: true } });
      if (!creditNote) throw new NotFoundException('یادداشت اعتباری پیدا نشد');
      if (!EDITABLE_SALES_DOCUMENT_STATUSES.includes(creditNote.status)) {
        throw new ConflictException(`فقط یادداشت اعتباری «${SALES_DOCUMENT_STATUS_LABELS_FA.DRAFT}» قابل حذف است`);
      }
      await tx.creditNote.delete({ where: { id } });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'CREDIT_NOTE_DELETED', entityType: AUDIT_ENTITY.CREDIT_NOTE, entityId: id, details: 'پیش‌نویس' },
        tx,
      );
    });
    return { success: true };
  }

  async post(id: number, dto: PostCreditNoteDto, actor: CreditNoteActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${id} FOR UPDATE`;
      const creditNote = await tx.creditNote.findUnique({ where: { id }, include: { items: true } });
      if (!creditNote) throw new NotFoundException('یادداشت اعتباری پیدا نشد');
      if (creditNote.status !== 'DRAFT') throw new ConflictException('این یادداشت اعتباری قبلاً ثبت شده است');
      if (!isSameVersion(creditNote.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (creditNote.items.length === 0) throw new BadRequestException('یادداشت اعتباری بدون ردیف قابل ثبت نیست');

      const creditNoteNumber = await nextDocumentNumber(tx, CREDIT_NOTE_DOC_TYPE, creditNote.creditDate);
      await tx.creditNote.update({
        where: { id },
        data: { status: 'POSTED', creditNoteNumber, postedByUserId: actor.userId, postedAt: new Date() },
      });

      for (const line of creditNote.items) {
        const invoiceItem = await tx.salesInvoiceItem.findUnique({ where: { id: line.salesInvoiceItemId }, select: { creditedQty: true } });
        if (!invoiceItem) throw new ConflictException('ردیف فاکتور مربوط پیدا نشد');
        await tx.salesInvoiceItem.update({
          where: { id: line.salesInvoiceItemId },
          data: { creditedQty: dec(invoiceItem.creditedQty).plus(dec(line.quantity ?? 0)) },
        });
      }

      await this.allocations.allocateCreditNoteToInvoice(tx, {
        creditNoteId: id,
        customerId: creditNote.customerId,
        invoiceId: creditNote.salesInvoiceId,
        amount: dec(creditNote.totalAmount),
        actor,
      });

      if (creditNote.salesReturnId !== null) {
        await this.salesReturns.markCredited(
          tx,
          creditNote.salesReturnId,
          creditNote.items.filter((line) => line.salesReturnItemId !== null).map((line) => ({ salesReturnItemId: line.salesReturnItemId!, quantity: dec(line.quantity ?? 0) })),
          actor,
        );
      }

      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'CREDIT_NOTE_POSTED',
          entityType: AUDIT_ENTITY.CREDIT_NOTE,
          entityId: id,
          details: `${creditNoteNumber} — جمع ${creditNote.totalAmount.toString()}`,
        },
        tx,
      );
    });
    return this.get(id);
  }
}
