import { compareSemver, highest } from "./semver";
import type { ListedRow, VersionRow } from "./types";

export const PER_PAGE_MAX = 100;

export type Sort = "all" | "name" | "downloads" | "recent";

const LATEST = `
  SELECT v.*, e.publisher AS publisher, e.first_party AS first_party, e.downloads AS total_downloads
  FROM extensions e
  JOIN extension_versions v ON v.name = e.name AND v.version = e.latest_version`;

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface ListQuery {
  search: string;
  category: string | null;
  sort: Sort;
  page: number;
  perPage: number;
}

export async function listLatest(
  db: D1Database,
  query: ListQuery,
): Promise<{ rows: ListedRow[]; total: number }> {
  const where: string[] = ["e.latest_version IS NOT NULL"];
  const params: unknown[] = [];
  if (query.search) {
    where.push("(e.name LIKE ? ESCAPE '\\' OR v.description LIKE ? ESCAPE '\\')");
    const pattern = likePattern(query.search);
    params.push(pattern, pattern);
  }
  if (query.category) {
    where.push("EXISTS (SELECT 1 FROM json_each(v.categories) WHERE json_each.value = ?)");
    params.push(query.category);
  }
  const order =
    query.sort === "downloads"
      ? "e.downloads DESC, e.name ASC"
      : query.sort === "recent"
        ? "v.published_at DESC, e.name ASC"
        : "e.name ASC";
  const clause = ` WHERE ${where.join(" AND ")}`;
  const [rows, count] = await Promise.all([
    db
      .prepare(`${LATEST}${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...params, query.perPage, (query.page - 1) * query.perPage)
      .all<ListedRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM extensions e
         JOIN extension_versions v ON v.name = e.name AND v.version = e.latest_version${clause}`,
      )
      .bind(...params)
      .first<{ total: number }>(),
  ]);
  return { rows: rows.results, total: count?.total ?? 0 };
}

export function getLatest(db: D1Database, name: string): Promise<ListedRow | null> {
  return db.prepare(`${LATEST} WHERE e.name = ?`).bind(name).first<ListedRow>();
}

export async function latestByName(
  db: D1Database,
  names: string[],
): Promise<Record<string, string | null>> {
  const found = await db
    .prepare(
      `SELECT name, latest_version FROM extensions
       WHERE name IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(names))
    .all<{ name: string; latest_version: string | null }>();
  const result: Record<string, string | null> = {};
  for (const name of names) result[name] = null;
  for (const row of found.results) result[row.name] = row.latest_version;
  return result;
}

export async function listVersions(db: D1Database, name: string): Promise<VersionRow[]> {
  const rows = await db
    .prepare("SELECT * FROM extension_versions WHERE name = ?")
    .bind(name)
    .all<VersionRow>();
  return rows.results.sort((a, b) => compareSemver(b.version, a.version));
}

export function getVersion(
  db: D1Database,
  name: string,
  version: string,
): Promise<VersionRow | null> {
  return db
    .prepare("SELECT * FROM extension_versions WHERE name = ? AND version = ?")
    .bind(name, version)
    .first<VersionRow>();
}

export function getExtension(
  db: D1Database,
  name: string,
): Promise<{ name: string; publisher: string; latest_version: string | null } | null> {
  return db
    .prepare("SELECT name, publisher, latest_version FROM extensions WHERE name = ?")
    .bind(name)
    .first();
}

export async function highestPublished(db: D1Database, name: string): Promise<string | null> {
  const rows = await db
    .prepare("SELECT version FROM extension_versions WHERE name = ?")
    .bind(name)
    .all<{ version: string }>();
  return highest(rows.results.map((row) => row.version));
}

/** Recomputes `latest_version` (highest non-yanked) after a yank or un-yank. */
export async function refreshLatest(db: D1Database, name: string): Promise<string | null> {
  const rows = await db
    .prepare("SELECT version FROM extension_versions WHERE name = ? AND yanked = 0")
    .bind(name)
    .all<{ version: string }>();
  const latest = highest(rows.results.map((row) => row.version));
  await db
    .prepare("UPDATE extensions SET latest_version = ?, updated_at = ? WHERE name = ?")
    .bind(latest, Date.now(), name)
    .run();
  return latest;
}

export async function countDownload(db: D1Database, name: string, version: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE extensions SET downloads = downloads + 1 WHERE name = ?").bind(name),
    db
      .prepare(
        "UPDATE extension_versions SET downloads = downloads + 1 WHERE name = ? AND version = ?",
      )
      .bind(name, version),
  ]);
}
