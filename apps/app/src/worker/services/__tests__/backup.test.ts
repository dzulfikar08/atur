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

function fakeEnv(days: string[]) {
  const r2 = fakeR2();
  days.forEach((d) => r2.store.set(`${BACKUP_PREFIX}${d}.sqlite`, new Uint8Array([1])));
  const env = {
    DB: { dump: async () => new Uint8Array([9, 9, 9]) },
    BACKUPS: r2 as unknown as R2Bucket,
  } as unknown as Env;
  return { env, r2 };
}

describe("runD1Backup", () => {
  it("writes a date-keyed dump and reports its size", async () => {
    const { env, r2 } = fakeEnv([]);
    const result = await runD1Backup(env, new Date("2026-09-06T03:30:00Z"));
    expect(result.key).toBe("d1/atur-db/2026-09-06.sqlite");
    expect(result.size).toBe(3);
    expect(r2.store.get(result.key)).toEqual(new Uint8Array([9, 9, 9]));
    expect(result.pruned).toEqual([]);
  });

  it("overwrites the same-day object on re-run", async () => {
    const { env, r2 } = fakeEnv(["2026-09-06"]);
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
    const { env, r2 } = fakeEnv(days);
    const pruned = await pruneOldBackups(env);
    expect(pruned).toHaveLength(5);
    expect(r2.store.size).toBe(KEEP_DAYS);
    // Newest survive, oldest go.
    // Exactly the 5 oldest go; newest survive.
    expect([...pruned].sort()).toEqual(
      days.slice(0, 5).map((d) => `d1/atur-db/${d}.sqlite`),
    );
    expect(r2.store.has(`d1/atur-db/${days[5]}.sqlite`)).toBe(true);
  });

  it("ignores non-sqlite objects in the prefix", async () => {
    const { env, r2 } = fakeEnv(["2026-01-01"]);
    r2.store.set(`${BACKUP_PREFIX}notes.txt`, new Uint8Array([1]));
    const pruned = await pruneOldBackups(env, 1);
    expect(pruned).toEqual([]);
    expect(r2.store.has(`${BACKUP_PREFIX}notes.txt`)).toBe(true);
  });
});
