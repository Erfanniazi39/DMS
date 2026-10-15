import { findMatchingRule, isStepApprover, ruleMatches, type MatchableRule } from './workflow-rules';

function rule(overrides: Partial<MatchableRule> = {}): MatchableRule {
  return {
    id: 1,
    isActive: true,
    sortOrder: 1,
    purchaseTypeId: null,
    supplierId: null,
    requesterDepartmentId: null,
    amountBasis: 'TOTAL',
    minAmount: null,
    maxAmount: null,
    ...overrides,
  };
}

describe('ruleMatches', () => {
  it('matches anything when the rule has no scope and no band', () => {
    expect(ruleMatches(rule(), { amountTotal: 5 })).toBe(true);
  });

  it('never matches an inactive rule', () => {
    expect(ruleMatches(rule({ isActive: false }), { amountTotal: 5 })).toBe(false);
  });

  it('requires every scope field the rule sets to equal the fact', () => {
    const r = rule({ purchaseTypeId: 3, supplierId: 7 });
    expect(ruleMatches(r, { purchaseTypeId: 3, supplierId: 7 })).toBe(true);
    expect(ruleMatches(r, { purchaseTypeId: 3, supplierId: 8 })).toBe(false);
    expect(ruleMatches(r, { purchaseTypeId: 3 })).toBe(false);
  });

  it('treats the band as [min, max): min inclusive, max exclusive', () => {
    const r = rule({ minAmount: 100, maxAmount: 200 });
    expect(ruleMatches(r, { amountTotal: 99 })).toBe(false);
    expect(ruleMatches(r, { amountTotal: 100 })).toBe(true);
    expect(ruleMatches(r, { amountTotal: 199 })).toBe(true);
    expect(ruleMatches(r, { amountTotal: 200 })).toBe(false);
  });

  it('supports open-ended bands and Decimal-like bounds', () => {
    expect(ruleMatches(rule({ minAmount: { toString: () => '1000000000' } }), { amountTotal: 5_000_000_000 })).toBe(true);
    expect(ruleMatches(rule({ maxAmount: 50 }), { amountTotal: 10 })).toBe(true);
  });

  it('uses the amount basis the rule names', () => {
    const facts = { amountTotal: 100, maxLineTotal: 900, maxUnitPrice: 40 };
    expect(ruleMatches(rule({ amountBasis: 'ANY_LINE_TOTAL', minAmount: 500 }), facts)).toBe(true);
    expect(ruleMatches(rule({ amountBasis: 'ANY_UNIT_PRICE', minAmount: 500 }), facts)).toBe(false);
    expect(ruleMatches(rule({ amountBasis: 'TOTAL', minAmount: 500 }), facts)).toBe(false);
  });

  it('a band rule never matches when the basis amount is unknown', () => {
    expect(ruleMatches(rule({ amountBasis: 'ANY_UNIT_PRICE', minAmount: 1 }), { amountTotal: 100, maxUnitPrice: null })).toBe(false);
    // ...but a band-less rule still does.
    expect(ruleMatches(rule({ amountBasis: 'ANY_UNIT_PRICE' }), { amountTotal: 100 })).toBe(true);
  });
});

describe('discount condition (sales orders)', () => {
  it('needs a discount: 0 = any discount, N = at least N percent on some line; a discount-free order never matches', () => {
    const anyDiscount = rule({ minDiscountPercent: 0 });
    expect(ruleMatches(anyDiscount, { amountTotal: 5, maxDiscountPercent: 0.5 })).toBe(true);
    expect(ruleMatches(anyDiscount, { amountTotal: 5, maxDiscountPercent: 0 })).toBe(false);
    expect(ruleMatches(anyDiscount, { amountTotal: 5 })).toBe(false);
    const atLeastTen = rule({ minDiscountPercent: { toString: () => '10.00' } });
    expect(ruleMatches(atLeastTen, { maxDiscountPercent: 9.99 })).toBe(false);
    expect(ruleMatches(atLeastTen, { maxDiscountPercent: 10 })).toBe(true);
  });

  it('combines with an amount band; no discount condition ignores discounts entirely', () => {
    const both = rule({ minDiscountPercent: 5, minAmount: 1000 });
    expect(ruleMatches(both, { amountTotal: 2000, maxDiscountPercent: 6 })).toBe(true);
    expect(ruleMatches(both, { amountTotal: 500, maxDiscountPercent: 6 })).toBe(false);
    expect(ruleMatches(rule(), { amountTotal: 1, maxDiscountPercent: 0 })).toBe(true);
  });
});

describe('findMatchingRule', () => {
  it('returns the first match by sortOrder, so the higher band must come first', () => {
    const high = rule({ id: 2, sortOrder: 1, minAmount: 1_000 });
    const low = rule({ id: 1, sortOrder: 2, minAmount: 100 });
    expect(findMatchingRule([low, high], { amountTotal: 5_000 })?.id).toBe(2);
    expect(findMatchingRule([low, high], { amountTotal: 500 })?.id).toBe(1);
  });

  it('breaks sortOrder ties by id and returns null with no match', () => {
    expect(findMatchingRule([rule({ id: 9 }), rule({ id: 4 })], {})?.id).toBe(4);
    expect(findMatchingRule([rule({ minAmount: 10 })], { amountTotal: 1 })).toBeNull();
  });
});

describe('isStepApprover', () => {
  const role5 = { approverType: 'ROLE' as const, roleId: 5, userId: null };
  const user9 = { approverType: 'USER' as const, roleId: null, userId: 9 };

  it('a ROLE approver accepts any active user holding the role', () => {
    expect(isStepApprover([role5], { id: 1, roleId: 5, active: true })).toBe(true);
    expect(isStepApprover([role5], { id: 1, roleId: 6, active: true })).toBe(false);
  });

  it('a USER approver accepts only that user, and a disabled user never qualifies', () => {
    expect(isStepApprover([user9], { id: 9, roleId: 1, active: true })).toBe(true);
    expect(isStepApprover([user9], { id: 10, roleId: 1, active: true })).toBe(false);
    expect(isStepApprover([user9], { id: 9, roleId: 1, active: false })).toBe(false);
  });

  it('a step with several approvers accepts any one of them (roles and users mixed)', () => {
    const approvers = [user9, { approverType: 'USER' as const, roleId: null, userId: 11 }, role5];
    expect(isStepApprover(approvers, { id: 9, roleId: 1, active: true })).toBe(true);
    expect(isStepApprover(approvers, { id: 11, roleId: 1, active: true })).toBe(true);
    expect(isStepApprover(approvers, { id: 20, roleId: 5, active: true })).toBe(true);
    expect(isStepApprover(approvers, { id: 20, roleId: 6, active: true })).toBe(false);
    expect(isStepApprover([], { id: 9, roleId: 5, active: true })).toBe(false);
  });
});
