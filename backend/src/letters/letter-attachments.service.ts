import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { matchesFileSignature } from '../common/file-signature';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_LETTER_ATTACHMENT_EXTENSIONS,
  LETTER_ATTACHMENT_TYPES_MESSAGE,
  MAX_LETTER_ATTACHMENTS,
  NO_EXTRA_LETTER_ACCESS,
  visibleLetterWhere,
  type LetterAccess,
} from './letter-rules';

export const LETTER_UPLOAD_DIR = join(process.cwd(), 'uploads', 'letters');

// Multer decodes multipart filenames as latin1, which mangles Persian names.
export function decodeUploadedName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const cleaned = (decoded.includes('�') ? name : decoded).replace(/[\\/\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 200) || 'file';
}

// Attachments live on DRAFT letters only (added/removed by the sender); once
// sent they are immutable. Files are held in memory, signature-checked, and
// stored under uploads/letters/<uuid>.<ext> — never served statically. A
// download goes through resolveFile(), which applies the PARENT LETTER's
// visibility rule (not a filename lookup).
@Injectable()
export class LetterAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async add(userId: number, letterId: number, file: { originalName: string; buffer: Buffer }) {
    const letter = await this.prisma.letter.findFirst({
      where: { id: letterId, senderUserId: userId },
      select: { status: true, _count: { select: { attachments: true } } },
    });
    if (!letter) throw new NotFoundException('نامه پیدا نشد');
    if (letter.status !== 'DRAFT') throw new ConflictException('پیوست نامهٔ ارسال‌شده قابل تغییر نیست');
    if (letter._count.attachments >= MAX_LETTER_ATTACHMENTS) {
      throw new BadRequestException(`حداکثر ${MAX_LETTER_ATTACHMENTS} پیوست برای هر نامه مجاز است`);
    }

    const extension = extname(file.originalName).toLowerCase();
    if (!ALLOWED_LETTER_ATTACHMENT_EXTENSIONS.has(extension)) {
      throw new BadRequestException(LETTER_ATTACHMENT_TYPES_MESSAGE);
    }
    if (!matchesFileSignature(file.buffer, extension)) {
      throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد؛ فایل واقعی با همان فرمت بارگذاری کنید');
    }

    const filename = `${randomUUID()}${extension}`;
    const filePath = `/uploads/letters/${filename}`;
    await writeFile(join(LETTER_UPLOAD_DIR, filename), file.buffer);
    try {
      // Row-locks the letter while it is still a DRAFT, so a send racing this
      // upload waits for it (and can't leave a file on a sent letter).
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM letters WHERE id = ${letterId} AND status = 'DRAFT' FOR UPDATE`;
        if (locked.length === 0) throw new ConflictException('پیوست نامهٔ ارسال‌شده قابل تغییر نیست');
        return tx.letterAttachment.create({
          data: { letterId, filePath, originalName: decodeUploadedName(file.originalName), sizeBytes: file.buffer.length, uploadedByUserId: userId },
          select: { id: true, originalName: true, sizeBytes: true, createdAt: true },
        });
      });
    } catch (error) {
      this.deleteFile(filePath);
      throw error;
    }
  }

  async remove(userId: number, letterId: number, attachmentId: number) {
    const attachment = await this.prisma.letterAttachment.findFirst({
      where: { id: attachmentId, letterId, letter: { senderUserId: userId } },
      select: { id: true, filePath: true, letter: { select: { status: true } } },
    });
    if (!attachment) throw new NotFoundException('پیوست پیدا نشد');
    if (attachment.letter.status !== 'DRAFT') throw new ConflictException('پیوست نامهٔ ارسال‌شده قابل تغییر نیست');
    const result = await this.prisma.letterAttachment.deleteMany({ where: { id: attachmentId, letter: { status: 'DRAFT' } } });
    if (result.count === 0) throw new ConflictException('پیوست نامهٔ ارسال‌شده قابل تغییر نیست');
    this.deleteFile(attachment.filePath);
    return { success: true };
  }

  // Fail-closed: no visible parent letter → 404 (never reveals the file exists).
  async resolveFile(userId: number, attachmentId: number, access: LetterAccess = NO_EXTRA_LETTER_ACCESS) {
    const attachment = await this.prisma.letterAttachment.findFirst({
      where: { id: attachmentId, letter: visibleLetterWhere(userId, access) },
      select: { filePath: true, originalName: true },
    });
    if (!attachment) throw new NotFoundException('فایل پیدا نشد');
    const absolutePath = join(process.cwd(), attachment.filePath.replace(/^\//, ''));
    if (!existsSync(absolutePath)) throw new NotFoundException('فایل پیدا نشد');
    return { absolutePath, originalName: attachment.originalName };
  }

  deleteFile(relativePath: string) {
    const filePath = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(filePath)) unlink(filePath, () => undefined);
  }
}
