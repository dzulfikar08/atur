import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as workspaceService from "../workspaces";
import { updateWorkspaceSchema } from "../workspaces";

// Thenable that also chains like a drizzle query builder. Each select() call
// consumes the next fixture; the last fixture repeats. Same pattern as
// workspace_tools.test.ts / dev19_authz.test.ts.
function chainy(rows: any[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    limit: () => chain,
    orderBy: () => chain,
    offset: () => chain,
  };
  return chain;
}

// Slim mock: select fixtures by call order, insert/update capture.
function mockDb(selectFixtures: any[][]) {
  const updates: any[] = [];
  const inserts: any[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      const builder: any = {
        table: "",
        where: () => chainy(rows),
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    update: () => ({
      set: (patch: any) => {
        updates.push(patch);
        return { where: () => ({ returning: () => Promise.resolve([]) }) };
      },
    }),
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }) };
      },
    }),
  };
  return { db, updates, inserts };
}

describe("workspace strategy rescore (DEV-22)", () => {
  it("a changed rescore stamps reviewed_at and appends one history row", async () => {
    // Select order: service findBySlug (old values), repo.update read-back
    // (new values).
    const db = mockDb([
      [{ id: "ws-1", slug: "acme", moatScore: null, aiProofScore: null }],
      [
        {
          id: "ws-1",
          slug: "acme",
          moatScore: 4,
          aiProofScore: 3,
          strategyVerdict: "harden",
          strategyNote: "workflow lock-in; AI recreates in weeks",
        },
      ],
    ]);
    const result = await workspaceService.update(db.db, "acme", {
      moatScore: 4,
      aiProofScore: 3,
      strategyVerdict: "harden",
      strategyNote: "workflow lock-in; AI recreates in weeks",
    });
    expect(result).toMatchObject({ moatScore: 4, aiProofScore: 3 });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      moatScore: 4,
      aiProofScore: 3,
      strategyVerdict: "harden",
    });
    expect(db.updates[0].reviewedAt).toBeTruthy();
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      workspaceId: "ws-1",
      moatScore: 4,
      aiProofScore: 3,
      strategyVerdict: "harden",
      strategyNote: "workflow lock-in; AI recreates in weeks",
    });
  });

  it("same-values PATCH is a no-op: no reviewed_at stamp, no history row", async () => {
    const current = { id: "ws-1", slug: "acme", moatScore: 4, aiProofScore: 3 };
    const db = mockDb([[current], [current]]);
    await workspaceService.update(db.db, "acme", { moatScore: 4, aiProofScore: 3 });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].reviewedAt).toBeUndefined();
    expect(db.inserts).toHaveLength(0);
  });

  it("a non-strategy patch (name only) writes no history row", async () => {
    const row = { id: "ws-1", slug: "acme", moatScore: 4 };
    const db = mockDb([[row], [{ ...row, name: "Renamed" }]]);
    await workspaceService.update(db.db, "acme", { name: "Renamed" });
    expect(db.updates[0]).toMatchObject({ name: "Renamed" });
    expect(db.updates[0].reviewedAt).toBeUndefined();
    expect(db.inserts).toHaveLength(0);
  });

  it("unknown slug is a 404", async () => {
    const db = mockDb([[]]);
    await expect(workspaceService.update(db.db, "ghost", { moatScore: 3 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("verdict must be a known enum value", () => {
    expect(updateWorkspaceSchema.safeParse({ strategyVerdict: "yolo" }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ strategyVerdict: "harden" }).success).toBe(true);
  });

  it("scores are bounded to 0–5 integers", () => {
    expect(updateWorkspaceSchema.safeParse({ moatScore: 6 }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ moatScore: -1 }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ moatScore: 2.5 }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ moatScore: 5, aiProofScore: 0 }).success).toBe(true);
  });

  it("strategyNote is capped at 2000 chars", () => {
    expect(updateWorkspaceSchema.safeParse({ strategyNote: "x".repeat(2001) }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ strategyNote: "x".repeat(2000) }).success).toBe(true);
  });
});
