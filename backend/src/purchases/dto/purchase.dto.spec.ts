import {
  createPurchasePaymentSchema,
  createPurchaseReturnSchema,
  createPurchaseSchema,
  purchaseListQuerySchema,
  updatePurchasePaymentSchema,
  updatePurchaseSchema,
} from './purchase.dto';

// Request-body validation for the Purchases module, tested against the
// business rules (CLAUDE.md rules 5/6, purchase-module-workflow.md §5) rather
// than whatever Zod happens to accept. Added in the QA pass of 2026-10-05.

const item = { name: 'شیر خام', quantity: 10, unitId: 6, totalPrice: 2500000 };

function purchase(overrides: Record<string, unknown> = {}, itemOverrides: Record<string, unknown> = {}) {
  return {
    purchaseDate: '2026-10-02',
    purchaseTypeId: 1,
    requesterDepartmentId: 1,
    buyerEmployeeId: 1,
    supplierId: 1,
    items: [{ ...item, ...itemOverrides }],
    ...overrides,
  };
}

describe('createPurchaseSchema', () => {
  it('accepts a normal operational purchase with Persian free-text item names', () => {
    expect(createPurchaseSchema.safeParse(purchase()).success).toBe(true);
  });

  it('never accepts derived or server-generated fields from the client — they are stripped', () => {
    const result = createPurchaseSchema.safeParse(
      purchase({ purchaseNumber: 'PUR-999999', totalAmount: 1, paidAmount: 999, paymentStatus: 'PAID', id: 77 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // (status is no longer stripped on create — it's an accepted field
      // restricted to DRAFT/CONFIRMED; see the "creation status" tests.)
      for (const key of ['purchaseNumber', 'totalAmount', 'paidAmount', 'paymentStatus', 'id']) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });

  it('does NOT enforce totalPrice = quantity × unitPrice (explicit business rule)', () => {
    const result = createPurchaseSchema.safeParse(purchase({}, { quantity: 10, unitPrice: 1000, totalPrice: 7500 }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0].totalPrice).toBe(7500);
  });

  it('treats unitPrice as optional (lump-sum lines) but totalPrice as required', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { unitPrice: '' })).success).toBe(true);
    const { totalPrice: _omit, ...withoutTotal } = item;
    expect(createPurchaseSchema.safeParse({ ...purchase(), items: [withoutTotal] }).success).toBe(false);
  });

  it('accepts a PurchaseItem name with no link to the Item master table (no itemId field exists)', () => {
    const result = createPurchaseSchema.safeParse(purchase({}, { name: 'دستگاه پاستوریزاتور', itemId: 3 }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0]).not.toHaveProperty('itemId');
  });

  it('requires department and buyer for an OPERATIONAL purchase, but not for a HISTORICAL_IMPORT one', () => {
    const bare = { purchaseDate: '2026-10-02', purchaseTypeId: 1, supplierId: 1, items: [item] };
    const operational = createPurchaseSchema.safeParse(bare);
    expect(operational.success).toBe(false);
    if (!operational.success) {
      expect(operational.error.flatten().fieldErrors).toMatchObject({
        requesterDepartmentId: ['دپارتمان درخواست‌کننده را انتخاب کنید'],
        buyerEmployeeId: ['کارمند خریدار را انتخاب کنید'],
      });
    }
    expect(createPurchaseSchema.safeParse({ ...bare, sourceType: 'HISTORICAL_IMPORT' }).success).toBe(true);
  });

  it.each([
    ['no items', { items: [] }, {}],
    ['negative totalPrice', {}, { totalPrice: -1 }],
    ['zero quantity', {}, { quantity: 0 }],
    ['blank item name', {}, { name: '   ' }],
    ['item name over 150 chars', {}, { name: 'ش'.repeat(151) }],
    ['unparseable date', { purchaseDate: 'abc' }, {}],
    ['note over 1000 chars', { note: 'x'.repeat(1001) }, {}],
  ])('rejects %s', (_label, overrides, itemOverrides) => {
    expect(createPurchaseSchema.safeParse(purchase(overrides, itemOverrides)).success).toBe(false);
  });

  // --- Regression tests for bugs found in QA 2026-10-05 — originally
  // `it.failing`, converted to plain `it` once fixed.

  it('KNOWN BUG: rejects a fractional Rial totalPrice (column is Decimal(15,0); 1500.7 is silently stored as 1501)', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { totalPrice: 1500.7 })).success).toBe(false);
  });

  it('KNOWN BUG: rejects an empty-string totalPrice instead of coercing it to 0', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { totalPrice: '' })).success).toBe(false);
  });

  it('KNOWN BUG: rejects a null totalPrice instead of coercing it to 0', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { totalPrice: null })).success).toBe(false);
  });

  it('KNOWN BUG: rejects a null purchaseDate instead of coercing it to 1970-01-01', () => {
    expect(createPurchaseSchema.safeParse(purchase({ purchaseDate: null })).success).toBe(false);
  });

  it('KNOWN BUG: rejects a quantity that rounds to 0.00 in Decimal(12,2) (e.g. 0.001)', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { quantity: 0.001 })).success).toBe(false);
  });

  it('KNOWN BUG: rejects a totalPrice wider than Decimal(15,0) with a validation error instead of a DB 500', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { totalPrice: 1_000_000_000_000_000 })).success).toBe(false);
  });

  it('KNOWN BUG: rejects a boolean quantity instead of coercing true → 1', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { quantity: true })).success).toBe(false);
  });
});

