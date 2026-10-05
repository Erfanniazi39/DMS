import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { matchesFileSignature } from '../common/file-signature';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PurchasesService } from './purchases.service';
import type { CreatePurchaseDocumentDto } from './dto/purchase.dto';

// The single source of which file types a Purchase document may carry — used
// both by PurchasesController's upload fileFilter (early reject) and by
// setDocumentFile() below (authoritative check, plus content signature).
export const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const PURCHASE_UPLOAD_DIR = join(process.cwd(), 'uploads', 'purchases');
// Stored names are always `<uuid><ext>` (see setDocumentFile()) — anything
// else (path separators, "..", other extensions) is never a valid request.
const STORED_DOCUMENT_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$/;

// Purchase documents (metadata rows) and their uploaded files on disk.
// Documents never affect any Purchase money field.
//
// Injects PurchasesService only for get() — the purchase-existence check in
// addDocument() and the full-detail response of removeDocument()/
// setDocumentFile(). PurchasesService never injects this back (no cycle).
@Injectable()
export class PurchaseDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchasesService: PurchasesService,
    private readonly audit: AuditService,
  ) {}

  // Returns the created PurchaseDocument itself (with its own id) — the
  // frontend needs that real id right back to attach the file in its
  // second step (see PurchasesController.uploadDocumentFile()). Returning
  // the purchase detail here instead, as removeDocument() does, would hand
  // back the *Purchase*'s id (same field name, wrong record), sending the
  // file upload to whatever unrelated document happened to share that id —
  // or to no document at all.
  async addDocument(purchaseId: number, dto: CreatePurchaseDocumentDto, userId: number | null, ipAddress?: string) {
    await this.purchasesService.get(purchaseId);
    const document = await this.prisma.purchaseDocument.create({ data: { purchaseId, ...dto } });
    await this.audit.log({ userId, ipAddress, action: 'DOCUMENT_ADDED', entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: document.documentType });
    return document;
  }

  async removeDocument(purchaseId: number, documentId: number, userId: number | null, ipAddress?: string) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    await this.prisma.purchaseDocument.delete({ where: { id: documentId } });
    await this.audit.log({ userId, ipAddress, action: 'DOCUMENT_REMOVED', entityType: AUDIT_ENTITY.PURCHASE, entityId: purchaseId, details: document.documentType });
    return this.purchasesService.get(purchaseId);
  }

  // Attaches the uploaded file to a document record already created via
  // addDocument() — same two-step pattern as Employee.photoPath /
  // contractDocumentPath: metadata first (JSON), file second (multipart).
  //
  // The upload arrives in memory (see PurchasesController); nothing touches
  // the disk until the purchase/document pair has been found and the file's
  // content has been checked against its extension. The old file (if any)
  // is only removed once the new path is committed, and the attach/replace
  // is audited (QA 2026-10-05: a replaced file used to leave no trace).
  async setDocumentFile(
    purchaseId: number,
    documentId: number,
    file: { originalName: string; buffer: Buffer },
    userId: number | null,
    ipAddress?: string,
  ) {
    const document = await this.prisma.purchaseDocument.findFirst({ where: { id: documentId, purchaseId } });
    if (!document) throw new NotFoundException('سند پیدا نشد');

    const extension = extname(file.originalName).toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است');
    }
    if (!matchesFileSignature(file.buffer, extension)) {
      throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد. فقط فایل PDF یا تصویر jpg/png واقعی مجاز است');
    }

    const filename = `${randomUUID()}${extension}`;
    const filePath = `/uploads/purchases/${filename}`;
    await writeFile(join(PURCHASE_UPLOAD_DIR, filename), file.buffer);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.purchaseDocument.update({ where: { id: documentId }, data: { filePath } });
        await this.audit.log(
          {
            userId,
            ipAddress,
            action: document.filePath ? 'DOCUMENT_FILE_REPLACED' : 'DOCUMENT_FILE_ATTACHED',
            entityType: AUDIT_ENTITY.PURCHASE,
            entityId: purchaseId,
            details: `${document.documentType} (سند #${document.id})`,
          },
          tx,
        );
      });
    } catch (error) {
      this.deleteUploadedFile(filePath);
      throw error;
    }
    if (document.filePath) this.deleteUploadedFile(document.filePath);
    return this.purchasesService.get(purchaseId);
  }

  // Resolves a stored purchase-document filename to its absolute path on
  // disk for the guarded download route (PurchaseFilesController) — only a
  // file that a PurchaseDocument actually references is ever served.
  async resolveDocumentFile(filename: string): Promise<string> {
    if (!STORED_DOCUMENT_FILENAME.test(filename)) throw new NotFoundException('فایل پیدا نشد');
    const document = await this.prisma.purchaseDocument.findFirst({
      where: { filePath: `/uploads/purchases/${filename}` },
      select: { id: true },
    });
    const absolutePath = join(PURCHASE_UPLOAD_DIR, filename);
    if (!document || !existsSync(absolutePath)) throw new NotFoundException('فایل پیدا نشد');
    return absolutePath;
  }

  private deleteUploadedFile(relativePath: string) {
    // Best-effort cleanup, same as EmployeesService.deleteUploadedFile — the
    // database record is what matters; a leftover file is not a data-loss
    // concern, so a failure here is silently ignored.
    const filePath = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(filePath)) unlink(filePath, () => undefined);
  }
}
