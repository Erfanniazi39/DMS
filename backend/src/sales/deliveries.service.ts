import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SalesDocumentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { getCustomerCreditPolicy } from '../customers/customer-rules';
import { InventoryService } from '../inventory/inventory.service';
import { issueForDelivery } from '../inventory/stock-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { applyDeliveredQuantities, recomputeOrderProgress } from './sales-progress';
import {
  CUSTOMER_CREDIT_HOLD,
  DELIVERABLE_SALES_ORDER_STATUSES,
  DELIVERY_DOC_TYPE,
  EDITABLE_SALES_DOCUMENT_STATUSES,
  SALES_DELIVERY_STATUS_LABELS_FA,
  SALES_DOCUMENT_STATUS_LABELS_FA,
  SALES_ORDER_STATUS_LABELS_FA,
} from './sales-rules';
import type { CreateDeliveryDto, DeliveryItemDto, PostDeliveryDto, UpdateDeliveryDto } from './dto/delivery.dto';

export type DeliveryActor = { userId: number | null; ipAddress?: string };

export type DeliveryListFilters = {
  q?: string;
  status?: SalesDocumentStatus;
  customerId?: number;
  salesOrderId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

const userSelect = { select: { id: true, username: true } } as const;

const orderLineSelect = {
  id: true,
  lineNo: true,
  itemId: true,
  itemCode: true,
  itemName: true,
  unitName: true,
  quantity: true,
  reservedQty: true,
  deliveredQty: true,
} as const;

// Everything the detail and print pages need: the order's printed fields
// (customer snapshot, customer note, reference) and each line's order-side
// snapshot (code / name / unit).
const deliveryDetailInclude = {
  salesOrder: {
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      status: true,
      deliveryStatus: true,
      customerName: true,
      customerEconomicCode: true,
      customerReference: true,
      customerNote: true,
    },
  },
  customer: { select: { id: true, customerNumber: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  createdByUser: userSelect,
  postedByUser: userSelect,
  items: {
    orderBy: { salesOrderItem: { lineNo: 'asc' } },
    include: { salesOrderItem: { select: orderLineSelect } },
  },
} satisfies Prisma.DeliveryInclude;

type OrderForDelivery = {
  id: number;
  orderNumber: string | null;
  orderDate: Date;
  status: Prisma.SalesOrderGetPayload<{ select: { status: true } }>['status'];
  customerId: number;
  locationId: number;
  deliveryAddressText: string | null;
  items: { id: number; lineNo: number; itemId: number; itemName: string; quantity: Prisma.Decimal; deliveredQty: Prisma.Decimal; reservedQty: Prisma.Decimal }[];
};

const undelivered = (line: { quantity: Prisma.Decimal; deliveredQty: Prisma.Decimal }) =>
  new Prisma.Decimal(line.quantity).minus(new Prisma.Decimal(line.deliveredQty));

// حواله تحویل — lifecycle per docs/sales-module-build-plan.md §5:
//
//   create (from order)  DRAFT against a CONFIRMED order; lines prefilled
//                        with each order line's undelivered quantity
//                        (quantity − deliveredQty) unless given. No number,
//                        no stock effect.
//   update / remove      DRAFT only (lines replaced wholesale on update).
//   post                 DRAFT → POSTED, one-way; POSTED is immutable.
//
// Posting is one transaction: lock the delivery, lock the order (then its
// lines are re-read — a concurrent post of another delivery for the same
// order has either committed or waits), re-check each line still fits the
// undelivered quantity, claim the gap-free DN-<jalali year>-NNNNNN number,
// issue stock through inventory/stock-ledger.ts issueForDelivery()
// (DELIVERY_ISSUE: ON_HAND −q, RESERVED −min(q, reservedQty); blocked if
// ON_HAND would go negative, or if it would take stock reserved for another
// order), update the order lines' deliveredQty/reservedQty and recompute the
// order's derived status via sales-progress.ts, mark POSTED, audit. A
// customer on credit hold blocks posting (409 CUSTOMER_CREDIT_HOLD). Any
// failure rolls all of it back — including the number (no gap).
//
// Lock order: delivery → sales order → stock balances (by itemId). Sales
// order actions lock order → stock, so the two can't deadlock.
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as the other list endpoints.
  async list(filters: DeliveryListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.DeliveryWhereInput = {};
    if (filters.q) {
      where.OR = [
        { deliveryNumber: { contains: filters.q, mode: 'insensitive' } },
        { salesOrder: { orderNumber: { contains: filters.q, mode: 'insensitive' } } },
        { salesOrder: { customerName: { contains: filters.q, mode: 'insensitive' } } },
        { receivedByName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;
    if (filters.dateFrom || filters.dateTo) {
      where.deliveryDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    const query = {
      where,
      orderBy: [{ deliveryDate: 'desc' }, { id: 'desc' }],
      include: {
        salesOrder: { select: { id: true, orderNumber: true, customerName: true } },
        customer: { select: { id: true, customerNumber: true } },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.DeliveryFindManyArgs;

    if (!pagination) return this.prisma.delivery.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.delivery.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  // Work queue: CONFIRMED orders with at least one line still to deliver
  // (deliveryStatus ≠ DELIVERED), oldest requested/ordered first.
  async queue(q?: string, pagination?: PaginationParams) {
    const where: Prisma.SalesOrderWhereInput = {
      status: { in: DELIVERABLE_SALES_ORDER_STATUSES },
      deliveryStatus: { not: 'DELIVERED' },
    };
    if (q) {
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerReference: { contains: q, mode: 'insensitive' } },
      ];
    }
    const query = {
      where,
      orderBy: [{ requestedDeliveryDate: { sort: 'asc', nulls: 'last' } }, { orderDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        requestedDeliveryDate: true,
        customerId: true,
        customerName: true,
        deliveryStatus: true,
        customer: { select: { id: true, customerNumber: true } },
        items: { select: { quantity: true, deliveredQty: true } },
        _count: { select: { deliveries: { where: { status: 'DRAFT' } } } },
      },
    } satisfies Prisma.SalesOrderFindManyArgs;

    const shape = (rows: Prisma.SalesOrderGetPayload<typeof query>[]) =>
      rows.map(({ items, _count, ...order }) => ({
        ...order,
        lineCount: items.length,
        openLineCount: items.filter((line) => undelivered(line).greaterThan(0)).length,
        draftDeliveryCount: _count.deliveries,
      }));

    if (!pagination) return shape(await this.prisma.salesOrder.findMany(query));
    const [rows, total] = await Promise.all([
      this.prisma.salesOrder.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { items: shape(rows), total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id }, include: deliveryDetailInclude });
    if (!delivery) throw new NotFoundException('حواله تحویل پیدا نشد');
    return delivery;
  }

  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.DELIVERY, id);
  }

  // The create form's source: the order header plus every line with its
  // undelivered quantity and the warehouse's current availability (display
  // only — posting re-checks under a lock).
  async orderContext(salesOrderId: number) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        deliveryStatus: true,
        customerId: true,
        customerName: true,
        deliveryAddressText: true,
        requestedDeliveryDate: true,
        locationId: true,
        location: { select: { id: true, code: true, name: true } },
        items: { orderBy: { lineNo: 'asc' }, select: orderLineSelect },
      },
    });
    if (!order) throw new NotFoundException('سفارش فروش پیدا نشد');
    const availability = await this.inventory.listAvailability(order.locationId);
    const byItem = new Map(availability.map((row) => [row.itemId, row]));
    const zero = new Prisma.Decimal(0);
    return {
      ...order,
      deliverable: DELIVERABLE_SALES_ORDER_STATUSES.includes(order.status),
      items: order.items.map((line) => ({
        ...line,
        undeliveredQty: undelivered(line).toString(),
        onHand: (byItem.get(line.itemId)?.onHand ?? zero).toString(),
        available: (byItem.get(line.itemId)?.available ?? zero).toString(),
      })),
    };
  }

  async createFromOrder(dto: CreateDeliveryDto, actor: DeliveryActor) {
    const order = await this.loadOrder(this.prisma, dto.salesOrderId);
    this.ensureOrderDeliverable(order);
    this.ensureDateNotBeforeOrder(dto.deliveryDate, order.orderDate);

    const requested =
      dto.items ??
      order.items.filter((line) => undelivered(line).greaterThan(0)).map((line) => ({ salesOrderItemId: line.id, quantity: undelivered(line).toNumber() }));
    if (requested.length === 0) throw new ConflictException('همهٔ اقلام این سفارش تحویل شده است');
    const lines = this.prepareLines(order, requested);

    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.create({
        data: {
          salesOrderId: order.id,
          customerId: order.customerId,
          locationId: order.locationId,
          deliveryAddressText: order.deliveryAddressText,
          deliveryDate: dto.deliveryDate,
          carrierNote: dto.carrierNote ?? null,
          receivedByName: dto.receivedByName ?? null,
          note: dto.note ?? null,
          status: 'DRAFT',
          createdByUserId: actor.userId,
          items: { create: lines },
        },
        include: deliveryDetailInclude,
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'DELIVERY_CREATED',
          entityType: AUDIT_ENTITY.DELIVERY,
          entityId: delivery.id,
          details: `پیش‌نویس — سفارش ${order.orderNumber ?? `#${order.id}`}، ${lines.length} ردیف`,
        },
        tx,
      );
      return delivery;
    });
  }

  // Full-record edit of a DRAFT: header plus lines replaced wholesale.
  // Optimistic lock on updatedAt, re-checked atomically together with
  // status = DRAFT inside the transaction.
  async update(id: number, dto: UpdateDeliveryDto, actor: DeliveryActor) {
    const existing = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true, salesOrderId: true } });
    if (!existing) throw new NotFoundException('حواله تحویل پیدا نشد');
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    const order = await this.loadOrder(this.prisma, existing.salesOrderId);
    this.ensureOrderDeliverable(order);
    this.ensureDateNotBeforeOrder(dto.deliveryDate, order.orderDate);
    const lines = this.prepareLines(order, dto.items);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.delivery.updateMany({ where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.deliveryItem.deleteMany({ where: { deliveryId: id } });
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          deliveryDate: dto.deliveryDate,
          carrierNote: dto.carrierNote ?? null,
          receivedByName: dto.receivedByName ?? null,
          note: dto.note ?? null,
          items: { create: lines },
        },
        include: deliveryDetailInclude,
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'DELIVERY_UPDATED',
          entityType: AUDIT_ENTITY.DELIVERY,
          entityId: id,
          details: `${lines.length} ردیف`,
        },
        tx,
      );
      return updated;
    });
  }

  // DRAFT only — it has no number, so deleting it leaves no gap. Lines
  // cascade. A POSTED delivery has no delete path — ever.
  async remove(id: number, actor: DeliveryActor) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDelivery(tx, id);
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: { id: true, status: true, salesOrder: { select: { id: true, orderNumber: true } } },
      });
      if (!delivery) throw new NotFoundException('حواله تحویل پیدا نشد');
      if (!EDITABLE_SALES_DOCUMENT_STATUSES.includes(delivery.status)) {
        throw new ConflictException(
          `فقط حوالهٔ «پیش‌نویس» قابل حذف است؛ این حواله «${SALES_DOCUMENT_STATUS_LABELS_FA[delivery.status]}» است و قابل حذف نیست.`,
        );
      }
      await tx.delivery.delete({ where: { id } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'DELIVERY_DELETED',
          entityType: AUDIT_ENTITY.DELIVERY,
          entityId: id,
          details: `پیش‌نویس — سفارش ${delivery.salesOrder.orderNumber ?? `#${delivery.salesOrder.id}`}`,
        },
        tx,
      );
    });
    return { success: true };
  }

  // DRAFT → POSTED. See the class comment for the transaction's steps.
  async post(id: number, dto: PostDeliveryDto, actor: DeliveryActor) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDelivery(tx, id);
      const delivery = await tx.delivery.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } }, location: { select: { isActive: true } } },
      });
      if (!delivery) throw new NotFoundException('حواله تحویل پیدا نشد');
      if (delivery.status === 'POSTED') throw new ConflictException('این حواله قبلاً ثبت شده است');
      if (!isSameVersion(delivery.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (delivery.items.length === 0) throw new BadRequestException('حوالهٔ بدون ردیف کالا قابل ثبت نیست');
      if (!delivery.location?.isActive) throw new ConflictException('انبار این حواله غیرفعال است');

      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${delivery.salesOrderId} FOR UPDATE`;
      const order = await this.loadOrder(tx, delivery.salesOrderId);
      this.ensureOrderDeliverable(order);
      // A customer on credit hold gets no goods issued (business decision
      // 2026-10-07, extending B4) — no override, same as order confirmation.
      // Checked before the number is claimed, so a refusal burns nothing.
      const policy = await getCustomerCreditPolicy(tx, order.customerId);
      if (policy.creditHold) {
        throw new ConflictException({
          statusCode: 409,
          code: CUSTOMER_CREDIT_HOLD,
          message: 'مشتری این سفارش در توقف اعتباری است و ثبت حوالهٔ تحویل برای آن امکان‌پذیر نیست',
        });
      }

      // Re-check against the counters as they are NOW (another delivery for
      // this order may have been posted since this draft was saved).
      const orderLines = new Map(order.items.map((line) => [line.id, line]));
      const pairs = delivery.items.map((item) => {
        const line = orderLines.get(item.salesOrderItemId);
        if (!line) throw new ConflictException('یکی از ردیف‌های این حواله دیگر در سفارش وجود ندارد');
        const open = undelivered(line);
        if (new Prisma.Decimal(item.quantity).greaterThan(open)) {
          throw new ConflictException(
            `ردیف ${line.lineNo} («${line.itemName}»): مقدار این حواله (${new Prisma.Decimal(item.quantity).toString()}) از مقدار تحویل‌نشدهٔ سفارش (${open.toString()}) بیشتر است — احتمالاً حوالهٔ دیگری برای این سفارش ثبت شده است. حواله را اصلاح کنید.`,
          );
        }
        return { item, line };
      });

      const deliveryNumber = await nextDocumentNumber(tx, DELIVERY_DOC_TYPE, delivery.deliveryDate);
      const issued = await issueForDelivery(
        tx,
        {
          locationId: delivery.locationId,
          movementDate: delivery.deliveryDate,
          referenceType: 'DELIVERY',
          referenceId: delivery.id,
          referenceNumber: deliveryNumber,
          createdByUserId: actor.userId,
        },
        pairs.map(({ item, line }) => ({ referenceLineId: item.id, itemId: item.itemId, quantity: item.quantity, reservedQty: line.reservedQty })),
      );
      const consumedByDeliveryItem = new Map(issued.map((result) => [result.referenceLineId, result.reservedConsumed]));

      await applyDeliveredQuantities(
        tx,
        pairs.map(({ item, line }) => ({
          salesOrderItemId: line.id,
          current: line,
          quantity: item.quantity,
          reservedConsumed: consumedByDeliveryItem.get(item.id)!,
        })),
      );
      await tx.delivery.update({
        where: { id },
        data: { status: 'POSTED', deliveryNumber, postedByUserId: actor.userId, postedAt: new Date() },
      });
      const progress = await recomputeOrderProgress(tx, order.id);

      const orderLabel = order.orderNumber ?? `#${order.id}`;
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'DELIVERY_POSTED',
          entityType: AUDIT_ENTITY.DELIVERY,
          entityId: id,
          details: `${deliveryNumber} — سفارش ${orderLabel}، ${pairs.length} ردیف`,
        },
        tx,
      );
      // The order's own history shows the delivery and its effect.
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_DELIVERY_POSTED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: order.id,
          details: `حواله ${deliveryNumber} — وضعیت تحویل: ${SALES_DELIVERY_STATUS_LABELS_FA[progress.deliveryStatus]}`,
        },
        tx,
      );
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
    });
    return this.get(id);
  }

  // --- internals ----------------------------------------------------------------

  private async lockDelivery(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM deliveries WHERE id = ${id} FOR UPDATE`;
  }

  private async loadOrder(client: Prisma.TransactionClient | PrismaService, salesOrderId: number): Promise<OrderForDelivery> {
    const order = await client.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        customerId: true,
        locationId: true,
        deliveryAddressText: true,
        items: {
          orderBy: { lineNo: 'asc' },
          select: { id: true, lineNo: true, itemId: true, itemName: true, quantity: true, deliveredQty: true, reservedQty: true },
        },
      },
    });
    if (!order) throw new NotFoundException('سفارش فروش پیدا نشد');
    return order;
  }

  private ensureOrderDeliverable(order: OrderForDelivery) {
    if (!DELIVERABLE_SALES_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException(
        `فقط برای سفارش «${SALES_ORDER_STATUS_LABELS_FA.CONFIRMED}» می‌توان حواله تحویل صادر یا ثبت کرد؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[order.status]}» است.`,
      );
    }
  }

  private ensureDateNotBeforeOrder(deliveryDate: Date, orderDate: Date) {
    if (deliveryDate.getTime() < orderDate.getTime()) throw new BadRequestException('تاریخ تحویل نمی‌تواند پیش از تاریخ سفارش باشد');
  }

  private ensureEditable(status: SalesDocumentStatus) {
    if (!EDITABLE_SALES_DOCUMENT_STATUSES.includes(status)) {
      throw new ConflictException(`فقط حوالهٔ «پیش‌نویس» قابل ویرایش است؛ این حواله «${SALES_DOCUMENT_STATUS_LABELS_FA[status]}» است`);
    }
  }

  // Each requested line must belong to the order and fit its undelivered
  // quantity (quantity − deliveredQty). Lines are stored in order-line order.
  private prepareLines(order: OrderForDelivery, items: Pick<DeliveryItemDto, 'salesOrderItemId' | 'quantity'>[]) {
    const orderLines = new Map(order.items.map((line) => [line.id, line]));
    const seen = new Set<number>();
    const prepared = items.map((entry) => {
      const line = orderLines.get(entry.salesOrderItemId);
      if (!line) throw new BadRequestException('ردیف انتخاب‌شده متعلق به این سفارش نیست');
      if (seen.has(line.id)) throw new BadRequestException(`ردیف ${line.lineNo} سفارش بیش از یک بار در حواله آمده است`);
      seen.add(line.id);
      const open = undelivered(line);
      if (new Prisma.Decimal(entry.quantity).greaterThan(open)) {
        throw new BadRequestException(
          `ردیف ${line.lineNo} («${line.itemName}»): مقدار تحویل (${entry.quantity}) از مقدار تحویل‌نشدهٔ سفارش (${open.toString()}) بیشتر است`,
        );
      }
      return { lineNo: line.lineNo, data: { salesOrderItemId: line.id, itemId: line.itemId, quantity: entry.quantity } };
    });
    return prepared.sort((a, b) => a.lineNo - b.lineNo).map((entry) => entry.data);
  }
}
