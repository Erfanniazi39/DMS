import { z } from 'zod';
import { enumField, optionalId, optionalTrimmedString, requiredId, requiredText } from '../../common/zod-fields';

export const LETTER_BOXES = ['inbox', 'sent', 'drafts', 'archive', 'all'] as const;
export type LetterBox = (typeof LETTER_BOXES)[number];

export const MAX_LETTER_RECIPIENTS = 100;

const recipientUserIds = z
  .array(requiredId('گیرنده نامعتبر است'), { error: 'فهرست گیرندگان نامعتبر است' })
  .max(MAX_LETTER_RECIPIENTS, { error: `حداکثر ${MAX_LETTER_RECIPIENTS} گیرنده مجاز است` })
  .default([]);

const letterContent = {
  subject: requiredText(200, 'موضوع نامه الزامی است'),
  body: requiredText(20000, 'متن نامه الزامی است'),
  // A draft may have no addressee yet; sending needs at least one.
  recipientUserIds,
};

// Reply = a new draft linked to a letter the caller received. With no
// recipients given it defaults to the parent's sender.
export const createLetterSchema = z.object({ ...letterContent, inReplyToId: optionalId('نامهٔ مرجع نامعتبر است') });
export const updateLetterSchema = z.object(letterContent);

export const letterListQuerySchema = z.object({
  box: enumField(LETTER_BOXES, 'صندوق نامعتبر است').default('inbox'),
  q: optionalTrimmedString(100),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export const resolveCodesSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(60), { error: 'فهرست کدها نامعتبر است' }).max(30, { error: 'حداکثر ۳۰ کد در هر درخواست' }),
});

export type ResolveCodesDto = z.infer<typeof resolveCodesSchema>;
export type CreateLetterDto = z.infer<typeof createLetterSchema>;
export type UpdateLetterDto = z.infer<typeof updateLetterSchema>;
export type LetterListQuery = z.infer<typeof letterListQuerySchema>;
