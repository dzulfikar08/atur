import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

// Same harness family as workspace_tools.test.ts (select-ordinal fixtures +
// insert/update capture).
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
        return { where: () => Promise.resolve() };
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

describe("module/state MCP tools (DEV-24)", () => {
  it("create_module binds the module to the resolved workspace + project", async () => {
    const created = { id: "m-new", name: "List A", projectId: "p1", workspaceId: "ws-1" };
    // Select order: getWorkspaceId (owner), assertProjectInWorkspace, read-back.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ projectId: "p1" }], [created]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "create_module",
      { workspace: "acme", project_id: "p1", name: "List A" },
      ME,
    );
    expect(result).toMatchObject({ id: "m-new", name: "List A" });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      name: "List A",
      projectId: "p1",
      workspaceId: "ws-1",
      status: "planned",
    });
  });

  it("create_module with a foreign project id is a 404, nothing inserted", async () => {
    // assertProjectInWorkspace select misses.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], []]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "create_module",
          { workspace: "acme", project_id: "p-foreign", name: "X" },
          ME,
        ),
      404,
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create_state inserts a state bound to project + workspace", async () => {
    const created = { id: "st-1", name: "Need Review", groupName: "started" };
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ projectId: "p1" }], [created]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "create_state",
      { workspace: "acme", project_id: "p1", name: "Need Review", group_name: "started" },
      ME,
    );
    expect(result).toMatchObject({ name: "Need Review" });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      name: "Need Review",
      groupName: "started",
      color: "#808080",
      projectId: "p1",
      workspaceId: "ws-1",
    });
  });

  it("update_module patches only provided fields and reads back", async () => {
    const updated = { id: "m-1", name: "Renamed", status: "planned" };
    // Select order: assertModuleAccess module row, project row, workspace
    // owner row, read-back.
    const db = mockDb([
      [{ projectId: "p1" }],
      [{ workspaceId: "ws-1" }],
      [{ ownerId: ME }],
      [updated],
    ]);
    const result = await handleTool(
      db.db,
      {} as any,
      "update_module",
      { workspace: "acme", module_id: "m-1", name: "Renamed" },
      ME,
    );
    expect(result).toMatchObject({ name: "Renamed" });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ name: "Renamed" });
    expect(db.updates[0].status).toBeUndefined();
  });

  it("update_module with an unknown module id is a 404", async () => {
    const db = mockDb([[]]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "update_module",
          { workspace: "acme", module_id: "m-missing", name: "X" },
          ME,
        ),
      404,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("update_module by a non-member of the module's workspace is a 403", async () => {
    // Select order: module row, project row, workspace owner (foreign),
    // membership select misses → 403 before any write.
    const db = mockDb([
      [{ projectId: "p1" }],
      [{ workspaceId: "ws-1" }],
      [{ ownerId: "other" }],
      [],
    ]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "update_module",
          { workspace: "acme", module_id: "m-1", name: "X" },
          ME,
        ),
      403,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("delete_module with an unknown module id is a 404", async () => {
    const db = mockDb([[]]);
    await expectStatus(
      () =>
        handleTool(db.db, {} as any, "delete_module", { workspace: "acme", module_id: "m-x" }, ME),
      404,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("delete_module soft-deletes (deletedAt set, no hard delete)", async () => {
    const db = mockDb([[{ projectId: "p1" }], [{ workspaceId: "ws-1" }], [{ ownerId: ME }]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "delete_module",
      { workspace: "acme", module_id: "m-1" },
      ME,
    );
    expect(result).toEqual({ success: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].deletedAt).toBeTruthy();
  });
});
