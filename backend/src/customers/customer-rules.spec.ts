import { ConflictException, NotFoundException } from '@nestjs/common';
import { ALLOWED_CUSTOMER_STATUS_TRANSITIONS, ensureCustomerExists, ensureTransactableCustomer } from './customer-rules';

describe('customer-rules', () => {
  it('ensureTransactableCustomer passes only for an ACTIVE customer that is not on credit hold', async () => {
    const db = { customer: { findUnique: jest.fn() } };

    db.customer.findUnique.mockResolvedValueOnce({ id: 1, status: 'ACTIVE', financialProfile: { creditHold: false } });
    await expect(ensureTransactableCustomer(db as never, 1)).resolves.toBeUndefined();

    db.customer.findUnique.mockResolvedValueOnce({ id: 1, status: 'ACTIVE', financialProfile: { creditHold: true } });
    await expect(ensureTransactableCustomer(db as never, 1)).rejects.toThrow('توقف اعتباری');

    for (const status of ['INACTIVE', 'SUSPENDED', 'ARCHIVED']) {
      db.customer.findUnique.mockResolvedValueOnce({ id: 1, status, financialProfile: { creditHold: false } });
      await expect(ensureTransactableCustomer(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
    }

    db.customer.findUnique.mockResolvedValueOnce(null);
    await expect(ensureTransactableCustomer(db as never, 1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ensureCustomerExists 404s for an unknown customer', async () => {
    const db = { customer: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(ensureCustomerExists(db as never, 9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the transition matrix never contains a same-status move', () => {
    for (const [from, targets] of Object.entries(ALLOWED_CUSTOMER_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });
});
