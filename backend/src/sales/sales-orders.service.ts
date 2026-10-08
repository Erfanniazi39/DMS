import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SalesDeliveryStatus, type SalesInvoicingStatus, type SalesOrderStatus, type SalesPaymentStatus } from '@prisma/client';
import { nextDocumentNumber } from '../common/document-sequence';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { toIsoDay } from '../common/zod-fields';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureTransactableCustomer, getCustomerCreditPolicy } from '../customers/customer-rules';
import { InventoryService } from '../inventory/inventory.service';
import { releaseReserved, reserveAvailable, type StockEventContext } from '../inventory/stock-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { computeExposure, evaluateCredit, type CreditCheck } from './sales-credit';
import {
  CREDIT_LIMIT_EXCEEDED,
  EDITABLE_SALES_ORDER_STATUSES,
  ensureSalesOrderTransition,
  formatAddress,
  SALES_ORDER_APPROVAL_REASON_LABELS_FA,
  SALES_ORDER_APPROVAL_REQUIRED,
  SALES_ORDER_DOC_TYPE,
  SALES_ORDER_STATUS_LABELS_FA,
  type SalesOrderApprovalReason,
} from './sales-rules';
import { computeLineAmounts, hasAnyDiscount, sumOrderTotals, type SalesLineAmounts } from './sales-totals';
import type {
  ApproveSalesOrderDto,
  CancelSalesOrderDto,
  CloseSalesOrderDto,
  ConfirmSalesOrderDto,
  CreateSalesOrderDto,
  RejectSalesOrderDto,
  SalesOrderItemDto,
  UpdateSalesOrderDto,
} from './dto/sales-order.dto';

// Who is acting, and what their session allows beyond the route's own
// @RequirePermissions (resolved by the controller from req.session):
//   canApprove    — sales.approve: may set discounts (B3), confirm a
//                   discounted / over-credit order, override credit (B4).
//   canViewCredit — sales.approve or customers.finance: may see the
//                   customer's credit limit / exposure figures in errors
//                   and the form's customer panel (the limit itself is
//                   customers.finance data in the Customer module).
export type SalesActor = {
  userId: number | null;
  ipAddress?: string;
  canApprove: boolean;
  canViewCredit: boolean;
};

export type SalesOrderListFilters = {
  q?: string;
  status?: SalesOrderStatus;
  deliveryStatus?: SalesDeliveryStatus;
  invoicingStatus?: SalesInvoicingStatus;
  paymentStatus?: SalesPaymentStatus;
  customerId?: number;
  dateFrom?: Date;
  dateTo?: Date;
};

// A line that couldn't be fully reserved at confirmation — a visible
// backorder, never a block (build plan §5).
export type SalesOrderBackorder = {
  lineNo: number;
  itemId: number;
  itemName: string;
  quantity: string;
  reserved: string;
  shortfall: string;
};

const userSelect = { select: { id: true, username: true } } as const;

// Everything the detail page needs. Employee narrowed to display fields
// (never national ID / salary / bank — CLAUDE.md, same as Purchases).
const salesOrderDetailInclude = {
  customer: { select: { id: true, customerNumber: true, name: true, status: true } },
  deliveryAddress: { select: { id: true, addressType: true, label: true, isActive: true } },
  paymentTerm: { select: { id: true, code: true, nameFa: true, dueDays: true } },
  salespersonEmployee: { select: { id: true, code: true, firstName: true, lastName: true } },
  location: { select: { id: true, code: true, name: true } },
  createdByUser: userSelect,
  approvedByUser: userSelect,
  creditOverrideByUser: userSelect,
  confirmedByUser: userSelect,
  cancelledByUser: userSelect,
  closedByUser: userSelect,
  items: { orderBy: { lineNo: 'asc' } },
} satisfies Prisma.SalesOrderInclude;

type PreparedLine = {
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unitId: number;
  unitName: string;
  quantity: number;
  listUnitPrice: Prisma.Decimal | null;
  unitPrice: number;
  priceOverrideReason: string | null;
  discountPercent: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  note: string | null;
};

