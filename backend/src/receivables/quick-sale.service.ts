import { Injectable } from '@nestjs/common';
import { toIsoDay } from '../common/zod-fields';
import { DeliveriesService } from '../sales/deliveries.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesOrdersService, type SalesActor } from '../sales/sales-orders.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { PaymentAllocationsService } from './payment-allocations.service';
import type { CreateQuickSaleDto } from './dto/quick-sale.dto';

export type QuickSaleActor = SalesActor;

export type QuickSaleResult = {
  order: { id: number; orderNumber: string | null };
  delivery: { id: number; deliveryNumber: string | null };
  invoice: { id: number; invoiceNumber: string | null };
  payment: { id: number; paymentNumber: string };
};

function today() {
  return new Date(`${toIsoDay(new Date())}T00:00:00.000Z`);
}

// فروش نقدی سریع (B6 — counter/cash sales): one action that runs the normal
// order → delivery → invoice → payment chain end to end, calling only the
// existing services' own transactional methods — never reimplementing their
// logic or writing a Sales/Receivables table directly (CLAUDE.md rule 11).
// Each step is its own, already-safe transaction (the same one a user
// clicking through five separate screens would trigger); this just automates
// the clicking. A failure at any step stops the chain and surfaces that
// step's own error — e.g. the same credit-limit/stock/negative-balance
// checks and 409s a manual order would hit — leaving whatever already
// committed (a DRAFT order, a posted delivery, ...) exactly as it is for the
// user to resolve or clean up manually. Nothing here is rolled back across
// steps; build plan B6 only promises the documents "stay separate
// underneath", not a single all-or-nothing database transaction.
//
// Lives in Receivables (not Sales) because it needs CustomerPaymentsService/
// PaymentAllocationsService, which Sales must never depend on (build plan
// §3's one-way receivables → sales → inventory direction) — ReceivablesModule
// already imports SalesModule, so this is the only module that can see both
// sides without a new dependency edge.
@Injectable()
export class QuickSaleService {
  constructor(
    private readonly salesOrders: SalesOrdersService,
    private readonly deliveries: DeliveriesService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly customerPayments: CustomerPaymentsService,
    private readonly paymentAllocations: PaymentAllocationsService,
  ) {}

  async createQuickSale(dto: CreateQuickSaleDto, actor: QuickSaleActor): Promise<QuickSaleResult> {
    const saleDate = dto.saleDate ?? today();

    const draft = await this.salesOrders.create(
      { orderDate: saleDate, customerId: dto.customerId, items: dto.items.map((item) => ({ itemId: item.itemId, quantity: item.quantity, unitPrice: item.unitPrice })) } as never,
      actor,
    );
    const confirmed = await this.salesOrders.confirm(draft.id, { updatedAt: draft.updatedAt } as never, actor);

    const draftDelivery = await this.deliveries.createFromOrder({ salesOrderId: confirmed.id, deliveryDate: saleDate } as never, actor);
    const postedDelivery = await this.deliveries.post(draftDelivery.id, { updatedAt: draftDelivery.updatedAt } as never, actor);

    const draftInvoice = await this.salesInvoices.create({ deliveryId: postedDelivery.id, invoiceDate: saleDate } as never, actor);
    const invoice = await this.salesInvoices.post(draftInvoice.id, { updatedAt: draftInvoice.updatedAt } as never, actor);

    const payment = await this.customerPayments.recordReceipt(
      { customerId: dto.customerId, paymentDate: saleDate, amount: invoice.totalAmount.toNumber(), method: dto.paymentMethod, referenceNumber: dto.referenceNumber } as never,
      actor,
    );
    await this.paymentAllocations.allocate({ sourcePaymentId: payment.id, items: [{ invoiceId: invoice.id, amount: invoice.totalAmount.toNumber() }] } as never, actor);

    return {
      order: { id: confirmed.id, orderNumber: confirmed.orderNumber },
      delivery: { id: postedDelivery.id, deliveryNumber: postedDelivery.deliveryNumber },
      invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
      payment: { id: payment.id, paymentNumber: payment.paymentNumber },
    };
  }
}
