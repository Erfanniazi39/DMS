import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PurchaseStatus } from '@prisma/client';
import { toIsoDay } from '../common/zod-fields';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PAYABLE_PURCHASE_STATUSES, PURCHASE_STATUS_LABELS_FA } from './purchase-rules';
import { recomputePaymentTotals } from './purchase-totals';
import { PurchasesService } from './purchases.service';
import type { CreatePurchasePaymentDto, UpdatePurchasePaymentDto } from './dto/purchase.dto';

// Payments are a separate, append-only-by-default record of what's actually
// been paid ("Keep payments separate from the Purchase") — adding one
// recomputes and persists paidAmount/paymentStatus on the parent Purchase,
// always via the shared recomputePaymentTotals() (purchase-totals.ts, CLAUDE.md
// rule 6). Removing a mistaken entry does the same recompute.
//
// Injects PurchasesService only for get() — every payment endpoint responds
// with the full purchase detail. PurchasesService never injects this back, so
// there is no provider cycle.
@Injectable()
export class PurchasePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchasesService: PurchasesService,
    private readonly audit: AuditService,
  ) {}

  // The payment write, the paidAmount/paymentStatus recompute and the audit
  // row happen in ONE transaction (QA 2026-10-05: previously a payment could
  // be persisted while the recompute then failed, leaving paidAmount stale
  // and no audit row). The parent Purchase row is locked first — same
  // convention as PurchaseReturnsService.createReturn() — so two concurrent
  // payments on the same purchase can't each recompute from a sum that
  // misses the other.
  //
  // Business rules (2026-10-05): only a CONFIRMED/RECEIVED/CLOSED purchase
  // takes payments; a payment can't be dated before the purchase (a future
  // date — a post-dated cheque — is fine); paying MORE than totalAmount is
  // allowed — the response carries totalAmount and paidAmount, and the
  // frontend flags paidAmount > totalAmount as overpaid.
  async addPayment(purchaseId: number, dto: CreatePurchasePaymentDto, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await this.lockPurchaseForPayment(tx, purchaseId);
      this.ensurePayable(purchase, dto.paymentDate);
      const totalAmount = purchase.totalAmount;
      const payment = await tx.purchasePayment.create({ data: { purchaseId, ...dto } });
      await recomputePaymentTotals(tx, purchaseId, totalAmount);
      // "Payment added" and "Payment completed" are the same event here —
      // there's no separate mark-as-completed step (see PurchasePayment) —
      // so a payment created already COMPLETED logs as completed directly.
      const action = payment.status === 'COMPLETED' ? 'PAYMENT_COMPLETED' : 'PAYMENT_ADDED';
      await this.audit.log({ userId, ipAddress, action, entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: `${payment.amount} ریال` }, tx);
    });
    return this.purchasesService.get(purchaseId);
  }

  // Edits a payment in place (business decision 2026-10-05 — previously only
  // delete + re-add). Same transaction/lock/recompute/audit shape as
  // addPayment(), and the same status and date rules.
  async updatePayment(purchaseId: number, paymentId: number, dto: UpdatePurchasePaymentDto, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await this.lockPurchaseForPayment(tx, purchaseId);
      const existing = await tx.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
      if (!existing) throw new NotFoundException('پرداخت پیدا نشد');
      this.ensurePayable(purchase, dto.paymentDate);
      const payment = await tx.purchasePayment.update({ where: { id: paymentId }, data: { ...dto } });
      await recomputePaymentTotals(tx, purchaseId, purchase.totalAmount);
      await this.audit.log(
        {
          userId,
          ipAddress,
          action: 'PAYMENT_UPDATED',
          entityType: AUDIT_ENTITY.PURCHASE,
          entityId: purchaseId,
          details: `پرداخت #${paymentId}: ${existing.amount} ریال (${existing.status}) → ${payment.amount} ریال (${payment.status})`,
        },
        tx,
      );
    });
    return this.purchasesService.get(purchaseId);
  }

  // Deliberately NOT status-gated: removing a mistaken payment must stay
  // possible even after the purchase was cancelled.
  async removePayment(purchaseId: number, paymentId: number, userId: number | null, ipAddress?: string) {
    await this.prisma.$transaction(async (tx) => {
      const { totalAmount } = await this.lockPurchaseForPayment(tx, purchaseId);
      const payment = await tx.purchasePayment.findFirst({ where: { id: paymentId, purchaseId } });
      if (!payment) throw new NotFoundException('پرداخت پیدا نشد');
      await tx.purchasePayment.delete({ where: { id: paymentId } });
      await recomputePaymentTotals(tx, purchaseId, totalAmount);
      await this.audit.log({ userId, ipAddress, action: 'PAYMENT_REMOVED', entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: `${payment.amount} ریال` }, tx);
    });
    return this.purchasesService.get(purchaseId);
  }

  // Locks the parent Purchase row for the rest of the transaction (see
  // addPayment()) and returns what the payment rules need, read after the lock.
  private async lockPurchaseForPayment(tx: Prisma.TransactionClient, purchaseId: number) {
    await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      select: { totalAmount: true, status: true, purchaseDate: true },
    });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
    return { totalAmount: Number(purchase.totalAmount), status: purchase.status, purchaseDate: purchase.purchaseDate };
  }

  private ensurePayable(purchase: { status: PurchaseStatus; purchaseDate: Date }, paymentDate: Date) {
    if (!PAYABLE_PURCHASE_STATUSES.includes(purchase.status)) {
      throw new ConflictException(
        `پرداخت فقط برای خرید «تأییدشده»، «دریافت‌شده» یا «بسته‌شده» قابل ثبت است؛ وضعیت این خرید «${PURCHASE_STATUS_LABELS_FA[purchase.status] ?? purchase.status}» است`,
      );
    }
    if (toIsoDay(paymentDate) < toIsoDay(purchase.purchaseDate)) {
      throw new ConflictException('تاریخ پرداخت نمی‌تواند قبل از تاریخ خرید باشد');
    }
  }
}
