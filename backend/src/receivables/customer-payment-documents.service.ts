import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { matchesFileSignature } from '../common/file-signature';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ReceivablesActor } from './customer-payments.service';

export const PAYMENT_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const PAYMENT_UPLOAD_DIR = join(process.cwd(), 'uploads', 'customer-payments');
// Stored names are always `<uuid><ext>` — anything else is never a valid request.
const STORED_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$/;

const documentSelect = { id: true, originalName: true, filePath: true, note: true, uploadedAt: true, uploadedByUser: { select: { id: true, username: true } } } as const;

// Supporting files of a customer payment (transfer slip, cheque photo, …).
// One step: the multipart upload creates the row and the file together. The
// file arrives in memory; nothing touches the disk until the payment exists
// and the content matches its extension (same rules as Purchase documents).
// Documents are informational — they never change any amount or status, and
// a payment's documents can be added/removed in any status (even CANCELLED).
@Injectable()
export class CustomerPaymentDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(paymentId: number) {
    await this.ensurePayment(paymentId);
    return this.prisma.customerPaymentDocument.findMany({ where: { customerPaymentId: paymentId }, orderBy: { id: 'asc' }, select: documentSelect });
  }

  async add(paymentId: number, file: { originalName: string; buffer: Buffer }, note: string | undefined, actor: ReceivablesActor) {
    const payment = await this.ensurePayment(paymentId);

    const extension = extname(file.originalName).toLowerCase();
    if (!PAYMENT_DOCUMENT_EXTENSIONS.has(extension)) throw new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است');
    if (!matchesFileSignature(file.buffer, extension)) throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد. فقط فایل PDF یا تصویر jpg/png واقعی مجاز است');

    const filename = `${randomUUID()}${extension}`;
    const filePath = `/uploads/customer-payments/${filename}`;
    await writeFile(join(PAYMENT_UPLOAD_DIR, filename), file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.customerPaymentDocument.create({
          data: { customerPaymentId: paymentId, originalName: file.originalName.slice(0, 200), filePath, note: note?.trim() || null, uploadedByUserId: actor.userId },
          select: documentSelect,
        });
        await this.audit.log(
          { userId: actor.userId, ipAddress: actor.ipAddress, action: 'CUSTOMER_PAYMENT_DOCUMENT_ADDED', entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT, entityId: paymentId, details: `${payment.paymentNumber} — ${document.originalName}` },
          tx,
        );
        return document;
      });
    } catch (error) {
      this.deleteFile(filePath);
      throw error;
    }
  }

  async remove(paymentId: number, documentId: number, actor: ReceivablesActor) {
    const payment = await this.ensurePayment(paymentId);
    const document = await this.prisma.customerPaymentDocument.findFirst({ where: { id: documentId, customerPaymentId: paymentId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.customerPaymentDocument.delete({ where: { id: documentId } });
      await this.audit.log(
        { userId: actor.userId, ipAddress: actor.ipAddress, action: 'CUSTOMER_PAYMENT_DOCUMENT_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER_PAYMENT, entityId: paymentId, details: `${payment.paymentNumber} — ${document.originalName}` },
        tx,
      );
    });
    this.deleteFile(document.filePath);
  }

  // Absolute path for the guarded download route — only a file that a
  // CustomerPaymentDocument actually references is ever served.
  async resolveFile(filename: string): Promise<string> {
    if (!STORED_FILENAME.test(filename)) throw new NotFoundException('فایل پیدا نشد');
    const document = await this.prisma.customerPaymentDocument.findFirst({ where: { filePath: `/uploads/customer-payments/${filename}` }, select: { id: true } });
    const absolutePath = join(PAYMENT_UPLOAD_DIR, filename);
    if (!document || !existsSync(absolutePath)) throw new NotFoundException('فایل پیدا نشد');
    return absolutePath;
  }

  private async ensurePayment(paymentId: number) {
    const payment = await this.prisma.customerPayment.findUnique({ where: { id: paymentId }, select: { id: true, paymentNumber: true } });
    if (!payment) throw new NotFoundException('دریافت/پرداخت پیدا نشد');
    return payment;
  }

  // Best-effort cleanup; the database row is what matters.
  private deleteFile(relativePath: string) {
    const absolute = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(absolute)) unlink(absolute, () => undefined);
  }
}
