import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomerPaymentDirection, type PaymentMethod, type PaymentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { recomputeInvoiceSettlement } from './settlement';
import { ensureCustomerPaymentTransition, RECEIPT_DOC_TYPE, REFUND_DOC_TYPE } from './receivables-rules';
import type { BounceChequeDto, CancelCustomerPaymentDto, ClearChequeDto, CreateCustomerReceiptDto, CreateCustomerRefundDto } from './dto/customer-payment.dto';

export type ReceivablesActor = { userId: number | null; ipAddress?: string };

export type CustomerPaymentListFilters = {
  q?: string;
  direction?: CustomerPaymentDirection;
  status?: PaymentStatus;
  method?: PaymentMethod;
  customerId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

const userSelect = { select: { id: true, username: true } } as const;

const customerPaymentDetailInclude = {
  customer: { select: { id: true, customerNumber: true, name: true } },
  createdByUser: userSelect,
  cancelledByUser: userSelect,
  // Every allocation this payment has ever been the source of, oldest
  // first — including reversed ones, so the detail page shows the full
  // history (what it funded, and what was later undone).
  allocationsAsSource: {
    orderBy: [{ allocatedAt: 'asc' }, { id: 'asc' }],
    include: {
      targetInvoice: { select: { id: true, invoiceNumber: true } },
      allocatedByUser: userSelect,
      reversedByUser: userSelect,
    },
  },
} satisfies Prisma.CustomerPaymentInclude;

// دریافت/پرداخت نقدی مشتری — Receivables (Sales batch 5). See
// docs/sales-module-build-plan.md §4.3/§5. recordReceipt() and refund() both
// number the row immediately (no draft stage, unlike Sales documents) and
// derive status from method (CHECK → PENDING, otherwise COMPLETED — B9).
// cancel()/clearCheque()/bounceCheque() are the only status-changing
// actions; cancel()/bounceCheque() reverse every active allocation sourced
// from the payment (never delete) and recompute each affected invoice's
// settlement via SalesInvoicesService (the one approved cross-module call,
// see settlement.ts). Injects SalesInvoicesService (SalesModule export)
// only — never CustomersModule (a plain existence check is enough here).
@Injectable()
export class CustomerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: CustomerPaymentListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.CustomerPaymentWhereInput = {};
    const and: Prisma.CustomerPaymentWhereInput[] = [];
    if (filters.q) {
      and.push({
        OR: [
          { paymentNumber: { contains: filters.q, mode: 'insensitive' } },
          { referenceNumber: { contains: filters.q, mode: 'insensitive' } },
          { customer: { name: { contains: filters.q, mode: 'insensitive' } } },
          { customer: { customerNumber: { contains: filters.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.method) where.method = filters.method;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.dateFrom || filters.dateTo) {
      where.paymentDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    if (and.length > 0) where.AND = and;
    const query = {
      where,
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      include: { customer: { select: { id: true, customerNumber: true, name: true } } },
    } satisfies Prisma.CustomerPaymentFindManyArgs;

    if (!pagination) return this.prisma.customerPayment.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.customerPayment.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.customerPayment.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const payment = await this.prisma.customerPayment.findUnique({ where: { id }, include: customerPaymentDetailInclude });
    if (!payment) throw new NotFoundException('دریافت/پرداخت پیدا نشد');
    return payment;
  }

  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.CUSTOMER_PAYMENT, id);
  }

  // Receipt/refund form's customer picker: every customer that isn't
  // archived (an inactive or held customer may still owe/be owed historical
  // money — same reasoning as sales-invoices' opening-balance form).
  async formOptions() {
    const customers = await this.prisma.customer.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: { id: true, customerNumber: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { customers };
  }

  async recordReceipt(dto: CreateCustomerReceiptDto, actor: ReceivablesActor) {
    return this.create('RECEIPT', RECEIPT_DOC_TYPE, dto, actor);
  }

  async refund(dto: CreateCustomerRefundDto, actor: ReceivablesActor) {
    return this.create('REFUND', REFUND_DOC_TYPE, dto, actor);
  }

  private async create(direction: CustomerPaymentDirection, docType: string, dto: CreateCustomerReceiptDto | CreateCustomerRefundDto, actor: ReceivablesActor) {
    const id = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: dto.customerId }, select: { id: true } });
      if (!customer) throw new ConflictException('مشتری انتخاب‌شده یافت نشد');

      // B9: only a cheque starts PENDING — every other method settles
      // immediately (there is nothing to "clear").
      const status: PaymentStatus = dto.method === 'CHECK' ? 'PENDING' : 'COMPLETED';
      const paymentNumber = await nextDocumentNumber(tx, docType, dto.paymentDate);
      const payment = await tx.customerPayment.create({
        data: {
          paymentNumber,
          direction,
          customerId: dto.customerId,
          paymentDate: dto.paymentDate,
          amount: dto.amount,
          method: dto.method,
          status,
          referenceNumber: dto.referenceNumber ?? null,
          chequeDueDate: dto.method === 'CHECK' ? (dto.chequeDueDate ?? null) : null,
          bankName: dto.bankName ?? null,
          note: dto.note ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: direction === 'RECEIPT' ? 'CUSTOMER_PAYMENT_RECEIVED' : 'CUSTOMER_PAYMENT_REFUNDED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: payment.id,
          details: `${paymentNumber} — ${dto.amount.toLocaleString('en-US')} ریال (${status === 'PENDING' ? 'چک، در انتظار وصول' : 'تکمیل‌شده'})`,
        },
        tx,
      );
      return payment.id;
    });
    return this.get(id);
  }

  // COMPLETED → CANCELLED (reason required). A PENDING cheque is cancelled
  // via bounceCheque() instead — this keeps the "why" distinct in the audit
  // trail even though both land on the same CANCELLED status.
  async cancel(id: number, dto: CancelCustomerPaymentDto, actor: ReceivablesActor) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, id);
      if (dto.updatedAt && !isSameVersion(payment.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (payment.status !== 'COMPLETED') {
        throw new ConflictException('فقط دریافت/پرداخت «تکمیل‌شده» با این عملیات لغو می‌شود؛ برای چک در انتظار وصول از «برگشت چک» استفاده کنید');
      }
      ensureCustomerPaymentTransition(payment.status, 'CANCELLED');
      await tx.customerPayment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledByUserId: actor.userId, cancelledAt: new Date(), cancelReason: dto.reason },
      });
      const invoiceIds = await this.reverseActiveAllocationsOfPayment(tx, id, actor);
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'CUSTOMER_PAYMENT_CANCELLED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: id,
          details: `${payment.paymentNumber} — ${dto.reason}${invoiceIds.length > 0 ? ` — تخصیص به ${invoiceIds.length.toLocaleString('fa-IR')} فاکتور برگشت خورد` : ''}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // PENDING → COMPLETED. From this moment, any allocation already recorded
  // against this cheque starts counting toward the invoice (B9) — recompute
  // every invoice it touches.
  async clearCheque(id: number, dto: ClearChequeDto, actor: ReceivablesActor) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, id);
      if (dto.updatedAt && !isSameVersion(payment.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (payment.method !== 'CHECK') throw new BadRequestException('این دریافت/پرداخت چک نیست');
      ensureCustomerPaymentTransition(payment.status, 'COMPLETED');
      await tx.customerPayment.update({ where: { id }, data: { status: 'COMPLETED' } });

      const invoiceIds = await this.activeAllocationInvoiceIds(tx, id);
      for (const invoiceId of invoiceIds) await recomputeInvoiceSettlement(tx, invoiceId, this.salesInvoices);

      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'CHEQUE_CLEARED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: id,
          details: `${payment.paymentNumber} — وصول چک${invoiceIds.length > 0 ? ` — ${invoiceIds.length.toLocaleString('fa-IR')} فاکتور تسویه شد` : ''}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // PENDING → CANCELLED (reason required) — a bounced cheque reverses every
  // allocation already recorded against it (they never settled anything,
  // since they weren't counted while PENDING, but must still be formally
  // reversed so the amount is free to allocate elsewhere).
  async bounceCheque(id: number, dto: BounceChequeDto, actor: ReceivablesActor) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, id);
      if (dto.updatedAt && !isSameVersion(payment.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (payment.method !== 'CHECK') throw new BadRequestException('این دریافت/پرداخت چک نیست');
      ensureCustomerPaymentTransition(payment.status, 'CANCELLED');
      await tx.customerPayment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledByUserId: actor.userId, cancelledAt: new Date(), cancelReason: dto.reason },
      });
      const invoiceIds = await this.reverseActiveAllocationsOfPayment(tx, id, actor);
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'CHEQUE_BOUNCED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: id,
          details: `${payment.paymentNumber} — برگشت چک: ${dto.reason}${invoiceIds.length > 0 ? ` — تخصیص به ${invoiceIds.length.toLocaleString('fa-IR')} فاکتور برگشت خورد` : ''}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // --- internals ----------------------------------------------------------------

  private async lockPayment(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM customer_payments WHERE id = ${id} FOR UPDATE`;
    const payment = await tx.customerPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('دریافت/پرداخت پیدا نشد');
    return payment;
  }

  private async activeAllocationInvoiceIds(tx: Prisma.TransactionClient, paymentId: number): Promise<number[]> {
    const rows = await tx.paymentAllocation.findMany({
      where: { sourcePaymentId: paymentId, reversedAt: null, targetInvoiceId: { not: null } },
      select: { targetInvoiceId: true },
    });
    const ids = new Set(rows.map((row) => row.targetInvoiceId as number));
    return [...ids].sort((a, b) => a - b);
  }

  // Stamps every active allocation sourced from this payment as reversed
  // (never deletes) and recomputes the settlement of every invoice it
  // touched, in ascending id order (consistent lock order — see
  // sales-invoices.service.ts applySettlement()'s own invoice → order
  // ordering; this file never locks more than one invoice chain at once per
  // iteration). Returns the affected invoice ids, for the caller's audit line.
  private async reverseActiveAllocationsOfPayment(tx: Prisma.TransactionClient, paymentId: number, actor: ReceivablesActor): Promise<number[]> {
    const rows = await tx.paymentAllocation.findMany({
      where: { sourcePaymentId: paymentId, reversedAt: null },
      select: { id: true, targetInvoiceId: true },
    });
    if (rows.length === 0) return [];
    const now = new Date();
    for (const row of rows) {
      await tx.paymentAllocation.update({ where: { id: row.id }, data: { reversedAt: now, reversedByUserId: actor.userId } });
    }
    const invoiceIds = [...new Set(rows.map((row) => row.targetInvoiceId).filter((value): value is number => value !== null))].sort((a, b) => a - b);
    for (const invoiceId of invoiceIds) await recomputeInvoiceSettlement(tx, invoiceId, this.salesInvoices);
    return invoiceIds;
  }
}
