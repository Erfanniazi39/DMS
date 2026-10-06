import { createPurchaseRequestSchema, purchaseRequestListQuerySchema, updatePurchaseRequestSchema } from './purchase-request.dto';

// Request-body validation for Purchase Requests, tested against the business
// rules rather than whatever Zod happens to accept. Added in the QA pass of
// 2026-10-05.

// The optimistic-locking token an update must carry (business decision 2026-10-05).
const VERSION = '2026-10-05T08:00:00.000Z';

const request = {
  requestDate: '2026-10-01',
  purchaseTypeId: 2,
  requesterDepartmentId: 1,
  priority: 'HIGH',
  items: [{ name: 'شیر خام', quantity: 1000, unitId: 6 }],
};

describe('createPurchaseRequestSchema', () => {
  it('accepts a request with Persian free-text item names and no named employee', () => {
    expect(createPurchaseRequestSchema.safeParse(request).success).toBe(true);
  });

  it('strips client-supplied status / requestNumber / createdByUserId (new requests always start DRAFT, numbers are server-generated)', () => {
    const result = createPurchaseRequestSchema.safeParse({ ...request, status: 'COMPLETED', requestNumber: 'REQ-999999', createdByUserId: 3 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('status');
      expect(result.data).not.toHaveProperty('requestNumber');
      expect(result.data).not.toHaveProperty('createdByUserId');
    }
  });

  it('defaults priority to NORMAL and rejects unknown priorities', () => {
    const { priority: _omit, ...withoutPriority } = request;
    const result = createPurchaseRequestSchema.safeParse(withoutPriority);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe('NORMAL');
    expect(createPurchaseRequestSchema.safeParse({ ...request, priority: 'ASAP' }).success).toBe(false);
  });

  it.each([
    ['no department', { requesterDepartmentId: undefined }],
    ['no purchase type', { purchaseTypeId: undefined }],
    ['zero purchase type', { purchaseTypeId: 0 }],
    ['no items', { items: [] }],
    ['zero quantity', { items: [{ name: 'شیر', quantity: 0, unitId: 6 }] }],
    ['blank item name', { items: [{ name: ' ', quantity: 1, unitId: 6 }] }],
  ])('rejects %s', (_label, overrides) => {
    expect(createPurchaseRequestSchema.safeParse({ ...request, ...overrides }).success).toBe(false);
  });

  it('KNOWN BUG: rejects a null requestDate instead of coercing it to 1970-01-01', () => {
    expect(createPurchaseRequestSchema.safeParse({ ...request, requestDate: null }).success).toBe(false);
  });

  it('KNOWN BUG: rejects a quantity that rounds to 0.00 in Decimal(12,2) (e.g. 0.001)', () => {
    expect(createPurchaseRequestSchema.safeParse({ ...request, items: [{ name: 'شیر', quantity: 0.001, unitId: 6 }] }).success).toBe(false);
  });
});

describe('updatePurchaseRequestSchema', () => {
  it('requires an explicit status on update', () => {
    expect(updatePurchaseRequestSchema.safeParse({ ...request, updatedAt: VERSION }).success).toBe(false);
    expect(updatePurchaseRequestSchema.safeParse({ ...request, status: 'APPROVED', updatedAt: VERSION }).success).toBe(true);
  });
});

// --- More QA 2026-10-05 regression coverage --------------------------------

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => issue.message);
}
function expectPersian(list: string[]) {
  expect(list.length).toBeGreaterThan(0);
  for (const message of list) {
    expect(message).toMatch(/[\u0600-\u06FF]/);
    expect(message).not.toMatch(/[A-Za-z]{3,}/);
  }
}

describe('purchase request validation — strictness and Persian messages', () => {
  it.each([
    ['null requestDate', { requestDate: null }],
    ['numeric requestDate', { requestDate: 0 }],
    ['unknown priority', { priority: 'ASAP' }],
    ['boolean department', { requesterDepartmentId: true }],
    ['bad requiredDate', { items: [{ name: 'شیر', quantity: 1, unitId: 6, requiredDate: 'abc' }] }],
    ['3-decimal quantity', { items: [{ name: 'شیر', quantity: 1.005, unitId: 6 }] }],
    ['boolean quantity', { items: [{ name: 'شیر', quantity: true, unitId: 6 }] }],
  ])('rejects %s with Persian messages', (_label, overrides) => {
    const result = createPurchaseRequestSchema.safeParse({ ...request, ...overrides });
    expect(result.success).toBe(false);
    expectPersian(messages(result));
  });

  it('update: an unknown status is rejected in Persian; an optional line id is accepted for diffing', () => {
    expectPersian(messages(updatePurchaseRequestSchema.safeParse({ ...request, status: 'FOO', updatedAt: VERSION })));
    const result = updatePurchaseRequestSchema.safeParse({ ...request, status: 'APPROVED', updatedAt: VERSION, items: [{ id: '501', name: 'شیر', quantity: '10', unitId: 6 }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0].id).toBe(501);
  });
});

describe('purchaseRequestListQuerySchema (GET /purchase-requests filters)', () => {
  it('treats blank values as "no filter"', () => {
    expect(purchaseRequestListQuerySchema.safeParse({ status: '', priority: '', requesterDepartmentId: '' }).success).toBe(true);
  });

  it.each([
    ['status=FOO', { status: 'FOO' }],
    ['status=FOO&priority=ZZ', { status: 'FOO', priority: 'ZZ' }],
    ['requesterDepartmentId=abc', { requesterDepartmentId: 'abc' }],
  ])('rejects %s with a Persian 400 instead of a raw 500', (_label, query) => {
    const result = purchaseRequestListQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
    expectPersian(messages(result));
  });
});

// --- Business-owner decisions of 2026-10-05 ---------------------------------

describe('#4 request dates', () => {
  it('rejects a line requiredDate before the requestDate (same day is fine), in Persian, on create and update', () => {
    const before = { ...request, items: [{ name: 'شیر', quantity: 1, unitId: 6, requiredDate: '2026-09-30' }] };
    const result = createPurchaseRequestSchema.safeParse(before);
    expect(result.success).toBe(false);
    expectPersian(messages(result));
    expect(updatePurchaseRequestSchema.safeParse({ ...before, status: 'APPROVED', updatedAt: VERSION }).success).toBe(false);
    expect(createPurchaseRequestSchema.safeParse({ ...request, items: [{ name: 'شیر', quantity: 1, unitId: 6, requiredDate: '2026-10-01' }] }).success).toBe(true);
  });

  it.each(['9999-01-01', '1404-07-13'])('rejects an implausible requestDate / requiredDate (%s)', (date) => {
    expect(createPurchaseRequestSchema.safeParse({ ...request, requestDate: date }).success).toBe(false);
    expect(createPurchaseRequestSchema.safeParse({ ...request, items: [{ name: 'شیر', quantity: 1, unitId: 6, requiredDate: date }] }).success).toBe(false);
  });
});

describe('#12 updatePurchaseRequestSchema requires the optimistic-locking token', () => {
  it('rejects an update without updatedAt', () => {
    expect(updatePurchaseRequestSchema.safeParse({ ...request, status: 'APPROVED' }).success).toBe(false);
  });
});
