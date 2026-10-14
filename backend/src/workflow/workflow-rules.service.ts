import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkflowRuleDto, ReorderWorkflowRulesDto, TestWorkflowRuleDto, UpdateWorkflowRuleDto } from './dto/workflow.dto';
import { DOCUMENT_VIEW_PERMISSION, findMatchingRule, type WorkflowFacts } from './workflow-rules';

export type WorkflowActor = { userId: number; ipAddress?: string };

const ruleInclude = {
  steps: {
    orderBy: { level: 'asc' as const },
    include: { role: { select: { id: true, name: true } }, user: { select: { id: true, username: true, fullName: true, status: true } } },
  },
} satisfies Prisma.WorkflowRuleInclude;

const AUDITED_FIELDS = [
  'name',
  'documentType',
  'isActive',
  'purchaseTypeId',
  'supplierId',
  'requesterDepartmentId',
  'amountBasis',
  'minAmount',
  'maxAmount',
  'minDiscountPercent',
  'notifyByLetter',
  'note',
  'steps',
] as const;

// Rule definitions (workflow.manage). Scope ids point at other modules'
// master data: we only check "exists and is active" (the documented read-only
// lookup exception to CLAUDE.md rule 11) and store the plain id — no FK.
@Injectable()
export class WorkflowRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(documentType?: string) {
    const rules = await this.prisma.workflowRule.findMany({
      where: documentType ? { documentType: documentType as never } : {},
      orderBy: [{ documentType: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: ruleInclude,
    });
    return Promise.all(rules.map((rule) => this.present(rule)));
  }

  // Pickers for the rule editor. Read-only lookups of other modules' master
  // data (CLAUDE.md rule 11's documented exception) — lives here so the
  // rules screen needs only workflow.manage, not users/suppliers permissions.
  async formOptions() {
    const [roles, users, purchaseTypes, departments, suppliers] = await Promise.all([
      this.prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, username: true, fullName: true, roleId: true }, orderBy: { username: 'asc' } }),
      this.prisma.purchaseType.findMany({ where: { isActive: true }, select: { id: true, code: true, nameFa: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.department.findMany({ where: { status: 'active' }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.supplier.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { roles, users, purchaseTypes, departments, suppliers };
  }

  async get(id: number) {
    const rule = await this.prisma.workflowRule.findUnique({ where: { id }, include: ruleInclude });
    if (!rule) throw new NotFoundException('قانون پیدا نشد');
    return this.present(rule);
  }

  async create(dto: CreateWorkflowRuleDto, actor: WorkflowActor) {
    await this.validateReferences(dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const last = await tx.workflowRule.aggregate({ where: { documentType: dto.documentType }, _max: { sortOrder: true } });
      const rule = await tx.workflowRule.create({
        data: {
          ...this.ruleData(dto),
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
          steps: { create: this.stepData(dto) },
        },
      });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'WORKFLOW_RULE_CREATED', entityType: AUDIT_ENTITY.WORKFLOW_RULE, entityId: rule.id, details: dto.name },
        tx,
      );
      return rule.id;
    });
    return this.get(id);
  }

  // Full replace of the rule and its steps; version +1. In-flight approval
  // requests keep their own snapshot, so this never changes them.
  async update(id: number, dto: UpdateWorkflowRuleDto, actor: WorkflowActor) {
    const existing = await this.prisma.workflowRule.findUnique({ where: { id }, include: ruleInclude });
    if (!existing) throw new NotFoundException('قانون پیدا نشد');
    if (existing.documentType !== dto.documentType) throw new BadRequestException('نوع سند قانون قابل تغییر نیست');
    await this.validateReferences(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowRuleStep.deleteMany({ where: { ruleId: id } });
      const updated = await tx.workflowRule.update({
        where: { id },
        data: {
          ...this.ruleData(dto),
          isActive: dto.isActive ?? existing.isActive,
          version: { increment: 1 },
          updatedByUserId: actor.userId,
          steps: { create: this.stepData(dto) },
        },
        include: ruleInclude,
      });
      const describe = (rule: typeof existing) => ({ ...rule, steps: rule.steps.map((s) => `${s.level}:${s.approverType}:${s.roleId ?? s.userId}`).join(',') });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'WORKFLOW_RULE_UPDATED',
          entityType: AUDIT_ENTITY.WORKFLOW_RULE,
          entityId: id,
          details: `${dto.name} (نسخه ${updated.version})`,
          changes: diffChanges(describe(existing), describe(updated), AUDITED_FIELDS),
        },
        tx,
      );
    });
    return this.get(id);
  }

  async setActive(id: number, isActive: boolean, actor: WorkflowActor) {
    const rule = await this.prisma.workflowRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('قانون پیدا نشد');
    if (rule.isActive === isActive) return this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowRule.update({ where: { id }, data: { isActive, version: { increment: 1 }, updatedByUserId: actor.userId } });
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: isActive ? 'WORKFLOW_RULE_ACTIVATED' : 'WORKFLOW_RULE_DEACTIVATED',
          entityType: AUDIT_ENTITY.WORKFLOW_RULE,
          entityId: id,
          details: rule.name,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // A rule that was ever used by an approval request can only be deactivated.
  async remove(id: number, actor: WorkflowActor) {
    const rule = await this.prisma.workflowRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('قانون پیدا نشد');
    const used = await this.prisma.approvalRequest.count({ where: { ruleId: id } });
    if (used > 0) throw new ConflictException('این قانون قبلاً در درخواست‌های تأیید استفاده شده است؛ به‌جای حذف، آن را غیرفعال کنید');
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowRule.delete({ where: { id } });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'WORKFLOW_RULE_DELETED', entityType: AUDIT_ENTITY.WORKFLOW_RULE, entityId: id, details: rule.name },
        tx,
      );
    });
    return { ok: true };
  }

  // Order of evaluation for one document type: the given ids become 1..n; the
  // list must contain exactly that type's rules.
  async reorder(dto: ReorderWorkflowRulesDto, actor: WorkflowActor) {
    const rules = await this.prisma.workflowRule.findMany({ where: { documentType: dto.documentType }, select: { id: true } });
    const known = new Set(rules.map((rule) => rule.id));
    if (dto.ruleIds.length !== known.size || new Set(dto.ruleIds).size !== dto.ruleIds.length || dto.ruleIds.some((id) => !known.has(id))) {
      throw new BadRequestException('فهرست قوانین باید دقیقاً شامل همهٔ قوانین این نوع سند باشد');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [index, ruleId] of dto.ruleIds.entries()) {
        await tx.workflowRule.update({ where: { id: ruleId }, data: { sortOrder: index + 1 } });
      }
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'WORKFLOW_RULES_REORDERED', entityType: AUDIT_ENTITY.WORKFLOW_RULE, details: dto.documentType },
        tx,
      );
    });
    return this.list(dto.documentType);
  }

  // "What would happen to a document with these facts?" — used by the rules
  // screen. Works on all active rules regardless of the feature flag.
  async test(dto: TestWorkflowRuleDto) {
    const { documentType, ...facts } = dto;
    const rules = await this.prisma.workflowRule.findMany({ where: { documentType, isActive: true }, include: ruleInclude });
    const match = findMatchingRule(rules, facts as WorkflowFacts);
    if (!match) return { required: false as const };
    return {
      required: true as const,
      ruleId: match.id,
      ruleName: match.name,
      levels: match.steps.map((step) => ({ level: step.level, approverLabel: stepLabel(step) })),
    };
  }

  private ruleData(dto: CreateWorkflowRuleDto | UpdateWorkflowRuleDto) {
    return {
      name: dto.name,
      documentType: dto.documentType,
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      purchaseTypeId: dto.purchaseTypeId ?? null,
      supplierId: dto.supplierId ?? null,
      requesterDepartmentId: dto.requesterDepartmentId ?? null,
      amountBasis: dto.amountBasis,
      minAmount: dto.minAmount ?? null,
      maxAmount: dto.maxAmount ?? null,
      minDiscountPercent: dto.minDiscountPercent ?? null,
      notifyByLetter: dto.notifyByLetter,
      note: dto.note ?? null,
    };
  }

  private stepData(dto: CreateWorkflowRuleDto | UpdateWorkflowRuleDto) {
    return dto.steps.map((step, index) => ({
      level: index + 1,
      approverType: step.approverType,
      roleId: step.approverType === 'ROLE' ? (step.roleId ?? null) : null,
      userId: step.approverType === 'USER' ? (step.userId ?? null) : null,
      label: step.label || null,
    }));
  }

  // "Exists and is active" lookups on other modules' master data.
  private async validateReferences(dto: CreateWorkflowRuleDto | UpdateWorkflowRuleDto) {
    if (dto.purchaseTypeId) {
      const type = await this.prisma.purchaseType.findUnique({ where: { id: dto.purchaseTypeId }, select: { isActive: true } });
      if (!type?.isActive) throw new BadRequestException('نوع خرید انتخاب‌شده وجود ندارد یا غیرفعال است');
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId }, select: { id: true } });
      if (!supplier) throw new BadRequestException('تأمین‌کنندهٔ انتخاب‌شده وجود ندارد');
    }
    if (dto.requesterDepartmentId) {
      const department = await this.prisma.department.findUnique({ where: { id: dto.requesterDepartmentId }, select: { status: true } });
      if (department?.status !== 'active') throw new BadRequestException('دپارتمان انتخاب‌شده وجود ندارد یا غیرفعال است');
    }
    const seenUsers = new Set<number>();
    for (const [index, step] of dto.steps.entries()) {
      if (step.approverType === 'ROLE') {
        const role = await this.prisma.role.findUnique({ where: { id: step.roleId as number }, select: { id: true } });
        if (!role) throw new BadRequestException(`نقش مرحلهٔ ${index + 1} وجود ندارد`);
      } else {
        const user = await this.prisma.user.findUnique({ where: { id: step.userId as number }, select: { status: true } });
        if (user?.status !== 'ACTIVE') throw new BadRequestException(`کاربر مرحلهٔ ${index + 1} وجود ندارد یا فعال نیست`);
        if (seenUsers.has(step.userId as number)) throw new BadRequestException('یک کاربر نمی‌تواند در دو مرحلهٔ یک قانون باشد');
        seenUsers.add(step.userId as number);
      }
    }
  }

  // Adds `canViewDocument` per step: an approver who can't open the document
  // page can never press the button, so the editor warns about it.
  private async present(rule: Prisma.WorkflowRuleGetPayload<{ include: typeof ruleInclude }>) {
    const viewPermission = DOCUMENT_VIEW_PERMISSION[rule.documentType];
    const steps = await Promise.all(
      rule.steps.map(async (step) => ({
        id: step.id,
        level: step.level,
        approverType: step.approverType,
        roleId: step.roleId,
        userId: step.userId,
        label: step.label,
        approverLabel: stepLabel(step),
        canViewDocument: await this.canView(step, viewPermission),
      })),
    );
    const { steps: _steps, ...rest } = rule;
    void _steps;
    return { ...rest, steps };
  }

  private async canView(step: { approverType: string; roleId: number | null; userId: number | null }, permission: string) {
    if (step.approverType === 'ROLE' && step.roleId) {
      return (await this.prisma.rolePermission.count({ where: { roleId: step.roleId, permission: { name: permission } } })) > 0;
    }
    if (step.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: step.userId }, select: { roleId: true } });
      if (!user) return false;
      const [viaRole, viaUser] = await Promise.all([
        this.prisma.rolePermission.count({ where: { roleId: user.roleId, permission: { name: permission } } }),
        this.prisma.userPermission.count({ where: { userId: step.userId, permission: { name: permission } } }),
      ]);
      return viaRole + viaUser > 0;
    }
    return false;
  }
}

export function stepLabel(step: {
  label?: string | null;
  role?: { name: string } | null;
  user?: { username: string; fullName: string | null } | null;
}): string {
  return step.label || step.role?.name || step.user?.fullName || step.user?.username || '—';
}
