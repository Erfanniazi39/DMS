import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BackupService } from './backup.service';
import { BackupRemoteService, remoteDriveSchema, remoteStartSchema, type RemoteDriveDto, type RemoteStartDto } from './backup-remote.service';
import { manifestSchema } from './backup-manifest';

const pathSchema = z.object({ path: z.string({ error: 'مسیر پوشه را وارد کنید' }).trim().min(1, 'مسیر پوشه را وارد کنید').max(500) });
const restoreSchema = pathSchema.extend({
  backupId: z.string({ error: 'پشتیبان را انتخاب کنید' }).uuid('پشتیبان نامعتبر است'),
  confirmText: z.string({ error: 'تأیید لازم است' }).max(50),
});
const remoteBeginSchema = z.object({ manifests: z.array(manifestSchema).max(2000), backupId: z.string().uuid() });
const remoteConfirmSchema = z.object({ confirmText: z.string({ error: 'تأیید لازم است' }).max(50) });
type RemoteBeginDto = z.infer<typeof remoteBeginSchema>;
type RemoteConfirmDto = z.infer<typeof remoteConfirmSchema>;
type PathDto = z.infer<typeof pathSchema>;
type RestoreDto = z.infer<typeof restoreSchema>;

// Admin only. Taking a backup needs backup.manage, restoring from one needs backup.restore (both ADMIN
// only — migration 20261015210000). The drive is a folder on the SERVER computer.
@Controller('backup')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class BackupController {
  constructor(
    private readonly backups: BackupService,
    private readonly remote: BackupRemoteService,
  ) {}

  // The plan for a folder: what the system last backed up, what the drive holds, and what pressing the button will do.
  @Get('status')
  @RequirePermissions('backup.manage')
  status(@Query('path') path?: string) {
    return this.backups.status(path);
  }

  @Get('runs')
  @RequirePermissions('backup.manage')
  runs() {
    return this.backups.listRuns();
  }

  @Get('runs/:id')
  @RequirePermissions('backup.manage')
  run(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.backups.getRun(id);
  }

  @Post('run')
  @RequirePermissions('backup.manage')
  start(@Body(new ZodValidationPipe(pathSchema)) dto: PathDto, @Req() req: Request) {
    return this.backups.startBackup(dto.path, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  @Get('points')
  @RequirePermissions('backup.restore')
  points(@Query('path') path: string) {
    return this.backups.restorePoints(path ?? '');
  }

  @Post('restore')
  @RequirePermissions('backup.restore')
  restore(@Body(new ZodValidationPipe(restoreSchema)) dto: RestoreDto, @Req() req: Request) {
    return this.backups.startRestore(dto.path, dto.backupId, dto.confirmText, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  // ---- the drive is plugged into another computer: the browser moves the files -----------------

  @Post('remote/plan')
  @RequirePermissions('backup.manage')
  remotePlan(@Body(new ZodValidationPipe(remoteDriveSchema)) dto: RemoteDriveDto) {
    return this.remote.plan(dto);
  }

  @Post('remote/start')
  @RequirePermissions('backup.manage')
  remoteStart(@Body(new ZodValidationPipe(remoteStartSchema)) dto: RemoteStartDto, @Req() req: Request) {
    return this.remote.startBackup(dto, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  @Get('remote/:runId/files')
  @RequirePermissions('backup.manage')
  remoteFiles(@Param('runId', new ParseUUIDPipe()) runId: string) {
    return this.remote.listFiles(runId);
  }

  @Get('remote/:runId/file')
  @RequirePermissions('backup.manage')
  async remoteFile(@Param('runId', new ParseUUIDPipe()) runId: string, @Query('path') path?: string) {
    if (!path) throw new BadRequestException('مسیر فایل را وارد کنید');
    const { stream, size } = await this.remote.openFile(runId, path);
    return new StreamableFile(stream, { type: 'application/octet-stream', length: size, disposition: 'attachment' });
  }

  @Post('remote/:runId/commit')
  @RequirePermissions('backup.manage')
  remoteCommit(@Param('runId', new ParseUUIDPipe()) runId: string, @Req() req: Request) {
    return this.remote.commitBackup(runId, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  @Post('remote/:runId/abort')
  @RequirePermissions('backup.manage')
  remoteAbort(@Param('runId', new ParseUUIDPipe()) runId: string) {
    return this.remote.abortBackup(runId);
  }

  @Post('remote/restore/begin')
  @RequirePermissions('backup.restore')
  remoteRestoreBegin(@Body(new ZodValidationPipe(remoteBeginSchema)) dto: RemoteBeginDto, @Req() req: Request) {
    return this.remote.beginRestore(dto.manifests, dto.backupId, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  // The body is the raw bytes of one piece of a file (not JSON).
  @Put('remote/restore/:jobId/file')
  @RequirePermissions('backup.restore')
  remoteRestoreChunk(@Param('jobId', new ParseUUIDPipe()) jobId: string, @Query('path') path: string, @Query('offset') offset: string, @Req() req: Request) {
    const parsedOffset = Number(offset);
    if (!path || !Number.isInteger(parsedOffset) || parsedOffset < 0) throw new BadRequestException('اطلاعات قطعهٔ فایل نامعتبر است');
    return this.remote.receiveChunk(jobId, path, parsedOffset, req);
  }

  @Post('remote/restore/:jobId/start')
  @RequirePermissions('backup.restore')
  remoteRestoreStart(@Param('jobId', new ParseUUIDPipe()) jobId: string, @Body(new ZodValidationPipe(remoteConfirmSchema)) dto: RemoteConfirmDto, @Req() req: Request) {
    return this.remote.startRestore(jobId, dto.confirmText, { userId: req.session.userId as number, ipAddress: req.ip });
  }

  @Post('remote/restore/:jobId/cancel')
  @RequirePermissions('backup.restore')
  remoteRestoreCancel(@Param('jobId', new ParseUUIDPipe()) jobId: string) {
    return this.remote.cancelRestore(jobId);
  }
}
