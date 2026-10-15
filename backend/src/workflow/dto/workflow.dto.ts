import { z } from 'zod';

const documentType = z.enum(['PURCHASE', 'SALES_ORDER', 'PURCHASE_REQUEST']);
const amount = z.coerce.number().int('مبلغ باید عدد صحیح باشد').min(0).max(999_999_999_999_999);
const optionalId = z.number().int().positive().nullable().optional();

export const workflowApproverSchema = z
  .object({
    approverType: z.enum(['ROLE', 'USER']),
    roleId: z.number().int().positive().nullable().optional(),
    userId: z.number().int().positive().nullable().optional(),
  })
  .superRefine((approver, ctx) => {
    if (approver.approverType === 'ROLE' && !approver.roleId) ctx.addIssue({ code: 'custom', path: ['roleId'], message: 'نقش تأییدکننده الزامی است' });
    if (approver.approverType === 'USER' && !approver.userId) ctx.addIssue({ code: 'custom', path: ['userId'], message: 'کاربر تأییدکننده الزامی است' });
  });

// A step has up to 5 approvers; any one of them may decide it. The old
// single-approver shape ({approverType, roleId, userId}) is still accepted.
export const workflowStepSchema = z.preprocess(
  (value) => {
    if (value && typeof value === 'object' && !('approvers' in value) && 'approverType' in value) {
      const { approverType, roleId, userId, ...rest } = value as Record<string, unknown>;
      return { ...rest, approvers: [{ approverType, roleId, userId }] };
    }
    return value;
  },
  z.object({
    approvers: z.array(workflowApproverSchema).min(1, 'هر مرحله حداقل یک تأییدکننده لازم دارد').max(5, 'هر مرحله حداکثر ۵ تأییدکننده می‌تواند داشته باشد'),
    label: z.string().trim().max(100).nullable().optional(),
  }),
);

const workflowRuleObject = z.object({
  name: z.string().trim().min(1, 'نام قانون الزامی است').max(150),
  documentType,
  isActive: z.boolean().optional(),
  purchaseTypeId: optionalId,
  supplierId: optionalId,
  requesterDepartmentId: optionalId,
  amountBasis: z.enum(['TOTAL', 'ANY_LINE_TOTAL', 'ANY_UNIT_PRICE']).default('TOTAL'),
  minAmount: amount.nullable().optional(),
  maxAmount: amount.nullable().optional(),
  minDiscountPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  notifyByLetter: z.boolean().default(true),
  note: z.string().trim().max(1000).nullable().optional(),
  // Levels run in array order (1..n).
  steps: z.array(workflowStepSchema).min(1, 'حداقل یک مرحله تأیید لازم است').max(5, 'حداکثر ۵ مرحله تأیید مجاز است'),
});

function bandRefine(rule: { minAmount?: number | null; maxAmount?: number | null }, ctx: z.RefinementCtx) {
  if (rule.minAmount != null && rule.maxAmount != null && rule.minAmount >= rule.maxAmount) {
    ctx.addIssue({ code: 'custom', path: ['maxAmount'], message: 'حداکثر مبلغ باید بیشتر از حداقل مبلغ باشد' });
  }
}

export const createWorkflowRuleSchema = workflowRuleObject.superRefine(bandRefine);
export const updateWorkflowRuleSchema = workflowRuleObject.superRefine(bandRefine);
export type CreateWorkflowRuleDto = z.infer<typeof createWorkflowRuleSchema>;
export type UpdateWorkflowRuleDto = z.infer<typeof updateWorkflowRuleSchema>;

export const reorderWorkflowRulesSchema = z.object({
  documentType,
  ruleIds: z.array(z.number().int().positive()).min(1),
});
export type ReorderWorkflowRulesDto = z.infer<typeof reorderWorkflowRulesSchema>;

export const testWorkflowRuleSchema = z.object({
  documentType,
  amountTotal: z.number().nullable().optional(),
  maxLineTotal: z.number().nullable().optional(),
  maxUnitPrice: z.number().nullable().optional(),
  purchaseTypeId: optionalId,
  supplierId: optionalId,
  requesterDepartmentId: optionalId,
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
});
export type TestWorkflowRuleDto = z.infer<typeof testWorkflowRuleSchema>;

export const workflowInboxQuerySchema = z.object({
  tab: z.enum(['mine', 'decided', 'submitted']).default('mine'),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});
export type WorkflowInboxQuery = z.infer<typeof workflowInboxQuerySchema>;
