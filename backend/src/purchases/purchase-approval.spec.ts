import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { CreatePurchaseDto, UpdatePurchaseDto } from './dto/purchase.dto';
import { purchaseWorkflowFacts } from './purchase-rules';
import {
  baseItems,
  buildPurchasesService,
  createPrismaMock,
  createPurchaseRequestsServiceMock,
  createWorkflowServiceMock,
  fullGet,
  mockActiveMasterData,
  VERSION,
} from './purchases.spec-helpers';

// Workflow engine integration (batch W3): which purchase paths ask the engine,
// and how its answers move the purchase's own status. The engine itself is
// covered by workflow/*.spec.ts; here it is a double.

const REQUIRED = { required: true, ruleId: 1, ruleName: 'r', ruleVersion: 1, notifyByLetter: true, levels: [{ level: 1, approverLabel: 'مدیر' }] };

function setup() {
  const prisma = createPrismaMock();
  const workflow = createWorkflowServiceMock();
  const service = buildPurchasesService(prisma, createPurchaseRequestsServiceMock(), workflow);
  mockActiveMasterData(prisma);
  prisma.purchase.create.mockResolvedValue({ id: 5 });
  prisma.purchase.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 5,
    purchaseNumber: 'PUR-000005',
    totalAmount: 10000,
    supplier: { name: 'تأمین‌کننده' },
    items: [{}],
    ...data,
  }));
  return { prisma, workflow, service };
}

const createDto = (overrides: Partial<CreatePurchaseDto> = {}): CreatePurchaseDto =>
  ({
    purchaseDate: new Date('2026-01-01'),
    purchaseTypeId: 1,
    requesterDepartmentId: 2,
    buyerEmployeeId: 3,
    supplierId: 4,
    sourceType: 'OPERATIONAL',
    status: 'CONFIRMED',
    items: baseItems,
    confirmOverage: false,
    ...overrides,
  }) as never;

const updateDto = (overrides: Partial<UpdatePurchaseDto> = {}): UpdatePurchaseDto =>
  ({
    purchaseDate: new Date('2026-01-01'),
    purchaseTypeId: 1,
    requesterDepartmentId: 2,
    buyerEmployeeId: 3,
    supplierId: 4,
    sourceType: 'OPERATIONAL',
    status: 'CONFIRMED',
    updatedAt: VERSION,
    items: baseItems,
    confirmOverage: false,
    ...overrides,
  }) as never;

const existingRow = (overrides: Record<string, unknown> = {}) => ({
  ...fullGet,
  id: 5,
  purchaseNumber: 'PUR-000005',
  status: 'CONFIRMED',
  sourceType: 'OPERATIONAL',
  purchaseTypeId: 1,
  supplierId: 4,
  requesterDepartmentId: 2,
  buyerEmployeeId: 3,
  totalAmount: 10000,
  paidAmount: 0,
  items: [{ unitId: 1, totalPrice: 10000, unitPrice: 1000 }],
  ...overrides,
});

describe('purchaseWorkflowFacts', () => {
  it('sums the total and takes the largest line total / unit price, skipping lines without a unit price', () => {
    expect(
      purchaseWorkflowFacts({
        purchaseTypeId: 1,
        supplierId: 4,
        items: [
          { totalPrice: 300, unitPrice: 30 },
          { totalPrice: 900, unitPrice: null },
          { totalPrice: '200', unitPrice: '50' },
        ],
      }),
    ).toEqual({ amountTotal: 1400, maxLineTotal: 900, maxUnitPrice: 50, purchaseTypeId: 1, supplierId: 4, requesterDepartmentId: null });
  });
});

