import { Client } from 'pg';
import { EXCLUDED_TABLES, FETCH_BATCH_ROWS, INSERT_BATCH_MAX_CHARS, INSERT_BATCH_ROWS } from './backup.constants';
import { GzipLineWriter, readGzipLines } from './backup-io';

// Everything the backup module says to PostgreSQL. Rows travel as JSON text produced by Postgres itself
// (to_jsonb) and go back in with jsonb_populate_recordset, so every column type — numeric, timestamps,
// enums, arrays — round-trips exactly without this code ever parsing a value.

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const table = (name: string) => `public.${quote(name)}`;

export async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

// Business tables: every ordinary table in `public` except the infrastructure ones.
export async function listTables(client: Client): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY($1::text[])) ORDER BY c.relname`,
    [[...EXCLUDED_TABLES]],
  );
  return result.rows.map((row) => row.name);
}

export async function appliedMigrations(client: Client): Promise<string[]> {
  const result = await client.query<{ name: string }>(`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  return result.rows.map((row) => row.name);
}

export async function currentSnapshot(client: Client): Promise<string> {
  const result = await client.query<{ snapshot: string }>(`SELECT pg_current_snapshot()::text AS snapshot`);
  return result.rows[0].snapshot;
}

// DECLARE is a utility statement and takes no bind parameters, so callers inline their (escaped) values.
async function streamCursor(client: Client, name: string, sql: string, onRows: (rows: Record<string, string>[]) => Promise<void>): Promise<void> {
  await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`);
  try {
    for (;;) {
      const batch = await client.query<Record<string, string>>(`FETCH ${FETCH_BATCH_ROWS} FROM ${name}`);
      if (batch.rows.length === 0) break;
      await onRows(batch.rows);
    }
  } finally {
    await client.query(`CLOSE ${name}`);
  }
}

// Full copy of one table, one JSON object per line. Must run inside the caller's REPEATABLE READ transaction.
export async function exportTable(client: Client, name: string, outFile: string): Promise<{ rows: number; bytes: number; sha256: string }> {
  const writer = new GzipLineWriter(outFile);
  await streamCursor(client, 'backup_table_cursor', `SELECT to_jsonb(t)::text AS j FROM ${table(name)} t`, async (rows) => {
    for (const row of rows) await writer.writeLine(row.j);
  });
  const result = await writer.close();
  return { rows: result.lines, bytes: result.bytes, sha256: result.sha256 };
}

// The changes that happened after `previousSnapshot` and are already inside `snapshot`, in the order they
// were made. One line per change: seq, table, op, primary key (JSON), new row (JSON, empty for deletes) — tab separated.
export async function exportChanges(client: Client, previousSnapshot: string, snapshot: string, outFile: string): Promise<{ entries: number; bytes: number; sha256: string }> {
  const writer = new GzipLineWriter(outFile);
  await streamCursor(
    client,
    'backup_change_cursor',
    `SELECT seq::text AS seq, table_name, op, pk::text AS pk, COALESCE(row_data::text, '') AS row_data FROM backup_change_log
     WHERE pg_visible_in_snapshot(txid, ${client.escapeLiteral(snapshot)}::pg_snapshot) AND NOT pg_visible_in_snapshot(txid, ${client.escapeLiteral(previousSnapshot)}::pg_snapshot) ORDER BY backup_change_log.seq`,
    async (rows) => {
      for (const row of rows) await writer.writeLine(`${row.seq}\t${row.table_name}\t${row.op}\t${row.pk}\t${row.row_data}`);
    },
  );
  const result = await writer.close();
  return { entries: result.lines, bytes: result.bytes, sha256: result.sha256 };
}

// Removes the change-log rows a snapshot already contains (they can never be asked for again).
export async function pruneChangeLog(client: Client, throughSnapshot: string): Promise<number> {
  const result = await client.query(`DELETE FROM backup_change_log WHERE pg_visible_in_snapshot(txid, $1::text::pg_snapshot)`, [throughSnapshot]);
  return result.rowCount ?? 0;
}

// --- restore -----------------------------------------------------------------------------------

export async function wipeTables(client: Client, tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  await client.query(`TRUNCATE ${tables.map(table).join(', ')}`);
}

export async function loadTableFile(client: Client, name: string, file: string): Promise<number> {
  let batch: string[] = [];
  let chars = 0;
  let total = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await client.query(`INSERT INTO ${table(name)} SELECT * FROM jsonb_populate_recordset(NULL::${table(name)}, $1::text::jsonb)`, [`[${batch.join(',')}]`]);
    total += batch.length;
    batch = [];
    chars = 0;
  };
  for await (const line of readGzipLines(file)) {
    batch.push(line);
    chars += line.length;
    if (batch.length >= INSERT_BATCH_ROWS || chars >= INSERT_BATCH_MAX_CHARS) await flush();
  }
  await flush();
  return total;
}

type TableMeta = { columns: string[]; pk: string[] };

async function tableMeta(client: Client, name: string): Promise<TableMeta> {
  const columns = await client.query<{ name: string }>(`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [name]);
  const pk = await client.query<{ name: string }>(
    `SELECT a.attname::text AS name FROM pg_index i
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY k.ord`,
    [table(name)],
  );
  return { columns: columns.rows.map((row) => row.name), pk: pk.rows.map((row) => row.name) };
}

