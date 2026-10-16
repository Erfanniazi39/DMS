import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'fs';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import type { IncomingMessage } from 'http';
import { dirname, join, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { BACKUP_ROOT_DIR, DRIVE_FILE, MANIFEST_FILE, RESTORE_CONFIRM_TEXT } from './backup.constants';
import { BackupService } from './backup.service';
import { safeRelativePath } from './backup-files';
import { removeIfExists } from './backup-folder';
import { backupDirName, manifestSchema, planBackup, type BackupManifest, type DriveScan } from './backup-manifest';

// The drive is plugged into ANOTHER computer (an admin's PC) rather than the server. The browser there reads and
// writes the drive through the File System Access API; the server only builds the backup into a staging folder
// (and later lends it to the browser file by file), or receives the chosen backup file by file for a restore.
// Same on-disk format as a local backup, so a drive written this way can be restored either way.

const STAGING_TTL_MS = 3 * 60 * 60 * 1000;

export const remoteDriveSchema = z.object({
  // The drive's folder holds files that are not ours (and no DMS-Backup folder) — not usable for a backup.
  hasOtherContent: z.boolean(),
  driveDatabaseId: z.string().uuid().nullable().optional(),
  manifests: z.array(manifestSchema).max(2000),
  // Backup folders the browser could not read a valid manifest from.
  invalid: z.array(z.string().max(200)).max(100).optional(),
});
export type RemoteDriveDto = z.infer<typeof remoteDriveSchema>;

export const remoteStartSchema = remoteDriveSchema.extend({
  // Files an earlier manifest lists but the browser found missing/wrong-sized on the drive: they are sent again.
  missingFiles: z.array(z.string().max(500)).max(50_000).optional(),
});
export type RemoteStartDto = z.infer<typeof remoteStartSchema>;

type FileEntry = { path: string; size: number; sha256?: string };
type Actor = { userId: number; ipAddress?: string };

type BackupJob = { runId: string; dir: string; built: Awaited<ReturnType<BackupService['buildBackup']>> | null; actor: Actor; timer: NodeJS.Timeout };
type RestoreJob = { id: string; dir: string; chain: BackupManifest[]; highestOrdinal: number; expected: Map<string, FileEntry>; actor: Actor; timer: NodeJS.Timeout; started: boolean };

export function stagingRoot(): string {
  return process.env.BACKUP_STAGING_DIR || join(process.cwd(), 'backup-staging');
}

@Injectable()
export class BackupRemoteService implements OnModuleInit {
  private readonly logger = new Logger(BackupRemoteService.name);
  private readonly backupJobs = new Map<string, BackupJob>();
  private readonly restoreJobs = new Map<string, RestoreJob>();

  constructor(
    private readonly backups: BackupService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Anything left over from before a restart is useless: the jobs lived in memory.
    await removeIfExists(stagingRoot());
  }

  private scanOf(input: RemoteDriveDto, databaseId: string): DriveScan {
    const foreign = (input.driveDatabaseId != null && input.driveDatabaseId !== databaseId) || input.manifests.some((manifest) => manifest.databaseId !== databaseId);
    return {
      usable: !input.hasOtherContent,
      problems: input.hasOtherContent ? ['این پوشه خالی نیست و پشتیبان این سیستم هم در آن نیست؛ یک پوشهٔ خالی انتخاب کنید'] : (input.invalid ?? []).map((name) => `پوشهٔ «${name}» پشتیبان کامل و معتبری نیست و نادیده گرفته شد`),
      empty: input.manifests.length === 0 && !foreign,
      foreign,
      manifests: input.manifests.filter((manifest) => manifest.databaseId === databaseId),
    };
  }

  async plan(input: RemoteDriveDto) {
    const state = await this.backups.readState();
    const plan = planBackup(state, this.scanOf(input, state.databaseId));
    return { kind: plan.kind, reasons: plan.reasons, inSync: plan.inSync, previousBackupId: plan.previous?.backupId ?? null, previousAt: plan.previous?.createdAt ?? null };
  }

  // ---- backup onto a drive attached to the admin's own computer ---------------------------------

  async startBackup(input: RemoteStartDto, actor: Actor) {
    this.backups.assertIdle();
    const state = await this.backups.readState();
    const scan = this.scanOf(input, state.databaseId);
    const plan = planBackup(state, scan);
    if (plan.kind === 'BLOCKED') throw new ConflictException(plan.reasons.join(' '));

    const run = await this.prisma.backupRun.create({
      data: { kind: plan.kind, status: 'RUNNING', targetPath: 'کامپیوتر دیگر (از طریق مرورگر)', startedByUserId: actor.userId, progress: { phase: 'start', message: 'در حال شروع...' } },
    });
    this.backups.markRunning(run.id, plan.kind);
    const dir = join(stagingRoot(), run.id);
    const job: BackupJob = { runId: run.id, dir, built: null, actor, timer: setTimeout(() => void this.abortBackup(run.id, 'مهلت انتقال به حافظه تمام شد').catch(() => undefined), STAGING_TTL_MS) };
    this.backupJobs.set(run.id, job);
    void this.backups
      .buildBackup(run.id, dir, plan, scan.manifests, { assumePool: true, missingFiles: new Set(input.missingFiles ?? []) })
      .then(async (built) => {
        job.built = built;
        await this.backups.setProgress(run.id, { phase: 'awaiting-drive', message: 'آمادهٔ انتقال به حافظه' }, true);
      })
      .catch(async (error) => {
        await this.backups.failRun(run.id, error, actor);
        await this.dropBackupJob(run.id);
      });
    return this.backups.presentRun(run);
  }

  private jobOf(runId: string): BackupJob {
    const job = this.backupJobs.get(runId);
    if (!job) throw new NotFoundException('کار پشتیبان‌گیری پیدا نشد (ممکن است لغو یا منقضی شده باشد)');
    return job;
  }

  private async dropBackupJob(runId: string) {
    const job = this.backupJobs.get(runId);
    if (job) clearTimeout(job.timer);
    this.backupJobs.delete(runId);
    await removeIfExists(join(stagingRoot(), runId)).catch(() => undefined);
    this.backups.clearRunning();
  }

  // Everything the browser must write onto the drive, paths relative to the drive's DMS-Backup folder.
  // Pool files and data files first, each backup's manifest.json last: a backup is only valid once its manifest is there.
  async listFiles(runId: string): Promise<FileEntry[]> {
    const job = this.jobOf(runId);
    if (!job.built) throw new ConflictException('پشتیبان هنوز آماده نیست');
    const root = join(job.dir, BACKUP_ROOT_DIR);
    const entries: FileEntry[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, item.name);
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) await walk(absolute, path);
        else if (item.isFile()) entries.push({ path, size: (await stat(absolute)).size });
      }
    };
    await walk(root, '');
    const isManifest = (entry: FileEntry) => entry.path.endsWith(`/${MANIFEST_FILE}`);
    return [...entries.filter((entry) => !isManifest(entry)), ...entries.filter(isManifest)];
  }

  async openFile(runId: string, path: string): Promise<{ stream: ReadStream; size: number }> {
    const job = this.jobOf(runId);
    if (!job.built) throw new ConflictException('پشتیبان هنوز آماده نیست');
    const absolute = this.stagingPath(job.dir, path);
    let size: number;
    try {
      size = (await stat(absolute)).size;
    } catch {
      throw new NotFoundException('فایل پیدا نشد');
    }
    return { stream: createReadStream(absolute), size };
  }

  private stagingPath(jobDir: string, relative: string): string {
    if (!safeRelativePath(relative) || !(relative === DRIVE_FILE || relative.startsWith('backups/') || relative.startsWith('files/'))) throw new BadRequestException('مسیر فایل نامعتبر است');
    const root = resolve(jobDir, BACKUP_ROOT_DIR);
    const absolute = resolve(root, ...relative.split('/'));
    if (!absolute.startsWith(`${root}${sep}`)) throw new BadRequestException('مسیر فایل نامعتبر است');
    return absolute;
  }

  // The browser has written and checked everything: only now does the system remember this backup.
  async commitBackup(runId: string, actor: Actor) {
    const job = this.jobOf(runId);
    if (!job.built) throw new ConflictException('پشتیبان هنوز آماده نیست');
    try {
      await this.backups.finalizeBackup(runId, 'کامپیوتر دیگر (از طریق مرورگر)', job.built, actor);
    } catch (error) {
      await this.backups.failRun(runId, error, actor);
      throw error;
    } finally {
      await this.dropBackupJob(runId);
    }
    return this.backups.getRun(runId);
  }

  async abortBackup(runId: string, reason = 'توسط کاربر لغو شد') {
    const job = this.backupJobs.get(runId);
    if (!job) return { success: true };
    await this.backups.failRun(runId, new Error(reason), job.actor);
    await this.dropBackupJob(runId);
    return { success: true };
  }

  // ---- restore from a drive attached to the admin's own computer --------------------------------

  // The browser sends the drive's manifests and the backup it wants; the server answers with the files it needs.
  async beginRestore(manifests: BackupManifest[], backupId: string, actor: Actor) {
    this.backups.assertIdle();
    const { chain, highestOrdinal } = await this.backups.prepareRestore(manifests, backupId);
    const target = chain[chain.length - 1];
    const id = randomUUID();
    const dir = join(stagingRoot(), `restore-${id}`);
    const expected = new Map<string, FileEntry>();
    for (const manifest of chain) {
      const base = `backups/${backupDirName(manifest)}`;
      await mkdir(join(dir, BACKUP_ROOT_DIR, base), { recursive: true });
      await writeFile(join(dir, BACKUP_ROOT_DIR, base, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
      for (const entry of [...manifest.tables, ...(manifest.changes ? [manifest.changes] : [])]) expected.set(`${base}/${entry.file}`, { path: `${base}/${entry.file}`, size: entry.bytes, sha256: entry.sha256 });
    }
    for (const file of target.files) expected.set(`files/${file.path}`, { path: `files/${file.path}`, size: file.size, sha256: file.sha256 });
    const job: RestoreJob = { id, dir, chain, highestOrdinal, expected, actor, started: false, timer: setTimeout(() => void this.dropRestoreJob(id), STAGING_TTL_MS) };
    this.restoreJobs.set(id, job);
    return { jobId: id, target: { backupId: target.backupId, ordinal: target.ordinal, createdAt: target.createdAt }, files: [...expected.values()] };
  }

  private restoreJobOf(jobId: string): RestoreJob {
    const job = this.restoreJobs.get(jobId);
    if (!job) throw new NotFoundException('کار بازیابی پیدا نشد (ممکن است منقضی شده باشد)');
    return job;
  }

  private async dropRestoreJob(jobId: string) {
    const job = this.restoreJobs.get(jobId);
    if (job) clearTimeout(job.timer);
    this.restoreJobs.delete(jobId);
    await removeIfExists(join(stagingRoot(), `restore-${jobId}`)).catch(() => undefined);
  }

  // Appends one piece of a file. `offset` must equal what has arrived so far (0 starts the file over).
  async receiveChunk(jobId: string, path: string, offset: number, request: IncomingMessage): Promise<{ received: number }> {
    const job = this.restoreJobOf(jobId);
    if (job.started) throw new ConflictException('بازیابی شروع شده است');
    const entry = job.expected.get(path);
    if (!entry) throw new BadRequestException('این فایل جزو پشتیبان انتخاب‌شده نیست');
    const absolute = this.stagingPath(job.dir, path);
    await mkdir(dirname(absolute), { recursive: true });
    let current = 0;
    try {
      current = (await stat(absolute)).size;
    } catch {
      current = 0;
    }
    if (offset === 0 && current > 0) {
      await rm(absolute, { force: true });
      current = 0;
    }
    if (offset !== current) throw new ConflictException(`ادامهٔ فایل از محل نادرست است (دریافت‌شده: ${current})`);
    const output = createWriteStream(absolute, { flags: 'a' });
    let received = 0;
    request.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (current + received > entry.size) request.destroy(new Error('حجم فایل بیشتر از انتظار است'));
    });
    await pipeline(request, output);
    return { received: current + received };
  }

  async startRestore(jobId: string, confirmText: string, actor: Actor) {
    if (confirmText.trim() !== RESTORE_CONFIRM_TEXT) throw new BadRequestException(`برای تأیید، کلمهٔ «${RESTORE_CONFIRM_TEXT}» را دقیقاً تایپ کنید`);
    const job = this.restoreJobOf(jobId);
    if (job.started) throw new ConflictException('بازیابی شروع شده است');
    this.backups.assertIdle();
    for (const entry of job.expected.values()) {
      let size = -1;
      try {
        size = (await stat(this.stagingPath(job.dir, entry.path))).size;
      } catch {
        size = -1;
      }
      if (size !== entry.size) throw new ConflictException(`فایل «${entry.path}» کامل منتقل نشده است`);
    }
    job.started = true;
    const target = job.chain[job.chain.length - 1];
    const run = await this.prisma.backupRun.create({
      data: { kind: 'RESTORE', status: 'RUNNING', targetPath: 'کامپیوتر دیگر (از طریق مرورگر)', startedByUserId: actor.userId, backupId: target.backupId, ordinal: target.ordinal, progress: { phase: 'start', message: 'در حال شروع...' } },
    });
    this.backups.markRunning(run.id, 'RESTORE');
    void this.backups
      .executeRestore(run.id, job.dir, job.chain, job.highestOrdinal, actor)
      .catch((error) => this.logger.error(`remote restore ${run.id} crashed: ${error}`))
      .finally(() => void this.dropRestoreJob(jobId));
    return this.backups.presentRun(run);
  }

  async cancelRestore(jobId: string) {
    await this.dropRestoreJob(jobId);
    return { success: true };
  }
}
