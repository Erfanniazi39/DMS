import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { invoiceOpenAmount } from '../sales/sales-progress';
import { recomputeInvoiceSettlement } from './settlement';
import type { AllocatePaymentDto, ReverseAllocationDto } from './dto/payment-allocation.dto';
import type { ReceivablesActor } from './customer-payments.service';

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

// Open-item AR allocation — build plan §4.3/§6. allocate() currently only
// ever receives a RECEIPT CustomerPayment as its source (sourcePaymentId);
// the CreditNote source side (sourceCreditNoteId) is a real, typed
// parameter here so Batch 6 can wire it in without changing this method's
// shape, but no DTO/route can send it yet (CreditNote doesn't exist) — see
// dto/payment-allocation.dto.ts.
//
// customer-scoped: every target invoice must belong to the SAME customer as
// the source payment. An allocation can never push an invoice's settled
// amount past its total (checked against the invoice's CURRENT open amount,
// under its own row lock) — the rest of the receipt simply stays
// unapplied, held on account (build plan §3's "how the money works").
//
// Reversal is a stamp (reversedAt/reversedByUserId), never a delete.
// Both paths call SalesInvoicesService (via settlement.ts) to recompute the
// affected invoice('s) — the one approved cross-module call.
@Injectable()
export class PaymentAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly audit: AuditService,
  ) {}

  // Oldest-first suggestion for the receipt form's allocation grid: the
  // customer's open invoices (SalesInvoicesService.listOpenForCustomer(),
  // already ordered oldest-due-first), greedily filled up to `amount`.
  // Read-only — wrapped in a transaction only because listOpenForCustomer()
  // takes a TransactionClient.
  async suggestAllocation(customerId: number, amount: Prisma.Decimal | number | string) {
    return this.prisma.$transaction(async (tx) => {
      const open = await this.salesInvoices.listOpenForCustomer(tx, customerId);
      let remaining = dec(amount);
      const items: { invoiceId: number; invoiceNumber: string | null; dueDate: Date | null; amount: string }[] = [];
      for (const invoice of open) {
        if (!remaining.greaterThan(0)) break;
        const take = Prisma.Decimal.min(remaining, invoice.openAmount);
        if (take.greaterThan(0)) {
          items.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate, amount: take.toString() });
          remaining = remaining.minus(take);
        }
      }
      return { items, unallocated: remaining.toString() };
    });
  }

  async allocate(dto: AllocatePaymentDto, actor: ReceivablesActor) {
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_payments WHERE id = ${dto.sourcePaymentId} FOR UPDATE`;
      const payment = await tx.customerPayment.findUnique({
        where: { id: dto.sourcePaymentId },
        select: { id: true, paymentNumber: true, customerId: true, amount: true, direction: true, status: true },
      });
      if (!payment) throw new NotFoundException('دریافت پیدا نشد');
      if (payment.direction !== 'RECEIPT') throw new ConflictException('فقط «دریافت» قابل تخصیص به فاکتور است');
      if (payment.status === 'CANCELLED') throw new ConflictException('این دریافت لغو شده و قابل تخصیص نیست');

      const alreadyAllocated = await this.sumActiveAllocationsForPayment(tx, payment.id);
      const unapplied = dec(payment.amount).minus(alreadyAllocated);
      const requestedTotal = dto.items.reduce((sum, item) => sum.plus(dec(item.amount)), new Prisma.Decimal(0));
      if (requestedTotal.greaterThan(unapplied)) {
        throw new ConflictException(`مبلغ تخصیص (${requestedTotal.toString()} ریال) از مانده تخصیص‌نیافتهٔ دریافت (${unapplied.toString()} ریال) بیشتر است`);
      }

      const requestedByInvoice = new Map<number, Prisma.Decimal>();
      for (const item of dto.items) requestedByInvoice.set(item.invoiceId, (requestedByInvoice.get(item.invoiceId) ?? new Prisma.Decimal(0)).plus(dec(item.amount)));

      const invoiceIds = [...requestedByInvoice.keys()].sort((a, b) => a - b);
      for (const invoiceId of invoiceIds) {
        await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${invoiceId} FOR UPDATE`;
        const invoice = await tx.salesInvoice.findUnique({
          where: { id: invoiceId },
          select: { id: true, invoiceNumber: true, customerId: true, status: true, totalAmount: true, paidAmount: true, creditedAmount: true },
        });
        if (!invoice) throw new NotFoundException(`فاکتور #${invoiceId} پیدا نشد`);
        if (invoice.customerId !== payment.customerId) throw new ConflictException(`فاکتور ${invoice.invoiceNumber ?? `#${invoice.id}`} متعلق به مشتری این دریافت نیست`);
        if (invoice.status !== 'POSTED') throw new ConflictException(`فاکتور ${invoice.invoiceNumber ?? `#${invoice.id}`} «ثبت‌شده» نیست`);
        const open = invoiceOpenAmount(invoice);
        const requested = requestedByInvoice.get(invoiceId) as Prisma.Decimal;
        if (requested.greaterThan(open)) {
          throw new ConflictException(
            `مبلغ تخصیص به فاکتور ${invoice.invoiceNumber ?? `#${invoice.id}`} (${requested.toString()} ریال) از مانده فاکتور (${open.toString()} ریال) بیشتر است`,
          );
        }
      }

      for (const item of dto.items) {
        await tx.paymentAllocation.create({
          data: {
            customerId: payment.customerId,
            sourcePaymentId: payment.id,
            targetInvoiceId: item.invoiceId,
            amount: item.amount,
            allocatedByUserId: actor.userId,
          },
        });
      }
      for (const invoiceId of invoiceIds) await recomputeInvoiceSettlement(tx, invoiceId, this.salesInvoices);

      const invoiceLabel = (invoiceId: number) => `#${invoiceId}`;
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'PAYMENT_ALLOCATED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: payment.id,
          details: `${payment.paymentNumber} — تخصیص ${requestedTotal.toString()} ریال به ${invoiceIds.length.toLocaleString('fa-IR')} فاکتور (${invoiceIds.map(invoiceLabel).join('، ')})`,
        },
        tx,
      );
      for (const invoiceId of invoiceIds) {
        await this.audit.log(
          {
            userId: actor.userId,
            ipAddress: actor.ipAddress,
            action: 'SALES_INVOICE_PAYMENT_ALLOCATED',
            entityType: AUDIT_ENTITY.SALES_INVOICE,
            entityId: invoiceId,
            details: `دریافت ${payment.paymentNumber} — ${(requestedByInvoice.get(invoiceId) as Prisma.Decimal).toString()} ریال تخصیص یافت`,
          },
          tx,
        );
      }
      return payment.id;
    });
    return this.prisma.customerPayment.findUniqueOrThrow({ where: { id } });
  }

  async reverse(allocationId: number, dto: ReverseAllocationDto, actor: ReceivablesActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_allocations WHERE id = ${allocationId} FOR UPDATE`;
      const allocation = await tx.paymentAllocation.findUnique({
        where: { id: allocationId },
        select: { id: true, sourcePaymentId: true, targetInvoiceId: true, amount: true, reversedAt: true },
      });
      if (!allocation) throw new NotFoundException('تخصیص پیدا نشد');
      if (allocation.reversedAt) throw new ConflictException('این تخصیص قبلاً برگشت داده شده است');

      await tx.paymentAllocation.update({ where: { id: allocationId }, data: { reversedAt: new Date(), reversedByUserId: actor.userId } });
      if (allocation.targetInvoiceId !== null) await recomputeInvoiceSettlement(tx, allocation.targetInvoiceId, this.salesInvoices);

      const payment = allocation.sourcePaymentId ? await tx.customerPayment.findUnique({ where: { id: allocation.sourcePaymentId }, select: { paymentNumber: true } }) : null;
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'PAYMENT_ALLOCATION_REVERSED',
          entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT,
          entityId: allocation.sourcePaymentId ?? allocationId,
          details: `${payment?.paymentNumber ?? `تخصیص #${allocationId}`} — ${allocation.amount.toString()} ریال برگشت خورد${dto.reason ? ` (${dto.reason})` : ''}`,
        },
        tx,
      );
      if (allocation.targetInvoiceId !== null) {
        await this.audit.log(
          {
            userId: actor.userId,
            ipAddress: actor.ipAddress,
            action: 'SALES_INVOICE_PAYMENT_ALLOCATION_REVERSED',
            entityType: AUDIT_ENTITY.SALES_INVOICE,
            entityId: allocation.targetInvoiceId,
            details: `تخصیص ${allocation.amount.toString()} ریال برگشت خورد${dto.reason ? ` (${dto.reason})` : ''}`,
          },
          tx,
        );
      }
    });
    return { success: true };
  }

  private async sumActiveAllocationsForPayment(tx: Prisma.TransactionClient, paymentId: number) {
    const result = await tx.paymentAllocation.aggregate({ where: { sourcePaymentId: paymentId, reversedAt: null }, _sum: { amount: true } });
    return dec(result._sum.amount ?? 0);
  }

  // The credit-note branch (build plan §6/§12): called by
  // CreditNotesService.post() — inside THAT method's own transaction, not a
  // new one — right after the credit note's own row is marked POSTED, so
  // settlement.ts's "CreditNote must be POSTED to count" check sees it as
  // already posted. A CreditNote always targets exactly the one invoice it
  // was raised against (CreditNote.salesInvoiceId), so unlike allocate()
  // there is no customer-scoped multi-invoice grid here — the caller
  // supplies the single (invoiceId, amount) pair, already capped at the
  // invoice's open amount the same way a receipt's suggestion is (build
  // plan §3: "overpayments stay as unallocated ... credit, held on
  // account" — the same idea applies to a credit note that exceeds its
  // invoice's open amount). No suggestAllocation()-style helper is needed
  // for this because the target is fixed, not chosen by a user — a separate
  // manual "allocate this credit note elsewhere" action is out of scope for
  // this batch (B15: only return-based credit notes).
  async allocateCreditNoteToInvoice(
    tx: Prisma.TransactionClient,
    params: { creditNoteId: number; customerId: number; invoiceId: number; amount: Prisma.Decimal; actor: { userId: number | null } },
  ): Promise<void> {
    if (!params.amount.greaterThan(0)) return;
    await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${params.invoiceId} FOR UPDATE`;
    const invoice = await tx.salesInvoice.findUnique({
      where: { id: params.invoiceId },
      select: { id: true, invoiceNumber: true, customerId: true, status: true, totalAmount: true, paidAmount: true, creditedAmount: true },
    });
    if (!invoice) throw new NotFoundException(`فاکتور #${params.invoiceId} پیدا نشد`);
    if (invoice.customerId !== params.customerId) throw new ConflictException(`فاکتور ${invoice.invoiceNumber ?? `#${invoice.id}`} متعلق به مشتری این یادداشت اعتباری نیست`);
    if (invoice.status !== 'POSTED') throw new ConflictException(`فاکتور ${invoice.invoiceNumber ?? `#${invoice.id}`} «ثبت‌شده» نیست`);
    const open = invoiceOpenAmount(invoice);
    const amount = Prisma.Decimal.min(params.amount, open);
    if (!amount.greaterThan(0)) return;

    await tx.paymentAllocation.create({
      data: { customerId: params.customerId, sourceCreditNoteId: params.creditNoteId, targetInvoiceId: params.invoiceId, amount, allocatedByUserId: params.actor.userId },
    });
    await recomputeInvoiceSettlement(tx, params.invoiceId, this.salesInvoices);
  }
}
