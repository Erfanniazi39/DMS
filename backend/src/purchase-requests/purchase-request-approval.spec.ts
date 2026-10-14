import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PurchaseQuantitiesService } from '../purchases/purchase-quantities.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import type { UpdatePurchaseRequestDto } from './dto/purchase-request.dto';

// Workflow engine integration for purchase requests (batch W7). SUBMITTED is
// the "waiting for approval" state; the engine itself is a double here
// (covered by workflow/*.spec.ts).

const VERSION = new Date('2026-01-01T10:00:00.000Z');
const REQUIRED = { required: true, ruleId: 1, ruleName: 'درخواست مواد اولیه', ruleVersion: 1, notifyByLetter: true, levels: [{ level: 1, approverLabel: 'مدیر' }] };

function setup(status: string = 'DRAFT') {
  const prisma: any = {
    purchaseRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1, requestNumber: 'REQ-000001', status, updatedAt: VERSION, purchaseTypeId: 1, requesterDepartmentId: 2,
        requesterDepartment: { id: 2 }, requestedByEmployee: null, createdByUser: null, items: [], purchases: [],
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    purchaseItem: { groupBy: jest.fn().mockResolvedValue([]) },
    purchaseType: { findUnique: jest.fn().mockResolvedValue({ id: 1, isActive: true }) },
    department: { findUnique: jest.fn().mockResolvedValue({ id: 2, status: 'active' }) },
    employee: { findUnique: jest.fn() },
    unit: { count: jest.fn().mockResolvedValue(1) },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(prisma));
  const workflow = {
    evaluate: jest.fn().mockResolvedValue({ required: false }),
    start: jest.fn(),
    decide: jest.fn(),
    cancel: jest.fn().mockResolvedValue(true),
    getTimeline: jest.fn().mockResolvedValue([]),
    canDecide: jest.fn().mockResolvedValue(false),
    pendingRequest: jest.fn().mockResolvedValue(null),
  };
  const service = new PurchaseRequestsService(prisma, new PurchaseQuantitiesService(prisma), new AuditService(prisma), workflow as never);
  return { prisma, workflow, service };
}

const dto = (status: string, overrides: Record<string, unknown> = {}): UpdatePurchaseRequestDto =>
  ({
    requestDate: new Date('2026-01-01'), purchaseTypeId: 1, requesterDepartmentId: 2, priority: 'NORMAL', status, updatedAt: VERSION,
    items: [{ name: 'روغن', quantity: 10, unitId: 1 }], ...overrides,
  }) as never;
const written = (prisma: any) => prisma.purchaseRequest.update.mock.calls[0][0].data.status;
const actions = (prisma: any) => prisma.auditLog.create.mock.calls.map((c: any) => c[0].data.action);

describe('Purchase requests × workflow engine', () => {
  describe('update()', () => {
    it.each([
      ['DRAFT', 'APPROVED'],
      ['SUBMITTED', 'APPROVED'],
      ['DRAFT', 'SUBMITTED'],
    ])('%s → %s on a request a rule matches starts an approval and holds it SUBMITTED', async (from, to) => {
      const { prisma, workflow, service } = setup(from);
      workflow.evaluate.mockResolvedValue(REQUIRED);
      await service.update(1, dto(to), 9);
      expect(written(prisma)).toBe('SUBMITTED');
      expect(workflow.start).toHaveBeenCalledWith(prisma, expect.objectContaining({ documentType: 'PURCHASE_REQUEST', documentId: 1, documentNumber: 'REQ-000001', amount: 0 }));
      expect(actions(prisma)).toContain('PURCHASE_REQUEST_SUBMITTED_FOR_APPROVAL');
    });

    it('with no matching rule the plain approve still works as before', async () => {
      const { prisma, workflow, service } = setup('SUBMITTED');
      await service.update(1, dto('APPROVED'), 9);
      expect(written(prisma)).toBe('APPROVED');
      expect(workflow.start).not.toHaveBeenCalled();
    });

    it('while an approval is open: APPROVED and field edits are refused; leaving (DRAFT / REJECTED / CANCELLED) closes it', async () => {
      const { prisma, workflow, service } = setup('SUBMITTED');
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 9, currentLevel: 1 });
      await expect(service.update(1, dto('APPROVED'), 9)).rejects.toThrow('فقط تأییدکنندهٔ مرحله');
      await expect(service.update(1, dto('SUBMITTED'), 9)).rejects.toThrow('پس بگیرید');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();

      await service.update(1, dto('DRAFT'), 9);
      expect(workflow.cancel).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ kind: 'WITHDRAWN' }));
      await service.update(1, dto('CANCELLED'), 9);
      expect(workflow.cancel).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ kind: 'CANCELLED' }));
    });
  });

  describe('approve / reject / withdraw', () => {
    it.each([
      ['APPROVED', 'APPROVED', 'PURCHASE_REQUEST_APPROVED'],
      ['REJECTED', 'DRAFT', 'PURCHASE_REQUEST_REJECTED'],
    ])('engine outcome %s writes status %s', async (outcome, status, action) => {
      const { prisma, workflow, service } = setup('SUBMITTED');
      workflow.decide.mockResolvedValue({ outcome, requestId: 1, level: 1, requestedByUserId: 3, documentNumber: 'REQ-000001' });
      if (outcome === 'APPROVED') await service.approve(1, { updatedAt: VERSION }, 9);
      else await service.reject(1, { updatedAt: VERSION, comment: 'لازم نیست' }, 9);
      expect(written(prisma)).toBe(status);
      expect(actions(prisma)).toContain(action);
    });

    it('a level approved with more to go leaves it SUBMITTED', async () => {
      const { prisma, workflow, service } = setup('SUBMITTED');
      workflow.decide.mockResolvedValue({ outcome: 'ADVANCED', requestId: 1, level: 1, requestedByUserId: 3, documentNumber: 'x' });
      await service.approve(1, { updatedAt: VERSION }, 9);
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });

    it('deciding a request that is not SUBMITTED is a 409', async () => {
      const { service } = setup('DRAFT');
      await expect(service.approve(1, { updatedAt: VERSION }, 9)).rejects.toBeInstanceOf(ConflictException);
    });

    it('only the requester or a purchases.manage holder withdraws; it returns to DRAFT', async () => {
      const { prisma, workflow, service } = setup('SUBMITTED');
      workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 3, currentLevel: 1 });
      await expect(service.withdraw(1, { updatedAt: VERSION }, 9, false)).rejects.toBeInstanceOf(ForbiddenException);
      await service.withdraw(1, { updatedAt: VERSION }, 3, false);
      expect(workflow.cancel).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'WITHDRAWN' }));
      expect(written(prisma)).toBe('DRAFT');
    });
  });

  it('getDetail() adds the timeline, canDecide and whether a workflow approval is open', async () => {
    const { workflow, service } = setup('SUBMITTED');
    workflow.getTimeline.mockResolvedValue([{ id: 1 }]);
    workflow.canDecide.mockResolvedValue(true);
    workflow.pendingRequest.mockResolvedValue({ id: 1, requestedByUserId: 3, currentLevel: 1 });
    expect((await service.getDetail(1, 9)).approval).toEqual({ requests: [{ id: 1 }], canDecide: true, requestedByUserId: 3, waitingOnWorkflow: true });
  });
});
