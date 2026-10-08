import { createCreditNoteSchema, creditNoteListQuerySchema, postCreditNoteSchema } from './credit-note.dto';

describe('credit-note DTOs', () => {
  it('create requires a return id and a reason; client-only fields are stripped', () => {
    expect(createCreditNoteSchema.safeParse({ reason: 'x' }).success).toBe(false);
    expect(createCreditNoteSchema.safeParse({ salesReturnId: 81, reason: '' }).success).toBe(false);
    const parsed = createCreditNoteSchema.parse({ salesReturnId: 81, reason: 'مرجوعی تأییدشده', creditNoteNumber: 'CN-1', status: 'POSTED' } as never);
    expect(parsed).not.toHaveProperty('creditNoteNumber');
    expect(parsed).not.toHaveProperty('status');
  });

  it('post requires the version', () => {
    expect(postCreditNoteSchema.safeParse({}).success).toBe(false);
    expect(postCreditNoteSchema.safeParse({ updatedAt: '2026-10-01T10:00:00.000Z' }).success).toBe(true);
  });

  it('list query refuses a bad status filter and strips an empty one', () => {
    expect(creditNoteListQuerySchema.safeParse({ status: 'NOT_A_STATUS' }).success).toBe(false);
    expect(creditNoteListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });
});
