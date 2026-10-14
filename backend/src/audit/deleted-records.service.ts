import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Read side of the delete archive (see deleted-records.ts) plus the expiry
// purge. No scheduler dependency: one purge at startup, then once a day.
@Injectable()
export class DeletedRecordsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletedRecordsService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

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

  async list(filter: { entityType?: string; entityId?: number; q?: string; page: number; pageSize: number }) {
    const where: Prisma.DeletedRecordWhereInput = {
      expiresAt: { gt: new Date() },
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId !== undefined ? { entityId: filter.entityId } : {}),
      ...(filter.q ? { label: { contains: filter.q, mode: 'insensitive' } } : {}),
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
          deletedBy: { select: { id: true, username: true } },
        },
      }),
    ]);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }

  async get(id: number) {
    const row = await this.prisma.deletedRecord.findFirst({
      where: { id, expiresAt: { gt: new Date() } },
      include: { deletedBy: { select: { id: true, username: true } } },
    });
    if (!row) throw new NotFoundException('سند حذف‌شده پیدا نشد یا مهلت نگهداری آن تمام شده است');
    return row;
  }
}
