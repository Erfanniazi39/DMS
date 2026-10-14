import { boxWhere, visibleLetterWhere } from './letter-rules';

// The visibility rule is the security core of letters: sender sees own
// letters (draft or sent); a recipient sees a letter only once it is SENT;
// no third path exists (so no admin override, no drafts leaking).
describe('visibleLetterWhere', () => {
  it('is exactly: own letter, OR a SENT letter the user is a recipient of', () => {
    expect(visibleLetterWhere(7)).toEqual({ OR: [{ senderUserId: 7 }, { status: 'SENT', recipients: { some: { userId: 7 } } }] });
  });

  it('letters.readAll adds exactly one more branch: any SENT letter — and never a DRAFT', () => {
    expect(visibleLetterWhere(7, { canReadAll: true })).toEqual({
      OR: [{ senderUserId: 7 }, { status: 'SENT', recipients: { some: { userId: 7 } } }, { status: 'SENT' }],
    });
    const where = visibleLetterWhere(7, { canReadAll: true }) as { OR: { status?: string; senderUserId?: number }[] };
    const extra = where.OR[2];
    expect(extra).toEqual({ status: 'SENT' });
    expect(extra.senderUserId).toBeUndefined();
  });

  it('never grants a recipient access to a DRAFT (recipient path requires SENT)', () => {
    const where = visibleLetterWhere(7) as { OR: { status?: string; recipients?: unknown }[] };
    const recipientPath = where.OR.find((branch) => branch.recipients);
    expect(recipientPath?.status).toBe('SENT');
  });
});

describe('boxWhere', () => {
  it('inbox: SENT letters I received and have not archived', () => {
    expect(boxWhere('inbox', 3)).toEqual({ status: 'SENT', recipients: { some: { userId: 3, archivedAt: null } } });
  });
  it('archive: SENT letters I received and archived', () => {
    expect(boxWhere('archive', 3)).toEqual({ status: 'SENT', recipients: { some: { userId: 3, archivedAt: { not: null } } } });
  });
  it('sent: SENT letters I wrote', () => {
    expect(boxWhere('sent', 3)).toEqual({ status: 'SENT', senderUserId: 3 });
  });
  it('all: every SENT letter (the service refuses this box without letters.readAll)', () => {
    expect(boxWhere('all', 3)).toEqual({ status: 'SENT' });
  });
  it('drafts: my own DRAFT letters only', () => {
    expect(boxWhere('drafts', 3)).toEqual({ status: 'DRAFT', senderUserId: 3 });
  });
});
