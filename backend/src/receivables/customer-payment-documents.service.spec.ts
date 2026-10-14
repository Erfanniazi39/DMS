import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerPaymentDocumentsService } from './customer-payment-documents.service';

const ACTOR = { userId: 4, ipAddress: '127.0.0.1' };
const PDF = Buffer.from('%PDF-1.4 test');

function build(payment: { id: number; paymentNumber: string } | null = { id: 9, paymentNumber: 'RCP-1405-000001' }) {
  const tx = {
    customerPaymentDocument: { create: jest.fn().mockResolvedValue({ id: 5, originalName: 'slip.pdf' }), delete: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    customerPayment: { findUnique: jest.fn().mockResolvedValue(payment) },
    customerPaymentDocument: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new CustomerPaymentDocumentsService(prisma as never, audit as never), prisma, tx, audit };
}

describe('CustomerPaymentDocumentsService', () => {
  it('refuses an unknown payment, a disallowed extension and a file whose content does not match its extension — before writing anything', async () => {
    await expect(build(null).service.add(9, { originalName: 'a.pdf', buffer: PDF }, undefined, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    const { service, tx } = build();
    await expect(service.add(9, { originalName: 'a.exe', buffer: PDF }, undefined, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.add(9, { originalName: 'a.png', buffer: PDF }, undefined, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.customerPaymentDocument.create).not.toHaveBeenCalled();
  });

  it('resolveFile only accepts uuid-shaped names that a document row references', async () => {
    const { service, prisma } = build();
    await expect(service.resolveFile('../../etc/passwd')).rejects.toBeInstanceOf(NotFoundException);
    prisma.customerPaymentDocument.findFirst.mockResolvedValue(null);
    await expect(service.resolveFile('0b7e0b0e-0000-4000-8000-000000000000.pdf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove 404s a document that belongs to another payment', async () => {
    const { service, prisma } = build();
    prisma.customerPaymentDocument.findFirst.mockResolvedValue(null);
    await expect(service.remove(9, 77, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});
