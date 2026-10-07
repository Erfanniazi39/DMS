import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CustomerNoteDto } from './dto/customer.dto';

// Customer notes. A pinned WARNING note is what the list's warning icon and
// the detail header's warning banner show. Audited under the customer
// (action-only entries; the note body is not copied into the audit log).
@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: number, dto: CustomerNoteDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.create({ data: { customerId, ...dto, createdByUserId: userId } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_NOTE_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: note.noteType }, tx);
      return note;
    });
  }

  async update(customerId: number, noteId: number, dto: CustomerNoteDto, userId: number | null, ipAddress?: string) {
    await this.findOwned(customerId, noteId);
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.update({ where: { id: noteId }, data: { noteType: dto.noteType, body: dto.body, isPinned: dto.isPinned } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_NOTE_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: note.noteType }, tx);
      return note;
    });
  }

  async remove(customerId: number, noteId: number, userId: number | null, ipAddress?: string) {
    const note = await this.findOwned(customerId, noteId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerNote.delete({ where: { id: noteId } });
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_NOTE_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: note.noteType }, tx);
    });
    return { success: true };
  }

  private async findOwned(customerId: number, noteId: number) {
    const note = await this.prisma.customerNote.findFirst({ where: { id: noteId, customerId } });
    if (!note) throw new NotFoundException('یادداشت پیدا نشد');
    return note;
  }
}
