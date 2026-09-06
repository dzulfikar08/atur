import type { Env } from "../lib/env";

// Daily D1 → R2 backups (cron "30 3 * * *", see wrangler.toml [triggers]).
// env.DB.dump() is unavailable on this database (D1_DUMP_ERROR), so we build a
// logical dump: sqlite_master schema + per-table INSERT statements, restored by
// piping the file through `wrangler d1 execute atur-db --remote --file=…`
// against a fresh, migrated database. Same-day re-runs overwrite that day's
// object, so the cron and the manual trigger never double up.
export const BACKUP_PREFIX = "d1/atur-db/";
export const KEEP_DAYS = 30;

// Bookkeeping tables: excluded from dumps — a restore target starts from the
// drizzle migration chain (the bookkeeping rows would lie about applied state).
const SKIP_TABLES = new Set(["__drizzle_migrations", "d1_migrations"]);

export interface BackupResult {
  key: string;
  size: number;
  tables: number;
  rows: number;
  pruned: string[];
}

type SchemaRow = { name: string; sql: string; type: string };

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return `X'${[...v].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function buildDumpSql(env: Env): Promise<{ sql: string; tables: number; rows: number }> {
  const objects = await env.DB.prepare(
    `SELECT name, sql, type FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'
     ORDER BY type DESC, rowid`,
  ).all<SchemaRow>();
  const tables = objects.results.filter(
    (r) => r.type === "table" && !SKIP_TABLES.has(r.name),
  );
  const parts: string[] = [
    `-- Atur D1 dump ${new Date().toISOString()}`,
    "-- Restore: migrate a fresh database (bun run db:migrate:local/remote), then",
    "-- pipe this file through `wrangler d1 execute atur-db --file=<dump>`. Bookkeeping",
    `-- tables (${[...SKIP_TABLES].join(", ")}) are intentionally excluded.`,
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
  ];
  let rowCount = 0;
  for (const t of tables) {
    parts.push(`${t.sql.replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS")};`);
    const { results } = await env.DB.prepare(`SELECT * FROM "${t.name}"`).all<Record<string, unknown>>();
    for (const row of results) {
      const cols = Object.keys(row);
      parts.push(
        `INSERT OR IGNORE INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(", ")});`,
      );
      rowCount++;
    }
  }
  for (const idx of objects.results.filter((r) => r.type === "index")) {
    parts.push(`${idx.sql.replace(/^CREATE INDEX/i, "CREATE INDEX IF NOT EXISTS")};`);
  }
  parts.push("COMMIT;");
  return { sql: parts.join("\n"), tables: tables.length, rows: rowCount };
}

export async function runD1Backup(env: Env, now = new Date()): Promise<BackupResult> {
  if (!env.BACKUPS) throw new Error("BACKUPS R2 binding not configured");
  const { sql, tables, rows } = await buildDumpSql(env);
  const key = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.sql`;
  await env.BACKUPS.put(key, new TextEncoder().encode(sql));
  const pruned = await pruneOldBackups(env);
  return { key, size: sql.length, tables, rows, pruned };
}

// Date keys sort chronologically, so newest-first is a plain reverse
// lexicographic sort; anything beyond the newest KEEP_DAYS is deleted.
export async function pruneOldBackups(env: Env, keep: number = KEEP_DAYS): Promise<string[]> {
  const list = await env.BACKUPS.list({ prefix: BACKUP_PREFIX });
  const keys = list.objects
    .map((o) => o.key)
    .filter((key) => key.endsWith(".sql"))
    .sort((a, b) => b.localeCompare(a));
  const stale = keys.slice(keep);
  await Promise.all(stale.map((key) => env.BACKUPS.delete(key)));
  return stale;
}
