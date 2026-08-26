import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

// workspace_tools harness.
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
          builder.cond = cond;
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
  return { db, updates, inserts };
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

describe("folder MCP tools (DEV-27)", () => {
  it("create_folder inserts a folder bound to the resolved workspace", async () => {
    const created = { id: "f1", name: "Program", workspaceId: "ws-1" };
    // Select order: getWorkspaceId (owner), read-back.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [created]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "create_folder",
      { workspace: "acme", name: "Program" },
      ME,
    );
    expect(result).toMatchObject({ name: "Program" });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      name: "Program",
      workspaceId: "ws-1",
      sortOrder: 65535.0,
    });
  });

  it("set_project_folder moves the project (folder_id set)", async () => {
    // Select order: getWorkspaceId, assertProjectInWorkspace, assertFolderInWorkspace.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ projectId: "p1" }], [{ id: "f1" }]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "set_project_folder",
      { workspace: "acme", project_id: "p1", folder_id: "f1" },
      ME,
    );
    expect(result).toEqual({ success: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ folderId: "f1" });
  });

  it("set_project_folder with folder_id null clears the folder", async () => {
    // assertFolderInWorkspace is skipped for null.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ projectId: "p1" }]]);
    await handleTool(
      db.db,
      {} as any,
      "set_project_folder",
      { workspace: "acme", project_id: "p1", folder_id: null },
      ME,
    );
    expect(db.updates[0]).toMatchObject({ folderId: null });
  });

  it("set_project_folder with a foreign folder id is a 404, no write", async () => {
    const db = mockDb([
      [{ id: "ws-1", ownerId: ME }],
      [{ projectId: "p1" }],
      [], // folder lookup misses
    ]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "set_project_folder",
          { workspace: "acme", project_id: "p1", folder_id: "f-foreign" },
          ME,
        ),
      404,
    );
    expect(db.updates).toHaveLength(0);
  });

  it("delete_folder soft-deletes (deletedAt set)", async () => {
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ id: "f1" }]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "delete_folder",
      { workspace: "acme", folder_id: "f1" },
      ME,
    );
    expect(result).toEqual({ success: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].deletedAt).toBeTruthy();
  });
});
