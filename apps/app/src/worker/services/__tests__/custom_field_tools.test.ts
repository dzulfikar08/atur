import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

// workspace_tools harness + onConflictDoUpdate for the values upsert.
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
        where: () => chainy(rows),
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  };
  return { db, inserts };
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

describe("custom field MCP tools (DEV-26)", () => {
  it("create_custom_field defaults currency settings to IDR", async () => {
    const created = { id: "f1", name: "Target Jumlah", fieldType: "currency" };
    // Select order: getWorkspaceId (owner), assertProjectInWorkspace, read-back.
    const db = mockDb([[{ id: "ws-1", ownerId: ME }], [{ projectId: "p1" }], [created]]);
    const result = await handleTool(
      db.db,
      {} as any,
      "create_custom_field",
      { workspace: "acme", project_id: "p1", name: "Target Jumlah", field_type: "currency" },
      ME,
    );
    expect(result).toMatchObject({ fieldType: "currency" });
    expect(JSON.parse(db.inserts[0].options)).toEqual({ currency: "IDR" });
  });

  it("set_custom_field_value writes the JSON value for a bound issue+field", async () => {
    // Select order: getWorkspaceId, assertProjectInWorkspace, issue, field.
    const db = mockDb([
      [{ id: "ws-1", ownerId: ME }],
      [{ projectId: "p1" }],
      [{ id: "i1", workspaceId: "ws-1" }],
      [{ id: "f1" }],
    ]);
    const result = await handleTool(
      db.db,
      {} as any,
      "set_custom_field_value",
      {
        workspace: "acme",
        project_id: "p1",
        issue_id: "i1",
        custom_field_id: "f1",
        value_json: { amount_cents: 3750000000, currency: "IDR" },
      },
      ME,
    );
    expect(result).toEqual({ success: true });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({ issueId: "i1", customFieldId: "f1" });
    expect(db.inserts[0].valueJson).toBe('{"amount_cents":3750000000,"currency":"IDR"}');
  });

  it("set_custom_field_value with a foreign-project field is a 404", async () => {
    const db = mockDb([
      [{ id: "ws-1", ownerId: ME }],
      [{ projectId: "p1" }],
      [{ id: "i1", workspaceId: "ws-1" }],
      [], // field lookup misses
    ]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "set_custom_field_value",
          {
            workspace: "acme",
            project_id: "p1",
            issue_id: "i1",
            custom_field_id: "f-foreign",
            value_json: 1,
          },
          ME,
        ),
      404,
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("set_custom_field_value with an issue from another project is a 404", async () => {
    const db = mockDb([
      [{ id: "ws-1", ownerId: ME }],
      [{ projectId: "p1" }],
      [], // issue lookup misses
    ]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as any,
          "set_custom_field_value",
          {
            workspace: "acme",
            project_id: "p1",
            issue_id: "i-foreign",
            custom_field_id: "f1",
            value_json: 1,
          },
          ME,
        ),
      404,
    );
  });
});
