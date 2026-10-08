import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CREDIT_NOTE_DRAFT_EXISTS } from '../sales/sales-rules';
import { ACTOR, buildCreditNotesService, createReceivablesDb, postedInvoiceWorld, type ReceivablesDb } from './receivables.spec-helpers';

// CreditNotesService — create (from an INSPECTED return) + post (number,
// SalesInvoiceItem.creditedQty, auto-allocation to the originating invoice
// via PaymentAllocationsService.allocateCreditNoteToInvoice() →
// settlement.ts → SalesInvoicesService.applySettlement(), and
// SalesReturnsService.markCredited()). Runs on the same Sales/Inventory fake
// as the rest of Receivables — applySettlement() and the allocation really
// execute, so creditedAmount/paymentStatus and the return's own status are
// asserted on resulting state.

const dec = (value: number) => new Prisma.Decimal(value);
const CREDIT_DATE = new Date('2026-10-07T00:00:00.000Z'); // 1405/07/15

function inspectedReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 81,
    returnNumber: 'RMA-1405-000001',
    customerId: 9,
    status: 'INSPECTED',
    items: [
      { id: 801, deliveryItemId: 401, itemId: 1, itemName: 'شیر', unitName: 'عدد', unitPrice: dec(1000), requestedQty: dec(3), receivedQty: dec(3), restockQty: dec(2), writeOffQty: dec(1), creditedQty: dec(0) },
    ],
    creditNotes: [] as { id: number; status: string }[],
    ...overrides,
  };
}

function invoiceItem(overrides: Record<string, unknown> = {}) {
  return { id: 501, deliveryItemId: 401, salesInvoiceId: 51, itemName: 'شیر', unitName: 'عدد', creditedQty: dec(0), quantity: dec(5), ...overrides };
}

// Mutable world: a POSTED invoice (postedInvoiceWorld), its one line (via
// salesInvoiceItem, keyed by deliveryItemId — what CreditNotesService.create()
// looks the invoice line up by), and an INSPECTED return.
function world(db: ReceivablesDb, init: { salesReturn?: any; invoiceItem?: any; invoiceOverrides?: Record<string, unknown> } = {}) {
  const { invoice, order } = postedInvoiceWorld(db, init.invoiceOverrides ?? {});
  const state = { invoice, order, salesReturn: init.salesReturn ?? inspectedReturn(), invoiceItem: init.invoiceItem ?? invoiceItem() };

  db.salesInvoiceItem.findMany.mockImplementation(async ({ where }: any) =>
    state.invoiceItem.deliveryItemId !== null && (where.deliveryItemId?.in ?? []).includes(state.invoiceItem.deliveryItemId) ? [state.invoiceItem] : [],
  );
  db.salesInvoiceItem.findUnique.mockImplementation(async ({ where }: any) => (state.invoiceItem.id === where.id ? state.invoiceItem : null));
  db.salesInvoiceItem.update.mockImplementation(async ({ where, data }: any) => {
    if (state.invoiceItem.id !== where.id) throw new Error('invoice item not found');
    return Object.assign(state.invoiceItem, data);
  });

  db.salesReturn.findUnique.mockImplementation(async () => state.salesReturn);
  db.salesReturn.update.mockImplementation(async ({ data }: any) => Object.assign(state.salesReturn, data));
  db.salesReturnItem.update.mockImplementation(async ({ where, data }: any) => {
    const item = state.salesReturn.items.find((entry: any) => entry.id === where.id);
    return Object.assign(item, data);
  });
  return state;
}

