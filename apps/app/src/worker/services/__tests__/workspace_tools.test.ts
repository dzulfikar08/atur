import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

// Thenable that also chains like a drizzle query builder (limit/orderBy are
// no-ops returning the same result). Each select() call consumes the next
// fixture; the last fixture repeats. Same pattern as dev19_authz.test.ts.
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

// Slim dev19-style mock: select fixtures by call order (capturing the
// from-table for predicate pins), insert/update capture. No drizzle.query
// relational API needed — workspace tools only use the builder API.
function mockDb(selectFixtures: any[][]) {
  const updates: any[] = [];
  const inserts: any[] = [];
  const selects: { table: string; cond: unknown }[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      const idx = selectIdx;
      selectIdx++;
      const builder: any = {
        table: "",
        innerJoin: () => builder,
        where: (cond: unknown) => {
          selects[idx] = { table: builder.table, cond };
          return chainy(rows);
        },
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
  return { db, updates, inserts, selects };
}

const ME = "u1";
const OTHER = "u2";

async function expectStatus(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
    return;
  }
  throw new Error(`expected HTTPException(${status})`);
}

describe("workspace management MCP tools", () => {
  it("create_workspace inserts workspace + owner membership, returns the row", async () => {
    const wsRow = { id: "ws-new", slug: "acme", name: "Acme" };
    // Select order: findBySlug (dupe check), findById (post-insert read-back).
    const db = mockDb([[], [wsRow]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "create_workspace",
      { name: "Acme", slug: "acme", timezone: "Asia/Jakarta" },
      ME,
    );
    expect(result).toMatchObject({ id: "ws-new", slug: "acme" });
    expect(db.inserts).toHaveLength(2);
    expect(db.inserts[0]).toMatchObject({ name: "Acme", slug: "acme", ownerId: ME });
    // repo.create mints a uuid for the workspace; the membership row must
    // reference THAT id, not any fixture value.
    expect(db.inserts[1]).toMatchObject({ memberId: ME, role: 20 });
    expect(db.inserts[1].workspaceId).toBe(db.inserts[0].id);
  });

  it("create_workspace with a taken slug is a 409, nothing inserted", async () => {
    const db = mockDb([[{ id: "ws-existing", slug: "acme" }]]);
    await expectStatus(
      () => handleTool(db.db, {} as any, "create_workspace", { name: "Acme", slug: "acme" }, ME),
      409,
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create_workspace with a malformed slug is a 400", async () => {
    const db = mockDb([[]]);
    await expectStatus(
      () =>
        handleTool(db.db, {} as any, "create_workspace", { name: "Acme", slug: "Not A Slug" }, ME),
      400,
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("update_workspace as owner applies the patch", async () => {
    const updated = { id: "ws-1", slug: "acme", name: "Acme Renamed" };
    // Select order: getWorkspaceId (owner short-circuits the membership
    // select), assertWorkspaceAdmin (owner short-circuits the role select),
    // findById (read-back).
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ ownerId: ME }], [updated]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "update_workspace",
      { workspace: "acme", name: "Acme Renamed" },
      ME,
    );
    expect(result).toMatchObject({ name: "Acme Renamed" });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ name: "Acme Renamed" });
    expect(db.updates[0].updatedAt).toBeTruthy();
  });

  it("update_workspace as a regular member is a 403", async () => {
    // Select order: getWorkspaceId (foreign owner → membership select),
    // membership row (active member), assertWorkspaceAdmin owner select,
    // role select (role 5 < 20).
    const db = mockDb([
      [{ id: "ws-1", ownerId: OTHER }],
      [{ id: "m1" }],
      [{ ownerId: OTHER }],
      [{ role: 5 }],
    ]);
    await expectStatus(
      () =>
        handleTool(db.db, {} as any, "update_workspace", { workspace: "acme", name: "Nope" }, ME),
      403,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("update_workspace as an admin member (role 20) applies the patch", async () => {
    const updated = { id: "ws-1", slug: "acme", name: "Admin Rename" };
    const db = mockDb([
      [{ id: "ws-1", ownerId: OTHER }],
      [{ id: "m1" }],
      [{ ownerId: OTHER }],
      [{ role: 20 }],
      [updated],
    ]);
    const result = await handleTool(
      db.db,
      {} as any,
      "update_workspace",
      { workspace: "acme", name: "Admin Rename" },
      ME,
    );
    expect(result).toMatchObject({ name: "Admin Rename" });
    expect(db.updates).toHaveLength(1);
  });

  it("update_workspace with no updatable fields is a 400", async () => {
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ ownerId: ME }]]);
    await expectStatus(
      () => handleTool(db.db, {} as any, "update_workspace", { workspace: "acme" }, ME),
      400,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("update_workspace by a non-member is a 403 from getWorkspaceId", async () => {
    const db = mockDb([[{ id: "ws-1", ownerId: OTHER }], []]);
    await expectStatus(
      () => handleTool(db.db, {} as any, "update_workspace", { workspace: "acme", name: "X" }, ME),
      403,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("delete_workspace as owner soft-deletes (deletedAt set)", async () => {
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ ownerId: ME }]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "delete_workspace",
      { workspace: "acme" },
      ME,
    );
    expect(result).toMatchObject({ success: true, deleted: "acme" });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].deletedAt).toBeTruthy();
  });

  it("delete_workspace as a suspended/no-active-membership admin is a 403", async () => {
    // The role select filters isActive = 1 in the predicate; an empty fixture
    // models a suspended (or removed) member, so no active row matches.
    const db = mockDb([[{ id: "ws-1", ownerId: OTHER }], [{ id: "m1" }], [{ ownerId: OTHER }], []]);
    await expectStatus(
      () => handleTool(db.db, {} as any, "delete_workspace", { workspace: "acme" }, ME),
      403,
    );
    expect(db.updates).toHaveLength(0);
  });
});
