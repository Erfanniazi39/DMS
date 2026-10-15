import type { WorkflowAmountBasis } from '@prisma/client';

// Pure rule logic of the workflow engine — no DB, no Nest. The owning module
// (Purchases, Sales, Purchase Requests) computes the facts from its own
// documents and hands them to the engine; the engine never reads their
// tables (CLAUDE.md rule 11).
export type WorkflowFacts = {
  // Document total in Rial.
  amountTotal?: number | null;
  // Largest single line total / unit price on the document (null when no line
  // has one — e.g. PurchaseItem.unitPrice is optional).
  maxLineTotal?: number | null;
  maxUnitPrice?: number | null;
  purchaseTypeId?: number | null;
  supplierId?: number | null;
  requesterDepartmentId?: number | null;
  // Sales orders: the largest line discount as a percent of that line's gross
  // (0/null = the order has no discount).
  maxDiscountPercent?: number | null;
};

export type MatchableRule = {
  isActive: boolean;
  sortOrder: number;
  id: number;
  purchaseTypeId: number | null;
  supplierId: number | null;
  requesterDepartmentId: number | null;
  amountBasis: WorkflowAmountBasis;
  minAmount: { toString(): string } | number | null;
  maxAmount: { toString(): string } | number | null;
  minDiscountPercent?: { toString(): string } | number | null;
};

export const MAX_APPROVAL_LEVELS = 5;

export function amountForBasis(basis: WorkflowAmountBasis, facts: WorkflowFacts): number | null {
  const value = basis === 'TOTAL' ? facts.amountTotal : basis === 'ANY_LINE_TOTAL' ? facts.maxLineTotal : facts.maxUnitPrice;
  return value === undefined || value === null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function toNumber(value: { toString(): string } | number | null): number | null {
  return value === null ? null : Number(value.toString());
}

// A rule matches when every scope field it sets equals the fact, and — if it
// has an amount band — the basis amount is in [min, max). A band rule never
// matches a document whose basis amount is unknown.
export function ruleMatches(rule: MatchableRule, facts: WorkflowFacts): boolean {
  if (!rule.isActive) return false;
  if (rule.purchaseTypeId !== null && rule.purchaseTypeId !== (facts.purchaseTypeId ?? null)) return false;
  if (rule.supplierId !== null && rule.supplierId !== (facts.supplierId ?? null)) return false;
  if (rule.requesterDepartmentId !== null && rule.requesterDepartmentId !== (facts.requesterDepartmentId ?? null)) return false;
  // A discount condition needs a discount: minDiscountPercent 0 = any
  // discount, 10 = at least 10% on some line; a discount-free order never matches.
  const minDiscount = toNumber(rule.minDiscountPercent ?? null);
  if (minDiscount !== null) {
    const discount = facts.maxDiscountPercent ?? 0;
    if (discount <= 0 || discount < minDiscount) return false;
  }
  const min = toNumber(rule.minAmount);
  const max = toNumber(rule.maxAmount);
  if (min === null && max === null) return true;
  const amount = amountForBasis(rule.amountBasis, facts);
  if (amount === null) return false;
  if (min !== null && amount < min) return false;
  if (max !== null && amount >= max) return false;
  return true;
}

// First active match by sortOrder (ties by id) wins — bands are written as
// separate rules, higher threshold first.
export function findMatchingRule<T extends MatchableRule>(rules: readonly T[], facts: WorkflowFacts): T | null {
  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return ordered.find((rule) => ruleMatches(rule, facts)) ?? null;
}

// Who may decide the OPEN step of a request. Pure so it can be unit-tested;
// the service feeds it the actor's role/status read from the DB, never the
// session (permissions and roles are cached in the session at login).
export type StepApprover = { approverType: 'ROLE' | 'USER'; roleId: number | null; userId: number | null };
export type Actor = { id: number; roleId: number; active: boolean };

// A step lists one or more approvers (roles and/or users, mixed); ANY ONE of
// them may decide it.
export function isStepApprover(approvers: readonly StepApprover[], actor: Actor): boolean {
  if (!actor.active) return false;
  return approvers.some((approver) => (approver.approverType === 'ROLE' ? approver.roleId === actor.roleId : approver.userId === actor.id));
}

export const WORKFLOW_DOCUMENT_TYPE_LABELS_FA: Record<string, string> = {
  PURCHASE: 'خرید',
  SALES_ORDER: 'سفارش فروش',
  PURCHASE_REQUEST: 'درخواست خرید',
};

// The permission that opens each document's detail page — an approver without
// it can't reach the buttons, so the rule editor warns about it.
export const DOCUMENT_VIEW_PERMISSION: Record<string, string> = {
  PURCHASE: 'purchases.view',
  SALES_ORDER: 'sales.view',
  PURCHASE_REQUEST: 'purchases.view',
};
