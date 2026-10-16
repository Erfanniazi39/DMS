import { BadRequestException } from '@nestjs/common';
import { mkdir, readdir, readFile, rm, statfs, writeFile } from 'fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'path';
import { BACKUPS_SUBDIR, BACKUP_FORMAT, BACKUP_ROOT_DIR, DRIVE_FILE, FILES_SUBDIR, FORBIDDEN_TARGET_PREFIXES, IGNORED_ROOT_ENTRIES, MANIFEST_FILE } from './backup.constants';
import { manifestSchema, type BackupManifest, type DriveScan } from './backup-manifest';

// The drive side: checking the folder the admin typed, reading what backups it already holds,
// and laying out the folder structure. Layout:
//   <folder>/DMS-Backup/drive.json            which database owns this drive
//   <folder>/DMS-Backup/backups/<n>-.../      manifest.json + data files of each backup
//   <folder>/DMS-Backup/files/...             shared pool of uploaded files (named by UUID, never rewritten)

export function backupRoot(folder: string): string {
  return join(folder, BACKUP_ROOT_DIR);
}
export function backupsDir(folder: string): string {
  return join(backupRoot(folder), BACKUPS_SUBDIR);
}
export function filesPool(folder: string): string {
  return join(backupRoot(folder), FILES_SUBDIR);
}

// Only an absolute path to somewhere that is not part of the application or the operating system.
export function normalizeTargetPath(input: string, appDir = process.cwd()): string {
  const trimmed = input.trim();
  if (!trimmed) throw new BadRequestException('مسیر پوشهٔ پشتیبان را وارد کنید');
  if (!isAbsolute(trimmed)) throw new BadRequestException('مسیر باید کامل (مطلق) باشد، مثلاً /media/usb/backup');
  const path = resolve(normalize(trimmed));
  if (path === sep || FORBIDDEN_TARGET_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}${sep}`))) {
    throw new BadRequestException('این مسیر برای پشتیبان مجاز نیست');
  }
  const app = resolve(appDir);
  if (path === app || path.startsWith(`${app}${sep}`) || app.startsWith(`${path}${sep}`)) {
    throw new BadRequestException('پوشهٔ پشتیبان نباید داخل پوشهٔ برنامه (یا بالاتر از آن) باشد');
  }
  return path;
}

export async function freeBytes(folder: string): Promise<number | null> {
  try {
    const stats = await statfs(folder);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

// What is on the drive, from the point of view of the database `databaseId`.
// `databaseId` null = list whatever is there (restore reads a drive from any database; the caller checks it holds just one).
export async function scanDrive(folder: string, databaseId: string | null): Promise<DriveScan> {
  const scan: DriveScan = { usable: true, problems: [], empty: true, foreign: false, manifests: [] };
  if (!(await exists(folder))) {
    return { ...scan, usable: false, problems: ['این پوشه وجود ندارد یا قابل خواندن نیست؛ حافظه را وصل و مسیر را بررسی کنید'] };
  }
  const probe = join(folder, `.dms-write-test-${process.pid}`);
  try {
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
  } catch {
    return { ...scan, usable: false, problems: ['در این پوشه نمی‌توان نوشت (حافظه قفل است یا اجازهٔ نوشتن نیست)'] };
  }

  const entries = (await readdir(folder)).filter((name) => !IGNORED_ROOT_ENTRIES.has(name) && !name.startsWith('.dms-write-test-'));
  const hasOurs = entries.includes(BACKUP_ROOT_DIR);
  if (!hasOurs) {
    if (entries.length > 0) {
      return { ...scan, usable: false, empty: false, problems: ['این پوشه خالی نیست و پشتیبان این سیستم هم در آن نیست؛ یک پوشهٔ خالی انتخاب کنید'] };
    }
    return scan;
  }

  scan.empty = false;
  try {
    const drive = JSON.parse(await readFile(join(backupRoot(folder), DRIVE_FILE), 'utf8')) as { databaseId?: string };
    if (databaseId && drive.databaseId && drive.databaseId !== databaseId) scan.foreign = true;
  } catch {
    // No drive.json yet (an interrupted first backup) — the manifests decide.
  }

  let dirs: string[] = [];
  try {
    dirs = await readdir(backupsDir(folder));
  } catch {
    dirs = [];
  }
  for (const dir of dirs.sort()) {
    try {
      const parsed = manifestSchema.parse(JSON.parse(await readFile(join(backupsDir(folder), dir, MANIFEST_FILE), 'utf8')));
      if (databaseId && parsed.databaseId !== databaseId) scan.foreign = true;
      else scan.manifests.push(parsed);
    } catch {
      // A folder without a complete manifest is an interrupted backup — it is never used, only reported.
      if (!dir.startsWith('.tmp-')) scan.problems.push(`پوشهٔ «${dir}» پشتیبان کامل و معتبری نیست و نادیده گرفته شد`);
    }
  }
  scan.empty = scan.manifests.length === 0 && !scan.foreign;
  return scan;
}

export async function ensureDriveStructure(folder: string, databaseId: string): Promise<void> {
  await mkdir(backupsDir(folder), { recursive: true });
  await mkdir(filesPool(folder), { recursive: true });
  await writeFile(join(backupRoot(folder), DRIVE_FILE), JSON.stringify({ format: BACKUP_FORMAT, databaseId, createdAt: new Date().toISOString() }, null, 2));
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function manifestPath(folder: string, dirName: string): string {
  return join(backupsDir(folder), dirName, MANIFEST_FILE);
}

export type DriveBackupRef = { dirName: string; manifest: BackupManifest };
