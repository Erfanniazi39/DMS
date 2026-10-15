import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type WorkflowDocumentType } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { isFeatureEnabled } from '../common/feature-flags';
import { toSkipTake, type PaginationParams } from '../common/pagination';
import { LettersService } from '../letters/letters.service';
import { PrismaService } from '../prisma/prisma.service';
import { WORKFLOW_DOCUMENT_TYPE_LABELS_FA, findMatchingRule, isStepApprover, type WorkflowFacts } from './workflow-rules';
import { stepLabel } from './workflow-rules.service';

type Db = Prisma.TransactionClient;

const ruleWithSteps = {
  steps: {
    orderBy: { level: 'asc' as const },
    include: {
      approvers: {
        orderBy: { id: 'asc' as const },
        include: { role: { select: { name: true } }, user: { select: { username: true, fullName: true } } },
      },
    },
  },
} satisfies Prisma.WorkflowRuleInclude;

export type ApprovalPreview =
  | { required: false }
  | {
      required: true;
      ruleId: number;
      ruleName: string;
      ruleVersion: number;
      notifyByLetter: boolean;
      levels: { level: number; approverLabel: string }[];
    };

export type DecisionOutcome = 'ADVANCED' | 'APPROVED' | 'REJECTED';

type Actor = { userId: number; ipAddress?: string };

// Prisma `user` filter matching anyone who may decide a step: any listed user
// or any holder of a listed role.
function approverMatch(approvers: readonly { approverType: string; roleId: number | null; userId: number | null }[]): Prisma.UserWhereInput[] {
  const conditions: Prisma.UserWhereInput[] = approvers.map((approver) => (approver.approverType === 'ROLE' ? { roleId: approver.roleId as number } : { id: approver.userId as number }));
  return conditions.length ? conditions : [{ id: -1 }];
}

