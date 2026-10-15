import { BadRequestException, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { AuditService } from './audit.service';
import { DeletedRecordsService } from './deleted-records.service';

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} نامعتبر است`);
  return date;
}

// Admin-panel read of the shared audit log (user-activity page, a user's
// recent activity). Same gate as the rest of the Users & Access screens.
@Controller('audit')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('users.create')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly deletedRecords: DeletedRecordsService,
  ) {}

  // Snapshots of deleted records (kept until they expire). Snapshot bodies
  // have sensitive values masked at write time.
  @Get('deleted-records')
  listDeleted(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('q') q?: string,
    @Query('restored') restored?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parsedEntityId = entityId ? Number(entityId) : undefined;
    if (parsedEntityId !== undefined && !Number.isInteger(parsedEntityId)) throw new BadRequestException('شناسه نامعتبر است');
    const paging = parsePagination(page ?? '1', pageSize ?? '20')!;
    return this.deletedRecords.list({ entityType: entityType?.trim() || undefined, entityId: parsedEntityId, q: q?.trim() || undefined, restored: restored === 'true' ? true : restored === 'false' ? false : undefined, ...paging });
  }

  @Get('deleted-records/:id')
  getDeleted(@Param('id', ParseIntPipe) id: number) {
    return this.deletedRecords.get(id);
  }

  // Dry run of a restore — can this snapshot be put back right now, and if not, why.
  @Get('deleted-records/:id/restore-check')
  @RequirePermissions('users.create', 'records.restore')
  checkRestore(@Param('id', ParseIntPipe) id: number) {
    return this.deletedRecords.checkRestore(id);
  }

  @Post('deleted-records/:id/restore')
  @RequirePermissions('users.create', 'records.restore')
  restore(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.deletedRecords.restore(id, req.session.userId ?? null, req.ip);
  }

  @Get('activity')
  activity(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    let parsedUserId: number | undefined;
    if (userId) {
      parsedUserId = Number(userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId < 1) throw new BadRequestException('شناسه کاربر نامعتبر است');
    }
    const paging = parsePagination(page ?? '1', pageSize ?? '20')!;
    const toDate = parseDate(to, 'تاریخ پایان');
    return this.audit.listActivity({
      userId: parsedUserId,
      action: action?.trim() || undefined,
      entityType: entityType?.trim() || undefined,
      from: parseDate(from, 'تاریخ شروع'),
      // `to` is an inclusive day: the caller sends the start of the last day.
      to: toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : undefined,
      ...paging,
    });
  }
}
