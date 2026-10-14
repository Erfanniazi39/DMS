import { ConflictException, ForbiddenException } from '@nestjs/common';
import { seedStock } from '../inventory/inventory.spec-helpers';
import { salesOrderWorkflowFacts } from './sales-rules';
import { buildSalesOrdersService, createSalesDb, createWorkflowMock, draftOrder, MANAGER, mockOrder, orderLine, SALESPERSON, setCreditPolicy, VERSION, type SalesDb } from './sales.spec-helpers';

// Workflow engine integration for sales orders (batch W7): a matching rule
// replaces the built-in discount/credit approval for that order; with no
// matching rule the built-in behaviour is untouched (covered by
// sales-orders.service.spec.ts, which runs with no rule).

const REQUIRED = { required: true, ruleId: 1, ruleName: 'تخفیف بالای ۵٪', ruleVersion: 1, notifyByLetter: true, levels: [{ level: 1, approverLabel: 'مدیر فروش' }] };
const confirmDto = { updatedAt: VERSION, submitForApproval: false };
const actions = (db: SalesDb) => db.auditLog.create.mock.calls.map((call: any) => call[0].data.action);

function setup(order = draftOrder()) {
  const db = createSalesDb();
  seedStock(db, 1, 20);
  setCreditPolicy(db, { creditLimit: 1_000_000 });
  const workflow = createWorkflowMock();
  const current = mockOrder(db, order);
  return { db, workflow, current, service: buildSalesOrdersService(db, workflow) };
}

describe('salesOrderWorkflowFacts', () => {
  it('takes the largest line discount as a percent of that line gross, whether entered as percent or amount', () => {
    const facts = salesOrderWorkflowFacts({
      totalAmount: 9000,
      items: [
        { quantity: 10, unitPrice: 1000, lineTotal: 9000, discountAmount: 500, discountPercent: null }, // 5%
        { quantity: 5, unitPrice: 2000, lineTotal: 8000, discountAmount: 2000, discountPercent: 20 }, // 20%
      ],
    });
    expect(facts).toMatchObject({ amountTotal: 9000, maxLineTotal: 9000, maxUnitPrice: 2000, maxDiscountPercent: 20 });
  });

  it('a discount-free order has maxDiscountPercent 0', () => {
    expect(salesOrderWorkflowFacts({ totalAmount: 5000, items: [{ quantity: 5, unitPrice: 1000, lineTotal: 5000, discountAmount: 0 }] }).maxDiscountPercent).toBe(0);
  });
});

