import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createLetterSchema } from './dto/letter.dto';
import { decodeUploadedName } from './letter-attachments.service';
import { LettersService } from './letters.service';
import { visibleLetterWhere } from './letter-rules';

// Service behaviour on a mocked Prisma. Real cross-user visibility (sender vs
// recipient vs outsider vs ADMIN) and the send transaction are verified live
// against Postgres — these pin the rules the service must apply.

const ME = 5;
const actor = { userId: ME, ipAddress: '127.0.0.1' };

function build() {
  const db: any = {
    letter: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    letterRecipient: { updateMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn(), count: jest.fn() },
    letterAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]),
    auditLog: { create: jest.fn() },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const audit = { log: jest.fn() };
  const attachments = { deleteFile: jest.fn() };
  const service = new LettersService(db, audit as any, attachments as any);
  return { db, audit, attachments, service };
}

const activeUser = (id: number, extra: Record<string, unknown> = {}) => ({ id, username: `u${id}`, fullName: null, status: 'ACTIVE', ...extra });

describe('LettersService', () => {
  describe('reads are fail-closed', () => {
    it('get(): applies visibleLetterWhere and 404s (never 403) when nothing is visible', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(null);
      await expect(service.get(ME, 9)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.letter.findFirst.mock.calls[0][0].where).toEqual({ AND: [{ id: 9 }, visibleLetterWhere(ME)] });
    });

    it('markRead(): 404 for a letter the caller cannot see, and changes nothing', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(null);
      await expect(service.markRead(ME, 9)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.letterRecipient.updateMany).not.toHaveBeenCalled();
    });

    it('markRead(): only touches the caller own recipient row of a SENT letter, once (readAt: null guard)', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue({ id: 9 });
      await service.markRead(ME, 9);
      expect(db.letterRecipient.updateMany).toHaveBeenCalledWith({
        where: { letterId: 9, userId: ME, readAt: null, letter: { status: 'SENT' } },
        data: { readAt: expect.any(Date) },
      });
    });

    it('archive()/unarchive(): 404 when the caller is not a recipient of that SENT letter', async () => {
      const { db, service } = build();
      db.letterRecipient.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.archive(ME, 9)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.unarchive(ME, 9)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.letterRecipient.updateMany.mock.calls[0][0].where).toEqual({ letterId: 9, userId: ME, letter: { status: 'SENT' } });
    });

    it('list(box=all): refused (403) without letters.readAll; with it, lists SENT letters only and shows read counts', async () => {
      const { db, service } = build();
      await expect(service.list(ME, { box: 'all' } as never, { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.letter.findMany).not.toHaveBeenCalled();
      await service.list(ME, { box: 'all' } as never, { page: 1, pageSize: 20 }, { canReadAll: true });
      expect(db.letter.findMany.mock.calls[0][0].where).toEqual({ AND: [{ status: 'SENT' }] });
    });

    const sentLetter = (overrides: Record<string, unknown> = {}) => ({
      id: 9,
      letterNumber: 'LTR-1405-000009',
      status: 'SENT',
      subject: 'محرمانه',
      body: 'متن',
      sentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      senderUserId: 8,
      inReplyToId: null,
      senderUser: { id: 8, username: 'u8', fullName: null },
      recipients: [{ userId: 6, readAt: new Date(), archivedAt: null, user: { id: 6, username: 'u6', fullName: null, role: { name: 'VIEWER' } } }],
      attachments: [],
      replies: [],
      ...overrides,
    });

    it('get() with letters.readAll: management view — read receipts shown, no reply/archive state, and the view is audited (number only)', async () => {
      const { db, audit, service } = build();
      db.letter.findFirst.mockResolvedValue(sentLetter());
      const result = await service.get(ME, 9, { canReadAll: true }, '10.0.0.1');
      expect(db.letter.findFirst.mock.calls[0][0].where).toEqual({ AND: [{ id: 9 }, visibleLetterWhere(ME, { canReadAll: true })] });
      expect(result.managementView).toBe(true);
      expect(result.canReply).toBe(false);
      expect(result.my).toBeNull();
      expect(result.recipients[0]).toHaveProperty('readAt');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'LETTER_VIEWED_BY_MANAGEMENT', entityId: 9, details: 'LTR-1405-000009' }));
      expect(JSON.stringify(audit.log.mock.calls[0][0])).not.toContain('محرمانه');
    });

    it('get() as the sender or an addressee is NOT a management view and writes no audit', async () => {
      const { db, audit, service } = build();
      db.letter.findFirst.mockResolvedValue(sentLetter({ senderUserId: ME }));
      expect((await service.get(ME, 9, { canReadAll: true })).managementView).toBe(false);
      db.letter.findFirst.mockResolvedValue(sentLetter({ recipients: [{ userId: ME, readAt: null, archivedAt: null, user: { id: ME, username: 'me', fullName: null, role: { name: 'VIEWER' } } }] }));
      expect((await service.get(ME, 9, { canReadAll: true })).managementView).toBe(false);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('list(): always constrained to the caller (box filter) — never an unscoped query', async () => {
      const { db, service } = build();
      await service.list(ME, { box: 'inbox' } as never, { page: 1, pageSize: 20 });
      expect(JSON.stringify(db.letter.findMany.mock.calls[0][0].where)).toContain(`"userId":${ME}`);
    });
  });

  describe('create / update', () => {
    it('refuses to address the sender themself', async () => {
      const { service } = build();
      await expect(service.create(actor, { subject: 's', body: 'b', recipientUserIds: [ME] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an unknown or inactive addressee', async () => {
      const { db, service } = build();
      db.user.findMany.mockResolvedValue([activeUser(6)]);
      await expect(service.create(actor, { subject: 's', body: 'b', recipientUserIds: [6, 7] })).rejects.toBeInstanceOf(BadRequestException);
      db.user.findMany.mockResolvedValue([activeUser(6), activeUser(7, { status: 'DISABLED' })]);
      await expect(service.create(actor, { subject: 's', body: 'b', recipientUserIds: [6, 7] })).rejects.toThrow('غیرفعال');
    });

    it('de-duplicates addressees', async () => {
      const { db, service } = build();
      db.user.findMany.mockResolvedValue([activeUser(6)]);
      db.letter.create.mockResolvedValue({ id: 1 });
      db.letter.findFirst.mockResolvedValue(null);
      await service.create(actor, { subject: 's', body: 'b', recipientUserIds: [6, 6, 6] }).catch(() => undefined);
      expect(db.letter.create.mock.calls[0][0].data.recipients).toEqual({ create: [{ userId: 6 }] });
    });

    it('reply: only a recipient of a SENT letter may reply; otherwise 404', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(null);
      await expect(service.create(actor, { subject: 's', body: 'b', recipientUserIds: [], inReplyToId: 3 })).rejects.toBeInstanceOf(NotFoundException);
      expect(db.letter.findFirst.mock.calls[0][0].where).toEqual({ id: 3, status: 'SENT', recipients: { some: { userId: ME } } });
      expect(db.letter.create).not.toHaveBeenCalled();
    });

    it('reply with no addressees defaults to the parent sender', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValueOnce({ senderUserId: 8 }).mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([activeUser(8)]);
      db.letter.create.mockResolvedValue({ id: 2 });
      await service.create(actor, { subject: 's', body: 'b', recipientUserIds: [], inReplyToId: 3 }).catch(() => undefined);
      expect(db.letter.create.mock.calls[0][0].data.recipients).toEqual({ create: [{ userId: 8 }] });
    });

    it('update(): 404 for a letter that is not yours, 409 for a sent one', async () => {
      const { db, service } = build();
      db.user.findMany.mockResolvedValue([]);
      db.letter.findFirst.mockResolvedValue(null);
      await expect(service.update(actor, 4, { subject: 's', body: 'b', recipientUserIds: [] })).rejects.toBeInstanceOf(NotFoundException);
      db.letter.findFirst.mockResolvedValue({ status: 'SENT' });
      await expect(service.update(actor, 4, { subject: 's', body: 'b', recipientUserIds: [] })).rejects.toBeInstanceOf(ConflictException);
      expect(db.letter.updateMany).not.toHaveBeenCalled();
    });

    it('remove(): refuses a sent letter (409) and never deletes it', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue({ status: 'SENT' });
      await expect(service.remove(actor, 4)).rejects.toBeInstanceOf(ConflictException);
      expect(db.letter.deleteMany).not.toHaveBeenCalled();
    });

    it('remove(): deletes a draft and then its files', async () => {
      const { db, attachments, service } = build();
      db.letter.findFirst.mockResolvedValue({ status: 'DRAFT' });
      db.letterAttachment.findMany.mockResolvedValue([{ filePath: '/uploads/letters/a.pdf' }]);
      db.letter.deleteMany.mockResolvedValue({ count: 1 });
      await service.remove(actor, 4);
      expect(attachments.deleteFile).toHaveBeenCalledWith('/uploads/letters/a.pdf');
    });
  });

  describe('send', () => {
    const draft = (overrides: Record<string, unknown> = {}) => ({ status: 'DRAFT', subject: 'موضوع', body: 'متن', recipients: [{ userId: 6 }], ...overrides });

    it('404 for a letter that is not yours; 409 for one already sent', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(null);
      await expect(service.send(actor, 4)).rejects.toBeInstanceOf(NotFoundException);
      db.letter.findFirst.mockResolvedValue(draft({ status: 'SENT' }));
      await expect(service.send(actor, 4)).rejects.toBeInstanceOf(ConflictException);
    });

    it('needs at least one addressee, and burns no number without one', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(draft({ recipients: [] }));
      await expect(service.send(actor, 4)).rejects.toThrow('حداقل یک گیرنده');
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it('re-validates addressees at send time (one disabled since the draft was saved)', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(draft());
      db.user.findMany.mockResolvedValue([activeUser(6, { status: 'DISABLED' })]);
      await expect(service.send(actor, 4)).rejects.toThrow('غیرفعال');
      expect(db.letter.updateMany).not.toHaveBeenCalled();
    });

    it('guards the status flip on DRAFT: a lost double-send race is a 409 (the transaction, number included, rolls back)', async () => {
      const { db, service } = build();
      db.letter.findFirst.mockResolvedValue(draft());
      db.user.findMany.mockResolvedValue([activeUser(6)]);
      db.letter.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.send(actor, 4)).rejects.toBeInstanceOf(ConflictException);
      expect(db.letter.updateMany.mock.calls[0][0].where).toEqual({ id: 4, status: 'DRAFT' });
    });

    it('success: claims an LTR number, flips to SENT, audits the number and count — never the subject/body', async () => {
      const { db, audit, service } = build();
      db.letter.findFirst.mockResolvedValueOnce(draft()).mockResolvedValue(null);
      db.user.findMany.mockResolvedValue([activeUser(6)]);
      db.letter.updateMany.mockResolvedValue({ count: 1 });
      await service.send(actor, 4).catch(() => undefined);
      expect(db.letter.updateMany.mock.calls[0][0].data).toEqual({ status: 'SENT', letterNumber: expect.stringMatching(/^LTR-\d{4}-000001$/), sentAt: expect.any(Date) });
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('LETTER_SENT');
      expect(entry.details).toMatch(/^LTR-\d{4}-000001 — 1 گیرنده$/);
      expect(JSON.stringify(entry)).not.toContain('موضوع');
      expect(JSON.stringify(entry)).not.toContain('متن');
    });
  });

  it('unreadCount(): counts only my unread, unarchived, SENT letters', async () => {
    const { db, service } = build();
    db.letterRecipient.count.mockResolvedValue(3);
    expect(await service.unreadCount(ME)).toEqual({ count: 3 });
    expect(db.letterRecipient.count).toHaveBeenCalledWith({ where: { userId: ME, readAt: null, archivedAt: null, letter: { status: 'SENT' } } });
  });
});

describe('createLetterSchema', () => {
  it('requires subject and body, allows an empty addressee list on a draft', () => {
    expect(createLetterSchema.safeParse({ subject: '', body: 'x' }).success).toBe(false);
    expect(createLetterSchema.safeParse({ subject: 'x', body: '  ' }).success).toBe(false);
    const ok = createLetterSchema.safeParse({ subject: 'x', body: 'y' });
    expect(ok.success && ok.data.recipientUserIds).toEqual([]);
  });
  it('caps the addressee list', () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(createLetterSchema.safeParse({ subject: 'x', body: 'y', recipientUserIds: ids }).success).toBe(false);
  });
});

describe('decodeUploadedName', () => {
  it('restores a UTF-8 (Persian) filename that multer decoded as latin1', () => {
    const mangled = Buffer.from('گزارش.pdf', 'utf8').toString('latin1');
    expect(decodeUploadedName(mangled)).toBe('گزارش.pdf');
  });
  it('leaves a plain ASCII name alone and strips path separators', () => {
    expect(decodeUploadedName('report.pdf')).toBe('report.pdf');
    expect(decodeUploadedName('../../etc/passwd.pdf')).not.toContain('/');
  });
});