describe('updatePurchaseSchema', () => {
  it('requires a status on update and strips derived money fields', () => {
    expect(updatePurchaseSchema.safeParse(purchase({ updatedAt: '2026-10-05T08:00:00.000Z' })).success).toBe(false);
    const result = updatePurchaseSchema.safeParse(purchase({ status: 'RECEIVED', updatedAt: '2026-10-05T08:00:00.000Z', paymentStatus: 'PAID', totalAmount: 1 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('paymentStatus');
      expect(result.data).not.toHaveProperty('totalAmount');
    }
  });
});

describe('createPurchasePaymentSchema', () => {
  const payment = { amount: 50000000, paymentDate: '2026-10-03', method: 'BANK_TRANSFER' };

  // Business decision 2026-10-05 (was PENDING): only COMPLETED payments count
  // toward paidAmount, and recording money already paid is the common case.
  it('defaults a new payment to COMPLETED', () => {
    const result = createPurchasePaymentSchema.safeParse(payment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('COMPLETED');
  });

  it('strips a client-supplied purchaseId (the URL decides which purchase is paid)', () => {
    const result = createPurchasePaymentSchema.safeParse({ ...payment, purchaseId: 999 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('purchaseId');
  });

  it.each([0, -5])('rejects a non-positive amount (%d)', (amount) => {
    expect(createPurchasePaymentSchema.safeParse({ ...payment, amount }).success).toBe(false);
  });

  it('rejects an unknown payment method', () => {
    expect(createPurchasePaymentSchema.safeParse({ ...payment, method: 'BITCOIN' }).success).toBe(false);
  });

  it('KNOWN BUG: rejects a sub-Rial amount (0.4 is stored as a 0-Rial COMPLETED payment)', () => {
    expect(createPurchasePaymentSchema.safeParse({ ...payment, amount: 0.4 }).success).toBe(false);
  });

  it('KNOWN BUG: rejects a null paymentDate instead of coercing it to 1970-01-01', () => {
    expect(createPurchasePaymentSchema.safeParse({ ...payment, paymentDate: null }).success).toBe(false);
  });
});

describe('createPurchaseReturnSchema', () => {
  const ret = { returnDate: '2026-10-05', reason: 'خامه فاسد شده', items: [{ purchaseItemId: 1, quantity: 2, creditAmount: 1800000 }] };

  it('never accepts a client-supplied returnNumber', () => {
    const result = createPurchaseReturnSchema.safeParse({ ...ret, returnNumber: 'RTN-999999' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('returnNumber');
  });

  it('requires a non-blank reason and at least one line', () => {
    expect(createPurchaseReturnSchema.safeParse({ ...ret, reason: '  ' }).success).toBe(false);
    expect(createPurchaseReturnSchema.safeParse({ ...ret, items: [] }).success).toBe(false);
  });

  it('KNOWN BUG: rejects a return quantity that rounds to 0.00 (0.004 is stored as a zero-quantity return line)', () => {
    expect(createPurchaseReturnSchema.safeParse({ ...ret, items: [{ purchaseItemId: 1, quantity: 0.004, creditAmount: 0 }] }).success).toBe(false);
  });
});

// --- More QA 2026-10-05 regression coverage --------------------------------

// Every message a client can receive from these schemas must be Persian
// (CLAUDE.md: user-facing backend errors are Persian). "Persian" here = the
// message contains Arabic-script letters and no run of 3+ Latin letters
// (so "Invalid input: expected date…" / "Too big…" fail, while a message
// mentioning a format like "PDF" or "jpg" would still be caught deliberately).
function allMessages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => issue.message);
}
function expectPersian(messages: string[]) {
  expect(messages.length).toBeGreaterThan(0);
  for (const message of messages) {
    expect(message).toMatch(/[\u0600-\u06FF]/);
    expect(message).not.toMatch(/[A-Za-z]{3,}/);
  }
}

describe('Persian validation messages (no English Zod defaults leak through)', () => {
  it.each([
    ['null date', { purchaseDate: null }, {}],
    ['garbage date', { purchaseDate: 'abc' }, {}],
    ['boolean id', { purchaseTypeId: true }, {}],
    ['unknown sourceType', { sourceType: 'FOO' }, {}],
    ['huge totalPrice', {}, { totalPrice: 1e18 }],
    ['fractional totalPrice', {}, { totalPrice: 10.5 }],
    ['3-decimal quantity', {}, { quantity: 1.005 }],
    ['non-string name', {}, { name: 42 }],
    ['over-long name', {}, { name: 'x'.repeat(151) }],
    ['items not an array', { items: 'abc' }, {}],
  ])('createPurchaseSchema: %s', (_label, overrides, itemOverrides) => {
    expectPersian(allMessages(createPurchaseSchema.safeParse(purchase(overrides, itemOverrides))));
  });

  it('createPurchaseSchema: a non-object body', () => {
    expectPersian(allMessages(createPurchaseSchema.safeParse('nope')));
  });

  it('updatePurchaseSchema: unknown status', () => {
    expectPersian(allMessages(updatePurchaseSchema.safeParse(purchase({ status: 'FOO', updatedAt: '2026-10-05T08:00:00.000Z' }))));
  });

  it('createPurchasePaymentSchema: bad method / status / date / amount', () => {
    expectPersian(
      allMessages(createPurchasePaymentSchema.safeParse({ amount: 'x', paymentDate: 0, method: 'BITCOIN', status: 'MAYBE', referenceNumber: 'r'.repeat(61) })),
    );
  });
});

describe('strict numeric/date parsing', () => {
  it('still accepts numeric strings and ISO date strings from form posts', () => {
    const result = createPurchaseSchema.safeParse(purchase({ purchaseTypeId: '1', supplierId: '1' }, { quantity: '12.50', totalPrice: '2500000', unitPrice: '' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].quantity).toBe(12.5);
      expect(result.data.items[0].unitPrice).toBeUndefined();
      expect(result.data.purchaseDate).toEqual(new Date('2026-10-02'));
    }
  });

  it('accepts the smallest storable quantity (0.01) and the largest storable money value', () => {
    expect(createPurchaseSchema.safeParse(purchase({}, { quantity: 0.01, totalPrice: 999_999_999_999_999 })).success).toBe(true);
  });

  it.each([
    ['a numeric timestamp date (0 → 1970-01-01)', { purchaseDate: 0 }, {}],
    ['a fractional unitPrice', {}, { unitPrice: 0.4 }],
    ['a boolean unitId', {}, { unitId: true }],
    ['a null supplierId', { supplierId: null }, {}],
  ])('rejects %s', (_label, overrides, itemOverrides) => {
    expect(createPurchaseSchema.safeParse(purchase(overrides, itemOverrides)).success).toBe(false);
  });

  it('rejects a fractional credit amount on a return line', () => {
    expect(createPurchaseReturnSchema.safeParse({ returnDate: '2026-10-05', reason: 'x', items: [{ purchaseItemId: 1, quantity: 1, creditAmount: 10.5 }] }).success).toBe(false);
  });
});

describe('purchaseListQuerySchema (GET /purchases filters)', () => {
  it('treats blank values as "no filter" and parses valid ones', () => {
    const result = purchaseListQuerySchema.safeParse({ status: '', paymentStatus: '', sourceType: '', supplierId: '', dateFrom: '', q: '', page: '2' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ status: undefined, paymentStatus: undefined, sourceType: undefined, supplierId: undefined, dateFrom: undefined, page: '2' });
    }
    const valid = purchaseListQuerySchema.safeParse({ status: 'RECEIVED', paymentStatus: 'PARTIAL', sourceType: 'HISTORICAL_IMPORT', supplierId: '4', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.supplierId).toBe(4);
  });

  it.each([
    ['status=FOO', { status: 'FOO' }],
    ['paymentStatus=FOO', { paymentStatus: 'FOO' }],
    ['sourceType=FOO', { sourceType: 'FOO' }],
    ['dateFrom=abc', { dateFrom: 'abc' }],
    ['dateTo=2026-13-45', { dateTo: '2026-13-45' }],
    ['supplierId=abc', { supplierId: 'abc' }],
    ['purchaseTypeId=-1', { purchaseTypeId: '-1' }],
    ['a repeated status param', { status: ['DRAFT', 'CLOSED'] }],
  ])('rejects %s with a Persian 400 message instead of a raw 500 / silent ignore', (_label, query) => {
    const result = purchaseListQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
    expectPersian(allMessages(result));
  });
});

// --- Business-owner decisions of 2026-10-05 ---------------------------------

describe('#4 business date range (Jalali 1300–1499 ≈ 1921-03-21 … 2121-03-20)', () => {
  it.each([
    ['year 9999', '9999-12-31'],
    ['a Jalali year typed into the Gregorian field', '1404-01-01'],
    ['the day before 1300/01/01', '1921-03-20'],
    ['1500/01/01 Jalali', '2121-03-21'],
  ])('rejects %s on purchaseDate with a Persian message', (_label, purchaseDate) => {
    const result = createPurchaseSchema.safeParse(purchase({ purchaseDate }));
    expect(result.success).toBe(false);
    expectPersian(allMessages(result));
  });

  it.each(['1921-03-21', '2121-03-20', '2026-10-05'])('accepts %s', (purchaseDate) => {
    expect(createPurchaseSchema.safeParse(purchase({ purchaseDate })).success).toBe(true);
  });

  it('applies the same range to payment, return and document dates (future post-dated cheques allowed)', () => {
    const payment = { amount: 1000, method: 'CHECK' };
    expect(createPurchasePaymentSchema.safeParse({ ...payment, paymentDate: '2030-01-01' }).success).toBe(true);
    expect(createPurchasePaymentSchema.safeParse({ ...payment, paymentDate: '9999-01-01' }).success).toBe(false);
    expect(createPurchaseReturnSchema.safeParse({ returnDate: '9999-01-01', reason: 'x', items: [{ purchaseItemId: 1, quantity: 1, creditAmount: 1 }] }).success).toBe(false);
  });

  it('does NOT apply the range to list filters (they are not entered business dates)', () => {
    expect(purchaseListQuerySchema.safeParse({ dateTo: '9999-12-31' }).success).toBe(true);
  });
});

describe('#5 confirmOverage flag', () => {
  it('defaults to false and accepts only a real boolean', () => {
    const result = createPurchaseSchema.safeParse(purchase());
    expect(result.success && result.data.confirmOverage).toBe(false);
    expect(createPurchaseSchema.safeParse(purchase({ confirmOverage: true })).success).toBe(true);
    expect(createPurchaseSchema.safeParse(purchase({ confirmOverage: 'yes' })).success).toBe(false);
  });
});

describe('#7 payments: default status and the edit schema', () => {
  it('updatePurchasePaymentSchema requires an explicit status (an edit never silently flips PENDING → COMPLETED)', () => {
    const payment = { amount: 1000, paymentDate: '2026-10-05', method: 'CASH' };
    expect(updatePurchasePaymentSchema.safeParse(payment).success).toBe(false);
    expect(updatePurchasePaymentSchema.safeParse({ ...payment, status: 'PENDING' }).success).toBe(true);
  });
});

describe('#12 updatePurchaseSchema requires the optimistic-locking token', () => {
  it('rejects an update without updatedAt (in Persian) and parses it into a Date when present', () => {
    const missing = updatePurchaseSchema.safeParse(purchase({ status: 'RECEIVED' }));
    expect(missing.success).toBe(false);
    expectPersian(allMessages(missing));
    const ok = updatePurchaseSchema.safeParse(purchase({ status: 'RECEIVED', updatedAt: '2026-10-05T08:00:00.123Z' }));
    expect(ok.success && ok.data.updatedAt.getTime()).toBe(new Date('2026-10-05T08:00:00.123Z').getTime());
  });
});

describe('creation status (business decision 2026-10-05: new purchases default to CONFIRMED)', () => {
  it('defaults a new purchase to CONFIRMED when no status is sent', () => {
    const result = createPurchaseSchema.safeParse(purchase());
    expect(result.success && result.data.status).toBe('CONFIRMED');
  });

  it('still allows explicitly creating a DRAFT (staging an unfinished entry)', () => {
    const result = createPurchaseSchema.safeParse(purchase({ status: 'DRAFT' }));
    expect(result.success && result.data.status).toBe('DRAFT');
  });

  it.each(['RECEIVED', 'CLOSED', 'CANCELLED', 'FOO'])('refuses creating a purchase directly as %s, in Persian', (status) => {
    const result = createPurchaseSchema.safeParse(purchase({ status }));
    expect(result.success).toBe(false);
    expectPersian(allMessages(result));
  });

  it('update keeps accepting every status (RECEIVED/CLOSED/CANCELLED are normal later transitions)', () => {
    expect(updatePurchaseSchema.safeParse(purchase({ status: 'CLOSED', updatedAt: '2026-10-05T08:00:00.000Z' })).success).toBe(true);
  });
});

