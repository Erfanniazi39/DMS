import type { Prisma } from '@prisma/client';
import type { LetterBox } from './dto/letter.dto';

// Who may see a letter — the ONE rule every read path shares (list, detail,
// attachment download, reply parent), fail-closed:
//   - the sender sees their own letter, draft or sent;
//   - a recipient sees it only once it is SENT;
//   - a holder of letters.readAll (management oversight, owner decision
//     2026-10-13) also sees every SENT letter — never anyone's DRAFT. That
//     access is read-only and each such view is audited.
// Nobody else does. A letter you can't see is a 404, never a 403, so its
// existence isn't revealed.
export type LetterAccess = { canReadAll: boolean };
export const NO_EXTRA_LETTER_ACCESS: LetterAccess = { canReadAll: false };

export function visibleLetterWhere(userId: number, access: LetterAccess = NO_EXTRA_LETTER_ACCESS): Prisma.LetterWhereInput {
  const branches: Prisma.LetterWhereInput[] = [{ senderUserId: userId }, { status: 'SENT', recipients: { some: { userId } } }];
  if (access.canReadAll) branches.push({ status: 'SENT' });
  return { OR: branches };
}

export function boxWhere(box: LetterBox, userId: number): Prisma.LetterWhereInput {
  switch (box) {
    case 'inbox':
      return { status: 'SENT', recipients: { some: { userId, archivedAt: null } } };
    case 'archive':
      return { status: 'SENT', recipients: { some: { userId, archivedAt: { not: null } } } };
    case 'sent':
      return { status: 'SENT', senderUserId: userId };
    case 'drafts':
      return { status: 'DRAFT', senderUserId: userId };
    case 'all':
      // Management oversight box — the service refuses it without letters.readAll.
      return { status: 'SENT' };
  }
}

export const LETTER_DOC_TYPE = 'LTR';
export const ALLOWED_LETTER_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xls', '.xlsx']);
export const LETTER_ATTACHMENT_TYPES_MESSAGE = 'فقط فایل PDF، تصویر (jpg، jpeg، png)، Word (doc، docx) یا Excel (xls، xlsx) مجاز است';
export const MAX_LETTER_ATTACHMENTS = 10;
export const MAX_LETTER_ATTACHMENT_BYTES = 10 * 1024 * 1024;
