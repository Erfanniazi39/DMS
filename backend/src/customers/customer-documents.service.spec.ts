import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CUSTOMER_UPLOAD_DIR, CustomerDocumentsService } from './customer-documents.service';
import { buildAudit, createPrismaMock, type PrismaMock } from './customers.spec-helpers';

// Same coverage as purchase-documents.service.spec.ts, for customer documents.

function build(prisma: PrismaMock) {
  return new CustomerDocumentsService(prisma as never, buildAudit(prisma));
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n%test\n');

describe('CustomerDocumentsService', () => {
  it('addDocument returns the document itself (its own id) and records the uploader', async () => {
    const prisma = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: 5 });
    prisma.customerDocument.create.mockResolvedValue({ id: 101, customerId: 5, documentType: 'CONTRACT' });

    const document = await build(prisma).addDocument(5, { documentType: 'CONTRACT' } as never, 9);

    expect(document.id).toBe(101);
    expect(prisma.customerDocument.create).toHaveBeenCalledWith({ data: { customerId: 5, documentType: 'CONTRACT', uploadedByUserId: 9 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_DOCUMENT_ADDED', entityId: '5', details: 'CONTRACT' }) });
  });

  it('setDocumentFile: a customer/document id mismatch is a 404 before anything is written', async () => {
    const prisma = createPrismaMock();
    prisma.customerDocument.findFirst.mockResolvedValue(null);
    await expect(build(prisma).setDocumentFile(5, 77, { originalName: 'a.pdf', buffer: PDF_BYTES }, 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerDocument.findFirst).toHaveBeenCalledWith({ where: { id: 77, customerId: 5 } });
    expect(prisma.customerDocument.update).not.toHaveBeenCalled();
  });

  it.each([
    ['an executable renamed to .pdf', 'license.pdf', Buffer.from('MZ\x90\x00binary')],
    ['HTML renamed to .png', 'scan.png', Buffer.from('<html><script>alert(1)</script>')],
    ['a disallowed extension', 'notes.exe', PDF_BYTES],
  ])('setDocumentFile rejects %s', async (_label, originalName, buffer) => {
    const prisma = createPrismaMock();
    prisma.customerDocument.findFirst.mockResolvedValue({ id: 77, customerId: 5, documentType: 'OTHER', filePath: null });
    await expect(build(prisma).setDocumentFile(5, 77, { originalName, buffer }, 9)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerDocument.update).not.toHaveBeenCalled();
  });

  it('setDocumentFile writes a uuid-named file under uploads/customers and audits the attach', async () => {
    mkdirSync(CUSTOMER_UPLOAD_DIR, { recursive: true });
    const prisma = createPrismaMock();
    prisma.customerDocument.findFirst.mockResolvedValue({ id: 77, customerId: 5, documentType: 'CONTRACT', filePath: null });
    prisma.customerDocument.update.mockImplementation(async ({ data }: any) => ({ id: 77, ...data }));

    const updated = await build(prisma).setDocumentFile(5, 77, { originalName: 'contract.PDF', buffer: PDF_BYTES }, 9);

    expect(updated.filePath).toMatch(/^\/uploads\/customers\/[0-9a-f-]{36}\.pdf$/);
    const onDisk = join(CUSTOMER_UPLOAD_DIR, updated.filePath!.split('/').pop()!);
    expect(existsSync(onDisk)).toBe(true);
    unlinkSync(onDisk);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_DOCUMENT_FILE_ATTACHED', entityId: '5' }) });
  });

  it('resolveDocumentFile only serves uuid filenames that a document references', async () => {
    const prisma = createPrismaMock();
    await expect(build(prisma).resolveDocumentFile('../../etc/passwd')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerDocument.findFirst).not.toHaveBeenCalled();

    prisma.customerDocument.findFirst.mockResolvedValue(null);
    await expect(build(prisma).resolveDocumentFile('0f8fad5b-d9cb-469f-a165-70867728950e.pdf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeDocument deletes the row and audits; another customer\'s document is a 404', async () => {
    const prisma = createPrismaMock();
    prisma.customerDocument.findFirst.mockResolvedValueOnce({ id: 77, documentType: 'TAX', filePath: null });
    await expect(build(prisma).removeDocument(5, 77, 1)).resolves.toEqual({ success: true });
    expect(prisma.customerDocument.delete).toHaveBeenCalledWith({ where: { id: 77 } });

    prisma.customerDocument.findFirst.mockResolvedValueOnce(null);
    await expect(build(prisma).removeDocument(5, 77, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