type ExistingDraft = {
  customerId: number;
  deliveryAddressId: number | null;
  salespersonEmployeeId: number | null;
  locationId: number;
  items: { itemId: number }[];
};

// Today as a business date (UTC midnight of the calendar day — the same
// convention as every user-entered date, see common/zod-fields.ts toIsoDay()).
function today() {
  return new Date(`${toIsoDay(new Date())}T00:00:00.000Z`);
}

// سفارش فروش — lifecycle per docs/sales-module-build-plan.md §5:
//
//   create/update/remove  DRAFT only (no number, no stock effect; snapshots
//                         refreshed on every save).
//   confirm               DRAFT → CONFIRMED, or → PENDING_APPROVAL when the
//                         order needs a sales.approve holder (discount, or
//                         over the credit limit) and the user isn't one.
//   approve / reject      PENDING_APPROVAL → CONFIRMED / DRAFT.
//   cancel / close        CONFIRMED → CANCELLED (nothing delivered yet) /
//                         CLOSED (short-close); both release the reservation.
//
// Reaching CONFIRMED is one transaction (finalizeConfirm): lock the order,
// customer gate (ensureTransactableCustomer — creditHold blocks with no
// override), credit check under a lock on the customer's financial profile,
// claim the gap-free SO-<jalali year>-NNNNNN number, reserve stock through
// inventory/stock-ledger.ts, mark CONFIRMED, audit. Anything failing rolls
// all of it back — including the number (no gap).
//
// Stock is never written here: reservation/release go through
// stock-ledger.ts reserveAvailable()/releaseReserved() (→ applyMovements()).
// Customers are checked via customers/customer-rules.ts (no CustomersModule
// injection).
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // Same opt-in pagination contract as the other list endpoints.
  async list(filters: SalesOrderListFilters = {}, pagination?: PaginationParams) {
    const where: Prisma.SalesOrderWhereInput = {};
    if (filters.q) {
      where.OR = [
        { orderNumber: { contains: filters.q, mode: 'insensitive' } },
        { customerName: { contains: filters.q, mode: 'insensitive' } },
        { customerReference: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters.status) where.status = filters.status;
    if (filters.deliveryStatus) where.deliveryStatus = filters.deliveryStatus;
    if (filters.invoicingStatus) where.invoicingStatus = filters.invoicingStatus;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.dateFrom || filters.dateTo) {
      where.orderDate = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    const query = {
      where,
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, customerNumber: true } },
        salespersonEmployee: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    } satisfies Prisma.SalesOrderFindManyArgs;

    if (!pagination) return this.prisma.salesOrder.findMany(query);
    const [items, total] = await Promise.all([
      this.prisma.salesOrder.findMany({ ...query, ...toSkipTake(pagination) }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { items, total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(id: number) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: salesOrderDetailInclude });
    if (!order) throw new NotFoundException('سفارش فروش پیدا نشد');
    return order;
  }

  // History tab: this order's audit trail, newest first.
  history(id: number) {
    return this.audit.listForEntity(AUDIT_ENTITY.SALES_ORDER, id);
  }

  async create(dto: CreateSalesOrderDto, actor: SalesActor) {
    this.ensureDiscountAllowed(dto.items, actor);
    const prepared = await this.prepareDraft(dto);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.create({
        data: {
          ...prepared.header,
          status: 'DRAFT',
          createdByUserId: actor.userId,
          items: { create: prepared.lines },
        },
        include: salesOrderDetailInclude,
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_CREATED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: order.id,
          details: `پیش‌نویس — ${order.customerName}، ${prepared.lines.length} ردیف، جمع ${order.totalAmount.toString()}`,
        },
        tx,
      );
      return order;
    });
  }

  // Full-record edit of a DRAFT: header plus lines replaced wholesale (same
  // convention as PurchasesService.update()). Optimistic lock on updatedAt,
  // re-checked atomically together with status = DRAFT inside the
  // transaction, so an edit can't land on an order that was confirmed or
  // submitted for approval in the meantime.
  async update(id: number, dto: UpdateSalesOrderDto, actor: SalesActor) {
    const existing = await this.prisma.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw new NotFoundException('سفارش فروش پیدا نشد');
    this.ensureEditable(existing.status);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    this.ensureDiscountAllowed(dto.items, actor, existing.items);
    const prepared = await this.prepareDraft(dto, existing);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: { id, updatedAt: existing.updatedAt, status: 'DRAFT' },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw recordModifiedConflict();
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { ...prepared.header, items: { create: prepared.lines } },
        include: salesOrderDetailInclude,
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_UPDATED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: id,
          details: `${prepared.lines.length} ردیف، جمع ${updated.totalAmount.toString()}`,
        },
        tx,
      );
      return updated;
    });
  }

  // DRAFT only — it has no number, so deleting it leaves no gap. Lines cascade.
  async remove(id: number, actor: SalesActor) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      const order = await tx.salesOrder.findUnique({ where: { id }, select: { id: true, status: true, customerName: true } });
      if (!order) throw new NotFoundException('سفارش فروش پیدا نشد');
      if (!EDITABLE_SALES_ORDER_STATUSES.includes(order.status)) {
        throw new ConflictException(
          `فقط سفارش «پیش‌نویس» قابل حذف است؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[order.status]}» است. سفارش تأییدشده را می‌توان لغو یا بست.`,
        );
      }
      await tx.salesOrder.delete({ where: { id } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_DELETED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: id,
          details: `پیش‌نویس — ${order.customerName}`,
        },
        tx,
      );
    });
    return { success: true };
  }

  // DRAFT → CONFIRMED, or → PENDING_APPROVAL. Approval is needed when the
  // order carries a discount (B3/§5) or would exceed the customer's credit
  // limit (B4). Then:
  //   - a sales.approve holder confirms directly (over the limit only with
  //     dto.creditOverrideReason — else 409 CREDIT_LIMIT_EXCEEDED);
  //   - anyone else gets 409 SALES_ORDER_APPROVAL_REQUIRED, or, with
  //     dto.submitForApproval, the order moves to PENDING_APPROVAL.
  // The customer gate (inactive / credit hold) blocks everyone, always.
  async confirm(id: number, dto: ConfirmSalesOrderDto, actor: SalesActor) {
    if (dto.creditOverrideReason && !actor.canApprove) {
      throw new ForbiddenException('فقط کاربر دارای مجوز «تأیید فروش» می‌تواند از سقف اعتبار عبور کند');
    }
    const backorders = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadLocked(tx, id);
      if (!isSameVersion(order.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      // DRAFT only: PENDING_APPROVAL → CONFIRMED is legal in the matrix but
      // belongs to approve() (sales.approve) — otherwise a salesperson could
      // confirm their own pending order here once the reason went away.
      if (order.status !== 'DRAFT') {
        throw new ConflictException(
          order.status === 'PENDING_APPROVAL'
            ? 'این سفارش در انتظار تأیید است و فقط از طریق «تأیید» یا «رد» توسط کاربر دارای مجوز «تأیید فروش» قابل تغییر است'
            : `فقط سفارش «پیش‌نویس» قابل تأیید است؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[order.status]}» است`,
        );
      }
      ensureSalesOrderTransition(order.status, 'CONFIRMED');
      if (order.items.length === 0) throw new BadRequestException('سفارش بدون ردیف کالا قابل تأیید نیست');
      await ensureTransactableCustomer(tx, order.customerId);
      const credit = await evaluateCredit(tx, order.customerId, order.totalAmount, { excludeSalesOrderId: order.id });

      const reasons: SalesOrderApprovalReason[] = [];
      if (hasAnyDiscount(order.items)) reasons.push('DISCOUNT');
      if (credit.exceeded) reasons.push('CREDIT_LIMIT');

      if (actor.canApprove) {
        if (credit.exceeded && !dto.creditOverrideReason) throw this.creditConflict(credit, actor);
        return this.finalizeConfirm(tx, order, actor, {
          approved: reasons.length > 0,
          creditOverrideReason: credit.exceeded ? dto.creditOverrideReason! : null,
          credit,
        });
      }

      if (reasons.length === 0) return this.finalizeConfirm(tx, order, actor, { approved: false, creditOverrideReason: null, credit });

      if (!dto.submitForApproval) {
        const labels = reasons.map((reason) => SALES_ORDER_APPROVAL_REASON_LABELS_FA[reason]).join('؛ ');
        throw new ConflictException({
          statusCode: 409,
          code: SALES_ORDER_APPROVAL_REQUIRED,
          message: `تأیید این سفارش نیاز به مجوز «تأیید فروش» دارد (${labels}). برای ادامه، سفارش را برای تأیید ارسال کنید.`,
          details: { reasons, ...(actor.canViewCredit && credit.exceeded ? { credit: this.creditDetails(credit) } : {}) },
        });
      }
      ensureSalesOrderTransition(order.status, 'PENDING_APPROVAL');
      await tx.salesOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_SUBMITTED_FOR_APPROVAL',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: id,
          details: reasons.map((reason) => SALES_ORDER_APPROVAL_REASON_LABELS_FA[reason]).join('؛ '),
        },
        tx,
      );
      return [] as SalesOrderBackorder[];
    });
    return { ...(await this.get(id)), backorders };
  }

  // PENDING_APPROVAL → CONFIRMED (route requires sales.approve). Customer
  // gate and credit are re-checked now — the situation may have changed
  // since the order was submitted.
  async approve(id: number, dto: ApproveSalesOrderDto, actor: SalesActor) {
    const backorders = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadLocked(tx, id);
      if (!isSameVersion(order.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (order.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(`فقط سفارش «در انتظار تأیید» قابل تأیید است؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[order.status]}» است`);
      }
      await ensureTransactableCustomer(tx, order.customerId);
      const credit = await evaluateCredit(tx, order.customerId, order.totalAmount, { excludeSalesOrderId: order.id });
      if (credit.exceeded && !dto.creditOverrideReason) throw this.creditConflict(credit, actor);
      return this.finalizeConfirm(tx, order, actor, {
        approved: true,
        approvalNote: dto.note ?? null,
        creditOverrideReason: credit.exceeded ? dto.creditOverrideReason! : null,
        credit,
      });
    });
    return { ...(await this.get(id)), backorders };
  }

  // PENDING_APPROVAL → DRAFT (route requires sales.approve). The only path
  // back to DRAFT; the order becomes editable again.
  async reject(id: number, dto: RejectSalesOrderDto, actor: SalesActor) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadLocked(tx, id);
      if (!isSameVersion(order.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
      if (order.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(`فقط سفارش «در انتظار تأیید» قابل رد است؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[order.status]}» است`);
      }
      ensureSalesOrderTransition(order.status, 'DRAFT');
      await tx.salesOrder.update({ where: { id }, data: { status: 'DRAFT' } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_REJECTED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: id,
          details: dto.reason ? `علت: ${dto.reason}` : undefined,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // CONFIRMED → CANCELLED, only while nothing has been delivered. Releases
  // every reservation. The number stays (a cancelled order is still a
  // numbered document — no gap).
  cancel(id: number, dto: CancelSalesOrderDto, actor: SalesActor) {
    return this.endOrder(id, 'CANCELLED', dto.updatedAt, dto.reason, actor);
  }

  // CONFIRMED → CLOSED: manual short-close. Releases whatever is still
  // reserved; what was delivered stays delivered.
  close(id: number, dto: CloseSalesOrderDto, actor: SalesActor) {
    return this.endOrder(id, 'CLOSED', dto.updatedAt, dto.reason, actor);
  }

  // --- Form lookups ------------------------------------------------------------

  // Pickers for the order form, in one call (the SALESPERSON role has no
  // employees.view). Read-only display lookups (CLAUDE.md rule 11's
  // documented exception): active customers / items / employees, display
  // fields only, plus per-item availability at the default warehouse from
  // InventoryService (display only — confirmation re-checks under a lock).
  async formOptions() {
    const location = await this.inventory.getDefaultLocation();
    const [customers, items, employees, availability] = await Promise.all([
      this.prisma.customer.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, customerNumber: true, name: true, financialProfile: { select: { creditHold: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.item.findMany({
        where: { status: 'active' },
        select: { id: true, code: true, name: true, sellingPrice: true, unit: { select: { id: true, nameFa: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.employee.findMany({
        where: { status: 'active' },
        select: { id: true, code: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      }),
      this.inventory.listAvailability(location.id),
    ]);
    const availableByItem = new Map(availability.map((row) => [row.itemId, row.available]));
    return {
      location: { id: location.id, code: location.code, name: location.name },
      customers: customers.map(({ financialProfile, ...customer }) => ({ ...customer, creditHold: financialProfile?.creditHold ?? false })),
      items: items.map((item) => ({ ...item, available: (availableByItem.get(item.id) ?? new Prisma.Decimal(0)).toString() })),
      employees,
    };
  }

  // The order form's customer panel: delivery addresses, the payment term
  // the order will carry, hold status, and — only for canViewCredit — the
  // credit figures.
  async customerContext(customerId: number, actor: SalesActor) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, customerNumber: true, name: true, status: true, economicCode: true },
    });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    const [addresses, policy] = await Promise.all([
      this.prisma.customerAddress.findMany({
        where: { customerId, isActive: true },
        select: { id: true, addressType: true, label: true, province: true, city: true, addressLine: true, postalCode: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
      getCustomerCreditPolicy(this.prisma, customerId),
    ]);
    let credit: { creditLimit: string | null; exposure: string; available: string } | null = null;
    if (actor.canViewCredit) {
      const exposure = await computeExposure(this.prisma, customerId);
      const limit = policy.creditLimit ?? new Prisma.Decimal(0);
      credit = { creditLimit: policy.creditLimit?.toString() ?? null, exposure: exposure.total.toString(), available: limit.minus(exposure.total).toString() };
    }
    return {
      customer,
      creditHold: policy.creditHold,
      paymentTerm: policy.paymentTerm,
      addresses: addresses.map((address) => ({ ...address, text: formatAddress(address) })),
      credit,
    };
  }

  // --- internals ----------------------------------------------------------------

  private async lockOrder(tx: Prisma.TransactionClient, id: number) {
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
  }

  private async loadLocked(tx: Prisma.TransactionClient, id: number) {
    await this.lockOrder(tx, id);
    const order = await tx.salesOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } }, location: { select: { isActive: true } } },
    });
    if (!order) throw new NotFoundException('سفارش فروش پیدا نشد');
    return order;
  }

  // The CONFIRMED write, shared by confirm() and approve(). Runs inside the
  // caller's transaction after every check has passed.
  private async finalizeConfirm(
    tx: Prisma.TransactionClient,
    order: Awaited<ReturnType<SalesOrdersService['loadLocked']>>,
    actor: SalesActor,
    options: { approved: boolean; approvalNote?: string | null; creditOverrideReason: string | null; credit: CreditCheck },
  ): Promise<SalesOrderBackorder[]> {
    if (!order.location?.isActive) throw new ConflictException('انبار این سفارش غیرفعال است');

    const orderNumber = await nextDocumentNumber(tx, SALES_ORDER_DOC_TYPE, order.orderDate);
    const results = await reserveAvailable(
      tx,
      {
        locationId: order.locationId,
        movementDate: order.orderDate,
        referenceType: 'SALES_ORDER',
        referenceId: order.id,
        referenceNumber: orderNumber,
        createdByUserId: actor.userId,
      },
      order.items.map((line) => ({ referenceLineId: line.id, itemId: line.itemId, quantity: line.quantity })),
    );
    for (const result of results) {
      if (result.reserved.greaterThan(0)) {
        await tx.salesOrderItem.update({ where: { id: result.referenceLineId }, data: { reservedQty: result.reserved } });
      }
    }

    const now = new Date();
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        status: 'CONFIRMED',
        orderNumber,
        confirmedByUserId: actor.userId,
        confirmedAt: now,
        ...(options.approved ? { approvedByUserId: actor.userId, approvedAt: now, approvalReason: options.approvalNote ?? null } : {}),
        ...(options.creditOverrideReason
          ? { creditOverrideByUserId: actor.userId, creditOverrideAt: now, creditOverrideReason: options.creditOverrideReason }
          : {}),
      },
    });

    const linesById = new Map(order.items.map((line) => [line.id, line]));
    const backorders: SalesOrderBackorder[] = results
      .filter((result) => result.shortfall.greaterThan(0))
      .map((result) => {
        const line = linesById.get(result.referenceLineId)!;
        return {
          lineNo: line.lineNo,
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: result.requested.toString(),
          reserved: result.reserved.toString(),
          shortfall: result.shortfall.toString(),
        };
      });

    const backorderNote = backorders.length > 0 ? `؛ کسری موجودی (پس‌افت) در ${backorders.length} ردیف` : '';
    await this.audit.log(
      {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: options.approved && order.status === 'PENDING_APPROVAL' ? 'SALES_ORDER_APPROVED' : 'SALES_ORDER_CONFIRMED',
        entityType: AUDIT_ENTITY.SALES_ORDER,
        entityId: order.id,
        details: `${orderNumber} — جمع ${order.totalAmount.toString()}${backorderNote}${options.approvalNote ? `؛ یادداشت تأیید: ${options.approvalNote}` : ''}`,
      },
      tx,
    );
    if (options.creditOverrideReason) {
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'SALES_ORDER_CREDIT_OVERRIDE',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: order.id,
          details: `${orderNumber} — عبور از سقف اعتبار به میزان ${options.credit.excess.toString()}؛ علت: ${options.creditOverrideReason}`,
        },
        tx,
      );
    }
    return backorders;
  }

  private async endOrder(id: number, target: 'CANCELLED' | 'CLOSED', loadedVersion: Date, reason: string, actor: SalesActor) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadLocked(tx, id);
      if (!isSameVersion(order.updatedAt, loadedVersion)) throw recordModifiedConflict();
      ensureSalesOrderTransition(order.status, target);
      if (target === 'CANCELLED' && order.items.some((line) => new Prisma.Decimal(line.deliveredQty).greaterThan(0))) {
        throw new ConflictException('برای این سفارش کالا تحویل شده است و قابل لغو نیست؛ در صورت نیاز آن را «بستن» کنید.');
      }

      const context: StockEventContext = {
        locationId: order.locationId,
        movementDate: today(),
        referenceType: 'SALES_ORDER',
        referenceId: order.id,
        referenceNumber: order.orderNumber,
        createdByUserId: actor.userId,
        note: reason,
      };
      const held = order.items.filter((line) => new Prisma.Decimal(line.reservedQty).greaterThan(0));
      await releaseReserved(
        tx,
        context,
        held.map((line) => ({ referenceLineId: line.id, itemId: line.itemId, quantity: line.reservedQty })),
      );
      if (held.length > 0) await tx.salesOrderItem.updateMany({ where: { salesOrderId: id }, data: { reservedQty: 0 } });

      const now = new Date();
      await tx.salesOrder.update({
        where: { id },
        data:
          target === 'CANCELLED'
            ? { status: 'CANCELLED', cancelledByUserId: actor.userId, cancelledAt: now, cancelReason: reason }
            : { status: 'CLOSED', closedByUserId: actor.userId, closedAt: now, closeReason: reason },
      });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: target === 'CANCELLED' ? 'SALES_ORDER_CANCELLED' : 'SALES_ORDER_CLOSED',
          entityType: AUDIT_ENTITY.SALES_ORDER,
          entityId: id,
          details: `${order.orderNumber ?? ''} — علت: ${reason}${held.length > 0 ? `؛ آزادسازی رزرو در ${held.length} ردیف` : ''}`,
        },
        tx,
      );
    });
    return this.get(id);
  }

  private creditDetails(credit: CreditCheck) {
    return {
      creditLimit: credit.creditLimit?.toString() ?? null,
      exposure: credit.exposure.total.toString(),
      orderAmount: credit.orderAmount.toString(),
      projected: credit.projected.toString(),
      excess: credit.excess.toString(),
    };
  }

  // 409 for a sales.approve holder confirming/approving over the limit
  // without an override reason. Figures only for canViewCredit.
  private creditConflict(credit: CreditCheck, actor: SalesActor) {
    const limitText = credit.creditLimit === null ? 'تعریف نشده (فقط فروش نقدی)' : credit.creditLimit.toString();
    const figures = actor.canViewCredit
      ? ` سقف اعتبار: ${limitText}، تعهدات باز فعلی: ${credit.exposure.total.toString()}، مبلغ این سفارش: ${credit.orderAmount.toString()}، مازاد: ${credit.excess.toString()}.`
      : '';
    return new ConflictException({
      statusCode: 409,
      code: CREDIT_LIMIT_EXCEEDED,
      message: `مبلغ این سفارش از سقف اعتبار مشتری بیشتر است.${figures} برای تأیید، علت عبور از سقف اعتبار را وارد کنید.`,
      details: actor.canViewCredit ? this.creditDetails(credit) : undefined,
    });
  }

  private ensureEditable(status: SalesOrderStatus) {
    if (!EDITABLE_SALES_ORDER_STATUSES.includes(status)) {
      throw new ConflictException(`فقط سفارش «پیش‌نویس» قابل ویرایش است؛ این سفارش «${SALES_ORDER_STATUS_LABELS_FA[status]}» است`);
    }
  }

  // B3: only a sales.approve holder may set a discount at all — and, since a
  // draft's lines are replaced wholesale on save, only they may save a draft
  // that already carries one (otherwise the save would either strip or
  // re-submit a discount the user isn't allowed to set).
  private ensureDiscountAllowed(items: SalesOrderItemDto[], actor: SalesActor, existingItems?: { discountAmount: Prisma.Decimal; discountPercent: Prisma.Decimal | null }[]) {
    if (actor.canApprove) return;
    if (items.some((line) => (line.discountPercent ?? 0) > 0 || (line.discountAmount ?? 0) > 0)) {
      throw new ForbiddenException('فقط کاربر دارای مجوز «تأیید فروش» می‌تواند تخفیف اعمال کند');
    }
    if (existingItems && hasAnyDiscount(existingItems)) {
      throw new ForbiddenException('این سفارش دارای تخفیف است و فقط کاربر دارای مجوز «تأیید فروش» می‌تواند آن را ویرایش کند');
    }
  }

  // Validates references and builds the snapshots + derived money for a
  // DRAFT save. A reference is re-checked for "active" only when it's new or
  // changed (same rule as Purchases): a draft may keep an item / address /
  // salesperson that was deactivated since.
  private async prepareDraft(dto: CreateSalesOrderDto, existing?: ExistingDraft) {
    if (!existing || existing.customerId !== dto.customerId) await ensureTransactableCustomer(this.prisma, dto.customerId);
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { name: true, economicCode: true } });
    if (!customer) throw new ConflictException('مشتری انتخاب‌شده یافت نشد');

    let deliveryAddressText: string | null = null;
    if (dto.deliveryAddressId) {
      const address = await this.prisma.customerAddress.findFirst({ where: { id: dto.deliveryAddressId, customerId: dto.customerId } });
      if (!address) throw new BadRequestException('آدرس تحویل انتخاب‌شده متعلق به این مشتری نیست');
      if (!address.isActive && address.id !== existing?.deliveryAddressId) throw new BadRequestException('آدرس تحویل انتخاب‌شده غیرفعال است');
      deliveryAddressText = formatAddress(address);
    }

    if (dto.salespersonEmployeeId && dto.salespersonEmployeeId !== existing?.salespersonEmployeeId) {
      const employee = await this.prisma.employee.findUnique({ where: { id: dto.salespersonEmployeeId }, select: { status: true } });
      if (!employee || employee.status !== 'active') throw new BadRequestException('فروشنده انتخاب‌شده فعال نیست');
    }

    // The payment term always comes from the customer's financial profile
    // (set under customers.finance) — never chosen on the order, so a
    // salesperson can't grant terms.
    const policy = await getCustomerCreditPolicy(this.prisma, dto.customerId);
    const locationId = existing?.locationId ?? (await this.inventory.getDefaultLocation()).id;

    const prepared = await this.prepareLines(dto.items, existing?.items.map((line) => line.itemId) ?? []);
    const lines = prepared.map((entry) => entry.line);
    const totals = sumOrderTotals(prepared.map((entry) => entry.amounts));

    return {
      header: {
        orderDate: dto.orderDate,
        customerId: dto.customerId,
        customerName: customer.name,
        customerEconomicCode: customer.economicCode ?? null,
        deliveryAddressId: dto.deliveryAddressId ?? null,
        deliveryAddressText,
        paymentTermId: policy.paymentTerm?.id ?? null,
        paymentTermName: policy.paymentTerm?.nameFa ?? null,
        paymentDueDays: policy.paymentTerm?.dueDays ?? 0,
        salespersonEmployeeId: dto.salespersonEmployeeId ?? null,
        locationId,
        customerReference: dto.customerReference ?? null,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        internalNote: dto.internalNote ?? null,
        customerNote: dto.customerNote ?? null,
        ...totals,
      },
      lines,
    };
  }

  private async prepareLines(items: SalesOrderItemDto[], alreadyOnOrder: number[]): Promise<{ line: PreparedLine; amounts: SalesLineAmounts }[]> {
    const ids = [...new Set(items.map((line) => line.itemId))];
    const found = await this.prisma.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true, status: true, sellingPrice: true, unitId: true, unit: { select: { nameFa: true } } },
    });
    const byId = new Map(found.map((item) => [item.id, item]));
    const kept = new Set(alreadyOnOrder);

    return items.map((line, index) => {
      const label = `ردیف ${index + 1}`;
      const item = byId.get(line.itemId);
      if (!item) throw new BadRequestException(`${label}: کالای انتخاب‌شده یافت نشد`);
      if (item.status !== 'active' && !kept.has(item.id)) throw new BadRequestException(`${label}: کالای «${item.name}» غیرفعال است`);

      // B2: any sales.manage holder may change the price; going BELOW the
      // list price needs a reason, above it doesn't.
      const listUnitPrice = item.sellingPrice === null ? null : new Prisma.Decimal(item.sellingPrice);
      const belowList = listUnitPrice !== null && new Prisma.Decimal(line.unitPrice).lessThan(listUnitPrice);
      if (belowList && !line.priceOverrideReason) {
        throw new BadRequestException(
          `${label}: قیمت «${item.name}» کمتر از قیمت فهرست (${listUnitPrice.toString()}) است؛ علت کاهش قیمت را وارد کنید`,
        );
      }
      const amounts = computeLineAmounts(line, label);
      const prepared: PreparedLine = {
        lineNo: index + 1,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unitId: item.unitId,
        unitName: item.unit.nameFa,
        quantity: line.quantity,
        listUnitPrice,
        unitPrice: line.unitPrice,
        priceOverrideReason: belowList ? line.priceOverrideReason! : null,
        discountPercent: amounts.discountPercent,
        discountAmount: amounts.discountAmount,
        taxRate: amounts.taxRate,
        taxAmount: amounts.taxAmount,
        lineTotal: amounts.lineTotal,
        note: line.note ?? null,
      };
      return { line: prepared, amounts };
    });
  }
}