describe('Sales orders × workflow engine', () => {
  describe('confirm()', () => {
    it('a matching rule sends even a sales.approve holder to PENDING_APPROVAL — no number, no reservation — and starts an approval request', async () => {
      const { db, workflow, current, service } = setup();
      workflow.evaluate.mockResolvedValue(REQUIRED);
      const result = await service.confirm(11, confirmDto as never, MANAGER);
      expect(current().status).toBe('PENDING_APPROVAL');
      expect(current().orderNumber).toBeNull();
      expect(db.state.sequences.size).toBe(0);
      expect(result.backorders).toEqual([]);
      expect(workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ documentType: 'SALES_ORDER', documentId: 11, amount: 5000, actor: { userId: 2, ipAddress: '127.0.0.1' } }),
      );
      expect(actions(db)).toEqual(['SALES_ORDER_SUBMITTED_FOR_APPROVAL']);
    });

    it('with no matching rule the built-in path is unchanged (salesperson, no discount → CONFIRMED)', async () => {
      const { current, workflow, service } = setup();
      await service.confirm(11, confirmDto as never, SALESPERSON);
      expect(current().status).toBe('CONFIRMED');
      expect(workflow.start).not.toHaveBeenCalled();
    });

    it("'bypass' (historical entry) never asks the engine; 'refuse' (quick sale) refuses a rule-held order and leaves it DRAFT", async () => {
      const { workflow, current, service } = setup();
      workflow.evaluate.mockResolvedValue(REQUIRED);
      await service.confirm(11, confirmDto as never, { ...MANAGER, workflow: 'bypass' });
      expect(workflow.evaluate).not.toHaveBeenCalled();
      expect(current().status).toBe('CONFIRMED');

      const second = setup();
      second.workflow.evaluate.mockResolvedValue(REQUIRED);
      await expect(second.service.confirm(11, confirmDto as never, { ...MANAGER, workflow: 'refuse' })).rejects.toThrow('فروش سریع');
      expect(second.current().status).toBe('DRAFT');
      expect(second.workflow.start).not.toHaveBeenCalled();
    });
  });

  describe('approve() / reject() on an order waiting for a workflow approval', () => {
    const pendingOrder = () => draftOrder({ status: 'PENDING_APPROVAL' });

    it('final approval by a rule-named approver WITHOUT sales.approve confirms the order (numbered, reserved)', async () => {
      const { db, workflow, current, service } = setup(pendingOrder());
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
      workflow.decide.mockResolvedValue({ outcome: 'APPROVED', requestId: 1, level: 1, requestedByUserId: 5, documentNumber: 'x' });
      await service.approve(11, { updatedAt: VERSION, note: 'تأیید شد' } as never, SALESPERSON);
      expect(workflow.decide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: 'APPROVE', comment: 'تأیید شد' }));
      expect(current()).toEqual(expect.objectContaining({ status: 'CONFIRMED', orderNumber: 'SO-1405-000001', approvedByUserId: 5 }));
      expect(actions(db)).toEqual(['SALES_ORDER_APPROVED']);
    });

    it('a level approved with more to go leaves the order waiting — nothing numbered', async () => {
      const { db, workflow, current, service } = setup(pendingOrder());
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
      workflow.decide.mockResolvedValue({ outcome: 'ADVANCED', requestId: 1, level: 1, requestedByUserId: 5, documentNumber: 'x' });
      await service.approve(11, { updatedAt: VERSION } as never, MANAGER);
      expect(current().status).toBe('PENDING_APPROVAL');
      expect(db.state.sequences.size).toBe(0);
      expect(actions(db)).toEqual(['SALES_ORDER_APPROVAL_LEVEL_APPROVED']);
    });

    it('the engine refusing the user (not the approver / the requester) aborts the approval', async () => {
      const { workflow, current, service } = setup(pendingOrder());
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
      workflow.decide.mockRejectedValue(new ForbiddenException('شما تأییدکنندهٔ این مرحله نیستید'));
      await expect(service.approve(11, { updatedAt: VERSION } as never, MANAGER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(current().status).toBe('PENDING_APPROVAL');
    });

    it('reject goes back to DRAFT through the engine; its reason becomes the comment', async () => {
      const { workflow, current, service } = setup(pendingOrder());
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
      workflow.decide.mockResolvedValue({ outcome: 'REJECTED', requestId: 1, level: 1, requestedByUserId: 5, documentNumber: 'x' });
      await service.reject(11, { updatedAt: VERSION, reason: 'تخفیف زیاد است' } as never, SALESPERSON);
      expect(workflow.decide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: 'REJECT', comment: 'تخفیف زیاد است' }));
      expect(current().status).toBe('DRAFT');
    });

    it('a built-in pending order (no engine request) still needs sales.approve — a salesperson gets 403', async () => {
      const { workflow, current, service } = setup(pendingOrder());
      workflow.pendingRequest.mockResolvedValue(null);
      await expect(service.approve(11, { updatedAt: VERSION } as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.reject(11, { updatedAt: VERSION } as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
      expect(workflow.decide).not.toHaveBeenCalled();
      expect(current().status).toBe('PENDING_APPROVAL');
    });

    it('a credit override by someone without sales.approve is still refused', async () => {
      const { service } = setup(pendingOrder());
      await expect(service.approve(11, { updatedAt: VERSION, creditOverrideReason: 'x' } as never, SALESPERSON)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('withdraw()', () => {
    it('the requester (or a sales.approve holder) withdraws a workflow-pending order back to DRAFT; others are refused', async () => {
      const { workflow, current, service } = setup(draftOrder({ status: 'PENDING_APPROVAL' }));
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
      await expect(service.withdraw(11, { updatedAt: VERSION }, { ...SALESPERSON, userId: 77 })).rejects.toBeInstanceOf(ForbiddenException);
      await service.withdraw(11, { updatedAt: VERSION }, SALESPERSON);
      expect(workflow.cancel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'WITHDRAWN', documentId: 11 }));
      expect(current().status).toBe('DRAFT');
    });

    it('refuses an order that is not waiting on a workflow approval', async () => {
      const { workflow, service } = setup(draftOrder({ status: 'PENDING_APPROVAL' }));
      workflow.pendingRequest.mockResolvedValue(null);
      await expect(service.withdraw(11, { updatedAt: VERSION }, MANAGER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('getDetail() adds the approval timeline and whether the caller may decide', async () => {
    const { workflow, service } = setup(draftOrder({ status: 'PENDING_APPROVAL', items: [orderLine()] }));
    workflow.getTimeline.mockResolvedValue([{ id: 1 }]);
    workflow.canDecide.mockResolvedValue(true);
    workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 5, currentLevel: 1 });
    const detail = await service.getDetail(11, 2);
    expect(detail.approval).toEqual({ requests: [{ id: 1 }], canDecide: true, requestedByUserId: 5 });
  });
});
