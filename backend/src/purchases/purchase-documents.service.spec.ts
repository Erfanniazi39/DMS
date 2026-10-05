import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildDocumentsService, createPrismaMock, fullGet } from './purchases.spec-helpers';

// PurchaseDocumentsService — document records and their uploaded files.
// Moved verbatim from purchases.service.spec.ts when the service was split.

describe('PurchaseDocumentsService', () => {
  // --- 11. Multiple documents ----------------------------------------------

  it('attaches multiple documents to one Purchase, each call returning its own document id (not the Purchase id)', async () => {
    const prisma = createPrismaMock();
    const service = buildDocumentsService(prisma);
    prisma.purchase.findUnique.mockResolvedValue({ id: 8 });
    prisma.purchaseDocument.create
      .mockResolvedValueOnce({ id: 101, purchaseId: 8, documentType: 'INVOICE' })
      .mockResolvedValueOnce({ id: 102, purchaseId: 8, documentType: 'RECEIPT' });

    const first = await service.addDocument(8, { documentType: 'INVOICE' } as never, 9, undefined);
    const second = await service.addDocument(8, { documentType: 'RECEIPT' } as never, 9, undefined);

    expect(first.id).toBe(101);
    expect(second.id).toBe(102);
    expect(first.id).not.toBe(second.id);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_ADDED', entityId: '8', details: 'INVOICE' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_ADDED', entityId: '8', details: 'RECEIPT' }) }),
    );
  });

  // --- Document files ------------------------------------------------------

  const PDF_BYTES = Buffer.from('%PDF-1.7\n%test\n');

  it('setDocumentFile(): a purchase/document id mismatch is a 404 before anything is written to disk', async () => {
    const prisma = createPrismaMock();
    const service = buildDocumentsService(prisma);
    prisma.purchaseDocument.findFirst.mockResolvedValue(null);

    await expect(service.setDocumentFile(8, 77, { originalName: 'a.pdf', buffer: PDF_BYTES }, 9, undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseDocument.findFirst).toHaveBeenCalledWith({ where: { id: 77, purchaseId: 8 } });
    expect(prisma.purchaseDocument.update).not.toHaveBeenCalled();
  });

  it.each([
    ['an executable renamed to .pdf', 'invoice.pdf', Buffer.from('MZ\x90\x00binary')],
    ['HTML renamed to .png', 'scan.png', Buffer.from('<html><script>alert(1)</script>')],
    ['a PDF renamed to .jpg', 'photo.jpg', Buffer.from('%PDF-1.4')],
    ['a disallowed extension', 'run.exe', Buffer.from('%PDF-1.4')],
  ])('setDocumentFile(): rejects %s (content must match the extension)', async (_label, originalName, buffer) => {
    const prisma = createPrismaMock();
    const service = buildDocumentsService(prisma);
    prisma.purchaseDocument.findFirst.mockResolvedValue({ id: 77, purchaseId: 8, filePath: null, documentType: 'INVOICE' });

    await expect(service.setDocumentFile(8, 77, { originalName, buffer }, 9, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchaseDocument.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('setDocumentFile(): replacing an existing file is audited as DOCUMENT_FILE_REPLACED (first upload: DOCUMENT_FILE_ATTACHED)', async () => {
    const prisma = createPrismaMock();
    const service = buildDocumentsService(prisma);
    mkdirSync(join(process.cwd(), 'uploads', 'purchases'), { recursive: true });
    prisma.purchase.findUnique.mockResolvedValue({ id: 8, ...fullGet });
    const written: string[] = [];
    prisma.purchaseDocument.update.mockImplementation(({ data }: { data: { filePath: string } }) => {
      written.push(data.filePath);
      return Promise.resolve({});
    });

    try {
      prisma.purchaseDocument.findFirst.mockResolvedValueOnce({ id: 77, purchaseId: 8, filePath: null, documentType: 'INVOICE' });
      await service.setDocumentFile(8, 77, { originalName: 'Invoice.PDF', buffer: PDF_BYTES }, 9, '127.0.0.1');
      expect(written[0]).toMatch(/^\/uploads\/purchases\/[0-9a-f-]{36}\.pdf$/);
      expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_FILE_ATTACHED', entityType: 'Purchase', entityId: '8', userId: 9 }) }),
      );

      prisma.purchaseDocument.findFirst.mockResolvedValueOnce({ id: 77, purchaseId: 8, filePath: written[0], documentType: 'INVOICE' });
      await service.setDocumentFile(8, 77, { originalName: 'scan.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) }, 9, '127.0.0.1');
      expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DOCUMENT_FILE_REPLACED', entityId: '8' }) }),
      );
    } finally {
      for (const relative of written) {
        const absolute = join(process.cwd(), relative.replace(/^\//, ''));
        if (existsSync(absolute)) unlinkSync(absolute);
      }
    }
  });

  it.each(['../../.env', '..%2F..%2Fsecret', 'not-a-uuid.pdf', '0b0e0f6e-1111-4222-8333-944455556666.exe'])(
    'resolveDocumentFile(): refuses a filename that is not a stored <uuid>.<pdf|png|jpg|jpeg> name (%s)',
    async (filename) => {
      const prisma = createPrismaMock();
      const service = buildDocumentsService(prisma);
      (prisma.purchaseDocument as any).findFirst.mockResolvedValue({ id: 1 });

      await expect(service.resolveDocumentFile(filename)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.purchaseDocument.findFirst).not.toHaveBeenCalled();
    },
  );

  it('resolveDocumentFile(): a well-formed name that no PurchaseDocument references is a 404 (orphans are never served)', async () => {
    const prisma = createPrismaMock();
    const service = buildDocumentsService(prisma);
    prisma.purchaseDocument.findFirst.mockResolvedValue(null);

    await expect(service.resolveDocumentFile('0b0e0f6e-1111-4222-8333-944455556666.pdf')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.purchaseDocument.findFirst).toHaveBeenCalledWith({
      where: { filePath: '/uploads/purchases/0b0e0f6e-1111-4222-8333-944455556666.pdf' },
      select: { id: true },
    });
  });
});
