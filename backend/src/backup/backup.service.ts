import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, rename, rm, stat, truncate, writeFile } from 'fs/promises';
import type { IncomingMessage } from 'http';
import { pipeline } from 'stream/promises';
import { dirname, join, resolve, sep } from 'path';
import type { Client } from 'pg';
import { AuditService } from '../audit/audit.service';
import { clearSessionAccessCache } from '../auth/session-access';
import { PrismaService } from '../prisma/prisma.service';
import { RESTORE_CONFIRM_TEXT } from './backup.constants';
import { BackupMaintenanceState } from './backup-maintenance';
import * as db from './backup-db';
import { restoreFilesFromPool, safeRelativePath, syncFilesToPool, verifyPoolFiles } from './backup-files';
import { backupsDir, ensureDriveStructure, filesPool, freeBytes, manifestPath, normalizeTargetPath, removeIfExists, scanDrive } from './backup-folder';
import { sha256File } from './backup-io';
import { backupDirName, chainIsValid, manifestSchema, planBackup, resolveChain, type BackupManifest, type BackupPlan, type DriveScan, type ManifestFile, type SystemBackupState } from './backup-manifest';

type Progress = { phase: string; done?: number; total?: number; message: string };
type BuiltBackup = { manifest: BackupManifest; finalDir: string; rows: number; bytes: number };

const ENTITY = 'Backup';

function uploadsDir() {
  return join(process.cwd(), 'uploads');
}

// Where the automatic safety copy taken right before a restore is kept (on the server itself).
function localBackupDir() {
  return process.env.BACKUP_LOCAL_DIR || join(process.cwd(), 'local-backups');
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL تنظیم نشده است');
  return url;
}

