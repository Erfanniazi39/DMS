import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toIsoDay } from '../common/zod-fields';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PURCHASE_STATUS_LABELS_FA, RETURNABLE_PURCHASE_STATUSES } from './purchase-rules';
import type { CreatePurchaseReturnDto } from './dto/purchase.dto';

// A Return-to-Vendor record with each returned line's original PurchaseItem
// (name/unit/quantity) — enough for the detail page to render the return and
// derive "still returnable" per item without another round-trip.
const purchaseReturnInclude = {
  items: { include: { purchaseItem: { include: { unit: true } } }, orderBy: { id: 'asc' } },
  createdByUser: { select: { id: true, username: true } },
} satisfies Prisma.PurchaseReturnInclude;

// --- Return to Vendor (RTV) ------------------------------------------------
//
// A PurchaseReturn is a historical record of goods sent back and their
// credit value. It deliberately does NOT touch Purchase.totalAmount /
// paidAmount / paymentStatus (those stay "what was originally billed /
// paid", see purchase-totals.ts) and has no status lifecycle — same
// create/list/delete shape as PurchasePayment. No Inventory effect.
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // returnNumber (RTN-000001) uses the same placeholder-then-fix pattern as
  // purchaseNumber. The returnable-quantity check runs inside the same
  // transaction, after locking the parent Purchase row, so two concurrent
  // returns against the same purchase can't both pass the check and
  // together exceed an item's original quantity.
  //
  // Business rules (2026-10-05): only a RECEIVED/CLOSED purchase can have a
  // return (it represents goods actually received); the return can't be
  // dated before the purchase; and each line's credit is capped at that
  // purchase line's remaining value (totalPrice minus credit already
  // returned) — same enforcement level as the quantity cap.
  async createReturn(purchaseId: number, dto: CreatePurchaseReturnDto, userId: number | null, ipAddress?: string) {
    const created = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number; status: PurchaseStatus; purchase_date: Date }[]>`SELECT id, status, purchase_date FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('خرید پیدا نشد');
      const [purchase] = locked;
      if (!RETURNABLE_PURCHASE_STATUSES.includes(purchase.status)) {
        throw new ConflictException(
          `برگشت فقط برای خرید «دریافت‌شده» یا «بسته‌شده» قابل ثبت است؛ وضعیت این خرید «${PURCHASE_STATUS_LABELS_FA[purchase.status] ?? purchase.status}» است`,
        );
      }
      if (toIsoDay(dto.returnDate) < toIsoDay(purchase.purchase_date)) {
        throw new ConflictException('تاریخ برگشت نمی‌تواند قبل از تاریخ خرید باشد');
      }

      const itemIds = [...new Set(dto.items.map((item) => item.purchaseItemId))];
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { id: { in: itemIds }, purchaseId },
        select: { id: true, name: true, quantity: true, totalPrice: true },
      });
      if (purchaseItems.length !== itemIds.length) {
        throw new ConflictException('یکی از اقلام انتخاب‌شده برای برگشت، متعلق به این خرید نیست');
      }

      const alreadyReturned = await tx.purchaseReturnItem.groupBy({
        by: ['purchaseItemId'],
        where: { purchaseItemId: { in: itemIds } },
        _sum: { quantity: true, creditAmount: true },
      });
      const returnedByItem = new Map(alreadyReturned.map((row) => [row.purchaseItemId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
      const creditedByItem = new Map(alreadyReturned.map((row) => [row.purchaseItemId, new Prisma.Decimal(row._sum.creditAmount ?? 0)]));
      // The same item may appear on more than one line of this return —
      // what counts is the total being returned now.
      const requestedByItem = new Map<number, Prisma.Decimal>();
      const creditRequestedByItem = new Map<number, Prisma.Decimal>();
      for (const line of dto.items) {
        const current = requestedByItem.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
        requestedByItem.set(line.purchaseItemId, current.plus(line.quantity));
        const currentCredit = creditRequestedByItem.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
        creditRequestedByItem.set(line.purchaseItemId, currentCredit.plus(line.creditAmount));
      }
      for (const item of purchaseItems) {
        const remaining = new Prisma.Decimal(item.quantity).minus(returnedByItem.get(item.id) ?? 0);
        const requested = requestedByItem.get(item.id) ?? new Prisma.Decimal(0);
        if (requested.greaterThan(remaining)) {
          throw new ConflictException(`مقدار برگشتی «${item.name}» بیشتر از مقدار قابل برگشت (${remaining.toString()}) است`);
        }
        const remainingValue = new Prisma.Decimal(item.totalPrice).minus(creditedByItem.get(item.id) ?? 0);
        const creditRequested = creditRequestedByItem.get(item.id) ?? new Prisma.Decimal(0);
        if (creditRequested.greaterThan(remainingValue)) {
          throw new ConflictException(`مبلغ اعتبار برگشتی «${item.name}» بیشتر از ارزش باقی‌ماندهٔ قابل برگشت (${remainingValue.toString()} ریال) است`);
        }
      }

      const record = await tx.purchaseReturn.create({
        data: {
          returnNumber: `PENDING-${randomUUID()}`,
          purchaseId,
          returnDate: dto.returnDate,
          reason: dto.reason,
          note: dto.note,
          createdByUserId: userId ?? undefined,
          items: { create: dto.items },
        },
      });
      const returnNumber = `RTN-${String(record.id).padStart(6, '0')}`;
      return tx.purchaseReturn.update({ where: { id: record.id }, data: { returnNumber }, include: purchaseReturnInclude });
    });

    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_RETURN_CREATED', entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: created.returnNumber });
    return created;
  }

  async listReturns(purchaseId: number) {
    await this.ensurePurchaseExists(purchaseId);
    return this.prisma.purchaseReturn.findMany({
      where: { purchaseId },
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
      include: purchaseReturnInclude,
    });
  }

  async getReturn(purchaseId: number, returnId: number) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({ where: { id: returnId, purchaseId }, include: purchaseReturnInclude });
    if (!purchaseReturn) throw new NotFoundException('برگشت پیدا نشد');
    return purchaseReturn;
  }

  // Removing a mistaken return — its lines cascade with it. No Purchase
  // field needs recomputing here (returns never touched them in the first
  // place).
  async removeReturn(purchaseId: number, returnId: number, userId: number | null, ipAddress?: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({ where: { id: returnId, purchaseId } });
    if (!purchaseReturn) throw new NotFoundException('برگشت پیدا نشد');
    await this.prisma.purchaseReturn.delete({ where: { id: returnId } });
    await this.audit.log({ userId, ipAddress, action: 'PURCHASE_RETURN_DELETED', entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: purchaseReturn.returnNumber });
    return { success: true };
  }

  private async ensurePurchaseExists(id: number) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, select: { id: true } });
    if (!purchase) throw new NotFoundException('خرید پیدا نشد');
  }
}
