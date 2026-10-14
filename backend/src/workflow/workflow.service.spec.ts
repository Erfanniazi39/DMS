import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

// In-memory stand-in for the few Prisma calls the engine makes (like the
// other service specs — real SQL is covered by the live API smoke test).
type Step = { id: number; requestId: number; level: number; approverType: 'ROLE' | 'USER'; roleId: number | null; userId: number | null; approverLabel: string; status: string; decidedByUserId: number | null; comment: string | null };
type Request = { id: number; documentType: string; documentId: number; documentNumber: string; status: string; currentLevel: number; requestedByUserId: number; steps: Step[] };

const USERS: Record<number, { id: number; roleId: number; status: string }> = {
  1: { id: 1, roleId: 10, status: 'ACTIVE' }, // requester
  2: { id: 2, roleId: 20, status: 'ACTIVE' }, // finance manager
  3: { id: 3, roleId: 30, status: 'ACTIVE' }, // CEO
  4: { id: 4, roleId: 20, status: 'ACTIVE' }, // second finance manager
  5: { id: 5, roleId: 20, status: 'DISABLED' },
};

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'مواد اولیه بالای ۱۰۰',
    documentType: 'PURCHASE',
    isActive: true,
    sortOrder: 1,
    version: 3,
    purchaseTypeId: null,
    supplierId: null,
    requesterDepartmentId: null,
    amountBasis: 'TOTAL',
    minAmount: 100,
    maxAmount: null,
    notifyByLetter: true,
    steps: [
      { level: 1, approverType: 'ROLE', roleId: 20, userId: null, label: null, role: { name: 'مدیر مالی' }, user: null },
      { level: 2, approverType: 'ROLE', roleId: 30, userId: null, label: null, role: { name: 'مدیرعامل' }, user: null },
    ],
    ...overrides,
  };
}

function build(rules = [makeRule()]) {
  const notify = { value: true };
  const requests: Request[] = [];
  let nextRequestId = 1;
  let nextStepId = 1;
  const auditEntries: { action: string }[] = [];
  const tx = {
    workflowRule: { findMany: async () => rules },
    user: {
      findUnique: async ({ where }: { where: { id: number } }) => USERS[where.id] ?? null,
      findMany: async ({ where }: { where: { roleId: number; status: string } }) =>
        Object.values(USERS).filter((u) => u.roleId === where.roleId && u.status === where.status).map((u) => ({ id: u.id })),
    },
    approvalRequest: {
      count: async ({ where }: { where: { documentId: number; status: string } }) => requests.filter((r) => r.documentId === where.documentId && r.status === where.status).length,
      create: async ({ data }: { data: Record<string, any> }) => {
        const id = nextRequestId++;
        const request: Request = {
          id,
          documentType: data.documentType,
          documentId: data.documentId,
          documentNumber: data.documentNumber,
          status: 'PENDING',
          currentLevel: data.currentLevel,
          requestedByUserId: data.requestedByUserId,
          steps: data.steps.create.map((s: Record<string, any>) => ({ ...s, id: nextStepId++, requestId: id, decidedByUserId: null, comment: null })),
        };
        requests.push(request);
        return request;
      },
      findUnique: async ({ where }: { where: { id: number } }) => {
        const request = requests.find((r) => r.id === where.id);
        return request ? { ...request, notifyByLetter: notify.value, summary: 's', amount: 500, ruleNameSnapshot: 'r' } : null;
      },
      findFirst: async ({ where }: { where: { documentType: string; documentId: number; status: string } }) =>
        requests.find((r) => r.documentType === where.documentType && r.documentId === where.documentId && r.status === where.status) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Record<string, any> }) => {
        const request = requests.find((r) => r.id === where.id) as Request;
        Object.assign(request, data);
        return request;
      },
    },
    approvalStep: {
      updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const all = requests.flatMap((r) => r.steps);
        const hits = all.filter(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.requestId === undefined || s.requestId === where.requestId) &&
            (where.status === undefined || (typeof where.status === 'string' ? s.status === where.status : where.status.in.includes(s.status))),
        );
        hits.forEach((s) => Object.assign(s, data));
        return { count: hits.length };
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, any> }) => {
        const step = requests.flatMap((r) => r.steps).find((s) => s.id === where.id) as Step;
        Object.assign(step, data);
        return step;
      },
    },
  };
  const prisma = tx as never;
  const audit = { log: async (entry: { action: string }) => void auditEntries.push(entry) } as never;
  const letters = { sendSystemLetter: jest.fn().mockResolvedValue({ id: 77, letterNumber: 'LTR-1405-000099' }) };
  const service = new WorkflowService(prisma, audit, letters as never);
  return { service, tx: tx as never, requests, auditEntries, letters, notify };
}