// The approval engine. Owning modules (Purchases, Sales, Purchase Requests)
// call it with facts they computed themselves and change their OWN status
// from the result; the engine never reads or writes their tables and has no
// FK to their documents (CLAUDE.md rule 11). Every write method takes the
// caller's transaction, like AuditService.log(), so the document change and
// the approval record commit or roll back together.
//
// With the `workflowApprovals` flag off, evaluate() always says "not
// required" — documents then flow exactly as before the engine existed.
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Notifications only (sendSystemLetter) — the letter is the notice, the
    // decision itself always happens on the document page.
    private readonly letters: LettersService,
  ) {}

  // Read-only: does a document with these facts need approval, and from whom?
  async evaluate(documentType: WorkflowDocumentType, facts: WorkflowFacts, db?: Db): Promise<ApprovalPreview> {
    if (!isFeatureEnabled('workflowApprovals')) return { required: false };
    const rule = await this.matchRule(db ?? this.prisma, documentType, facts);
    if (!rule) return { required: false };
    return {
      required: true,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      notifyByLetter: rule.notifyByLetter,
      levels: rule.steps.map((step) => ({ level: step.level, approverLabel: stepLabel(step) })),
    };
  }

  // Opens an approval request for a document. The caller has already decided
  // (via evaluate) that approval is needed and puts its document into its own
  // "pending approval" state in the same transaction.
  async start(
    tx: Db,
    input: {
      documentType: WorkflowDocumentType;
      documentId: number;
      documentNumber: string;
      summary: string;
      amount: number;
      facts: WorkflowFacts;
      actor: Actor;
    },
  ) {
    const rule = await this.matchRule(tx, input.documentType, input.facts);
    if (!rule) throw new BadRequestException('برای این سند قانون تأییدی تعریف نشده است');
    const existing = await tx.approvalRequest.count({ where: { documentType: input.documentType, documentId: input.documentId, status: 'PENDING' } });
    if (existing > 0) throw new ConflictException('برای این سند یک درخواست تأیید در جریان وجود دارد');

    let request;
    try {
      request = await tx.approvalRequest.create({
        data: {
          documentType: input.documentType,
          documentId: input.documentId,
          documentNumber: input.documentNumber,
          summary: input.summary,
          amount: input.amount,
          ruleId: rule.id,
          ruleVersion: rule.version,
          ruleNameSnapshot: rule.name,
          notifyByLetter: rule.notifyByLetter,
          factsSnapshot: input.facts as Prisma.InputJsonValue,
          currentLevel: 1,
          requestedByUserId: input.actor.userId,
          steps: {
            create: rule.steps.map((step) => ({
              level: step.level,
              approverLabel: stepLabel(step),
              approvers: { create: step.approvers.map((approver) => ({ approverType: approver.approverType, roleId: approver.roleId, userId: approver.userId })) },
              status: step.level === 1 ? ('OPEN' as const) : ('WAITING' as const),
            })),
          },
        },
        include: { steps: { orderBy: { level: 'asc' } } },
      });
    } catch (error) {
      // The partial unique index (one PENDING per document) caught a race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('برای این سند یک درخواست تأیید در جریان وجود دارد');
      }
      throw error;
    }
    await this.audit.log(
      {
        userId: input.actor.userId,
        ipAddress: input.actor.ipAddress,
        action: 'APPROVAL_REQUESTED',
        entityType: AUDIT_ENTITY.APPROVAL_REQUEST,
        entityId: request.id,
        details: `${input.documentNumber} — ${rule.name} (نسخه ${rule.version})`,
      },
      tx,
    );
    await this.notifyLevelOpened(tx, request.id, 1, input.actor);
    return { requestId: request.id, currentLevel: 1, levels: request.steps.map((step) => ({ level: step.level, approverLabel: step.approverLabel })) };
  }

  // Approve or reject the document's pending request. Eligibility is read
  // from the DB (the session's role/permissions are stale after changes).
  async decide(
    tx: Db,
    input: { documentType: WorkflowDocumentType; documentId: number; actor: Actor; decision: 'APPROVE' | 'REJECT'; comment?: string | null },
  ): Promise<{ outcome: DecisionOutcome; requestId: number; level: number; requestedByUserId: number; documentNumber: string }> {
    const comment = input.comment?.trim() || null;
    if (input.decision === 'REJECT' && !comment) throw new BadRequestException('نوشتن دلیل رد الزامی است');

    const request = await tx.approvalRequest.findFirst({
      where: { documentType: input.documentType, documentId: input.documentId, status: 'PENDING' },
      include: { steps: { orderBy: { level: 'asc' }, include: { approvers: true } } },
    });
    if (!request) throw new ConflictException('درخواست تأیید فعالی برای این سند وجود ندارد');
    const step = request.steps.find((s) => s.level === request.currentLevel && s.status === 'OPEN');
    if (!step) throw new ConflictException('این مرحله دیگر در انتظار تصمیم نیست');

    const user = await tx.user.findUnique({ where: { id: input.actor.userId }, select: { id: true, roleId: true, status: true } });
    if (!user || !isStepApprover(step.approvers, { id: user.id, roleId: user.roleId, active: user.status === 'ACTIVE' })) {
      throw new ForbiddenException('شما تأییدکنندهٔ این مرحله نیستید');
    }
    if (user.id === request.requestedByUserId) throw new ForbiddenException('درخواست‌دهنده نمی‌تواند درخواست خود را تأیید یا رد کند');
    if (request.steps.some((s) => s.decidedByUserId === user.id)) throw new ForbiddenException('هر کاربر فقط در یک مرحلهٔ هر درخواست می‌تواند تصمیم بگیرد');

    const now = new Date();
    // Guarded on status: of two simultaneous deciders only the first wins.
    const claimed = await tx.approvalStep.updateMany({
      where: { id: step.id, status: 'OPEN' },
      data: { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedByUserId: user.id, decidedAt: now, comment },
    });
    if (claimed.count === 0) throw new ConflictException('این مرحله هم‌اکنون توسط کاربر دیگری تصمیم‌گیری شد');

    const base = { requestId: request.id, level: step.level, requestedByUserId: request.requestedByUserId, documentNumber: request.documentNumber };
    const auditBase = { userId: user.id, ipAddress: input.actor.ipAddress, entityType: AUDIT_ENTITY.APPROVAL_REQUEST, entityId: request.id };

    if (input.decision === 'REJECT') {
      await tx.approvalStep.updateMany({ where: { requestId: request.id, status: 'WAITING' }, data: { status: 'CANCELLED' } });
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', decidedAt: now } });
      await this.audit.log({ ...auditBase, action: 'APPROVAL_REJECTED', details: `${request.documentNumber} — مرحلهٔ ${step.level}: ${comment}` }, tx);
      await this.notifyDecision(tx, request.id, 'REJECTED', input.actor, comment);
      return { ...base, outcome: 'REJECTED' };
    }

    const next = request.steps.find((s) => s.level === step.level + 1);
    if (next) {
      await tx.approvalStep.update({ where: { id: next.id }, data: { status: 'OPEN' } });
      await tx.approvalRequest.update({ where: { id: request.id }, data: { currentLevel: next.level } });
      await this.audit.log({ ...auditBase, action: 'APPROVAL_LEVEL_APPROVED', details: `${request.documentNumber} — مرحلهٔ ${step.level}` }, tx);
      await this.notifyLevelOpened(tx, request.id, next.level, input.actor);
      return { ...base, outcome: 'ADVANCED' };
    }
    await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', decidedAt: now } });
    await this.audit.log({ ...auditBase, action: 'APPROVAL_APPROVED', details: request.documentNumber }, tx);
    await this.notifyDecision(tx, request.id, 'APPROVED', input.actor, comment);
    return { ...base, outcome: 'APPROVED' };
  }

  // Closes the document's pending request without a decision (the requester
  // withdrew it, or the document was cancelled/deleted). Returns false when
  // there was nothing pending. Who may withdraw is the owning module's call.
  async cancel(
    tx: Db,
    input: { documentType: WorkflowDocumentType; documentId: number; actor: Actor; kind: 'WITHDRAWN' | 'CANCELLED'; reason?: string | null },
  ): Promise<boolean> {
    const request = await tx.approvalRequest.findFirst({ where: { documentType: input.documentType, documentId: input.documentId, status: 'PENDING' } });
    if (!request) return false;
    await tx.approvalStep.updateMany({ where: { requestId: request.id, status: { in: ['WAITING', 'OPEN'] } }, data: { status: 'CANCELLED' } });
    await tx.approvalRequest.update({ where: { id: request.id }, data: { status: input.kind, decidedAt: new Date(), closeReason: input.reason?.trim() || null } });
    await this.audit.log(
      {
        userId: input.actor.userId,
        ipAddress: input.actor.ipAddress,
        action: input.kind === 'WITHDRAWN' ? 'APPROVAL_WITHDRAWN' : 'APPROVAL_CANCELLED',
        entityType: AUDIT_ENTITY.APPROVAL_REQUEST,
        entityId: request.id,
        details: request.documentNumber,
      },
      tx,
    );
    return true;
  }

  // Newest first. The owning module puts this into its own detail response,
  // so its existing view permission is what protects it.
  async getTimeline(documentType: WorkflowDocumentType, documentId: number) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: { documentType, documentId },
      orderBy: { id: 'desc' },
      include: {
        requestedByUser: { select: { id: true, username: true, fullName: true } },
        steps: { orderBy: { level: 'asc' }, include: { decidedByUser: { select: { id: true, username: true, fullName: true } } } },
      },
    });
    return requests.map((request) => ({
      id: request.id,
      status: request.status,
      amount: request.amount.toString(),
      ruleName: request.ruleNameSnapshot,
      ruleVersion: request.ruleVersion,
      currentLevel: request.currentLevel,
      requestedBy: request.requestedByUser,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      closeReason: request.closeReason,
      steps: request.steps.map((step) => ({
        id: step.id,
        level: step.level,
        approverLabel: step.approverLabel,
        status: step.status,
        decidedBy: step.decidedByUser,
        decidedAt: step.decidedAt,
        comment: step.comment,
      })),
    }));
  }

  // Can this user decide the document's current step right now? For the
  // owning module's detail page (show / hide the approve and reject buttons).
  async canDecide(documentType: WorkflowDocumentType, documentId: number, userId: number): Promise<boolean> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { documentType, documentId, status: 'PENDING' },
      include: { steps: { include: { approvers: true } } },
    });
    if (!request || request.requestedByUserId === userId) return false;
    const step = request.steps.find((s) => s.level === request.currentLevel && s.status === 'OPEN');
    if (!step || request.steps.some((s) => s.decidedByUserId === userId)) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, roleId: true, status: true } });
    return !!user && isStepApprover(step.approvers, { id: user.id, roleId: user.roleId, active: user.status === 'ACTIVE' });
  }

  // The document's open request (who asked, for the owning module's
  // withdraw policy), or null.
  async pendingRequest(documentType: WorkflowDocumentType, documentId: number, db?: Db) {
    return (db ?? this.prisma).approvalRequest.findFirst({
      where: { documentType, documentId, status: 'PENDING' },
      select: { id: true, requestedByUserId: true, currentLevel: true },
    });
  }

  // The amount of the document's last APPROVED request (edit-after-approval
  // check), or null if it was never approved.
  async approvedAmount(documentType: WorkflowDocumentType, documentId: number, db?: Db): Promise<number | null> {
    const request = await (db ?? this.prisma).approvalRequest.findFirst({
      where: { documentType, documentId, status: 'APPROVED' },
      orderBy: { id: 'desc' },
      select: { amount: true },
    });
    return request ? Number(request.amount.toString()) : null;
  }

  async inbox(userId: number, tab: 'mine' | 'decided' | 'submitted', pagination: PaginationParams) {
    const include = { requestedByUser: { select: { id: true, username: true, fullName: true } }, steps: { orderBy: { level: 'asc' as const } } };
    const page = toSkipTake(pagination);
    let where: Prisma.ApprovalRequestWhereInput;
    if (tab === 'mine') {
      where = await this.pendingForUserWhere(userId);
    } else if (tab === 'submitted') {
      where = { requestedByUserId: userId };
    } else {
      where = { steps: { some: { decidedByUserId: userId } } };
    }
    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({ where, include, orderBy: { id: 'desc' }, ...page }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return {
      items: rows.map((request) => ({
        id: request.id,
        documentType: request.documentType,
        documentId: request.documentId,
        documentNumber: request.documentNumber,
        summary: request.summary,
        amount: request.amount.toString(),
        status: request.status,
        currentLevel: request.currentLevel,
        totalLevels: request.steps.length,
        currentApproverLabel: request.steps.find((s) => s.level === request.currentLevel)?.approverLabel ?? null,
        requestedBy: request.requestedByUser,
        createdAt: request.createdAt,
        decidedAt: request.decidedAt,
      })),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async inboxCount(userId: number): Promise<number> {
    if (!isFeatureEnabled('workflowApprovals')) return 0;
    return this.prisma.approvalRequest.count({ where: await this.pendingForUserWhere(userId) });
  }

  // Pending requests nobody can currently decide: the open step names a
  // disabled user, or a role with no active user. Managers fix these by
  // withdrawing the document and changing the rule.
  async stuck() {
    const pending = await this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING' },
      include: { steps: { orderBy: { level: 'asc' }, include: { approvers: true } }, requestedByUser: { select: { id: true, username: true, fullName: true } } },
      orderBy: { id: 'asc' },
    });
    const stuck = [];
    for (const request of pending) {
      const step = request.steps.find((s) => s.level === request.currentLevel && s.status === 'OPEN');
      if (!step) continue;
      const decidedBefore = request.steps.map((s) => s.decidedByUserId).filter((id): id is number => id !== null);
      const candidates = await this.prisma.user.count({
        where: {
          status: 'ACTIVE',
          id: { notIn: [request.requestedByUserId, ...decidedBefore] },
          OR: approverMatch(step.approvers),
        },
      });
      if (candidates === 0) {
        stuck.push({
          id: request.id,
          documentType: request.documentType,
          documentId: request.documentId,
          documentNumber: request.documentNumber,
          summary: request.summary,
          level: step.level,
          approverLabel: step.approverLabel,
          requestedBy: request.requestedByUser,
          createdAt: request.createdAt,
        });
      }
    }
    return stuck;
  }

  // Requests whose OPEN step I may decide: it names me or my role, I'm not the
  // requester and I haven't decided another level of the same request.
  private async pendingForUserWhere(userId: number): Promise<Prisma.ApprovalRequestWhereInput> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { roleId: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return { id: -1 };
    return {
      status: 'PENDING',
      requestedByUserId: { not: userId },
      steps: {
        some: { status: 'OPEN', approvers: { some: { OR: [{ userId }, { roleId: user.roleId }] } } },
        none: { decidedByUserId: userId },
      },
    };
  }

  private matchRule(db: Db | PrismaService, documentType: WorkflowDocumentType, facts: WorkflowFacts) {
    return db.workflowRule
      .findMany({ where: { documentType, isActive: true }, include: ruleWithSteps })
      .then((rules) => findMatchingRule(rules, facts));
  }

  // Letter to everyone who may decide the level that just opened, sent on
  // behalf of whoever caused it (the requester for level 1, the previous
  // approver after that). Recipients are computed now from the DB: the named
  // user, or every active holder of the role — minus the requester and anyone
  // who already decided a level (they couldn't decide this one). The document
  // number in the text becomes a link for readers allowed to open it.
  private async notifyLevelOpened(tx: Db, requestId: number, level: number, actor: Actor): Promise<void> {
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { level: 'asc' }, include: { approvers: true } } } });
    if (!request?.notifyByLetter) return;
    const step = request.steps.find((s) => s.level === level);
    if (!step) return;
    const excluded = [request.requestedByUserId, ...request.steps.map((s) => s.decidedByUserId).filter((id): id is number => id !== null)];
    const recipients = [...new Set((await tx.user.findMany({ where: { status: 'ACTIVE', OR: approverMatch(step.approvers) }, select: { id: true } })).map((user) => user.id))];
    const typeLabel = WORKFLOW_DOCUMENT_TYPE_LABELS_FA[request.documentType] ?? request.documentType;
    const letter = await this.letters.sendSystemLetter(tx, {
      senderUserId: actor.userId,
      recipientUserIds: recipients.filter((id) => !excluded.includes(id)),
      subject: `درخواست تأیید ${typeLabel} ${request.documentNumber}`,
      body: [
        `${typeLabel} ${request.documentNumber} برای تأیید شما ارسال شده است.`,
        '',
        `شرح: ${request.summary}`,
        `مبلغ: ${Number(request.amount.toString()).toLocaleString('fa-IR')} ریال`,
        `قانون تأیید: ${request.ruleNameSnapshot}`,
        `مرحله: ${level.toLocaleString('fa-IR')} از ${request.steps.length.toLocaleString('fa-IR')} (${step.approverLabel})`,
        '',
        `برای تأیید یا رد، سند ${request.documentNumber} را باز کنید. این نامه به‌صورت خودکار از گردش کار ارسال شده است.`,
      ].join('\n'),
      source: 'گردش کار',
      ipAddress: actor.ipAddress,
    });
    if (letter) await tx.approvalStep.update({ where: { id: step.id }, data: { notificationLetterId: letter.id } });
  }

  // The final outcome, to the requester, from the approver who decided.
  private async notifyDecision(tx: Db, requestId: number, outcome: 'APPROVED' | 'REJECTED', actor: Actor, comment: string | null): Promise<void> {
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request?.notifyByLetter) return;
    const typeLabel = WORKFLOW_DOCUMENT_TYPE_LABELS_FA[request.documentType] ?? request.documentType;
    const approved = outcome === 'APPROVED';
    await this.letters.sendSystemLetter(tx, {
      senderUserId: actor.userId,
      recipientUserIds: [request.requestedByUserId],
      subject: `${typeLabel} ${request.documentNumber} ${approved ? 'تأیید شد' : 'رد شد'}`,
      body: [
        approved
          ? `درخواست تأیید ${typeLabel} ${request.documentNumber} تأیید نهایی شد.`
          : `درخواست تأیید ${typeLabel} ${request.documentNumber} رد شد و سند به پیش‌نویس برگشت؛ می‌توانید آن را اصلاح و دوباره ارسال کنید.`,
        ...(comment ? ['', `${approved ? 'توضیح' : 'دلیل'}: ${comment}`] : []),
        '',
        'این نامه به‌صورت خودکار از گردش کار ارسال شده است.',
      ].join('\n'),
      source: 'گردش کار',
      ipAddress: actor.ipAddress,
    });
  }
}
