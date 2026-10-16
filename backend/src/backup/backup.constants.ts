// Backup / restore (admin panel «پشتیبان‌گیری») — shared constants.

export const BACKUP_FORMAT = 1;

// Folder created inside the drive's root folder; everything the module writes lives in it.
export const BACKUP_ROOT_DIR = 'DMS-Backup';
export const DRIVE_FILE = 'drive.json';
export const MANIFEST_FILE = 'manifest.json';
export const BACKUPS_SUBDIR = 'backups';
export const FILES_SUBDIR = 'files';

// Never part of a backup: infrastructure tables (they describe the backup itself or are
// rebuilt by the app) — see the migration 20261015210000_backup_and_change_log.
export const EXCLUDED_TABLES = ['_prisma_migrations', 'user_sessions', 'backup_state', 'backup_change_log', 'backup_runs'] as const;

// Folders on the root of a drive that are not "content" (a USB stick's own bookkeeping), so the
// drive still counts as empty.
export const IGNORED_ROOT_ENTRIES = new Set(['System Volume Information', '$RECYCLE.BIN', 'lost+found', '.Trash-1000', '.Spotlight-V100', '.fseventsd', '.DS_Store', 'desktop.ini', 'Thumbs.db']);

// Paths the backup target may never be in or under.
export const FORBIDDEN_TARGET_PREFIXES = ['/etc', '/proc', '/sys', '/dev', '/boot', '/bin', '/sbin', '/usr', '/lib', '/lib64', '/var/lib/postgresql'];

export const RESTORE_CONFIRM_TEXT = 'بازیابی';

export const FETCH_BATCH_ROWS = 2000;
export const INSERT_BATCH_ROWS = 500;
export const INSERT_BATCH_MAX_CHARS = 4_000_000;
