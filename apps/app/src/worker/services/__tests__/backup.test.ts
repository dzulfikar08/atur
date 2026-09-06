import { describe, expect, it } from "vitest";
import { BACKUP_PREFIX, KEEP_DAYS, pruneOldBackups, runD1Backup } from "../backup";
import type { Env } from "../../lib/env";

// Minimal R2Bucket stand-in over a keyed map: put/list/delete only, matching
// the surface the backup service uses.
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(key: string, value: Uint8Array) {
      store.set(key, value);
      return {} as R2Object;
    },
    async list({ prefix }: { prefix: string }) {
      return {
        objects: [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
      };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

// Fake D1 over sqlite_master-style schema + per-table object rows.
function fakeDB(tables: { name: string; sql: string; rows: Record<string, unknown>[] }[]) {
  return {
    prepare(sql: string) {
      if (sql.includes("sqlite_master")) {
        return {
          all: async () => ({
            results: tables.map((t) => ({ name: t.name, sql: t.sql, type: "table" })),
          }),
        };
      }
      const name = sql.match(/FROM "(.+)"/)![1];
      const table = tables.find((t) => t.name === name)!;
      return { all: async () => ({ results: table.rows }) };
    },
  };
}

function fakeEnv(tables: Parameters<typeof fakeDB>[0], days: string[] = []) {
  const r2 = fakeR2();
  days.forEach((d) => r2.store.set(`${BACKUP_PREFIX}${d}.sql`, new Uint8Array([1])));
  const env = { DB: fakeDB(tables), BACKUPS: r2 } as unknown as Env;
  return { env, r2 };
}

describe("runD1Backup", () => {
  it("writes a date-keyed SQL dump with schema and escaped rows", async () => {
    const { env, r2 } = fakeEnv([
      {
        name: "users",
        sql: "CREATE TABLE users (id text PRIMARY KEY, name text)",
        rows: [
          { id: "u1", name: "O'Brien" },
          { id: "u2", name: null },
          { id: "u3", name: 42 },
        ],
      },
    ]);
    const result = await runD1Backup(env, new Date("2026-09-06T03:30:00Z"));
    expect(result.key).toBe("d1/atur-db/2026-09-06.sql");
    expect(result.tables).toBe(1);
    expect(result.rows).toBe(3);
    const sql = new TextDecoder().decode(r2.store.get(result.key)!);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
    // Quote escaping, NULL, and numeric literals round-trip.
    expect(sql).toContain("'O''Brien'");
    expect(sql).toContain(", NULL");
    expect(sql).toContain(", 42");
    expect(result.pruned).toEqual([]);
  });

  it("excludes migration bookkeeping tables from the dump", async () => {
    const { env } = fakeEnv([
      {
        name: "__drizzle_migrations",
        sql: "CREATE TABLE __drizzle_migrations (hash text)",
        rows: [{ hash: "x" }],
      },
      { name: "users", sql: "CREATE TABLE users (id text)", rows: [{ id: "u1" }] },
    ]);
    const result = await runD1Backup(env, new Date("2026-09-06T03:30:00Z"));
    expect(result.tables).toBe(1);
    expect(result.rows).toBe(1);
  });

  it("overwrites the same-day object on re-run", async () => {
    const tables = [{ name: "users", sql: "CREATE TABLE users (id text)", rows: [] }];
    const { env, r2 } = fakeEnv(tables, ["2026-09-06"]);
    await runD1Backup(env, new Date("2026-09-06T12:00:00Z"));
    expect(r2.store.size).toBe(1);
  });
});

describe("pruneOldBackups", () => {
  it("keeps the newest KEEP_DAYS dumps and deletes the rest", async () => {
    const days = Array.from({ length: KEEP_DAYS + 5 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      return d.toISOString().slice(0, 10);
    });
    const tables = [{ name: "users", sql: "CREATE TABLE users (id text)", rows: [] }];
    const { env, r2 } = fakeEnv(tables, days);
    const pruned = await pruneOldBackups(env);
    expect(pruned).toHaveLength(5);
    expect(r2.store.size).toBe(KEEP_DAYS);
    // Exactly the 5 oldest go; newest survive.
    expect([...pruned].sort()).toEqual(days.slice(0, 5).map((d) => `d1/atur-db/${d}.sql`));
    expect(r2.store.has(`d1/atur-db/${days[5]}.sql`)).toBe(true);
  });
});