// Replays an incremental backup's change file on top of the restored data, in the order the changes were made.
export async function replayChanges(client: Client, file: string): Promise<number> {
  const metas = new Map<string, TableMeta>();
  const metaOf = async (name: string) => {
    let meta = metas.get(name);
    if (!meta) {
      meta = await tableMeta(client, name);
      metas.set(name, meta);
    }
    return meta;
  };
  let applied = 0;
  for await (const line of readGzipLines(file)) {
    const [, tableName, op, pk, row] = line.split('\t');
    const meta = await metaOf(tableName);
    if (op === 'T') {
      await client.query(`DELETE FROM ${table(tableName)}`);
    } else if (op === 'D') {
      if (meta.pk.length === 0) {
        await client.query(`DELETE FROM ${table(tableName)} x WHERE to_jsonb(x) = $1::text::jsonb`, [pk]);
      } else {
        const where = meta.pk.map((column) => `x.${quote(column)} = p.${quote(column)}`).join(' AND ');
        await client.query(`DELETE FROM ${table(tableName)} x USING jsonb_populate_record(NULL::${table(tableName)}, $1::text::jsonb) p WHERE ${where}`, [pk]);
      }
    } else {
      const source = `jsonb_populate_record(NULL::${table(tableName)}, $1::text::jsonb)`;
      if (meta.pk.length === 0) {
        await client.query(`INSERT INTO ${table(tableName)} SELECT * FROM ${source}`, [row]);
      } else {
        const updatable = meta.columns.filter((column) => !meta.pk.includes(column));
        const conflict = updatable.length === 0 ? 'DO NOTHING' : `DO UPDATE SET ${updatable.map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`).join(', ')}`;
        await client.query(`INSERT INTO ${table(tableName)} SELECT * FROM ${source} ON CONFLICT (${meta.pk.map(quote).join(', ')}) ${conflict}`, [row]);
      }
    }
    applied += 1;
  }
  return applied;
}

// With the database's own link checks switched off during a restore, nothing proved that every record still points to a
// record that exists. This does: every foreign key is checked, and the names of the broken ones are returned.
export async function findBrokenLinks(client: Client): Promise<string[]> {
  const constraints = await client.query<{ name: string; child: string; parent: string; child_cols: string[]; parent_cols: string[] }>(
    `SELECT c.conname AS name, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS child_cols,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS parent_cols
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const broken: string[] = [];
  for (const fk of constraints.rows) {
    const notNull = fk.child_cols.map((column) => `c.${quote(column)} IS NOT NULL`).join(' AND ');
    const match = fk.child_cols.map((column, index) => `p.${quote(fk.parent_cols[index])} = c.${quote(column)}`).join(' AND ');
    const result = await client.query(`SELECT 1 FROM ${fk.child} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${match}) LIMIT 1`);
    if ((result.rowCount ?? 0) > 0) broken.push(`${fk.child}.${fk.name}`);
  }
  return broken;
}

// After rows came back with their original ids, every serial sequence must continue after the highest one.
export async function resetSequences(client: Client, tables: string[]): Promise<void> {
  const result = await client.query<{ table_name: string; column_name: string; seq: string | null }>(
    `SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) AS seq
     FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_default LIKE 'nextval(%'`,
  );
  for (const row of result.rows) {
    if (!row.seq || !tables.includes(row.table_name)) continue;
    await client.query(
      `SELECT setval($1::regclass, GREATEST(COALESCE((SELECT max(${quote(row.column_name)}) FROM ${table(row.table_name)}), 0), 1), (SELECT max(${quote(row.column_name)}) FROM ${table(row.table_name)}) IS NOT NULL)`,
      [row.seq],
    );
  }
}
