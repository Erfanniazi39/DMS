import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/document-sequence';
import { buildOrderBy, parseSort, toSkipTake, type Paginated, type PaginationParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLetterDto, LetterListQuery, UpdateLetterDto } from './dto/letter.dto';
import { LetterAttachmentsService } from './letter-attachments.service';
import { boxWhere, LETTER_DOC_TYPE, NO_EXTRA_LETTER_ACCESS, visibleLetterWhere, type LetterAccess } from './letter-rules';

export type LetterActor = { userId: number; ipAddress?: string };

const userSelect = { id: true, username: true, fullName: true } as const;

// نامه‌نگاری — internal letters between system users (v1: users only).
//
//   DRAFT  visible only to its sender; subject/body/addressees/attachments
//          editable; deletable. No number.
//   SENT   immutable. Sending (one transaction) re-validates the addressees,
//          claims the gap-free LTR-<jalali year>-NNNNNN number and flips the
//          status, guarded on status = DRAFT so two simultaneous sends can't
//          both win (the loser rolls back, number included).
//
// A draft's addressees are stored as LetterRecipient rows right away; they
// grant NO access until the letter is SENT (visibleLetterWhere requires
// status SENT for the recipient path), so nothing leaks from a draft.
// Every read goes through visibleLetterWhere()/boxWhere() in letter-rules.ts.
// Users are read directly via Prisma only for "exists and is ACTIVE" and
// display fields — CLAUDE.md rule 11's documented exception.
@Injectable()
export class LettersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attachments: LetterAttachmentsService,
  ) {}

  async list(
    userId: number,
    query: LetterListQuery,
    pagination: PaginationParams,
    access: LetterAccess = NO_EXTRA_LETTER_ACCESS,
  ): Promise<Paginated<ReturnType<typeof toListItem>>> {
    if (query.box === 'all' && !access.canReadAll) throw new ForbiddenException('دسترسی مشاهدهٔ همهٔ نامه‌ها را ندارید');
    const filters: Prisma.LetterWhereInput[] = [boxWhere(query.box, userId)];
    if (query.q) {
      filters.push({ OR: [{ subject: { contains: query.q, mode: 'insensitive' } }, { letterNumber: { contains: query.q, mode: 'insensitive' } }] });
    }
    const where: Prisma.LetterWhereInput = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.letter.findMany({
        where,
        orderBy: buildOrderBy<Prisma.LetterOrderByWithRelationInput>(
          parseSort(query.sortBy, query.sortDir),
          {
            letterNumber: (dir) => ({ letterNumber: { sort: dir, nulls: 'last' } }),
            subject: (dir) => ({ subject: dir }),
            sender: (dir) => ({ senderUser: { fullName: { sort: dir, nulls: 'last' } } }),
            // «تاریخ ارسال» — «آخرین ویرایش» in the drafts box.
            date: (dir) => (query.box === 'drafts' ? { updatedAt: dir } : { sentAt: { sort: dir, nulls: 'last' } }),
          },
          query.box === 'drafts' ? [{ updatedAt: 'desc' }, { id: 'desc' }] : [{ sentAt: 'desc' }, { id: 'desc' }],
          [{ id: 'desc' }],
        ),
        ...toSkipTake(pagination),
        select: {
          id: true,
          letterNumber: true,
          status: true,
          subject: true,
          sentAt: true,
          createdAt: true,
          updatedAt: true,
          senderUserId: true,
          senderUser: { select: userSelect },
          recipients: { select: { userId: true, readAt: true } },
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.letter.count({ where }),
    ]);
    return { items: rows.map((row) => toListItem(row, userId, access.canReadAll)), total, page: pagination.page, pageSize: pagination.pageSize };
  }

  async get(userId: number, id: number, access: LetterAccess = NO_EXTRA_LETTER_ACCESS, ipAddress?: string) {
    const letter = await this.prisma.letter.findFirst({
      where: { AND: [{ id }, visibleLetterWhere(userId, access)] },
      include: {
        senderUser: { select: userSelect },
        recipients: { include: { user: { select: { ...userSelect, role: { select: { name: true } } } } }, orderBy: { userId: 'asc' } },
        attachments: { select: { id: true, originalName: true, sizeBytes: true, createdAt: true }, orderBy: { id: 'asc' } },
        replies: {
          where: { AND: [{ status: 'SENT' }, visibleLetterWhere(userId, access)] },
          select: { id: true, letterNumber: true, subject: true, sentAt: true, senderUser: { select: userSelect } },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!letter) throw new NotFoundException('نامه پیدا نشد');

    // The parent is shown only if the caller may see it too.
    const parent = letter.inReplyToId
      ? await this.prisma.letter.findFirst({
          where: { AND: [{ id: letter.inReplyToId }, visibleLetterWhere(userId, access)] },
          select: { id: true, letterNumber: true, subject: true, senderUser: { select: userSelect } },
        })
      : null;

    const isSender = letter.senderUserId === userId;
    const mine = letter.recipients.find((recipient) => recipient.userId === userId);
    // Neither the sender nor an addressee: this is a management oversight
    // read (letters.readAll). Recorded every time — never the subject/body.
    const managementView = !isSender && mine === undefined;
    if (managementView) {
      await this.audit.log({
        userId,
        ipAddress,
        action: 'LETTER_VIEWED_BY_MANAGEMENT',
        entityType: AUDIT_ENTITY.LETTER,
        entityId: letter.id,
        details: letter.letterNumber ?? undefined,
      });
    }
    return {
      id: letter.id,
      letterNumber: letter.letterNumber,
      status: letter.status,
      subject: letter.subject,
      body: letter.body,
      sentAt: letter.sentAt,
      createdAt: letter.createdAt,
      updatedAt: letter.updatedAt,
      isSender,
      managementView,
      sender: letter.senderUser,
      // Read receipts (readAt) are the sender's view — and management's.
      recipients: letter.recipients.map((recipient) => ({
        id: recipient.user.id,
        username: recipient.user.username,
        fullName: recipient.user.fullName,
        role: recipient.user.role.name,
        ...(isSender || managementView ? { readAt: recipient.readAt } : {}),
      })),
      attachments: letter.attachments,
      inReplyTo: parent,
      replies: letter.replies,
      my: mine && letter.status === 'SENT' ? { readAt: mine.readAt, archivedAt: mine.archivedAt } : null,
      canReply: letter.status === 'SENT' && mine !== undefined,
    };
  }

  async create(actor: LetterActor, dto: CreateLetterDto) {
    let recipientIds = unique(dto.recipientUserIds);
    if (dto.inReplyToId) {
      // Only a recipient of a SENT letter can reply to it.
      const parent = await this.prisma.letter.findFirst({
        where: { id: dto.inReplyToId, status: 'SENT', recipients: { some: { userId: actor.userId } } },
        select: { senderUserId: true },
      });
      if (!parent) throw new NotFoundException('نامه‌ای برای پاسخ پیدا نشد');
      if (recipientIds.length === 0) recipientIds = [parent.senderUserId];
    }
    await this.ensureAddressable(recipientIds, actor.userId);

    const letter = await this.prisma.letter.create({
      data: {
        subject: dto.subject,
        body: dto.body,
        senderUserId: actor.userId,
        inReplyToId: dto.inReplyToId,
        recipients: { create: recipientIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return this.get(actor.userId, letter.id);
  }

  async update(actor: LetterActor, id: number, dto: UpdateLetterDto) {
    const recipientIds = unique(dto.recipientUserIds);
    await this.ensureAddressable(recipientIds, actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await this.ensureOwnDraft(tx, id, actor.userId);
      const guarded = await tx.letter.updateMany({ where: { id, status: 'DRAFT' }, data: { subject: dto.subject, body: dto.body } });
      if (guarded.count === 0) throw sentLetterConflict();
      await tx.letterRecipient.deleteMany({ where: { letterId: id } });
      await tx.letterRecipient.createMany({ data: recipientIds.map((userId) => ({ letterId: id, userId })) });
    });
    return this.get(actor.userId, id);
  }

  async remove(actor: LetterActor, id: number) {
    const filePaths = await this.prisma.$transaction(async (tx) => {
      await this.ensureOwnDraft(tx, id, actor.userId);
      const files = await tx.letterAttachment.findMany({ where: { letterId: id }, select: { filePath: true } });
      const deleted = await tx.letter.deleteMany({ where: { id, status: 'DRAFT' } });
      if (deleted.count === 0) throw sentLetterConflict();
      return files.map((file) => file.filePath);
    });
    // Only once the rows are gone — a failed delete never loses a file.
    for (const filePath of filePaths) this.attachments.deleteFile(filePath);
    return { success: true };
  }

  async send(actor: LetterActor, id: number) {
    const sent = await this.prisma.$transaction(async (tx) => {
      const letter = await tx.letter.findFirst({
        where: { id, senderUserId: actor.userId },
        select: { status: true, subject: true, body: true, recipients: { select: { userId: true } } },
      });
      if (!letter) throw new NotFoundException('نامه پیدا نشد');
      if (letter.status !== 'DRAFT') throw sentLetterConflict();
      if (!letter.subject.trim() || !letter.body.trim()) throw new BadRequestException('موضوع و متن نامه الزامی است');
      const recipientIds = letter.recipients.map((recipient) => recipient.userId);
      if (recipientIds.length === 0) throw new BadRequestException('حداقل یک گیرنده را انتخاب کنید');
      // Addressees are re-checked now: one may have been disabled since the draft was saved.
      await this.ensureAddressable(recipientIds, actor.userId, tx);

      const sentAt = new Date();
      const letterNumber = await nextDocumentNumber(tx, LETTER_DOC_TYPE, sentAt);
      // Guarded on DRAFT: the loser of a double-send gets 409 and its number rolls back.
      const flipped = await tx.letter.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SENT', letterNumber, sentAt } });
      if (flipped.count === 0) throw sentLetterConflict();
      await this.audit.log(
        {
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          action: 'LETTER_SENT',
          entityType: AUDIT_ENTITY.LETTER,
          entityId: id,
          // Never the subject or body — only the number and how many people.
          details: `${letterNumber} — ${recipientIds.length} گیرنده`,
        },
        tx,
      );
      return id;
    });
    return this.get(actor.userId, sent);
  }

  // A letter written by the system on a user's behalf and sent at once — for
  // other modules' notifications (the workflow engine: "your approval is
  // needed", "your request was approved/rejected"). Runs inside the CALLER's
  // transaction so the notice commits or rolls back with the business change.
  // Tolerant on purpose: inactive users and the sender are dropped silently,
  // and with nobody left nothing is created (returns null) — a notice must
  // never block the action it reports. Same numbering, immutability and
  // visibility as any SENT letter; audited as LETTER_SENT.
  async sendSystemLetter(
    tx: Prisma.TransactionClient,
    input: { senderUserId: number; recipientUserIds: number[]; subject: string; body: string; source: string; ipAddress?: string },
  ): Promise<{ id: number; letterNumber: string } | null> {
    const wanted = unique(input.recipientUserIds).filter((userId) => userId !== input.senderUserId);
    if (wanted.length === 0) return null;
    const active = await tx.user.findMany({ where: { id: { in: wanted }, status: 'ACTIVE' }, select: { id: true } });
    const recipientIds = active.map((user) => user.id);
    if (recipientIds.length === 0) return null;
    const sentAt = new Date();
    const letterNumber = await nextDocumentNumber(tx, LETTER_DOC_TYPE, sentAt);
    const letter = await tx.letter.create({
      data: {
        subject: input.subject.slice(0, 200),
        body: input.body,
        senderUserId: input.senderUserId,
        status: 'SENT',
        letterNumber,
        sentAt,
        recipients: { create: recipientIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    await this.audit.log(
      {
        userId: input.senderUserId,
        ipAddress: input.ipAddress,
        action: 'LETTER_SENT',
        entityType: AUDIT_ENTITY.LETTER,
        entityId: letter.id,
        details: `${letterNumber} — ${recipientIds.length} گیرنده (خودکار: ${input.source})`,
      },
      tx,
    );
    return { id: letter.id, letterNumber };
  }

  // Idempotent. Anyone who can see the letter may call it (the sender opening
  // their own letter is a no-op); only a recipient's own row changes.
  async markRead(userId: number, id: number) {
    await this.ensureVisible(userId, id);
    await this.prisma.letterRecipient.updateMany({
      where: { letterId: id, userId, readAt: null, letter: { status: 'SENT' } },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async archive(userId: number, id: number) {
    return this.setArchived(userId, id, new Date());
  }

  async unarchive(userId: number, id: number) {
    return this.setArchived(userId, id, null);
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.letterRecipient.count({ where: { userId, readAt: null, archivedAt: null, letter: { status: 'SENT' } } });
    return { count };
  }

  // Everyone a letter can be addressed to: ACTIVE users other than the caller.
  async directory(userId: number) {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', id: { not: userId } },
      select: { ...userSelect, role: { select: { name: true } } },
      orderBy: [{ fullName: 'asc' }, { username: 'asc' }],
    });
    return users.map((user) => ({ id: user.id, username: user.username, fullName: user.fullName, role: user.role.name }));
  }

  // --- internals ----------------------------------------------------------------

  private async ensureVisible(userId: number, id: number) {
    const letter = await this.prisma.letter.findFirst({ where: { AND: [{ id }, visibleLetterWhere(userId)] }, select: { id: true } });
    if (!letter) throw new NotFoundException('نامه پیدا نشد');
  }

  // Not yours (or not there) → 404; yours but already sent → 409.
  private async ensureOwnDraft(tx: Prisma.TransactionClient, id: number, userId: number) {
    const letter = await tx.letter.findFirst({ where: { id, senderUserId: userId }, select: { status: true } });
    if (!letter) throw new NotFoundException('نامه پیدا نشد');
    if (letter.status !== 'DRAFT') throw sentLetterConflict();
  }

  private async setArchived(userId: number, id: number, archivedAt: Date | null) {
    const result = await this.prisma.letterRecipient.updateMany({ where: { letterId: id, userId, letter: { status: 'SENT' } }, data: { archivedAt } });
    if (result.count === 0) throw new NotFoundException('نامه پیدا نشد');
    return { success: true };
  }

  // Every addressee must be an existing ACTIVE user, and not the sender.
  private async ensureAddressable(userIds: number[], senderId: number, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    if (userIds.includes(senderId)) throw new BadRequestException('نمی‌توانید برای خودتان نامه بفرستید');
    if (userIds.length === 0) return;
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, fullName: true, status: true } });
    if (users.length !== userIds.length) throw new BadRequestException('یکی از گیرندگان انتخاب‌شده پیدا نشد');
    const inactive = users.find((user) => user.status !== 'ACTIVE');
    if (inactive) throw new BadRequestException(`گیرندهٔ «${inactive.fullName || inactive.username}» غیرفعال است`);
  }
}

function unique(ids: number[]) {
  return [...new Set(ids)];
}

function sentLetterConflict() {
  return new ConflictException('نامهٔ ارسال‌شده قابل ویرایش یا حذف نیست');
}

function toListItem(
  row: {
    id: number;
    letterNumber: string | null;
    status: 'DRAFT' | 'SENT';
    subject: string;
    sentAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    senderUserId: number;
    senderUser: { id: number; username: string; fullName: string | null };
    recipients: { userId: number; readAt: Date | null }[];
    _count: { attachments: number };
  },
  userId: number,
  canReadAll = false,
) {
  const mine = row.recipients.find((recipient) => recipient.userId === userId);
  const isSender = row.senderUserId === userId;
  return {
    id: row.id,
    letterNumber: row.letterNumber,
    status: row.status,
    subject: row.subject,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sender: row.senderUser,
    recipientCount: row.recipients.length,
    // Read progress is the sender's own view.
    ...((isSender || canReadAll) && row.status === 'SENT' ? { readCount: row.recipients.filter((recipient) => recipient.readAt).length } : {}),
    unread: !isSender && row.status === 'SENT' && mine !== undefined && mine.readAt === null,
    hasAttachments: row._count.attachments > 0,
  };
}