describe('Purchases × workflow engine', () => {
  describe('create()', () => {
    it('a confirmed purchase that matches a rule is saved as PENDING_APPROVAL and an approval request is started', async () => {
      const { prisma, workflow, service } = setup();
      workflow.evaluate.mockResolvedValue(REQUIRED);
      await service.create(createDto(), 9);
      expect(prisma.purchase.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }));
      expect(workflow.start).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ documentType: 'PURCHASE', documentId: 5, documentNumber: 'PUR-000005', amount: 10000, actor: { userId: 9, ipAddress: undefined } }),
      );
    });

    it('without a matching rule the purchase is CONFIRMED as before', async () => {
      const { prisma, workflow, service } = setup();
      await service.create(createDto(), 9);
      expect(prisma.purchase.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }));
      expect(workflow.start).not.toHaveBeenCalled();
    });

    it('drafts and historical imports are never evaluated', async () => {
      const { workflow, service } = setup();
      workflow.evaluate.mockResolvedValue(REQUIRED);
      await service.create(createDto({ status: 'DRAFT' as never }), 9);
      await service.create(createDto({ sourceType: 'HISTORICAL_IMPORT' as never }), 9);
      expect(workflow.evaluate).not.toHaveBeenCalled();
      expect(workflow.start).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus()', () => {
    it('confirming a draft that matches a rule sends it to PENDING_APPROVAL', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'DRAFT' }));
      workflow.evaluate.mockResolvedValue(REQUIRED);
      await service.changeStatus(5, { status: 'CONFIRMED', updatedAt: VERSION } as never, 9);
      expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PENDING_APPROVAL' } }));
      expect(workflow.start).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE_SUBMITTED_FOR_APPROVAL', details: 'از DRAFT به PENDING_APPROVAL' }) }),
      );
    });

    it('cancelling a waiting purchase closes its approval request', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      await service.changeStatus(5, { status: 'CANCELLED', updatedAt: VERSION } as never, 9);
      expect(workflow.cancel).toHaveBeenCalledWith(prisma, expect.objectContaining({ documentId: 5, kind: 'CANCELLED' }));
      expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
    });

    it('a waiting purchase cannot be moved forward by the status buttons', async () => {
      const { prisma, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      await expect(service.changeStatus(5, { status: 'CONFIRMED', updatedAt: VERSION } as never, 9)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.changeStatus(5, { status: 'RECEIVED', updatedAt: VERSION } as never, 9)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update()', () => {
    it('a waiting purchase cannot be edited', async () => {
      const { prisma, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      await expect(service.update(5, updateDto({ status: 'PENDING_APPROVAL' as never }), 9)).rejects.toThrow(/پس بگیرید/);
    });

    it('raising a confirmed purchase above its approved amount sends it back for approval', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow());
      workflow.evaluate.mockResolvedValue(REQUIRED);
      workflow.approvedAmount.mockResolvedValue(10000);
      const items = [{ ...baseItems[0], totalPrice: 15000 as never }];
      await service.update(5, updateDto({ items }), 9);
      expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }));
      expect(workflow.start).toHaveBeenCalled();
    });

    it('a decrease, or an unchanged amount, never needs re-approval', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow());
      workflow.evaluate.mockResolvedValue(REQUIRED);
      workflow.approvedAmount.mockResolvedValue(10000);
      await service.update(5, updateDto({ items: [{ ...baseItems[0], totalPrice: 8000 as never }] }), 9);
      await service.update(5, updateDto(), 9);
      expect(workflow.start).not.toHaveBeenCalled();
    });

    it('moving a confirmed purchase to another supplier inside a rule needs re-approval even at the same amount', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow());
      workflow.evaluate.mockResolvedValue(REQUIRED);
      workflow.approvedAmount.mockResolvedValue(10000);
      await service.update(5, updateDto({ supplierId: 7 }), 9);
      expect(workflow.start).toHaveBeenCalled();
    });

    it('a received purchase whose edit would need approval is refused', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'RECEIVED' }));
      workflow.evaluate.mockResolvedValue(REQUIRED);
      workflow.approvedAmount.mockResolvedValue(10000);
      const items = [{ ...baseItems[0], totalPrice: 15000 as never }];
      await expect(service.update(5, updateDto({ status: 'RECEIVED' as never, items }), 9)).rejects.toThrow(/دوباره به تأیید/);
      expect(prisma.purchaseItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('approve / reject / withdraw', () => {
    it.each([
      ['APPROVED', 'CONFIRMED', 'PURCHASE_APPROVED'],
      ['REJECTED', 'DRAFT', 'PURCHASE_REJECTED'],
    ])('engine outcome %s moves the purchase to %s', async (outcome, status, action) => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      workflow.decide.mockResolvedValue({ outcome, requestId: 1, level: 1, requestedByUserId: 3, documentNumber: 'PUR-000005' });
      const call = outcome === 'APPROVED' ? service.approve(5, { updatedAt: VERSION }, 9) : service.reject(5, { updatedAt: VERSION, comment: 'گران است' }, 9);
      await call;
      expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status } }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action }) }));
    });

    it('a level approved with more levels to go leaves the purchase waiting', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      (prisma.purchase as any).findUniqueOrThrow.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      workflow.decide.mockResolvedValue({ outcome: 'ADVANCED', requestId: 1, level: 1, requestedByUserId: 3, documentNumber: 'PUR-000005' });
      await service.approve(5, { updatedAt: VERSION, comment: 'تأیید با شرط تحویل سریع' }, 9);
      expect(prisma.purchase.update).not.toHaveBeenCalled();
      expect(workflow.decide).toHaveBeenCalledWith(prisma, expect.objectContaining({ decision: 'APPROVE', comment: 'تأیید با شرط تحویل سریع' }));
    });

    it('deciding a purchase that is not waiting is a 409', async () => {
      const { prisma, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'CONFIRMED' }));
      await expect(service.approve(5, { updatedAt: VERSION }, 9)).rejects.toBeInstanceOf(ConflictException);
    });

    it('only the requester or a purchases.manage holder may withdraw; it returns to DRAFT', async () => {
      const { prisma, workflow, service } = setup();
      prisma.purchase.findUnique.mockResolvedValue(existingRow({ status: 'PENDING_APPROVAL' }));
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 3, currentLevel: 1 });
      await expect(service.withdraw(5, { updatedAt: VERSION }, 9, false)).rejects.toBeInstanceOf(ForbiddenException);
      await service.withdraw(5, { updatedAt: VERSION }, 3, false);
      expect(workflow.cancel).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'WITHDRAWN' }));
      expect(prisma.purchase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DRAFT' } }));
      await service.withdraw(5, { updatedAt: VERSION }, 9, true);
    });
  });

  it('deleting a waiting purchase closes its approval request first', async () => {
    const { prisma, workflow, service } = setup();
    prisma.purchase.findUnique.mockResolvedValue({ ...existingRow({ status: 'PENDING_APPROVAL' }), _count: { payments: 0, documents: 0, returns: 0 } });
    await service.remove(5, 9);
    expect(workflow.cancel).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'CANCELLED' }));
    expect(prisma.purchase.delete).toHaveBeenCalled();
  });

  it('approvalPreview(): historical purchases never need approval; the edit form gets the re-approval answer', async () => {
    const { prisma, workflow, service } = setup();
    workflow.evaluate.mockResolvedValue(REQUIRED);
    const body = { purchaseTypeId: 1, supplierId: 4, items: [{ totalPrice: 15000 }] };
    expect(await service.approvalPreview({ ...body, sourceType: 'HISTORICAL_IMPORT' })).toEqual({ required: false, reapproval: false });
    expect(await service.approvalPreview({ ...body, sourceType: 'OPERATIONAL' })).toMatchObject({ required: true, reapproval: false });
    prisma.purchase.findUnique.mockResolvedValue(existingRow());
    workflow.approvedAmount.mockResolvedValue(10000);
    expect(await service.approvalPreview({ ...body, sourceType: 'OPERATIONAL', requesterDepartmentId: 2, purchaseId: 5 })).toMatchObject({ reapproval: true });
  });
});