// Backup and restore of the whole system to a folder (a flash drive). See README.md in this folder for the design.
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private running: { id: string; kind: 'FULL' | 'INCREMENTAL' | 'RESTORE' } | null = null;
  private lastProgressWrite = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: BackupMaintenanceState,
  ) {}

  async onModuleInit() {
    // A job that was running when the server stopped did not finish.
    await this.prisma.backupRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', error: 'کار با توقف سرور نیمه‌کاره ماند', finishedAt: new Date() } });
    // Tables added by later migrations get their change-capture triggers here.
    await this.prisma.$queryRaw`SELECT backup_install_triggers()`;
  }

  // ---- status / plan --------------------------------------------------------------------------

  async readState(): Promise<SystemBackupState & { lastPath: string | null; lastBackupOrdinal: number | null }> {
    const state = await this.prisma.backupState.findUniqueOrThrow({ where: { id: 1 } });
    return {
      databaseId: state.databaseId,
      generationId: state.generationId,
      backupCounter: state.backupCounter,
      prunedThroughOrdinal: state.prunedThroughOrdinal,
      lastBackupId: state.lastBackupId,
      lastBackupAt: state.lastBackupAt,
      lastPath: state.lastPath,
      lastBackupOrdinal: state.lastBackupOrdinal,
    };
  }

  async status(path?: string) {
    const state = await this.readState();
    const changeLog = await this.prisma.backupChangeLog.count();
    let drive = null;
    let plan: BackupPlan | null = null;
    if (path?.trim()) {
      const folder = normalizeTargetPath(path);
      const scan = await scanDrive(folder, state.databaseId);
      plan = planBackup(state, scan);
      drive = {
        path: folder,
        usable: scan.usable,
        problems: scan.problems,
        empty: scan.empty,
        foreign: scan.foreign,
        freeBytes: await freeBytes(folder),
        backups: scan.manifests
          .slice()
          .sort((a, b) => b.ordinal - a.ordinal)
          .map((manifest) => this.presentManifest(manifest)),
      };
    }
    return {
      system: {
        databaseId: state.databaseId,
        generationId: state.generationId,
        lastBackupId: state.lastBackupId,
        lastBackupAt: state.lastBackupAt,
        lastPath: state.lastPath,
        pendingChanges: changeLog,
      },
      drive,
      plan: plan && { kind: plan.kind, reasons: plan.reasons, inSync: plan.inSync, previousBackupId: plan.previous?.backupId ?? null, previousAt: plan.previous?.createdAt ?? null },
      running: this.running,
    };
  }

  private presentManifest(manifest: BackupManifest) {
    return {
      backupId: manifest.backupId,
      kind: manifest.kind,
      ordinal: manifest.ordinal,
      createdAt: manifest.createdAt,
      rows: manifest.totals.rows,
      files: manifest.totals.files,
      bytes: manifest.totals.bytes,
      generationId: manifest.generationId,
    };
  }

  // Backups on a drive that can be restored (their whole chain is present), newest first.
  async restorePoints(path: string) {
    const folder = normalizeTargetPath(path);
    const scan = await scanDrive(folder, null);
    if (!scan.usable && scan.manifests.length === 0) throw new BadRequestException(scan.problems[0] ?? 'پوشه قابل استفاده نیست');
    const databases = new Set(scan.manifests.map((manifest) => manifest.databaseId));
    if (databases.size > 1) throw new BadRequestException('روی این حافظه پشتیبان چند پایگاه‌دادهٔ مختلف هست؛ بازیابی ممکن نیست');
    return {
      path: folder,
      points: scan.manifests
        .filter((manifest) => chainIsValid(scan.manifests, manifest.backupId))
        .sort((a, b) => b.ordinal - a.ordinal)
        .map((manifest) => this.presentManifest(manifest)),
      problems: scan.problems,
    };
  }

  async listRuns(limit = 20) {
    const runs = await this.prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
    return runs.map((run) => this.presentRun(run));
  }

  async getRun(id: string) {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('کار پیدا نشد');
    return this.presentRun(run);
  }

  presentRun(run: { id: string; kind: string; status: string; startedAt: Date; finishedAt: Date | null; targetPath: string | null; backupId: string | null; ordinal: number | null; rowCount: bigint | null; fileCount: number | null; bytes: bigint | null; error: string | null; progress: unknown; startedByUserId: number | null }) {
    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      targetPath: run.targetPath,
      backupId: run.backupId,
      ordinal: run.ordinal,
      rowCount: run.rowCount === null ? null : Number(run.rowCount),
      fileCount: run.fileCount,
      bytes: run.bytes === null ? null : Number(run.bytes),
      error: run.error,
      progress: run.progress,
      startedByUserId: run.startedByUserId,
    };
  }

  // Used by BackupRemoteService, which owns a job while the browser moves the files.
  markRunning(id: string, kind: 'FULL' | 'INCREMENTAL' | 'RESTORE') {
    this.running = { id, kind };
  }
  clearRunning() {
    this.running = null;
  }

  // ---- progress helpers -------------------------------------------------------------------------

  async setProgress(runId: string, progress: Progress, force = false) {
    const now = Date.now();
    if (!force && now - this.lastProgressWrite < 800) return;
    this.lastProgressWrite = now;
    await this.prisma.backupRun.update({ where: { id: runId }, data: { progress: progress as never } }).catch(() => undefined);
  }

  assertIdle() {
    if (this.running) throw new ConflictException('یک پشتیبان‌گیری یا بازیابی در حال اجراست؛ تا پایان آن صبر کنید');
  }

  // ---- backup -----------------------------------------------------------------------------------

  // Validates and starts a backup in the background; the caller follows it through getRun().
  async startBackup(path: string, actor: { userId: number; ipAddress?: string }) {
    this.assertIdle();
    const folder = normalizeTargetPath(path);
    const state = await this.readState();
    const scan = await scanDrive(folder, state.databaseId);
    const plan = planBackup(state, scan);
    if (plan.kind === 'BLOCKED') throw new ConflictException(plan.reasons.join(' '));
    await this.ensureSpace(folder, plan.kind);

    const run = await this.prisma.backupRun.create({
      data: { kind: plan.kind, status: 'RUNNING', targetPath: folder, startedByUserId: actor.userId, progress: { phase: 'start', message: 'در حال شروع...' } },
    });
    this.running = { id: run.id, kind: plan.kind };
    void this.executeBackup(run.id, folder, plan, scan.manifests, actor).catch((error) => this.logger.error(`backup ${run.id} crashed: ${error}`));
    return this.presentRun(run);
  }

  private async ensureSpace(folder: string, kind: 'FULL' | 'INCREMENTAL') {
    if (kind !== 'FULL') return;
    const free = await freeBytes(folder);
    if (free === null) return;
    const [size] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    const needed = Number(size.size) + 50 * 1024 * 1024;
    if (free < needed) throw new ConflictException(`فضای خالی حافظه کم است (حدود ${Math.ceil(needed / 1024 / 1024)} مگابایت لازم است)`);
  }

  // Local mode: build the backup straight onto the drive's folder, then record it.
  private async executeBackup(
    runId: string,
    folder: string,
    plan: BackupPlan,
    driveManifests: BackupManifest[],
    actor: { userId: number | null; ipAddress?: string },
    options: { internal?: boolean } = {},
  ) {
    try {
      const built = await this.buildBackup(runId, folder, plan, driveManifests, {});
      await this.finalizeBackup(runId, folder, built, actor, options);
    } catch (error) {
      await this.failRun(runId, error, actor, options);
      if (options.internal) throw error;
    } finally {
      if (!options.internal) this.running = null;
    }
  }

  async failRun(runId: string, error: unknown, actor: { userId: number | null; ipAddress?: string }, options: { internal?: boolean } = {}) {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.backupRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 1000) } }).catch(() => undefined);
    if (!options.internal) {
      await this.audit.log({ userId: actor.userId, ipAddress: actor.ipAddress, action: 'BACKUP_FAILED', entityType: ENTITY, details: message.slice(0, 300) }).catch(() => undefined);
    }
  }

  // Reads the database (one consistent snapshot) and the uploaded files into `folder`, as one new backup
  // folder that is complete (manifest last) when this returns. Touches no bookkeeping — finalizeBackup does.
  async buildBackup(
    runId: string,
    folder: string,
    plan: BackupPlan,
    driveManifests: BackupManifest[],
    options: { assumePool?: boolean; missingFiles?: Set<string> },
  ): Promise<BuiltBackup> {
    let client: Client | null = null;
    let tempDir: string | null = null;
    try {
      const state = await this.readState();
      const kind = plan.kind as 'FULL' | 'INCREMENTAL';
      const backupId = randomUUID();
      const previous = plan.previous;
      const generationId = kind === 'INCREMENTAL' && previous ? previous.generationId : (state.generationId ?? randomUUID());
      const [{ ordinal }] = await this.prisma.$queryRaw<{ ordinal: number }[]>`UPDATE backup_state SET backup_counter = backup_counter + 1 WHERE id = 1 RETURNING backup_counter AS ordinal`;

      await ensureDriveStructure(folder, state.databaseId);
      tempDir = join(backupsDir(folder), `.tmp-${backupId}`);
      await mkdir(tempDir, { recursive: true });

      client = await db.connect(connectionString());
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await db.currentSnapshot(client);
      const migrations = await db.appliedMigrations(client);
      const tables: BackupManifest['tables'] = [];
      let changes: BackupManifest['changes'] = null;
      let rows = 0;
      let bytes = 0;

      if (kind === 'FULL') {
        const names = await db.listTables(client);
        let index = 0;
        for (const name of names) {
          await this.setProgress(runId, { phase: 'tables', done: index, total: names.length, message: `جدول ${name}` });
          const file = `${name}.ndjson.gz`;
          const result = await db.exportTable(client, name, join(tempDir, file));
          tables.push({ name, file, rows: result.rows, bytes: result.bytes, sha256: result.sha256 });
          rows += result.rows;
          bytes += result.bytes;
          index += 1;
        }
      } else {
        await this.setProgress(runId, { phase: 'changes', message: 'تغییرات از پشتیبان قبلی' }, true);
        const result = await db.exportChanges(client, previous!.snapshot, snapshot, join(tempDir, 'changes.tsv.gz'));
        changes = { file: 'changes.tsv.gz', entries: result.entries, bytes: result.bytes, sha256: result.sha256 };
        rows = result.entries;
        bytes = result.bytes;
      }
      await client.query('COMMIT');

      // Files are copied AFTER the snapshot, so every file a dumped row points to is already there.
      const known = new Map<string, ManifestFile>();
      const newest = [...driveManifests].sort((a, b) => b.ordinal - a.ordinal)[0];
      for (const file of (previous ?? newest)?.files ?? []) if (!options.missingFiles?.has(file.path)) known.set(file.path, file);
      const synced = await syncFilesToPool(uploadsDir(), filesPool(folder), known, (done, total) => void this.setProgress(runId, { phase: 'files', done, total, message: 'فایل‌های بارگذاری‌شده' }), options.assumePool === true);
      const fileBytes = synced.files.reduce((sum, file) => sum + file.size, 0);

      const manifest: BackupManifest = {
        format: 1,
        backupId,
        kind,
        databaseId: state.databaseId,
        generationId,
        ordinal,
        baseBackupId: kind === 'FULL' ? backupId : previous!.baseBackupId,
        previousBackupId: previous?.backupId ?? null,
        createdAt: new Date().toISOString(),
        snapshot,
        migrations,
        tables,
        changes,
        files: synced.files,
        totals: { rows, files: synced.files.length, bytes: bytes + fileBytes },
      };
      await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Read back what was written before calling the backup good.
      await this.setProgress(runId, { phase: 'verify', message: 'بررسی فایل‌های پشتیبان' }, true);
      for (const entry of [...tables, ...(changes ? [changes] : [])]) {
        if ((await sha256File(join(tempDir, entry.file))) !== entry.sha256) throw new Error(`فایل «${entry.file}» درست روی حافظه نوشته نشد`);
      }
      const finalDir = join(backupsDir(folder), backupDirName(manifest));
      await rename(tempDir, finalDir);
      tempDir = null;
      return { manifest, finalDir, rows, bytes: bytes + fileBytes };
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      if (tempDir) await removeIfExists(tempDir).catch(() => undefined);
      throw error;
    } finally {
      if (client) await client.end().catch(() => undefined);
    }
  }

  // The backup is safely on the drive: remember it, then drop the change-log rows no drive can ask for any more.
  async finalizeBackup(runId: string, folder: string, built: BuiltBackup, actor: { userId: number | null; ipAddress?: string }, options: { internal?: boolean } = {}) {
    const { manifest } = built;
    await this.prisma.backupState.update({
      where: { id: 1 },
      data: {
        generationId: manifest.generationId,
        lastBackupId: manifest.backupId,
        lastBackupOrdinal: manifest.ordinal,
        lastBackupSnapshot: manifest.snapshot,
        lastBackupAt: new Date(),
        lastPath: folder,
        updatedAt: new Date(),
      },
    });
    const priorRun = await this.prisma.backupRun.findFirst({ where: { status: 'OK', kind: { in: ['FULL', 'INCREMENTAL'] }, ordinal: { lt: manifest.ordinal } }, orderBy: { ordinal: 'desc' } });
    if (priorRun?.snapshot && priorRun.ordinal !== null) {
      const client = await db.connect(connectionString());
      try {
        await db.pruneChangeLog(client, priorRun.snapshot);
      } finally {
        await client.end();
      }
      await this.prisma.$executeRaw`UPDATE backup_state SET pruned_through_ordinal = GREATEST(pruned_through_ordinal, ${priorRun.ordinal}) WHERE id = 1`;
    }
    await this.prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: 'OK',
        finishedAt: new Date(),
        backupId: manifest.backupId,
        ordinal: manifest.ordinal,
        generationId: manifest.generationId,
        snapshot: manifest.snapshot,
        rowCount: BigInt(built.rows),
        fileCount: manifest.files.length,
        bytes: BigInt(built.bytes),
        progress: { phase: 'done', message: manifest.kind === 'FULL' ? 'پشتیبان کامل انجام شد' : 'پشتیبان تغییرات انجام شد' },
      },
    });
    if (!options.internal) {
      await this.audit.log({ userId: actor.userId, ipAddress: actor.ipAddress, action: 'BACKUP_CREATED', entityType: ENTITY, details: `${manifest.kind === 'FULL' ? 'کامل' : 'افزایشی'} — شمارهٔ ${manifest.ordinal} — ${folder}` });
    }
  }

  // ---- restore ----------------------------------------------------------------------------------

  async startRestore(path: string, backupId: string, confirmText: string, actor: { userId: number; ipAddress?: string }) {
    if (confirmText.trim() !== RESTORE_CONFIRM_TEXT) throw new BadRequestException(`برای تأیید، کلمهٔ «${RESTORE_CONFIRM_TEXT}» را دقیقاً تایپ کنید`);
    this.assertIdle();
    const folder = normalizeTargetPath(path);
    const scan = await scanDrive(folder, null);
    const { chain, highestOrdinal } = await this.prepareRestore(scan.manifests, backupId);
    const target = chain[chain.length - 1];

    const run = await this.prisma.backupRun.create({
      data: { kind: 'RESTORE', status: 'RUNNING', targetPath: folder, startedByUserId: actor.userId, backupId: target.backupId, ordinal: target.ordinal, progress: { phase: 'start', message: 'در حال شروع...' } },
    });
    this.running = { id: run.id, kind: 'RESTORE' };
    void this.executeRestore(run.id, folder, chain, highestOrdinal, actor).catch((error) => this.logger.error(`restore ${run.id} crashed: ${error}`));
    return this.presentRun(run);
  }

  // Checks that `backupId` can be restored from these manifests (one database, whole chain present, same schema
  // version as this system) and returns the chain to replay.
  async prepareRestore(manifests: BackupManifest[], backupId: string): Promise<{ chain: BackupManifest[]; highestOrdinal: number }> {
    const databases = new Set(manifests.map((manifest) => manifest.databaseId));
    if (databases.size !== 1) throw new BadRequestException('روی این حافظه پشتیبانی از یک پایگاه‌داده پیدا نشد');
    let chain: BackupManifest[];
    try {
      chain = resolveChain(manifests, backupId);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'زنجیرهٔ پشتیبان ناقص است');
    }
    const target = chain[chain.length - 1];
    const client = await db.connect(connectionString());
    try {
      const current = await db.appliedMigrations(client);
      if (JSON.stringify(current) !== JSON.stringify(target.migrations)) {
        throw new ConflictException('نسخهٔ ساختار پایگاه‌داده با این پشتیبان یکی نیست؛ بازیابی ممکن نیست (برنامه را با همان نسخه‌ای که پشتیبان گرفته‌اید اجرا کنید)');
      }
    } finally {
      await client.end();
    }
    return { chain, highestOrdinal: Math.max(...manifests.map((manifest) => manifest.ordinal)) };
  }

  async executeRestore(runId: string, folder: string, chain: BackupManifest[], highestOrdinalOnDrive: number, actor: { userId: number; ipAddress?: string }) {
    const target = chain[chain.length - 1];
    const base = chain[0];
    let client: Client | null = null;
    let maintenanceStarted = false;
    const report = async (phase: string, percent: number, message: string, force = true) => {
      this.maintenance.update({ phase, percent, message });
      await this.setProgress(runId, { phase, done: percent, total: 100, message }, force);
    };
    try {
      // 1. The backup must be intact before anything is touched.
      await this.setProgress(runId, { phase: 'verify', message: 'بررسی سلامت فایل‌های پشتیبان' }, true);
      for (const manifest of chain) {
        const dir = join(backupsDir(folder), backupDirName(manifest));
        for (const entry of [...manifest.tables, ...(manifest.changes ? [manifest.changes] : [])]) {
          if ((await sha256File(join(dir, entry.file))) !== entry.sha256) throw new Error(`فایل «${entry.file}» از پشتیبان شمارهٔ ${manifest.ordinal} خراب یا ناقص است`);
        }
      }
      await verifyPoolFiles(filesPool(folder), target.files, (done, total) => void this.setProgress(runId, { phase: 'verify', done, total, message: 'بررسی فایل‌های بارگذاری‌شده' }));

      // 2. A safety copy of the current state, kept on the server.
      await this.setProgress(runId, { phase: 'safety', message: 'گرفتن پشتیبان ایمنی از وضعیت فعلی' }, true);
      await this.safetyBackup(actor);

      // 3. From here on nobody else works in the system.
      this.maintenance.begin({ phase: 'restore', percent: 0, message: 'شروع بازیابی' });
      maintenanceStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));

      client = await db.connect(connectionString());
      await client.query('BEGIN');
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
      const tables = await db.listTables(client);
      await report('wipe', 2, 'پاک‌سازی داده‌های فعلی');
      await db.wipeTables(client, tables);

      const totalSteps = base.tables.length + chain.length - 1 || 1;
      let step = 0;
      const baseDir = join(backupsDir(folder), backupDirName(base));
      for (const table of base.tables) {
        if (!tables.includes(table.name)) throw new Error(`جدول «${table.name}» در این پایگاه‌داده نیست`);
        await db.loadTableFile(client, table.name, join(baseDir, table.file));
        step += 1;
        await report('load', 5 + Math.round((step / totalSteps) * 80), `بازگردانی جدول ${table.name}`, false);
      }
      for (const manifest of chain.slice(1)) {
        await db.replayChanges(client, join(backupsDir(folder), backupDirName(manifest), manifest.changes!.file));
        step += 1;
        await report('replay', 5 + Math.round((step / totalSteps) * 80), `اعمال تغییرات پشتیبان شمارهٔ ${manifest.ordinal}`, false);
      }
      await report('sequences', 86, 'تنظیم شمارنده‌ها');
      await db.resetSequences(client, tables);
      // Every record must still point to a record that exists — otherwise the restore is cancelled, nothing changes.
      await report('links', 88, 'بررسی ارتباط بین اطلاعات');
      const broken = await db.findBrokenLinks(client);
      if (broken.length > 0) throw new Error(`پشتیبان ناسازگار است و بازیابی لغو شد؛ ارتباط‌های خراب: ${broken.slice(0, 5).join('، ')}`);

      // The restored database continues the lineage of the backup; the next backup starts a new full chain.
      const highest = highestOrdinalOnDrive;
      await client.query(
        `UPDATE backup_state SET database_id = $1::uuid, generation_id = NULL, backup_counter = GREATEST(backup_counter, $2::int), pruned_through_ordinal = GREATEST(backup_counter, $2::int),
           last_backup_id = NULL, last_backup_ordinal = NULL, last_backup_snapshot = NULL, updated_at = now() WHERE id = 1`,
        [target.databaseId, highest],
      );
      await client.query('DELETE FROM backup_change_log');
      await client.query('COMMIT');
      await client.end();
      client = null;

      await report('files', 92, 'بازگردانی فایل‌های بارگذاری‌شده');
      const copied = await restoreFilesFromPool(filesPool(folder), target.files, uploadsDir());
      clearSessionAccessCache();

      await this.prisma.backupRun.update({
        where: { id: runId },
        data: { status: 'OK', finishedAt: new Date(), fileCount: target.files.length, rowCount: BigInt(chain.reduce((sum, manifest) => sum + manifest.totals.rows, 0)), progress: { phase: 'done', message: `بازیابی انجام شد (${copied} فایل بازگردانده شد)` } },
      });
      this.maintenance.end();
      maintenanceStarted = false;
      await this.audit
        .log({ userId: actor.userId, ipAddress: actor.ipAddress, action: 'BACKUP_RESTORED', entityType: ENTITY, details: `پشتیبان شمارهٔ ${target.ordinal} (${target.createdAt}) — ${folder}` })
        .catch(() => undefined);
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end().catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.backupRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 1000) } }).catch(() => undefined);
      await this.audit.log({ userId: actor.userId, ipAddress: actor.ipAddress, action: 'BACKUP_RESTORE_FAILED', entityType: ENTITY, details: message.slice(0, 300) }).catch(() => undefined);
    } finally {
      if (maintenanceStarted) this.maintenance.end();
      this.running = null;
    }
  }

  // A complete backup of the current state into the server's local folder, taken inside a restore.
  private async safetyBackup(actor: { userId: number; ipAddress?: string }) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = join(localBackupDir(), `before-restore-${stamp}`);
    await mkdir(folder, { recursive: true });
    const state = await this.readState();
    const run = await this.prisma.backupRun.create({ data: { kind: 'FULL', status: 'RUNNING', targetPath: folder, startedByUserId: actor.userId, progress: { phase: 'start', message: 'پشتیبان ایمنی' } } });
    const plan: BackupPlan = { kind: 'FULL', reasons: ['پشتیبان ایمنی پیش از بازیابی'], previous: null, inSync: false };
    void state;
    await this.executeBackup(run.id, folder, plan, [], actor, { internal: true });
  }
}
