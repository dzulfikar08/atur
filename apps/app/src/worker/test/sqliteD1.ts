// Test-only: a real SQLite database behind the D1 surface drizzle's d1 driver
// calls, so service tests run actual queries instead of chained mocks. The
// schema is generated from db/schema.ts (drizzle-kit/api), never hand-copied,
// so it cannot drift. Needs node:sqlite (Node >= 22.5); `sqliteSupported` lets a
// suite skip itself where the runtime lacks it.

import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";

type Row = Record<string, unknown>;
type NodeStatement = {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
  setReturnArrays?(enabled: boolean): void;
};
type NodeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
};

async function loadSqlite(): Promise<(new (path: string) => NodeDatabase) | null> {
  try {
    // Variable specifier: the worker tsconfig has no node types, and this keeps
    // bundlers from trying to resolve a Node builtin.
    const specifier = "node:sqlite";
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      DatabaseSync?: new (path: string) => NodeDatabase;
    };
    const probe = mod.DatabaseSync ? new mod.DatabaseSync(":memory:") : null;
    // Positional rows (setReturnArrays) are required: drizzle reads columns by
    // index, and joined selects repeat column names.
    return probe?.prepare("select 1").setReturnArrays ? (mod.DatabaseSync ?? null) : null;
  } catch {
    return null;
  }
}

const SQLite = await loadSqlite();
export const sqliteSupported = SQLite !== null;

function fakeD1(sqlite: NodeDatabase): D1Database {
  const statement = (sql: string, params: unknown[]) => {
    const self = {
      bind: (...next: unknown[]) => statement(sql, next),
      run: async () => {
        const r = sqlite.prepare(sql).run(...params);
        return {
          success: true,
          results: [],
          meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
        };
      },
      all: async () => {
        const rows = sqlite.prepare(sql).all(...params) as Row[];
        return { success: true, results: rows, meta: {} };
      },
      raw: async () => {
        const stmt = sqlite.prepare(sql);
        stmt.setReturnArrays?.(true);
        return stmt.all(...params);
      },
      first: async () => (sqlite.prepare(sql).all(...params) as Row[])[0] ?? null,
    };
    return self;
  };
  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (stmts: { run(): Promise<unknown> }[]) => {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}

export type TestDb = { db: DbClient; d1: D1Database; sqlite: NodeDatabase };

/** A fresh in-memory database with every table from db/schema.ts. */
export async function createTestDb(): Promise<TestDb> {
  if (!SQLite) throw new Error("node:sqlite is not available in this runtime");
  const ddl = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  );
  const sqlite = new SQLite(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const statement of ddl) sqlite.exec(statement);
  const d1 = fakeD1(sqlite);
  return { db: getDb(d1), d1, sqlite };
}
