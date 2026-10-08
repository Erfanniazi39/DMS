import { QuickSaleService } from './quick-sale.service';

// QuickSaleService's own job is purely orchestration (build plan B6: "calls
// the existing... chain server-side in one transaction-safe sequence...
// NOT reimplementing their logic"). Each collaborator's own business rules
// (credit checks, stock, numbering, settlement math) are already covered by
// SalesOrdersService/DeliveriesService/SalesInvoicesService/
// CustomerPaymentsService/PaymentAllocationsService's own specs — this spec
// only asserts the call sequence and that each step's output feeds the next
// step's input, using plain jest.fn() collaborators (not the Sales/
// Inventory fake) since no real business logic is exercised here.

const ACTOR = { userId: 4, ipAddress: '127.0.0.1', canApprove: false, canViewCredit: false };
const SALE_DATE = new Date('2026-10-07T00:00:00.000Z');

function buildCollaborators() {
  const salesOrders = {
    create: jest.fn().mockResolvedValue({ id: 11, updatedAt: SALE_DATE }),
    confirm: jest.fn().mockResolvedValue({ id: 11, orderNumber: 'SO-1405-000001', updatedAt: SALE_DATE }),
  };
  const deliveries = {
    createFromOrder: jest.fn().mockResolvedValue({ id: 31, updatedAt: SALE_DATE }),
    post: jest.fn().mockResolvedValue({ id: 31, deliveryNumber: 'DN-1405-000001', updatedAt: SALE_DATE }),
  };
  const salesInvoices = {
    create: jest.fn().mockResolvedValue({ id: 51, updatedAt: SALE_DATE }),
    post: jest.fn().mockResolvedValue({ id: 51, invoiceNumber: 'INV-1405-000001', totalAmount: { toNumber: () => 10_000 } }),
  };
  const customerPayments = { recordReceipt: jest.fn().mockResolvedValue({ id: 101, paymentNumber: 'RCP-1405-000001' }) };
  const paymentAllocations = { allocate: jest.fn().mockResolvedValue({ id: 101 }) };
  return { salesOrders, deliveries, salesInvoices, customerPayments, paymentAllocations };
}

function buildService(collaborators: ReturnType<typeof buildCollaborators>) {
  return new QuickSaleService(
    collaborators.salesOrders as never,
    collaborators.deliveries as never,
    collaborators.salesInvoices as never,
    collaborators.customerPayments as never,
    collaborators.paymentAllocations as never,
  );
}

describe('QuickSaleService.createQuickSale', () => {
  const dto = {
    customerId: 9,
    saleDate: SALE_DATE,
    paymentMethod: 'CASH' as const,
    items: [{ itemId: 1, quantity: 2, unitPrice: 5_000 }],
  };

  it('runs order → confirm → delivery → post → invoice → post → receipt → allocate, in that order, threading each step’s id/version into the next', async () => {
    const collaborators = buildCollaborators();
    const result = await buildService(collaborators).createQuickSale(dto as never, ACTOR);

    expect(collaborators.salesOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderDate: SALE_DATE, customerId: 9, items: [{ itemId: 1, quantity: 2, unitPrice: 5_000 }] }),
      ACTOR,
    );
    expect(collaborators.salesOrders.confirm).toHaveBeenCalledWith(11, expect.objectContaining({ updatedAt: SALE_DATE }), ACTOR);
    expect(collaborators.deliveries.createFromOrder).toHaveBeenCalledWith(expect.objectContaining({ salesOrderId: 11, deliveryDate: SALE_DATE }), ACTOR);
    expect(collaborators.deliveries.post).toHaveBeenCalledWith(31, expect.objectContaining({ updatedAt: SALE_DATE }), ACTOR);
    expect(collaborators.salesInvoices.create).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 31, invoiceDate: SALE_DATE }), ACTOR);
    expect(collaborators.salesInvoices.post).toHaveBeenCalledWith(51, expect.objectContaining({ updatedAt: SALE_DATE }), ACTOR);
    expect(collaborators.customerPayments.recordReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 9, paymentDate: SALE_DATE, amount: 10_000, method: 'CASH' }),
      ACTOR,
    );
    expect(collaborators.paymentAllocations.allocate).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaymentId: 101, items: [{ invoiceId: 51, amount: 10_000 }] }),
      ACTOR,
    );

    expect(result).toEqual({
      order: { id: 11, orderNumber: 'SO-1405-000001' },
      delivery: { id: 31, deliveryNumber: 'DN-1405-000001' },
      invoice: { id: 51, invoiceNumber: 'INV-1405-000001' },
      payment: { id: 101, paymentNumber: 'RCP-1405-000001' },
    });
  });

  it('defaults saleDate to today when omitted', async () => {
    const collaborators = buildCollaborators();
    await buildService(collaborators).createQuickSale({ ...dto, saleDate: undefined } as never, ACTOR);
    const usedDate = collaborators.salesOrders.create.mock.calls[0][0].orderDate as Date;
    expect(usedDate.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('stops the chain and propagates a failure from any step (e.g. confirm’s credit check) without calling later steps', async () => {
    const collaborators = buildCollaborators();
    collaborators.salesOrders.confirm.mockRejectedValue(new Error('سقف اعتبار کافی نیست'));
    await expect(buildService(collaborators).createQuickSale(dto as never, ACTOR)).rejects.toThrow('سقف اعتبار کافی نیست');
    expect(collaborators.deliveries.createFromOrder).not.toHaveBeenCalled();
    expect(collaborators.customerPayments.recordReceipt).not.toHaveBeenCalled();
  });
});