const facts = { amountTotal: 500 };
const start = (service: WorkflowService, tx: never, documentId = 1) =>
  service.start(tx, { documentType: 'PURCHASE', documentId, documentNumber: `PUR-00000${documentId}`, summary: 's', amount: 500, facts, actor: { userId: 1 } });
const decide = (service: WorkflowService, tx: never, userId: number, decision: 'APPROVE' | 'REJECT', comment?: string) =>
  service.decide(tx, { documentType: 'PURCHASE', documentId: 1, actor: { userId }, decision, comment });

describe('WorkflowService', () => {
  beforeEach(() => {
    process.env.DMS_FEATURE_WORKFLOW = 'true';
  });
  afterEach(() => {
    delete process.env.DMS_FEATURE_WORKFLOW;
  });

  describe('evaluate', () => {
    it('says not required while the feature flag is off, even with a matching rule', async () => {
      process.env.DMS_FEATURE_WORKFLOW = 'false';
      const { service, tx } = build();
      expect(await service.evaluate('PURCHASE', facts, tx)).toEqual({ required: false });
    });

    it('returns the matching rule and its levels', async () => {
      const { service, tx } = build();
      const preview = await service.evaluate('PURCHASE', facts, tx);
      expect(preview).toMatchObject({ required: true, ruleId: 1, ruleVersion: 3 });
      expect(preview.required && preview.levels).toEqual([
        { level: 1, approverLabel: 'مدیر مالی' },
        { level: 2, approverLabel: 'مدیرعامل' },
      ]);
    });

    it('is not required below the band', async () => {
      const { service, tx } = build();
      expect(await service.evaluate('PURCHASE', { amountTotal: 50 }, tx)).toEqual({ required: false });
    });
  });

  describe('start', () => {
    it('opens level 1, keeps later levels waiting, snapshots the rule and audits', async () => {
      const { service, tx, requests, auditEntries } = build();
      const result = await start(service, tx);
      expect(result.currentLevel).toBe(1);
      expect(requests[0].steps.map((s) => s.status)).toEqual(['OPEN', 'WAITING']);
      expect(requests[0]).toMatchObject({ status: 'PENDING', requestedByUserId: 1 });
      expect(auditEntries.map((e) => e.action)).toEqual(['APPROVAL_REQUESTED']);
    });

    it('refuses a second pending request for the same document', async () => {
      const { service, tx } = build();
      await start(service, tx);
      await expect(start(service, tx)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when no rule matches', async () => {
      const { service, tx } = build([]);
      await expect(start(service, tx)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('decide', () => {
    it('walks the levels in order and finishes APPROVED', async () => {
      const { service, tx, requests, auditEntries } = build();
      await start(service, tx);
      expect((await decide(service, tx, 2, 'APPROVE', 'ok')).outcome).toBe('ADVANCED');
      expect(requests[0].currentLevel).toBe(2);
      expect((await decide(service, tx, 3, 'APPROVE')).outcome).toBe('APPROVED');
      expect(requests[0].status).toBe('APPROVED');
      expect(auditEntries.map((e) => e.action)).toEqual(['APPROVAL_REQUESTED', 'APPROVAL_LEVEL_APPROVED', 'APPROVAL_APPROVED']);
    });

    it('a user outside the open step cannot decide it (the CEO cannot skip level 1)', async () => {
      const { service, tx } = build();
      await start(service, tx);
      await expect(decide(service, tx, 3, 'APPROVE')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the requester can never decide, even holding the approver role', async () => {
      const { service, tx, requests } = build();
      USERS[1].roleId = 20;
      try {
        await start(service, tx);
        await expect(decide(service, tx, 1, 'APPROVE')).rejects.toThrow('درخواست‌دهنده');
        expect(requests[0].steps[0].status).toBe('OPEN');
      } finally {
        USERS[1].roleId = 10;
      }
    });

    it('one user cannot approve two levels of the same request', async () => {
      const { service, tx } = build([
        makeRule({
          steps: [
            { level: 1, approverType: 'ROLE', roleId: 20, userId: null, label: null, role: { name: 'مالی' }, user: null },
            { level: 2, approverType: 'ROLE', roleId: 20, userId: null, label: null, role: { name: 'مالی' }, user: null },
          ],
        }),
      ]);
      await start(service, tx);
      await decide(service, tx, 2, 'APPROVE');
      await expect(decide(service, tx, 2, 'APPROVE')).rejects.toThrow('یک مرحلهٔ');
      expect((await decide(service, tx, 4, 'APPROVE')).outcome).toBe('APPROVED');
    });

    it('a disabled approver is refused', async () => {
      const { service, tx } = build();
      await start(service, tx);
      await expect(decide(service, tx, 5, 'APPROVE')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reject needs a comment, cancels later levels and ends REJECTED', async () => {
      const { service, tx, requests } = build();
      await start(service, tx);
      await expect(decide(service, tx, 2, 'REJECT', '   ')).rejects.toBeInstanceOf(BadRequestException);
      const result = await decide(service, tx, 2, 'REJECT', 'قیمت بالاست');
      expect(result.outcome).toBe('REJECTED');
      expect(requests[0].status).toBe('REJECTED');
      expect(requests[0].steps.map((s) => s.status)).toEqual(['REJECTED', 'CANCELLED']);
      expect(requests[0].steps[0].comment).toBe('قیمت بالاست');
    });

    it('fails with 409 when there is nothing pending', async () => {
      const { service, tx } = build();
      await expect(decide(service, tx, 2, 'APPROVE')).rejects.toBeInstanceOf(ConflictException);
    });

    it('the second of two simultaneous deciders loses on the status guard', async () => {
      const { service, tx, requests } = build();
      await start(service, tx);
      // Simulate the other decider committing between our read and our claim.
      const original = (tx as any).approvalStep.updateMany;
      (tx as any).approvalStep.updateMany = async (args: any) => {
        requests[0].steps[0].status = 'APPROVED';
        return original(args);
      };
      await expect(decide(service, tx, 2, 'APPROVE')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('snapshot isolation', () => {
    it('editing the rule after start does not change the running request', async () => {
      const rule = makeRule();
      const { service, tx, requests } = build([rule]);
      await start(service, tx);
      rule.steps = [{ level: 1, approverType: 'ROLE', roleId: 30, userId: null, label: null, role: { name: 'مدیرعامل' }, user: null }];
      rule.version = 4;
      expect(requests[0].steps).toHaveLength(2);
      expect(requests[0].steps[0].roleId).toBe(20);
      expect((await decide(service, tx, 2, 'APPROVE')).outcome).toBe('ADVANCED');
    });
  });

  describe('letter notifications', () => {
    it('level 1 opening writes one letter from the requester to every active holder of the role (minus requester), and stores its id', async () => {
      const { service, tx, letters, requests } = build();
      await start(service, tx);
      expect(letters.sendSystemLetter).toHaveBeenCalledTimes(1);
      const [, input] = letters.sendSystemLetter.mock.calls[0];
      expect(input.senderUserId).toBe(1);
      expect(input.recipientUserIds.sort()).toEqual([2, 4]); // role 20 active users; disabled user 5 excluded
      expect(input.subject).toContain('PUR-000001');
      expect(input.body).toContain('مرحله: ۱ از ۲');
      expect(requests[0].steps[0]).toMatchObject({ notificationLetterId: 77 });
    });

    it('the next level is notified by the approver who advanced it; the final approval notifies the requester', async () => {
      const { service, tx, letters } = build();
      await start(service, tx);
      await decide(service, tx, 2, 'APPROVE');
      const [, levelTwo] = letters.sendSystemLetter.mock.calls[1];
      expect(levelTwo).toMatchObject({ senderUserId: 2, recipientUserIds: [3] });
      await decide(service, tx, 3, 'APPROVE', 'تحویل فوری');
      const [, final] = letters.sendSystemLetter.mock.calls[2];
      expect(final).toMatchObject({ senderUserId: 3, recipientUserIds: [1] });
      expect(final.subject).toContain('تأیید شد');
      expect(final.body).toContain('تحویل فوری');
    });

    it('a rejection tells the requester why', async () => {
      const { service, tx, letters } = build();
      await start(service, tx);
      await decide(service, tx, 2, 'REJECT', 'گران است');
      const [, rejected] = letters.sendSystemLetter.mock.calls[1];
      expect(rejected).toMatchObject({ senderUserId: 2, recipientUserIds: [1] });
      expect(rejected.body).toContain('دلیل: گران است');
    });

    it('a rule with letters switched off sends nothing', async () => {
      const { service, tx, letters, notify } = build();
      notify.value = false;
      await start(service, tx);
      await decide(service, tx, 2, 'APPROVE');
      expect(letters.sendSystemLetter).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('closes the pending request and its open steps', async () => {
      const { service, tx, requests } = build();
      await start(service, tx);
      const closed = await service.cancel(tx, { documentType: 'PURCHASE', documentId: 1, actor: { userId: 1 }, kind: 'WITHDRAWN', reason: 'اشتباه' });
      expect(closed).toBe(true);
      expect(requests[0].status).toBe('WITHDRAWN');
      expect(requests[0].steps.map((s) => s.status)).toEqual(['CANCELLED', 'CANCELLED']);
    });

    it('returns false when nothing is pending', async () => {
      const { service, tx } = build();
      expect(await service.cancel(tx, { documentType: 'PURCHASE', documentId: 1, actor: { userId: 1 }, kind: 'CANCELLED' })).toBe(false);
    });
  });
});
