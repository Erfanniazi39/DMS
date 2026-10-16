import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { counterKey, defaultDocumentNumberFormat, renderDocumentNumber, type DocumentNumberFormat, type MiddleMode } from '../common/document-number-format';
import { jalaliYearOf, readCounter, setCounter } from '../common/document-sequence';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateNumberingDto } from './dto/numbering.dto';
import { NUMBERED_DOCUMENTS, SHARED_TABLE_GROUPS, isNumberedDocType, type NumberedDocType } from './numbering-registry';

// «قالب شماره‌گذاری»: how each document type's number looks and where its counter
// stands. Existing documents keep their numbers; only new ones use the format. The
// generator itself lives in common/document-sequence.ts (it reads numbering_formats).
@Injectable()
export class NumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.numberingFormat.findMany();
    const byType = new Map(rows.map((row) => [row.docType, row]));
    const year = jalaliYearOf(todayUtc());
    const result = [];
    for (const doc of NUMBERED_DOCUMENTS) {
      const row = byType.get(doc.docType);
      const format: DocumentNumberFormat = row
        ? { prefix: row.prefix, middleMode: row.middleMode as MiddleMode, middleText: row.middleText, separator: row.separator, digits: row.digits }
        : defaultDocumentNumberFormat(doc.docType);
      const counter = await this.prisma.documentSequence.findUnique({
        where: { docType_fiscalYear: { docType: doc.docType, fiscalYear: counterKey(format, year) } },
      });
      const nextNumber = (counter?.lastValue ?? 0) + 1;
      result.push({
        docType: doc.docType,
        label: doc.label,
        format,
        isDefault: !row,
        fiscalYear: year,
        nextNumber,
        nextPreview: renderDocumentNumber(format, year, nextNumber),
      });
    }
    return result;
  }

  async update(docType: string, dto: UpdateNumberingDto, userId: number | null, ipAddress?: string) {
    if (!isNumberedDocType(docType)) throw new NotFoundException('نوع سند پیدا نشد');
    await this.assertPrefixDistinct(docType, dto.format.prefix);
    const before = (await this.list()).find((entry) => entry.docType === docType)!;
    const year = jalaliYearOf(todayUtc());
    const key = counterKey(dto.format, year);

    await this.prisma.$transaction(async (tx) => {
      await tx.numberingFormat.upsert({
        where: { docType },
        create: { docType, ...dto.format },
        update: { ...dto.format },
      });
      if (dto.nextNumber !== undefined) {
        const last = await readCounter(tx, docType, key);
        if (dto.nextNumber - 1 < last) {
          throw new ConflictException(`شمارهٔ بعدی نمی‌تواند کمتر از ${(last + 1).toLocaleString('fa-IR')} باشد؛ شماره‌های قبلی صادر شده‌اند و تکراری نباید شوند`);
        }
        if (dto.nextNumber > 10 ** dto.format.digits - 1) throw new BadRequestException('شمارهٔ بعدی از گنجایش تعداد ارقام بیشتر است');
        if (dto.nextNumber - 1 !== last) await setCounter(tx, docType, key, dto.nextNumber - 1);
      }
    });

    const after = (await this.list()).find((entry) => entry.docType === docType)!;
    await this.audit.log({
      userId,
      ipAddress,
      action: 'NUMBERING_FORMAT_UPDATED',
      entityType: AUDIT_ENTITY.NUMBERING_FORMAT,
      details: `${docType}: ${before.nextPreview} ← ${after.nextPreview}`,
    });
    return after;
  }

  // Back to PREFIX-<year>-000001. The counter keeps its value (numbers never repeat).
  async reset(docType: string, userId: number | null, ipAddress?: string) {
    if (!isNumberedDocType(docType)) throw new NotFoundException('نوع سند پیدا نشد');
    await this.assertPrefixDistinct(docType, docType);
    await this.prisma.numberingFormat.deleteMany({ where: { docType } });
    await this.audit.log({ userId, ipAddress, action: 'NUMBERING_FORMAT_RESET', entityType: AUDIT_ENTITY.NUMBERING_FORMAT, details: docType });
    return (await this.list()).find((entry) => entry.docType === docType)!;
  }

  // Receipts and refunds share the customer-payments table: equal prefixes would let
  // two different documents land on the same number.
  private async assertPrefixDistinct(docType: NumberedDocType, prefix: string) {
    const group = SHARED_TABLE_GROUPS.find((members) => members.includes(docType));
    if (!group) return;
    const rows = await this.prisma.numberingFormat.findMany({ where: { docType: { in: group.filter((member) => member !== docType) as string[] } } });
    for (const other of group.filter((member) => member !== docType)) {
      const otherPrefix = rows.find((row) => row.docType === other)?.prefix ?? other;
      if (otherPrefix.toLowerCase() === prefix.toLowerCase()) throw new ConflictException(`پیشوند «${prefix}» برای ${other} هم استفاده شده است؛ پیشوند این دو نوع سند باید متفاوت باشد`);
    }
  }
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
