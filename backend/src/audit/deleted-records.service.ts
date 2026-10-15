import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { maskForDisplay } from './deleted-records';
import { RestoreRegistry } from './restore/restore.registry';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Read side of the delete archive (see deleted-records.ts) plus the expiry
// purge. No scheduler dependency: one purge at startup, then once a day.
@Injectable()
export class DeletedRecordsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletedRecordsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RestoreRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.purgeExpired();
    this.timer = setInterval(() => void this.purgeExpired(), PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async purgeExpired(now = new Date()) {
    try {
      const { count } = await this.prisma.deletedRecord.deleteMany({ where: { expiresAt: { lt: now } } });
      if (count > 0) this.logger.log(`purged ${count} expired deleted-record snapshot(s)`);
      return count;
    } catch (error) {
      this.logger.error('purging deleted records failed', error as Error);
      return 0;
    }
  }

  async list(filter: { entityType?: string; entityId?: number; q?: string; restored?: boolean; page: number; pageSize: number }) {
    const where: Prisma.DeletedRecordWhereInput = {
      expiresAt: { gt: new Date() },
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId !== undefined ? { entityId: filter.entityId } : {}),
      ...(filter.q ? { label: { contains: filter.q, mode: 'insensitive' } } : {}),
      ...(filter.restored === undefined ? {} : { restoredAt: filter.restored ? { not: null } : null }),
    };
    const [total, items] = await Promise.all([
      this.prisma.deletedRecord.count({ where }),
      this.prisma.deletedRecord.findMany({
        where,
        orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          label: true,
          deletedAt: true,
          expiresAt: true,
          restoredAt: true,
          deletedBy: { select: { id: true, username: true } },
          restoredBy: { select: { id: true, username: true } },
        },
      }),
    ]);
    return { items: items.map((row) => ({ ...row, restorable: this.registry.has(row.entityType) && !row.restoredAt })), total, page: filter.page, pageSize: filter.pageSize };
  }

  async get(id: number) {
    const row = await this.prisma.deletedRecord.findFirst({
      where: { id, expiresAt: { gt: new Date() } },
      include: { deletedBy: { select: { id: true, username: true } }, restoredBy: { select: { id: true, username: true } } },
    });
    if (!row) throw new NotFoundException('سند حذف‌شده پیدا نشد یا مهلت نگهداری آن تمام شده است');
    // The stored snapshot is complete (a restore needs it); what is shown is masked.
    return { ...row, snapshot: maskForDisplay(row.snapshot), restorable: this.registry.has(row.entityType) && !row.restoredAt };
  }

  // Dry run: performs the whole restore inside a transaction and rolls it back,
  // so the answer is exactly what a real restore would say (same checks, same
  // messages). Returns { restorable, reason }.
  async checkRestore(id: number) {
    try {
      await this.run(id, null, undefined, true);
      return { restorable: true as const, reason: null };
    } catch (error) {
      if (error instanceof ConflictException) return { restorable: false as const, reason: this.messageOf(error) };
      throw error;
    }
  }

  async restore(id: number, userId: number | null, ipAddress?: string) {
    return this.run(id, userId, ipAddress, false);
  }

  private messageOf(error: ConflictException) {
    const response = error.getResponse();
    return typeof response === 'string' ? response : ((response as { message?: string }).message ?? 'بازیابی ممکن نیست');
  }

  private async run(id: number, userId: number | null, ipAddress: string | undefined, dryRun: boolean) {
    const row = await this.prisma.deletedRecord.findFirst({ where: { id, expiresAt: { gt: new Date() } } });
    if (!row) throw new NotFoundException('سند حذف‌شده پیدا نشد یا مهلت نگهداری آن تمام شده است');
    if (row.restoredAt) throw new ConflictException('این سند قبلاً بازیابی شده است');
    const restorer = this.registry.get(row.entityType);
    if (!restorer) throw new ConflictException('بازیابی این نوع سند پشتیبانی نمی‌شود');

    const DRY_RUN = Symbol('dry-run');
    let result: Awaited<ReturnType<typeof restorer.restore>> | undefined;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Claim the snapshot atomically so two admins cannot restore it twice.
        const claimed = await tx.deletedRecord.updateMany({
          where: { id, restoredAt: null, expiresAt: { gt: new Date() } },
          data: { restoredAt: new Date(), restoredByUserId: userId },
        });
        if (claimed.count !== 1) throw new ConflictException('این سند قبلاً بازیابی شده است');
        try {
          result = await restorer.restore({ record: row.snapshot as Record<string, unknown>, tx, userId, ipAddress });
        } catch (error) {
          throw this.translate(error);
        }
        if (dryRun) throw DRY_RUN;
      });
    } catch (error) {
      if (error !== DRY_RUN) throw error;
      return null;
    }
    const warnings = [...(result?.warnings ?? [])];
    if (result?.afterCommit) {
      await result.afterCommit().catch((error: Error) => {
        this.logger.error('after-restore step failed', error);
        warnings.push('بازیابی انجام شد اما به‌روزرسانی وضعیت سند وابسته (مثلاً درخواست خرید) ناموفق بود؛ لطفاً آن را بررسی کنید.');
      });
    }
    await this.audit.log({ userId, ipAddress, action: 'DELETED_RECORD_RESTORED', entityType: row.entityType, entityId: row.entityId, details: row.label ?? undefined });
    return { entityType: row.entityType, entityId: result!.entityId, warnings };
  }

  // Database refusals while re-inserting → a clear Persian reason.
  private translate(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return new ConflictException('کد یا شمارهٔ این سند اکنون برای رکورد دیگری استفاده شده است؛ بازیابی ممکن نیست');
      if (error.code === 'P2003') return new ConflictException('یکی از اطلاعات مرتبط با این سند (مثل مشتری، تأمین‌کننده، کالا یا واحد) دیگر وجود ندارد؛ بازیابی ممکن نیست');
    }
    return error;
  }
}
