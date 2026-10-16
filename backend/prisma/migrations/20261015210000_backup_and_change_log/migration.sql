-- Backup / restore support (admin panel «پشتیبان‌گیری»). Additive.
--
--  backup_state       one row: this database's identity and the last backup it made.
--  backup_change_log  every INSERT/UPDATE/DELETE/TRUNCATE of every business table (filled by
--                     triggers), so an incremental backup can export "what changed since the
--                     last backup" exactly. Rows are tied to their transaction id (txid), so
--                     a backup knows precisely which changes its snapshot already contains.
--  backup_runs        history of backup / restore jobs and their progress.
--
-- The three tables themselves, user_sessions and _prisma_migrations are never backed up.

CREATE TABLE "backup_state" (
  "id"                     INTEGER NOT NULL DEFAULT 1,
  "database_id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "generation_id"          UUID,
  "backup_counter"         INTEGER NOT NULL DEFAULT 0,
  "pruned_through_ordinal" INTEGER NOT NULL DEFAULT 0,
  "last_backup_id"         UUID,
  "last_backup_ordinal"    INTEGER,
  "last_backup_snapshot"   TEXT,
  "last_backup_at"         TIMESTAMPTZ(6),
  "last_path"              TEXT,
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "backup_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_state_single_row" CHECK ("id" = 1)
);
INSERT INTO "backup_state" ("id") VALUES (1);

CREATE TABLE "backup_change_log" (
  "seq"        BIGSERIAL NOT NULL,
  "txid"       xid8 NOT NULL DEFAULT pg_current_xact_id(),
  "table_name" TEXT NOT NULL,
  "op"         CHAR(1) NOT NULL,
  "pk"         JSONB NOT NULL,
  "row_data"   JSONB,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "backup_change_log_pkey" PRIMARY KEY ("seq"),
  CONSTRAINT "backup_change_log_op_check" CHECK ("op" IN ('I', 'U', 'D', 'T'))
);

CREATE TABLE "backup_runs" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind"               TEXT NOT NULL,
  "status"             TEXT NOT NULL,
  "started_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at"        TIMESTAMPTZ(6),
  "started_by_user_id" INTEGER,
  "target_path"        TEXT,
  "backup_id"          UUID,
  "ordinal"            INTEGER,
  "generation_id"      UUID,
  "snapshot"           TEXT,
  "row_count"          BIGINT,
  "file_count"         INTEGER,
  "bytes"              BIGINT,
  "error"              TEXT,
  "progress"           JSONB,
  CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_runs_kind_check" CHECK ("kind" IN ('FULL', 'INCREMENTAL', 'RESTORE')),
  CONSTRAINT "backup_runs_status_check" CHECK ("status" IN ('RUNNING', 'OK', 'FAILED'))
);

-- ---------------------------------------------------------------------------
-- Change capture
-- ---------------------------------------------------------------------------

-- The primary-key values of a row as JSON ({"id": 5}); a table without a primary key
-- identifies a row by the whole row.
CREATE OR REPLACE FUNCTION backup_pk(row_json jsonb, pk_cols text[]) RETURNS jsonb AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  col text;
BEGIN
  IF pk_cols IS NULL OR array_length(pk_cols, 1) IS NULL THEN
    RETURN row_json;
  END IF;
  FOREACH col IN ARRAY pk_cols LOOP
    result := result || jsonb_build_object(col, row_json -> col);
  END LOOP;
  RETURN result;
END
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION backup_capture() RETURNS trigger AS $$
DECLARE
  pk_cols text[] := TG_ARGV;
  old_json jsonb;
  new_json jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    INSERT INTO backup_change_log (table_name, op, pk, row_data) VALUES (TG_TABLE_NAME, 'D', backup_pk(old_json, pk_cols), NULL);
    RETURN NULL;
  END IF;
  new_json := to_jsonb(NEW);
  IF TG_OP = 'UPDATE' THEN
    old_json := to_jsonb(OLD);
    -- A changed primary key is a delete of the old row plus an insert of the new one.
    IF backup_pk(old_json, pk_cols) IS DISTINCT FROM backup_pk(new_json, pk_cols) THEN
      INSERT INTO backup_change_log (table_name, op, pk, row_data) VALUES (TG_TABLE_NAME, 'D', backup_pk(old_json, pk_cols), NULL);
    END IF;
  END IF;
  INSERT INTO backup_change_log (table_name, op, pk, row_data)
  VALUES (TG_TABLE_NAME, CASE WHEN TG_OP = 'INSERT' THEN 'I' ELSE 'U' END, backup_pk(new_json, pk_cols), new_json);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION backup_capture_truncate() RETURNS trigger AS $$
BEGIN
  INSERT INTO backup_change_log (table_name, op, pk, row_data) VALUES (TG_TABLE_NAME, 'T', '{}'::jsonb, NULL);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

-- (Re)creates the capture triggers on every business table. Idempotent: the backend calls it on
-- start, so a table added by a later migration is covered automatically.
CREATE OR REPLACE FUNCTION backup_install_triggers() RETURNS integer AS $$
DECLARE
  tbl record;
  pk_cols text[];
  pk_args text;
  installed integer := 0;
BEGIN
  FOR tbl IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN ('_prisma_migrations', 'user_sessions', 'backup_state', 'backup_change_log', 'backup_runs')
  LOOP
    SELECT COALESCE(array_agg(a.attname::text ORDER BY k.ord), ARRAY[]::text[]) INTO pk_cols
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = format('public.%I', tbl.name)::regclass AND i.indisprimary;

    SELECT COALESCE(string_agg(quote_literal(col), ', '), '') INTO pk_args FROM unnest(pk_cols) AS col;

    EXECUTE format('DROP TRIGGER IF EXISTS backup_capture_row ON public.%I', tbl.name);
    EXECUTE format('CREATE TRIGGER backup_capture_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION backup_capture(%s)', tbl.name, pk_args);
    EXECUTE format('DROP TRIGGER IF EXISTS backup_capture_truncate ON public.%I', tbl.name);
    EXECUTE format('CREATE TRIGGER backup_capture_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION backup_capture_truncate()', tbl.name);
    installed := installed + 1;
  END LOOP;
  RETURN installed;
END
$$ LANGUAGE plpgsql;

SELECT backup_install_triggers();

-- ---------------------------------------------------------------------------
-- Permissions: ADMIN only (copied from the permission only ADMIN holds)
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("name") VALUES ('backup.manage'), ('backup.restore') ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", pn."id"
FROM "permissions" po
JOIN "role_permissions" rp ON rp."permission_id" = po."id"
JOIN "permissions" pn ON pn."name" IN ('backup.manage', 'backup.restore')
WHERE po."name" = 'users.create'
ON CONFLICT DO NOTHING;

INSERT INTO "user_permissions" ("user_id", "permission_id")
SELECT DISTINCT up."user_id", pn."id"
FROM "permissions" po
JOIN "user_permissions" up ON up."permission_id" = po."id"
JOIN "permissions" pn ON pn."name" IN ('backup.manage', 'backup.restore')
WHERE po."name" = 'users.create'
ON CONFLICT DO NOTHING;
