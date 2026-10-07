import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isSameVersion, recordModifiedConflict } from '../common/optimistic-lock';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { ensureCustomerExists } from './customer-rules';
import type { CreateCustomerComplaintDto, UpdateCustomerComplaintDto } from './dto/customer.dto';

// Minimal complaint/issue register (business decision 8): plain CRUD, no
// workflow engine — status is a field the user sets. No linked transaction
// (Sales doesn't exist). Audited under the customer, action-only entries.
// Update uses the same optimistic lock as Purchase (complaints have their
// own updatedAt).
@Injectable()
export class CustomerComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: number, dto: CreateCustomerComplaintDto, userId: number | null, ipAddress?: string) {
    await ensureCustomerExists(this.prisma, customerId);
    if (dto.ownerUserId) await this.ensureActiveUser(dto.ownerUserId);
    return this.prisma.$transaction(async (tx) => {
      const complaint = await tx.customerComplaint.create({ data: { customerId, ...dto, createdByUserId: userId } });
      await this.audit.log(
        { userId, ipAddress, action: 'CUSTOMER_COMPLAINT_ADDED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: `شکایت #${complaint.id}` },
        tx,
      );
      return complaint;
    });
  }

  async update(customerId: number, complaintId: number, dto: UpdateCustomerComplaintDto, userId: number | null, ipAddress?: string) {
    const existing = await this.findOwned(customerId, complaintId);
    if (!isSameVersion(existing.updatedAt, dto.updatedAt)) throw recordModifiedConflict();
    // Only a newly assigned owner must be an active user; an owner already
    // on the record may stay even if their account was disabled since.
    if (dto.ownerUserId && dto.ownerUserId !== existing.ownerUserId) await this.ensureActiveUser(dto.ownerUserId);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.customerComplaint.updateMany({ where: { id: complaintId, updatedAt: existing.updatedAt }, data: { updatedAt: new Date() } });
      if (claimed.count !== 1) throw recordModifiedConflict();
      const complaint = await tx.customerComplaint.update({
        where: { id: complaintId },
        data: {
          date: dto.date,
          category: dto.category,
          description: dto.description,
          severity: dto.severity,
          status: dto.status,
          resolution: dto.resolution ?? null,
          ownerUserId: dto.ownerUserId ?? null,
        },
      });
      const details = existing.status === dto.status ? `شکایت #${complaintId}` : `شکایت #${complaintId}: از ${existing.status} به ${dto.status}`;
      await this.audit.log({ userId, ipAddress, action: 'CUSTOMER_COMPLAINT_UPDATED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details }, tx);
      return complaint;
    });
  }

  async remove(customerId: number, complaintId: number, userId: number | null, ipAddress?: string) {
    await this.findOwned(customerId, complaintId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerComplaint.delete({ where: { id: complaintId } });
      await this.audit.log(
        { userId, ipAddress, action: 'CUSTOMER_COMPLAINT_REMOVED', entityType: AUDIT_ENTITY.CUSTOMER, entityId: customerId, details: `شکایت #${complaintId}` },
        tx,
      );
    });
    return { success: true };
  }

  private async findOwned(customerId: number, complaintId: number) {
    const complaint = await this.prisma.customerComplaint.findFirst({ where: { id: complaintId, customerId } });
    if (!complaint) throw new NotFoundException('شکایت پیدا نشد');
    return complaint;
  }

  // Read-only "exists and active" lookup on users (CLAUDE.md rule 11 exception).
  private async ensureActiveUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') throw new ConflictException('کاربر مسئول پیگیری انتخاب‌شده فعال نیست');
  }
}
