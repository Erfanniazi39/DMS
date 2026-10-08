import { createDeliverySchema, deliveryListQuerySchema, postDeliverySchema, updateDeliverySchema } from './delivery.dto';

const base = { salesOrderId: 11, deliveryDate: '2026-10-06' };

describe('delivery DTOs', () => {
  it('accepts a create with no lines (prefill from the order); client-only fields are stripped', () => {
    const parsed = createDeliverySchema.parse({ ...base, deliveryNumber: 'DN-1', status: 'POSTED', customerId: 3, locationId: 2, deliveryAddressText: 'x' });
    expect(parsed.items).toBeUndefined();
    for (const key of ['deliveryNumber', 'status', 'customerId', 'locationId', 'deliveryAddressText']) expect(parsed).not.toHaveProperty(key);
  });

  it('refuses duplicate order lines, zero / negative / 3-decimal quantities, and an empty line list', () => {
    expect(createDeliverySchema.safeParse({ ...base, items: [{ salesOrderItemId: 1, quantity: 1 }, { salesOrderItemId: 1, quantity: 2 }] }).success).toBe(false);
    for (const quantity of [0, -1, 1.005, '']) {
      expect(createDeliverySchema.safeParse({ ...base, items: [{ salesOrderItemId: 1, quantity }] }).success).toBe(false);
    }
    expect(createDeliverySchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });

  it('update requires the version and lines; post requires the version; bad list filters are refused', () => {
    expect(updateDeliverySchema.safeParse({ deliveryDate: '2026-10-06', items: [{ salesOrderItemId: 1, quantity: 1 }] }).success).toBe(false);
    expect(updateDeliverySchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z', deliveryDate: '2026-10-06' }).success).toBe(false);
    expect(postDeliverySchema.safeParse({}).success).toBe(false);
    expect(deliveryListQuerySchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(deliveryListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });
});
