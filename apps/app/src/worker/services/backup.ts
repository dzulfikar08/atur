import type { Env } from "../lib/env";

// Daily D1 → R2 backups (cron "30 3 * * *", see wrangler.toml [triggers]).
// env.DB.dump() returns the whole SQLite database as bytes; we drop it in the
// atur-backups bucket under a date key and keep the newest KEEP days. Same-day
// re-runs (manual POST /api/admin/backup-d1) overwrite that day's object, so
// the cron and manual triggers never double up.
export const BACKUP_PREFIX = "d1/atur-db/";
export const KEEP_DAYS = 30;

export interface BackupResult {
  key: string;
  size: number;
  pruned: string[];
}

export async function runD1Backup(env: Env, now = new Date()): Promise<BackupResult> {
  if (!env.BACKUPS) throw new Error("BACKUPS R2 binding not configured");
  const dump = await env.DB.dump();
  const key = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.sqlite`;
  await env.BACKUPS.put(key, dump);
  const pruned = await pruneOldBackups(env);
  return { key, size: dump.byteLength, pruned };
}

// Date keys sort chronologically, so newest-first is a plain reverse
// lexicographic sort; anything beyond the newest KEEP_DAYS is deleted.
export async function pruneOldBackups(env: Env, keep: number = KEEP_DAYS): Promise<string[]> {
  const list = await env.BACKUPS.list({ prefix: BACKUP_PREFIX });
  const keys = list.objects
    .map((o) => o.key)
    .filter((key) => key.endsWith(".sqlite"))
    .sort((a, b) => b.localeCompare(a));
  const stale = keys.slice(keep);
  await Promise.all(stale.map((key) => env.BACKUPS.delete(key)));
  return stale;
}
