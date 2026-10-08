import { ConflictException } from '@nestjs/common';
import type { SalesOrderStatus, SalesReturnStatus } from '@prisma/client';
import { ALLOWED_SALES_ORDER_STATUS_TRANSITIONS, ALLOWED_SALES_RETURN_STATUS_TRANSITIONS, ensureSalesOrderTransition, ensureSalesReturnTransition } from './sales-rules';

// The SalesOrder.status matrix from docs/sales-module-build-plan.md §5.
describe('sales-rules — SalesOrder status transitions', () => {
  const valid: [SalesOrderStatus, SalesOrderStatus][] = [
    ['DRAFT', 'PENDING_APPROVAL'],
    ['DRAFT', 'CONFIRMED'],
    ['PENDING_APPROVAL', 'CONFIRMED'],
    ['PENDING_APPROVAL', 'DRAFT'],
    ['CONFIRMED', 'COMPLETED'],
    ['CONFIRMED', 'CLOSED'],
    ['CONFIRMED', 'CANCELLED'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => ensureSalesOrderTransition(from, to)).not.toThrow();
  });

  const invalid: [SalesOrderStatus, SalesOrderStatus][] = [
    ['DRAFT', 'CANCELLED'], // a draft is deleted, never cancelled
    ['DRAFT', 'CLOSED'],
    ['DRAFT', 'DRAFT'],
    ['PENDING_APPROVAL', 'CANCELLED'],
    ['CONFIRMED', 'DRAFT'], // PENDING_APPROVAL → DRAFT is the only way back
    ['CONFIRMED', 'PENDING_APPROVAL'],
    ['COMPLETED', 'CLOSED'],
    ['CLOSED', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],
  ];

  it.each(invalid)('refuses %s → %s with a Persian 409', (from, to) => {
    expect(() => ensureSalesOrderTransition(from, to)).toThrow(ConflictException);
    expect(() => ensureSalesOrderTransition(from, to)).toThrow('مجاز نیست');
  });

  it('COMPLETED, CLOSED and CANCELLED are terminal', () => {
    expect(ALLOWED_SALES_ORDER_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ALLOWED_SALES_ORDER_STATUS_TRANSITIONS.CLOSED).toEqual([]);
    expect(ALLOWED_SALES_ORDER_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

// The SalesReturn.status matrix from docs/sales-module-build-plan.md §5.
describe('sales-rules — SalesReturn status transitions', () => {
  const valid: [SalesReturnStatus, SalesReturnStatus][] = [
    ['REQUESTED', 'APPROVED'],
    ['REQUESTED', 'REJECTED'],
    ['REQUESTED', 'CANCELLED'],
    ['APPROVED', 'RECEIVED'],
    ['APPROVED', 'CANCELLED'],
    ['RECEIVED', 'INSPECTED'],
    ['INSPECTED', 'COMPLETED'],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => ensureSalesReturnTransition(from, to)).not.toThrow();
  });

  const invalid: [SalesReturnStatus, SalesReturnStatus][] = [
    ['REQUESTED', 'RECEIVED'],
    ['REQUESTED', 'INSPECTED'],
    ['APPROVED', 'REJECTED'],
    ['APPROVED', 'INSPECTED'],
    ['RECEIVED', 'CANCELLED'],
    ['RECEIVED', 'COMPLETED'],
    ['INSPECTED', 'CANCELLED'],
    ['COMPLETED', 'CANCELLED'],
    ['REJECTED', 'REQUESTED'],
    ['CANCELLED', 'REQUESTED'],
  ];

  it.each(invalid)('refuses %s → %s with a Persian 409', (from, to) => {
    expect(() => ensureSalesReturnTransition(from, to)).toThrow(ConflictException);
    expect(() => ensureSalesReturnTransition(from, to)).toThrow('مجاز نیست');
  });

  it('REJECTED, COMPLETED and CANCELLED are terminal', () => {
    expect(ALLOWED_SALES_RETURN_STATUS_TRANSITIONS.REJECTED).toEqual([]);
    expect(ALLOWED_SALES_RETURN_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ALLOWED_SALES_RETURN_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });
});
