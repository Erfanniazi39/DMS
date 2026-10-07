import { createItemSchema, updateItemSchema } from './item.dto';

// Characterization tests — pin the Item DTO's current validation so
// shared-helper refactors can't silently change it.

const validItem = { code: 'ITM-1', name: 'کالای نمونه', categoryId: 1, unitId: 2 };

describe('createItemSchema', () => {
  it('accepts a minimal valid item and defaults status to active', () => {
    const result = createItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('active');
  });

  it('turns blank optional strings into undefined and trims the rest', () => {
    const result = createItemSchema.safeParse({ ...validItem, description: '   ', note: '  یادداشت  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.note).toBe('یادداشت');
    }
  });

  it('rejects missing references and over-long text', () => {
    expect(createItemSchema.safeParse({ ...validItem, categoryId: undefined }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...validItem, unitId: 0 }).success).toBe(false);
    expect(createItemSchema.safeParse({ ...validItem, description: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('createItemSchema sellingPrice', () => {
  it('is optional; blank/null mean "no default price"', () => {
    for (const sellingPrice of [undefined, null, '', '  ']) {
      const result = createItemSchema.safeParse({ ...validItem, sellingPrice });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sellingPrice).toBeUndefined();
    }
  });

  it('accepts a whole-Rial amount (number or numeric string), including 0', () => {
    const result = createItemSchema.safeParse({ ...validItem, sellingPrice: '125000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sellingPrice).toBe(125000);
    expect(createItemSchema.safeParse({ ...validItem, sellingPrice: 0 }).success).toBe(true);
  });

  it('rejects negative, fractional, oversized, or non-numeric prices', () => {
    for (const sellingPrice of [-1, 10.5, 1e16, true, 'abc']) {
      expect(createItemSchema.safeParse({ ...validItem, sellingPrice }).success).toBe(false);
    }
  });
});

describe('updateItemSchema', () => {
  it('requires an explicit valid status', () => {
    expect(updateItemSchema.safeParse({ ...validItem, status: 'inactive' }).success).toBe(true);
    expect(updateItemSchema.safeParse(validItem).success).toBe(false);
  });
});
