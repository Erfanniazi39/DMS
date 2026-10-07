import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { matchesFileSignature } from '../common/file-signature';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CustomerDocumentDto } from './dto/customer.dto';

// Copy of purchases/purchase-documents.service.ts for customer documents
// (licences, registration papers, contracts, scanned paper records, ...):
// metadata first (JSON), file second (multipart, held in memory and
// signature-checked before anything is written), uuid filenames under
// uploads/customers/, served only through the guarded
// CustomerFilesController (GET /uploads/customers/:filename, customers.view).
export const ALLOWED_CUSTOMER_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
export const CUSTOMER_UPLOAD_DIR = join(process.cwd(), 'uploads', 'customers');
const STORED_DOCUMENT_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$/;

@Injectable()
export class CustomerDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Returns the created CustomerDocument itself — the frontend needs its id
  // for the second (file) step. See PurchaseDocumentsService.addDocument().
  async addDocument(customerId: number, dto: CustomerDocumentDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.customerDocument.create({ data: { customerId, ...dto, uploadedByUserId: userId } });
      await this.audit.log(
        { userId, ipAddress, action: 'CUSTOMER_DOCUMENT_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: document.documentType },
        tx,
      );
      return document;
    });
  }

  async removeDocument(customerId: number, documentId: number, userId: number | null, ipAddress?: string) {
    const document = await this.prisma.customerDocument.findFirst({ where: { id: documentId, customerId } });
    if (!document) throw new NotFoundException('مدرک پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.customerDocument.delete({ where: { id: documentId } });
      await this.audit.log(
        { userId, ipAddress, action: 'CUSTOMER_DOCUMENT_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: document.documentType },
        tx,
      );
    });
    // Only once the row is gone — a failed delete never loses the file.
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    return { success: true };
  }

  async setDocumentFile(
    customerId: number,
    documentId: number,
    file: { originalName: string; buffer: Buffer },
    userId: number | null,
    ipAddress?: string,
  ) {
    const document = await this.prisma.customerDocument.findFirst({ where: { id: documentId, customerId } });
    if (!document) throw new NotFoundException('مدرک پیدا نشد');

    const extension = extname(file.originalName).toLowerCase();
    if (!ALLOWED_CUSTOMER_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است');
    }
    if (!matchesFileSignature(file.buffer, extension)) {
      throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد. فقط فایل PDF یا تصویر jpg/png واقعی مجاز است');
    }

    const filename = `${randomUUID()}${extension}`;
    const filePath = `/uploads/customers/${filename}`;
    await writeFile(join(CUSTOMER_UPLOAD_DIR, filename), file.buffer);
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.customerDocument.update({ where: { id: documentId }, data: { filePath, uploadedByUserId: userId } });
        await this.audit.log(
          {
            userId,
            ipAddress,
            action: document.filePath ? 'CUSTOMER_DOCUMENT_FILE_REPLACED' : 'CUSTOMER_DOCUMENT_FILE_ATTACHED',
            entityType: AUDIT_ENTITY.CUSTOMER,
            entityId: customerId,
            details: `${document.documentType} (مدرک #${document.id})`,
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      this.deleteUploadedFile(filePath);
      throw error;
    }
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    return updated;
  }

  // Only a file that a CustomerDocument actually references is ever served.
  async resolveDocumentFile(filename: string): Promise<string> {
    if (!STORED_DOCUMENT_FILENAME.test(filename)) throw new NotFoundException('فایل پیدا نشد');
    const document = await this.prisma.customerDocument.findFirst({
      where: { filePath: `/uploads/customers/${filename}` },
      select: { id: true },
    });
    const absolutePath = join(CUSTOMER_UPLOAD_DIR, filename);
    if (!document || !existsSync(absolutePath)) throw new NotFoundException('فایل پیدا نشد');
    return absolutePath;
  }

  private deleteUploadedFile(relativePath: string) {
    // Best-effort cleanup, same as PurchaseDocumentsService.
    const filePath = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(filePath)) unlink(filePath, () => undefined);
  }
}