describe('CreditNotesService', () => {
  describe('create (DRAFT, from an INSPECTED return)', () => {
    it('builds one line per credited return line, quantity = receivedQty, priced at the return’s unit-price snapshot', async () => {
      const db = createReceivablesDb();
      world(db);
      await buildCreditNotesService(db).create({ salesReturnId: 81, creditDate: CREDIT_DATE, reason: 'مرجوعی تأییدشده' } as never, ACTOR);

      const data = db.creditNote.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ customerId: 9, salesInvoiceId: 51, salesReturnId: 81, status: 'DRAFT', subtotal: dec(3000), totalAmount: dec(3000) }));
      expect(data.items.create).toEqual([
        { salesInvoiceItemId: 501, salesReturnItemId: 801, quantity: dec(3), unitPrice: dec(1000), taxAmount: 0, lineTotal: dec(3000) },
      ]);
    });

    it('refuses a return that is not INSPECTED', async () => {
      const db = createReceivablesDb();
      world(db, { salesReturn: inspectedReturn({ status: 'RECEIVED' }) });
      await expect(buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s with CREDIT_NOTE_DRAFT_EXISTS when a DRAFT already exists for this return, and refuses if already posted', async () => {
      const db = createReceivablesDb();
      const state = world(db, { salesReturn: inspectedReturn({ creditNotes: [{ id: 301, status: 'DRAFT' }] }) });
      await expect(buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ code: CREDIT_NOTE_DRAFT_EXISTS }),
      });

      state.salesReturn.creditNotes = [{ id: 301, status: 'POSTED' }];
      await expect(buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a line that was never invoiced, and an unknown return', async () => {
      const db = createReceivablesDb();
      world(db, { invoiceItem: invoiceItem({ deliveryItemId: 999 }) }); // no invoice line for deliveryItemId 401
      await expect(buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR)).rejects.toThrow('فاکتور نشده است');

      db.salesReturn.findUnique.mockResolvedValue(null);
      await expect(buildCreditNotesService(db).create({ salesReturnId: 999, reason: 'x' } as never, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when nothing on the return is credit-eligible (every line already fully credited)', async () => {
      const db = createReceivablesDb();
      world(db, { salesReturn: inspectedReturn({ items: [{ ...inspectedReturn().items[0], creditedQty: dec(3) }] }) });
      await expect(buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('post (DRAFT → POSTED)', () => {
    async function draftCreditNote(db: ReceivablesDb) {
      const service = buildCreditNotesService(db);
      return service.create({ salesReturnId: 81, creditDate: CREDIT_DATE, reason: 'مرجوعی تأییدشده' } as never, ACTOR);
    }

    it('assigns the CN number, credits the invoice line, allocates to the invoice (settlement), and marks the return COMPLETED', async () => {
      const db = createReceivablesDb();
      const state = world(db);
      const draft = await draftCreditNote(db);
      await buildCreditNotesService(db).post(draft.id, { updatedAt: draft.updatedAt } as never, ACTOR);

      expect(db.creditNote.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'POSTED', creditNoteNumber: 'CN-1405-000001' }) }));
      expect(state.invoiceItem.creditedQty.toString()).toBe('3');
      expect(state.invoice.creditedAmount.toString()).toBe('3000');
      expect(state.invoice.paymentStatus).toBe('PARTIALLY_PAID');
      expect(state.salesReturn.status).toBe('COMPLETED');
      expect(state.salesReturn.items[0].creditedQty.toString()).toBe('3');
      expect(db.state.allocations).toHaveLength(1);
      expect(db.state.allocations[0]).toEqual(expect.objectContaining({ sourceCreditNoteId: draft.id, targetInvoiceId: 51, amount: dec(3000) }));
    });

    it('caps the allocation at the invoice’s open amount — the excess is not allocated (stays as credit held on account)', async () => {
      const db = createReceivablesDb();
      // Invoice total is only 2,000 — less than the credit note's 3,000.
      const state = world(db, { invoiceOverrides: { totalAmount: dec(2_000) } });
      const draft = await draftCreditNote(db);
      await buildCreditNotesService(db).post(draft.id, { updatedAt: draft.updatedAt } as never, ACTOR);

      expect(state.invoice.creditedAmount.toString()).toBe('2000');
      expect(state.invoice.paymentStatus).toBe('PAID');
      expect(db.state.allocations[0].amount.toString()).toBe('2000');
    });

    it('refuses to post an already-posted credit note, and a stale version', async () => {
      const db = createReceivablesDb();
      world(db);
      const draft = await draftCreditNote(db);
      const service = buildCreditNotesService(db);
      await service.post(draft.id, { updatedAt: draft.updatedAt } as never, ACTOR);
      await expect(service.post(draft.id, { updatedAt: draft.updatedAt } as never, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for an unknown credit note', async () => {
      const db = createReceivablesDb();
      world(db);
      await expect(buildCreditNotesService(db).post(999, { updatedAt: new Date() } as never, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove (DRAFT only)', () => {
    it('deletes a DRAFT — no number, no gap', async () => {
      const db = createReceivablesDb();
      world(db);
      const draft = await buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR);
      await expect(buildCreditNotesService(db).remove(draft.id, ACTOR)).resolves.toEqual({ success: true });
      expect(db.state.creditNotes).toHaveLength(0);
    });

    it('refuses to delete a POSTED credit note', async () => {
      const db = createReceivablesDb();
      world(db);
      const draft = await buildCreditNotesService(db).create({ salesReturnId: 81, reason: 'x' } as never, ACTOR);
      await buildCreditNotesService(db).post(draft.id, { updatedAt: draft.updatedAt } as never, ACTOR);
      await expect(buildCreditNotesService(db).remove(draft.id, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
