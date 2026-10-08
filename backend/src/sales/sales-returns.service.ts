import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { inspectReturn, receiveReturn } from '../inventory/stock-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { applyReturnedQuantities } from './sales-progress';
import {
  ensureSalesReturnTransition,
  RETURNABLE_DELIVERY_STATUSES,
  SALES_RETURN_DOC_TYPE,
  SALES_RETURN_STATUS_LABELS_FA,
} from './sales-rules';
import type {
  ApproveSalesReturnDto,
  CancelSalesReturnDto,
  CompleteReturnWithoutCreditDto,
  InspectSalesReturnDto,
  ReceiveSalesReturnDto,
  RejectSalesReturnDto,
  RequestSalesReturnDto,
} from './dto/sales-return.dto';

export type SalesReturnActor = { userId: number | null; ipAddress?: string };

export type SalesReturnListFilters = {
  q?: string;
  status?: Prisma.SalesReturnWhereInput['status'];
  customerId?: number;
  salesOrderId?: number;
  deliveryId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

const userSelect = { select: { id: true, username: true } } as const;
const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

const salesReturnDetailInclude = {
  customer: { select: { id: true, customerNumber: true, name: true } },
  salesOrder: { select: { id: true, orderNumber: true } },
  delivery: { select: { id: true, deliveryNumber: true, deliveryDate: true } },
  location: { select: { id: true, code: true, name: true } },
  requestedByUser: userSelect,
  approvedByUser: userSelect,
  receivedByUser: userSelect,
  inspectedByUser: userSelect,
  items: {
    include: {
      deliveryItem: { select: { id: true, quantity: true, returnedQty: true, salesOrderItemId: true } },
    },
  },
  creditNotes: {
    orderBy: { id: 'asc' },
    select: { id: true, creditNoteNumber: true, status: true, totalAmount: true, createdAt: true },
  },
} satisfies Prisma.SalesReturnInclude;

type DeliveryForReturn = {
  id: number;
  deliveryNumber: string | null;
  deliveryDate: Date;
  status: string;
  customerId: number;
  salesOrderId: number;
  locationId: number;
  items: {
    id: number;
    itemId: number;
    quantity: Prisma.Decimal;
    returnedQty: Prisma.Decimal;
    salesOrderItemId: number;
    salesOrderItem: { id: number; lineNo: number; itemCode: string; itemName: string; unitName: string; unitPrice: Prisma.Decimal };
  }[];
};

const deliveryForReturnSelect = {
  id: true,
  deliveryNumber: true,
  deliveryDate: true,
  status: true,
  customerId: true,
  salesOrderId: true,
  locationId: true,
  items: {
    select: {
      id: true,
      itemId: true,
      quantity: true,
      returnedQty: true,
      salesOrderItemId: true,
      salesOrderItem: { select: { id: true, lineNo: true, itemCode: true, itemName: true, unitName: true, unitPrice: true } },
    },
  },
} satisfies Prisma.DeliverySelect;

// مرجوعی فروش (RMA) — lifecycle per docs/sales-module-build-plan.md §5:
//
//   request              REQUESTED against a POSTED delivery (B8: every
//                        return references a delivery). Lines capped at
//                        deliveryItem.quantity − deliveryItem.returnedQty as
//                        of now (display-time check — receive() re-checks
//                        under a lock, the same "enforce at the stock-moving
//                        step" discipline as Deliveries/Invoices). No
//                        number, no stock effect.
//   approve / reject     REQUESTED → APPROVED (RMA number assigned here) /
//                        REJECTED (reason required).
//   cancel               REQUESTED|APPROVED → CANCELLED (reason required;
//                        logged only — SalesReturn has no cancelReason
//                        column, unlike rejectReason).
//   receive              APPROVED → RECEIVED. Per line, receivedQty
//                        (defaults to requestedQty) → RETURN_RECEIPT (QC
//                        +q) and DeliveryItem/SalesOrderItem.returnedQty +=
//                        receivedQty.
//   inspect              RECEIVED → INSPECTED. Per line, restockQty +
//                        writeOffQty = receivedQty (exactly) →
//                        RETURN_RESTOCK (QC −r, ON_HAND +r) and/or
//                        RETURN_WRITE_OFF (QC −w).
//   completeWithoutCredit INSPECTED → COMPLETED, an explicit no-credit close
//                        (reason required) — the alternative to a credit
//                        note posting (markCredited()).
//   markCredited         INSPECTED → COMPLETED, called by
//                        CreditNotesService.post() inside ITS OWN
//                        transaction when the return's credit note posts.
//
// Lock order: return → delivery (receive() re-reads the delivery's own row
// under FOR UPDATE before touching its items' counters) — never the
// reverse, so this can't deadlock against Deliveries/Invoices' own
// delivery → sales order lock order.
@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: SalesReturnListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.SalesReturnWhereInput = {};
    if (filters.q) {
      where.OR = [
        { returnNumber: { contains: filters.q, mode: 'insensitive' } },
        { delivery: { deliveryNumber: { contains: filters.q, mode: 'insensitive' } } },
        { customer: { name: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;
    if (filters.deliveryId) where.deliveryId = filters.deliveryId;
    if (filters.dateFrom || filters.dateTo) {
      where.requestDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    const query = {
      where,
      orderBy: [{ requestDate: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, customerNumber: true } },
        delivery: { select: { id: true, deliveryNumber: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.SalesReturnFindManyArgs;

    if (!pagination) return this.prisma.salesReturn.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.salesReturn.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.salesReturn.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const salesReturn = await this.prisma.salesReturn.findUnique({ where: { id }, include: salesReturnDetailInclude });
    if (!salesReturn) throw new NotFoundException('مرجوعی پیدا نشد');
    return salesReturn;
  }

  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.SALES_RETURN, id);
  }

  // The request form's source: the delivery header plus every line's
  // still-returnable quantity (quantity − returnedQty) and the price/name
  // snapshot it would carry onto the return.
  async deliveryContext(deliveryId: number) {
    const delivery = await this.loadDelivery(this.prisma, deliveryId);
    return {
      id: delivery.id,
      deliveryNumber: delivery.deliveryNumber,
      deliveryDate: delivery.deliveryDate,
      status: delivery.status,
      customerId: delivery.customerId,
      salesOrderId: delivery.salesOrderId,
      locationId: delivery.locationId,
      returnable: RETURNABLE_DELIVERY_STATUSES.includes(delivery.status as never),
      items: delivery.items.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemCode: line.salesOrderItem.itemCode,
        itemName: line.salesOrderItem.itemName,
        unitName: line.salesOrderItem.unitName,
        unitPrice: line.salesOrderItem.unitPrice.toString(),
        quantity: line.quantity.toString(),
        returnedQty: line.returnedQty.toString(),
        returnableQty: this.returnable(line).toString(),
      })),
    };
  }

  async request(dto: RequestSalesReturnDto, actor: SalesReturnActor) {
    const delivery = await this.loadDelivery(this.prisma, dto.deliveryId);
    this.ensureDeliveryReturnable(delivery);

    const lines = dto.items.map((entry, index) => {
      const label = `ردیف ${index + 1}`;
      const line = delivery.items.find((item) => item.id === entry.deliveryItemId);
      if (!line) throw new BadRequestException(`${label}: ردیف انتخاب‌شده متعلق به این حواله نیست`);
      const open = this.returnable(line);
      if (dec(entry.quantity).greaterThan(open)) {
        throw new BadRequestException(`${label} («${line.salesOrderItem.itemName}»): مقدار درخواستی (${entry.quantity}) از مقدار قابل مرجوع این ردیف (${open.toString()}) بیشتر است`);
      }
      return {
        deliveryItemId: line.id,
        itemId: line.itemId,
        itemName: line.salesOrderItem.itemName,
        unitName: line.salesOrderItem.unitName,
        unitPrice: line.salesOrderItem.unitPrice,
        requestedQty: entry.quantity,
        conditionNote: entry.conditionNote ?? null,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      const salesReturn = await tx.salesReturn.create({
        data: {
          customerId: delivery.customerId,
          salesOrderId: delivery.salesOrderId,
          deliveryId: delivery.id,
          locationId: delivery.locationId,
          requestDate: dto.requestDate,
          reason: dto.reason,
          note: dto.note ?? null,
          status: 'REQUESTED',
          requestedByUserId: actor.userId,
          items: { create: lines },
        },
        include: salesReturnDetailInclude,
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_RETURN_REQUESTED',
          entityType: AUDIT_ENTITY.SALES_RETURN,
          entityId: salesReturn.id,
          details: `درخواست — حواله ${delivery.deliveryNumber ?? `#${delivery.id}`}، ${lines.length} ردیف`,
        },
        tx,
      );
      return salesReturn;
    });
  }

  // REQUESTED → APPROVED (RMA number assigned here, per build plan §4.2's
  // comment "assigned at APPROVED").
  async approve(id: number, dto: ApproveSalesReturnDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'APPROVED');
      const returnNumber = await nextDocumentNumber(tx, SALES_RETURN_DOC_TYPE, salesReturn.requestDate);
      await tx.salesReturn.update({
        where: { id },
        data: { status: 'APPROVED', returnNumber, approvedByUserId: actor.userId, approvedAt: new Date() },
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_RETURN_APPROVED',
          entityType: AUDIT_ENTITY.SALES_RETURN,
          entityId: id,
          details: returnNumber,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // REQUESTED → REJECTED (reason required, stored on rejectReason).
  async reject(id: number, dto: RejectSalesReturnDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'REJECTED');
      await tx.salesReturn.update({ where: { id }, data: { status: 'REJECTED', rejectReason: dto.reason } });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'SALES_RETURN_REJECTED', entityType: AUDIT_ENTITY.SALES_RETURN, entityId: id, details: `علت: ${dto.reason}` },
        tx,
      );
    });
    return this.get(id);
  }

  // REQUESTED|APPROVED → CANCELLED (reason required; logged only — no
  // cancelReason column on SalesReturn, unlike SalesOrder/CustomerPayment).
  async cancel(id: number, dto: CancelSalesReturnDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'CANCELLED');
      await tx.salesReturn.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'SALES_RETURN_CANCELLED', entityType: AUDIT_ENTITY.SALES_RETURN, entityId: id, details: `علت: ${dto.reason}` },
        tx,
      );
    });
    return this.get(id);
  }

  // APPROVED → RECEIVED. dto.items omitted ⇒ every line fully received
  // (receivedQty = requestedQty); when given, it must list every line of
  // this return (a line missing from the list would otherwise silently
  // receive zero). Re-checks each line's cap against the delivery item's
  // CURRENT returnedQty under a lock on the delivery row — another return
  // on the same delivery item may have been received since this one was
  // requested/approved.
  async receive(id: number, dto: ReceiveSalesReturnDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'RECEIVED');

      const byItemId = new Map(dto.items?.map((entry) => [entry.salesReturnItemId, entry]) ?? []);
      if (dto.items && salesReturn.items.some((line) => !byItemId.has(line.id))) {
        throw new BadRequestException('تمام ردیف‌های این مرجوعی باید در دریافت مشخص شوند');
      }

      await tx.$queryRaw`SELECT id FROM deliveries WHERE id = ${salesReturn.deliveryId} FOR UPDATE`;
      const deliveryItemIds = salesReturn.items.map((line) => line.deliveryItemId).filter((value): value is number => value !== null);
      const deliveryItems = await tx.deliveryItem.findMany({
        where: { id: { in: deliveryItemIds } },
        select: { id: true, quantity: true, returnedQty: true, salesOrderItemId: true },
      });
      const deliveryItemById = new Map(deliveryItems.map((row) => [row.id, row]));
      const salesOrderItems = await tx.salesOrderItem.findMany({
        where: { id: { in: deliveryItems.map((row) => row.salesOrderItemId) } },
        select: { id: true, returnedQty: true },
      });
      const salesOrderItemById = new Map(salesOrderItems.map((row) => [row.id, row]));

      const prepared = salesReturn.items.map((line) => {
        const requested = dec(line.requestedQty);
        const entry = byItemId.get(line.id);
        const receivedQty = entry?.receivedQty !== undefined ? dec(entry.receivedQty) : requested;
        if (receivedQty.greaterThan(requested)) {
          throw new BadRequestException(`ردیف «${line.itemName}»: مقدار دریافت‌شده (${receivedQty.toString()}) از مقدار درخواستی (${requested.toString()}) بیشتر است`);
        }
        const deliveryItem = line.deliveryItemId === null ? undefined : deliveryItemById.get(line.deliveryItemId);
        if (!deliveryItem) throw new ConflictException(`ردیف «${line.itemName}»: ردیف حواله مربوط پیدا نشد`);
        const capacity = dec(deliveryItem.quantity).minus(dec(deliveryItem.returnedQty));
        if (receivedQty.greaterThan(capacity)) {
          throw new ConflictException(
            `ردیف «${line.itemName}»: مقدار دریافت (${receivedQty.toString()}) از مقدار قابل مرجوع فعلی این ردیف حواله (${capacity.toString()}) بیشتر است — احتمالاً مرجوعی دیگری برای همین ردیف دریافت شده است.`,
          );
        }
        return { line, deliveryItem, receivedQty };
      });

      await receiveReturn(
        tx,
        {
          locationId: salesReturn.locationId,
          movementDate: new Date(),
          referenceType: 'SALES_RETURN',
          referenceId: salesReturn.id,
          referenceNumber: salesReturn.returnNumber,
          createdByUserId: actor.userId,
        },
        prepared.filter((entry) => entry.receivedQty.greaterThan(0)).map((entry) => ({ referenceLineId: entry.line.id, itemId: entry.line.itemId, quantity: entry.receivedQty })),
      );

      for (const entry of prepared) {
        await tx.salesReturnItem.update({ where: { id: entry.line.id }, data: { receivedQty: entry.receivedQty } });
      }
      await applyReturnedQuantities(
        tx,
        prepared
          .filter((entry) => entry.receivedQty.greaterThan(0))
          .map((entry) => ({
            deliveryItemId: entry.deliveryItem.id,
            deliveryItemReturnedQty: entry.deliveryItem.returnedQty,
            salesOrderItemId: entry.deliveryItem.salesOrderItemId,
            salesOrderItemReturnedQty: salesOrderItemById.get(entry.deliveryItem.salesOrderItemId)?.returnedQty ?? 0,
            quantity: entry.receivedQty,
          })),
      );

      await tx.salesReturn.update({ where: { id }, data: { status: 'RECEIVED', receivedByUserId: actor.userId, receivedAt: new Date() } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_RETURN_RECEIVED',
          entityType: AUDIT_ENTITY.SALES_RETURN,
          entityId: id,
          details: `${salesReturn.returnNumber ?? ''} — ${prepared.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // RECEIVED → INSPECTED. Every line with receivedQty > 0 must be listed,
  // restockQty + writeOffQty must equal that line's receivedQty exactly.
  async inspect(id: number, dto: InspectSalesReturnDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'INSPECTED');

      const byItemId = new Map(dto.items.map((entry) => [entry.salesReturnItemId, entry]));
      const receivedLines = salesReturn.items.filter((line) => dec(line.receivedQty).greaterThan(0));
      const missing = receivedLines.find((line) => !byItemId.has(line.id));
      if (missing) throw new BadRequestException(`ردیف «${missing.itemName}»: باید در بازرسی مشخص شود`);

      const prepared = receivedLines.map((line) => {
        const entry = byItemId.get(line.id)!;
        const restockQty = dec(entry.restockQty);
        const writeOffQty = dec(entry.writeOffQty);
        const received = dec(line.receivedQty);
        if (!restockQty.plus(writeOffQty).equals(received)) {
          throw new BadRequestException(
            `ردیف «${line.itemName}»: جمع بازگشت به انبار (${restockQty.toString()}) و ضایعات (${writeOffQty.toString()}) باید برابر مقدار دریافت‌شده (${received.toString()}) باشد`,
          );
        }
        return { line, restockQty, writeOffQty };
      });

      await inspectReturn(
        tx,
        {
          locationId: salesReturn.locationId,
          movementDate: new Date(),
          referenceType: 'SALES_RETURN',
          referenceId: salesReturn.id,
          referenceNumber: salesReturn.returnNumber,
          createdByUserId: actor.userId,
        },
        prepared.map((entry) => ({ referenceLineId: entry.line.id, itemId: entry.line.itemId, restockQty: entry.restockQty, writeOffQty: entry.writeOffQty })),
      );

      for (const entry of prepared) {
        await tx.salesReturnItem.update({ where: { id: entry.line.id }, data: { restockQty: entry.restockQty, writeOffQty: entry.writeOffQty } });
      }

      await tx.salesReturn.update({ where: { id }, data: { status: 'INSPECTED', inspectedByUserId: actor.userId, inspectedAt: new Date() } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_RETURN_INSPECTED',
          entityType: AUDIT_ENTITY.SALES_RETURN,
          entityId: id,
          details: `${salesReturn.returnNumber ?? ''} — ${prepared.length} ردیف`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // INSPECTED → COMPLETED, an explicit no-credit close (reason required) —
  // the alternative to markCredited() (build plan §5).
  async completeWithoutCredit(id: number, dto: CompleteReturnWithoutCreditDto, actor: SalesReturnActor) {
    await this.prisma.$transaction(async (tx) => {
      const salesReturn = await this.loadLocked(tx, id);
      if (!isSameVersion(salesReturn.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      ensureSalesReturnTransition(salesReturn.status, 'COMPLETED');
      await tx.salesReturn.update({ where: { id }, data: { status: 'COMPLETED' } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_RETURN_COMPLETED_NO_CREDIT',
          entityType: AUDIT_ENTITY.SALES_RETURN,
          entityId: id,
          details: `بدون صدور یادداشت اعتباری — علت: ${dto.reason}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // Called by CreditNotesService.post() inside ITS OWN transaction (same
  // commit as the credit note's POSTED write) — the cross-module call this
  // module exposes for Receivables, same role as
  // SalesInvoicesService.applySettlement(). INSPECTED → COMPLETED;
  // creditedQty is written per line.
  async markCredited(tx: Prisma.TransactionClient, salesReturnId: number, creditedLines: { salesReturnItemId: number; quantity: Prisma.Decimal }[], actor: SalesReturnActor) {
    await tx.$queryRaw`SELECT id FROM sales_returns WHERE id = ${salesReturnId} FOR UPDATE`;
    const salesReturn = await tx.salesReturn.findUnique({ where: { id: salesReturnId }, select: { id: true, status: true, returnNumber: true, items: { select: { id: true, creditedQty: true } } } });
    if (!salesReturn) throw new NotFoundException('مرجوعی پیدا نشد');
    ensureSalesReturnTransition(salesReturn.status, 'COMPLETED');
    const currentByItem = new Map(salesReturn.items.map((line) => [line.id, line.creditedQty]));
    for (const entry of creditedLines) {
      await tx.salesReturnItem.update({
        where: { id: entry.salesReturnItemId },
        data: { creditedQty: dec(currentByItem.get(entry.salesReturnItemId) ?? 0).plus(entry.quantity) },
      });
    }
    await tx.salesReturn.update({ where: { id: salesReturnId }, data: { status: 'COMPLETED' } });
    await this.audit.log(
      {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: 'SALES_RETURN_CREDITED',
        entityType: AUDIT_ENTITY.SALES_RETURN,
        entityId: salesReturnId,
        details: `${salesReturn.returnNumber ?? ''} — یادداشت اعتباری صادر شد`,
      },
      tx,
    );
  }

  // --- internals ----------------------------------------------------------------

  private async loadDelivery(client: Prisma.TransactionClient | PrismaService, deliveryId: number): Promise<DeliveryForReturn> {
    const delivery = await client.delivery.findUnique({ where: { id: deliveryId }, select: deliveryForReturnSelect });
    if (!delivery) throw new NotFoundException('حواله تحویل پیدا نشد');
    return delivery as unknown as DeliveryForReturn;
  }

  private ensureDeliveryReturnable(delivery: DeliveryForReturn) {
    if (!RETURNABLE_DELIVERY_STATUSES.includes(delivery.status as never)) {
      throw new ConflictException('فقط برای حوالهٔ «ثبت‌شده» می‌توان درخواست مرجوعی ثبت کرد');
    }
  }

  private returnable(line: { quantity: Prisma.Decimal; returnedQty: Prisma.Decimal }): Prisma.Decimal {
    return dec(line.quantity).minus(dec(line.returnedQty));
  }

  private async loadLocked(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM sales_returns WHERE id = ${id} FOR UPDATE`;
    const salesReturn = await tx.salesReturn.findUnique({ where: { id }, include: { items: true } });
    if (!salesReturn) throw new NotFoundException('مرجوعی پیدا نشد');
    return salesReturn;
  }
}
