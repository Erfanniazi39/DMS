import { NotFoundException } from '@nestjs/common';
import { RECORD_MODIFIED_CODE } from '../common/optimistic-lock';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomerAddressesService } from './customer-addresses.service';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerComplaintsService } from './customer-complaints.service';
import { buildAudit, createPrismaMock, VERSION, type PrismaMock } from './customers.spec-helpers';

// Contacts / addresses / notes / complaints — the customer's plain child
// records. Each is audited under the customer (entityType Customer, the
// customer's id), action-only.

function contacts(prisma: PrismaMock) {
  return new CustomerContactsService(prisma as never, buildAudit(prisma));
}
function addresses(prisma: PrismaMock) {
  return new CustomerAddressesService(prisma as never, buildAudit(prisma));
}
function notes(prisma: PrismaMock) {
  return new CustomerNotesService(prisma as never, buildAudit(prisma));
}
function complaints(prisma: PrismaMock) {
  return new CustomerComplaintsService(prisma as never, buildAudit(prisma));
}

const contactDto = { name: 'آقای احمدی', isPrimary: true, isActive: true };
const addressDto = { addressType: 'DELIVERY' as const, addressLine: 'خیابان آزادی', isDefault: true, isActive: true };

describe('CustomerContactsService', () => {
  it('a new primary contact unsets the previous primary, and is audited under the customer', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerContact.create.mockResolvedValue({ id: 1, name: 'آقای احمدی' });

    await contacts(prisma).create(5, contactDto, 2);

    expect(prisma.customerContact.updateMany).toHaveBeenCalledWith({ where: { customerId: 5, isPrimary: true }, data: { isPrimary: false } });
    expect(prisma.customerContact.create).toHaveBeenCalledWith({ data: { customerId: 5, ...contactDto } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CUSTOMER_CONTACT_ADDED', entityType: 'Customer', entityId: '5' }),
    });
  });

  it('a non-primary contact leaves the existing primary alone', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerContact.create.mockResolvedValue({ id: 1, name: 'x' });
    await contacts(prisma).create(5, { ...contactDto, isPrimary: false }, 2);
    expect(prisma.customerContact.updateMany).not.toHaveBeenCalled();
  });

  it('update excludes itself when unsetting the previous primary and clears omitted optionals', async () => {
    const prisma = createPrismaMock();
    prisma.customerContact.findFirst.mockResolvedValue({ id: 3, customerId: 5 });
    prisma.customerContact.update.mockResolvedValue({ id: 3, name: 'x' });

    await contacts(prisma).update(5, 3, contactDto, 2);

    expect(prisma.customerContact.findFirst).toHaveBeenCalledWith({ where: { id: 3, customerId: 5 } });
    expect(prisma.customerContact.updateMany).toHaveBeenCalledWith({ where: { customerId: 5, isPrimary: true, NOT: { id: 3 } }, data: { isPrimary: false } });
    expect(prisma.customerContact.update.mock.calls[0][0].data).toMatchObject({ roleTitle: null, mobile: null, email: null, note: null });
  });

  it('a contact of another customer is a 404 (no cross-customer edits)', async () => {
    const prisma = createPrismaMock();
    prisma.customerContact.findFirst.mockResolvedValue(null);
    await expect(contacts(prisma).remove(5, 3, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerContact.delete).not.toHaveBeenCalled();
  });

  it('a missing customer is a 404 on create', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(contacts(prisma).create(99, contactDto, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerAddressesService', () => {
  it('a new default address unsets the previous default of the SAME type only', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerAddress.create.mockResolvedValue({ id: 1, addressType: 'DELIVERY' });

    await addresses(prisma).create(5, addressDto, 2);

    expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
      where: { customerId: 5, addressType: 'DELIVERY', isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_ADDRESS_ADDED', entityId: '5' }) });
  });

  it('changing an address to a default of a new type unsets that type\'s default, excluding itself', async () => {
    const prisma = createPrismaMock();
    prisma.customerAddress.findFirst.mockResolvedValue({ id: 4, customerId: 5, addressType: 'DELIVERY' });
    prisma.customerAddress.update.mockResolvedValue({ id: 4, addressType: 'BILLING' });

    await addresses(prisma).update(5, 4, { ...addressDto, addressType: 'BILLING' }, 2);

    expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
      where: { customerId: 5, addressType: 'BILLING', isDefault: true, NOT: { id: 4 } },
      data: { isDefault: false },
    });
    expect(prisma.customerAddress.update.mock.calls[0][0].data).toMatchObject({ addressType: 'BILLING', city: null, postalCode: null });
  });

  it('a non-default address never touches other defaults', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerAddress.create.mockResolvedValue({ id: 1, addressType: 'OTHER' });
    await addresses(prisma).create(5, { ...addressDto, isDefault: false }, 2);
    expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
  });

  it('remove deletes and audits; another customer\'s address is a 404', async () => {
    const prisma = createPrismaMock();
    prisma.customerAddress.findFirst.mockResolvedValueOnce({ id: 4, addressType: 'DELIVERY' });
    await expect(addresses(prisma).remove(5, 4, 1)).resolves.toEqual({ success: true });
    expect(prisma.customerAddress.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_ADDRESS_REMOVED' }) });

    prisma.customerAddress.findFirst.mockResolvedValueOnce(null);
    await expect(addresses(prisma).remove(5, 4, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerNotesService', () => {
  it('records the author and audits without copying the note body', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerNote.create.mockResolvedValue({ id: 1, noteType: 'WARNING' });

    await notes(prisma).create(5, { noteType: 'WARNING', body: 'فقط پیش‌پرداخت', isPinned: true }, 7);

    expect(prisma.customerNote.create).toHaveBeenCalledWith({ data: { customerId: 5, noteType: 'WARNING', body: 'فقط پیش‌پرداخت', isPinned: true, createdByUserId: 7 } });
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'CUSTOMER_NOTE_ADDED', entityId: '5', details: 'WARNING' });
    expect(JSON.stringify(audit)).not.toContain('پیش‌پرداخت');
  });

  it('update / remove only touch a note of this customer', async () => {
    const prisma = createPrismaMock();
    prisma.customerNote.findFirst.mockResolvedValueOnce({ id: 2, noteType: 'GENERAL' });
    prisma.customerNote.update.mockResolvedValue({ id: 2, noteType: 'GENERAL' });
    await notes(prisma).update(5, 2, { noteType: 'GENERAL', body: 'x', isPinned: false }, 1);
    expect(prisma.customerNote.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { noteType: 'GENERAL', body: 'x', isPinned: false } });

    prisma.customerNote.findFirst.mockResolvedValueOnce(null);
    await expect(notes(prisma).remove(5, 2, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerComplaintsService', () => {
  const complaintDto = { date: new Date('2026-05-01'), category: 'کیفیت', description: 'شرح', severity: 'HIGH' as const, status: 'OPEN' as const };

  it('creates with the creating user, checks a given owner is an active user, and audits', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.customerComplaint.create.mockResolvedValue({ id: 11 });

    await complaints(prisma).create(5, { ...complaintDto, ownerUserId: 3 }, 7);

    expect(prisma.customerComplaint.create).toHaveBeenCalledWith({ data: { customerId: 5, ...complaintDto, ownerUserId: 3, createdByUserId: 7 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_COMPLAINT_ADDED', entityId: '5' }) });
  });

  it('rejects a disabled or unknown owner', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.user.findUnique.mockResolvedValue({ status: 'DISABLED' });
    await expect(complaints(prisma).create(5, { ...complaintDto, ownerUserId: 3 }, 7)).rejects.toThrow('کاربر مسئول پیگیری انتخاب‌شده فعال نیست');
    expect(prisma.customerComplaint.create).not.toHaveBeenCalled();
  });

  it('update compare-and-sets on updatedAt, clears omitted optionals and notes a status change', async () => {
    const prisma = createPrismaMock();
    prisma.customerComplaint.findFirst.mockResolvedValue({ id: 11, customerId: 5, status: 'OPEN', ownerUserId: null, updatedAt: VERSION });
    prisma.customerComplaint.update.mockResolvedValue({ id: 11 });

    await complaints(prisma).update(5, 11, { ...complaintDto, status: 'RESOLVED', resolution: 'تعویض شد', updatedAt: VERSION }, 7);

    expect(prisma.customerComplaint.updateMany).toHaveBeenCalledWith({ where: { id: 11, updatedAt: VERSION }, data: { updatedAt: expect.any(Date) } });
    expect(prisma.customerComplaint.update.mock.calls[0][0].data).toMatchObject({ status: 'RESOLVED', resolution: 'تعویض شد', ownerUserId: null });
    expect(prisma.auditLog.create.mock.calls[0][0].data.details).toContain('از OPEN به RESOLVED');
  });

  it('a stale updatedAt is RECORD_MODIFIED', async () => {
    const prisma = createPrismaMock();
    prisma.customerComplaint.findFirst.mockResolvedValue({ id: 11, status: 'OPEN', updatedAt: new Date('2026-04-04') });
    await expect(complaints(prisma).update(5, 11, { ...complaintDto, updatedAt: VERSION }, 7)).rejects.toMatchObject({
      response: expect.objectContaining({ code: RECORD_MODIFIED_CODE }),
    });
    expect(prisma.customerComplaint.update).not.toHaveBeenCalled();
  });

  it('remove deletes a complaint of this customer only', async () => {
    const prisma = createPrismaMock();
    prisma.customerComplaint.findFirst.mockResolvedValueOnce({ id: 11 });
    await complaints(prisma).remove(5, 11, 1);
    expect(prisma.customerComplaint.findFirst).toHaveBeenCalledWith({ where: { id: 11, customerId: 5 } });
    expect(prisma.customerComplaint.delete).toHaveBeenCalledWith({ where: { id: 11 } });
  });
});
