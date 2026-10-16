import { z } from 'zod';
import { BACKUP_FORMAT } from './backup.constants';

// What every backup folder on a drive describes itself with (manifest.json), plus the pure
// logic that decides — from the system's state and the drive's contents — what the next backup
// has to be. No I/O here: everything is unit-tested.

const uuid = z.string().uuid();
const fileEntry = z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: z.string().length(64) });

export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  backupId: uuid,
  kind: z.enum(['FULL', 'INCREMENTAL']),
  databaseId: uuid,
  // A chain of one full backup plus the incrementals after it. A restore of the system starts a new generation.
  generationId: uuid,
  // Global running number of backups made by this database; lets the system know which ones it can still continue from.
  ordinal: z.number().int().positive(),
  baseBackupId: uuid,
  previousBackupId: uuid.nullable(),
  createdAt: z.string().min(10),
  // pg_current_snapshot() of the moment this backup's data was read: everything committed before it is inside.
  snapshot: z.string().min(3),
  appVersion: z.string().optional(),
  migrations: z.array(z.string()),
  tables: z.array(z.object({ name: z.string().min(1), file: z.string().min(1), rows: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), sha256: z.string().length(64) })),
  changes: z.object({ file: z.string().min(1), entries: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), sha256: z.string().length(64) }).nullable(),
  // Every uploaded file existing at that moment (the files themselves live in the drive's shared pool).
  files: z.array(fileEntry),
  totals: z.object({ rows: z.number().int().nonnegative(), files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
});
export type BackupManifest = z.infer<typeof manifestSchema>;
export type ManifestFile = z.infer<typeof fileEntry>;

export type SystemBackupState = {
  databaseId: string;
  generationId: string | null;
  backupCounter: number;
  prunedThroughOrdinal: number;
  lastBackupId: string | null;
  lastBackupAt: Date | null;
};

export type DriveScan = {
  // The target folder exists and is usable (a problem list explains when not).
  usable: boolean;
  problems: string[];
  empty: boolean;
  // Backups of another database were found.
  foreign: boolean;
  manifests: BackupManifest[];
};

export type BackupPlan = {
  kind: 'FULL' | 'INCREMENTAL' | 'BLOCKED';
  reasons: string[];
  previous: BackupManifest | null;
  // The last backup this system made is also the last one on this drive.
  inSync: boolean;
};

// The backups needed to rebuild the state at `targetId`: its full base plus every incremental up
// to it, oldest first. Throws a Persian message when a link is missing.
export function resolveChain(manifests: readonly BackupManifest[], targetId: string): BackupManifest[] {
  const byId = new Map(manifests.map((manifest) => [manifest.backupId, manifest]));
  const chain: BackupManifest[] = [];
  let current: BackupManifest | undefined = byId.get(targetId);
  if (!current) throw new Error('پشتیبان انتخاب‌شده روی این حافظه پیدا نشد');
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.backupId)) throw new Error('زنجیرهٔ پشتیبان‌ها حلقه دارد');
    seen.add(current.backupId);
    chain.unshift(current);
    if (current.kind === 'FULL') return chain;
    const previous: BackupManifest | undefined = current.previousBackupId ? byId.get(current.previousBackupId) : undefined;
    if (!previous) throw new Error(`پشتیبان قبلی این نسخه (شمارهٔ ${current.ordinal}) روی حافظه نیست؛ زنجیره ناقص است`);
    if (previous.generationId !== current.generationId || previous.databaseId !== current.databaseId) throw new Error('زنجیرهٔ پشتیبان‌ها با هم هم‌خوان نیست');
    current = previous;
  }
  throw new Error('زنجیرهٔ پشتیبان‌ها ناقص است');
}

export function chainIsValid(manifests: readonly BackupManifest[], targetId: string): boolean {
  try {
    resolveChain(manifests, targetId);
    return true;
  } catch {
    return false;
  }
}

// What the button will do. The system looks at BOTH sides: its own last backup, and the newest
// backup of this database on the drive.
export function planBackup(system: SystemBackupState, drive: DriveScan): BackupPlan {
  if (!drive.usable) return { kind: 'BLOCKED', reasons: drive.problems, previous: null, inSync: false };
  if (drive.foreign) {
    return { kind: 'BLOCKED', reasons: ['روی این حافظه پشتیبان پایگاه‌دادهٔ دیگری هست؛ یک پوشهٔ خالی یا حافظهٔ دیگر انتخاب کنید.'], previous: null, inSync: false };
  }
  if (system.generationId === null) {
    const reason = system.backupCounter === 0 ? 'این اولین پشتیبان‌گیری سیستم است؛ پشتیبان کامل گرفته می‌شود.' : 'سیستم به‌تازگی از پشتیبان بازیابی شده است؛ پشتیبان کامل جدید گرفته می‌شود.';
    return { kind: 'FULL', reasons: [reason], previous: null, inSync: false };
  }
  const candidates = drive.manifests
    .filter((manifest) => manifest.generationId === system.generationId && chainIsValid(drive.manifests, manifest.backupId))
    .sort((a, b) => b.ordinal - a.ordinal);
  const latest = candidates[0];
  if (!latest) {
    return { kind: 'FULL', reasons: [drive.empty ? 'حافظه خالی است؛ پشتیبان کامل گرفته می‌شود.' : 'روی این حافظه پشتیبان سالمی از وضعیت فعلی نیست؛ پشتیبان کامل گرفته می‌شود.'], previous: null, inSync: false };
  }
  if (latest.ordinal > system.backupCounter) {
    return { kind: 'FULL', reasons: ['پشتیبان‌های این حافظه با سابقهٔ سیستم هم‌خوان نیست؛ پشتیبان کامل گرفته می‌شود.'], previous: null, inSync: false };
  }
  if (latest.ordinal < system.prunedThroughOrdinal) {
    return {
      kind: 'FULL',
      reasons: ['تغییرات بین آخرین پشتیبان این حافظه و اکنون دیگر در سیستم نگهداری نمی‌شود (پشتیبان‌های بعدی روی حافظهٔ دیگری گرفته شده)؛ پشتیبان کامل گرفته می‌شود.'],
      previous: null,
      inSync: false,
    };
  }
  const inSync = latest.backupId === system.lastBackupId;
  return {
    kind: 'INCREMENTAL',
    reasons: [
      inSync
        ? 'آخرین پشتیبان سیستم و آخرین پشتیبان این حافظه یکی است؛ فقط تغییرات از آن زمان ذخیره می‌شود.'
        : 'آخرین پشتیبان سیستم روی حافظهٔ دیگری گرفته شده؛ از آخرین پشتیبان همین حافظه به بعد ذخیره می‌شود.',
    ],
    previous: latest,
    inSync,
  };
}

export function backupDirName(manifest: Pick<BackupManifest, 'createdAt' | 'kind' | 'ordinal' | 'backupId'>): string {
  const stamp = manifest.createdAt.replace(/[-:]/g, '').replace(/\.\d+Z?$/, '').replace('T', '-').replace('Z', '');
  return `${String(manifest.ordinal).padStart(4, '0')}-${stamp}-${manifest.kind === 'FULL' ? 'full' : 'incr'}-${manifest.backupId.slice(0, 8)}`;
}
