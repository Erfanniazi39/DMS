# Backup & restore (پشتیبان‌گیری و بازیابی)

Admin only (`backup.manage` to back up, `backup.restore` to restore — both ADMIN only). Page: `/admin/backup`.

## What it does
- **One button** saves the whole system to a folder (a flash drive): every business table **and** every uploaded file.
- The **first** backup on a drive is complete. Later ones contain **only what changed since the last backup on that
  drive** (rows added / changed / deleted). The button first looks at BOTH sides — the system's last backup and the
  drive's newest backup — and shows what it will do (`planBackup()` in `backup-manifest.ts`).
- **Restore** puts the whole system back to the state of a chosen backup (full copy + the incrementals after it).
  It replaces everything; a safety copy of the current state is taken on the server first (`BACKUP_LOCAL_DIR`,
  default `backend/local-backups/`).
- The page shows ONE «انتخاب پوشه» button (browser folder picker, so it works from whichever computer the admin sits at, the
  server itself included); a typed server path appears only where the browser cannot open a picker (plain `http` on the LAN).
- Two ways the backend can reach the drive: **(a)** the drive is on the server computer (the backend writes the folder you type);
  **(b)** the drive is on the admin's own computer (the browser reads/writes the folder through the File System Access
  API — Chrome/Edge, `https` or `localhost` only — while the server builds / consumes the backup).

## How incremental works (and why it is exact)
Triggers on every business table (`backup_install_triggers()`, re-run at every start so new tables are covered)
write each INSERT / UPDATE / DELETE / TRUNCATE into `backup_change_log` together with the **transaction id**.
A backup runs in one `REPEATABLE READ` transaction and records `pg_current_snapshot()`. The next incremental exports
exactly the log rows that are visible in the new snapshot and **not** visible in the previous backup's snapshot —
so no change is lost or doubled, even while people keep working (tested with concurrent writes).
Rows are exported/imported as PostgreSQL JSON text (`to_jsonb` / `jsonb_populate_recordset`), so every column type
round-trips exactly. Change-log rows that every kept backup already contains are pruned after each backup
(`pruned_through_ordinal`); a drive older than that gets a new FULL backup automatically.

## Drive layout
```
<folder>/DMS-Backup/drive.json                    which database owns the drive (a drive never mixes databases)
<folder>/DMS-Backup/backups/0003-20261210-.../    manifest.json + <table>.ndjson.gz (FULL) or changes.tsv.gz (INCREMENTAL)
<folder>/DMS-Backup/files/<letters|customers|...>/ shared pool of uploaded files (UUID names, never rewritten)
```
A backup folder is valid only when its `manifest.json` exists (written last, after every data file was re-read and
its sha256 checked). Interrupted backups are reported and ignored.

## Restore, step by step (`executeRestore`)
1. The chosen backup and every backup before it in its chain must be on the drive, and the database schema version
   (applied migrations) must be the same.
2. Every data file and every uploaded file is hash-checked **before anything is touched**.
3. Safety copy of the current state (full backup into `BACKUP_LOCAL_DIR`).
4. Maintenance mode: every request gets `503` + the restore's progress (no database access, tables are locked).
5. **One transaction**: `session_replication_role = replica` → `TRUNCATE` all business tables → load the full backup →
   replay each incremental in order → reset the id sequences → reset backup bookkeeping. Any error rolls everything back.
6. Uploaded files are copied back; the next backup starts a new chain (full).

## Not backed up on purpose
`user_sessions` (everyone stays/gets signed in against the restored users), `_prisma_migrations`, and the backup tables.

## Operational notes
- The restore needs a database role that may `SET session_replication_role` (the docker `postgres` user can).
- Backups are **not encrypted** and contain personal/financial data (national IDs, salaries, bank numbers). Keep the drive safe;
  encryption with a password is a planned improvement (security review M8).
- A restore on a brand-new install needs the seeded `admin` account to sign in first (`npx prisma migrate deploy && npx prisma db seed`).
- `BACKUP_STAGING_DIR` (default `backend/backup-staging/`) holds a backup while the browser copies it to a drive on another
  computer; it is emptied on start and after every job.
- Tests: `backup-manifest.spec.ts` (planning/chain logic), `backup-folder.spec.ts` (paths, drive scan). The DB/restore
  path was verified end to end against a scratch database (identical table contents, concurrent writes, tampered file
  refused, broken chain refused, remote mode) — repeat that with `docs/backup/` notes after changing `backup-db.ts`.
