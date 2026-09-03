import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool, TOOLS } from "../../routes/mcp/index";
import { SLIM_STRING_LIMIT, slimResponse } from "../../routes/mcp/slim";

const ME = "u1";
const ENV: any = {};

// Thenable that also chains like a drizzle query builder (same pattern as
// mcp_comments.test.ts).
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

// Routes every select to per-table rows; update().set() payloads are captured
// and applied to the rows so a post-update re-read sees new values.
function mockDb(tables: Record<string, any[]>) {
  const db: any = {
    select: () => {
      const builder: any = {
        table: "",
        leftJoin: () => builder,
        where: () => chainy(tables[builder.table] ?? []),
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    update: (table: any) => ({
      set: (values: any) => {
        const name = getTableName(table);
        for (const row of tables[name] ?? []) Object.assign(row, values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db };
}

function issueRow(overrides: any = {}) {
  return {
    id: "i1",
    name: "Ship the thing",
    descriptionHtml: "<p>long body</p>",
    descriptionStripped: "long body",
    priority: "high",
    stateId: "s-done",
    sequenceId: 7,
    parentId: null,
    projectId: "p1",
    workspaceId: "ws-1",
    isDecision: 0,
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}
function issueTables(issues: any[]) {
  return {
    workspaces: [{ id: "ws-1", ownerId: ME }],
    issues,
    projects: [{ id: "p1", workspaceId: "ws-1" }],
    states: [{ id: "s-done" }],
    workspace_members: [{ id: "m1" }],
  };
}

describe("mcp slim responses — default passthrough", () => {
  it("update_issue without slim returns the full row byte-identically", async () => {
    const row = issueRow();
    const { db } = mockDb(issueTables([row]));

    const result = (await handleTool(
      db,
      ENV,
      "update_issue",
      { workspace: "acme", project_id: "p1", issue_id: "i1", state_id: "s-done" },
      ME,
    )) as any;

    expect(result).toEqual([row]);
    expect(result[0].descriptionHtml).toBe("<p>long body</p>");
    expect(result[0].descriptionStripped).toBe("long body");
  });

  it("explicit slim:false behaves exactly like omitting slim", async () => {
    const row = issueRow();
    const { db } = mockDb(issueTables([row]));

    const result = (await handleTool(
      db,
      ENV,
      "update_issue",
      { workspace: "acme", project_id: "p1", issue_id: "i1", slim: false },
      ME,
    )) as any;

    expect(result).toEqual([row]);
  });
});

describe("mcp slim responses — mutations", () => {
  it("update_issue with slim:true projects to identity fields, no description echo", async () => {
    const row = issueRow();
    const { db } = mockDb(issueTables([row]));

    const result = (await handleTool(
      db,
      ENV,
      "update_issue",
      {
        workspace: "acme",
        project_id: "p1",
        issue_id: "i1",
        state_id: "s-done",
        slim: true,
      },
      ME,
    )) as any;

    expect(result).toEqual([
      { id: "i1", name: "Ship the thing", sequenceId: 7, stateId: "s-done", priority: "high", projectId: "p1" },
    ]);
    const keys = Object.keys(result[0]);
    expect(keys).not.toContain("descriptionHtml");
    expect(keys).not.toContain("descriptionStripped");
  });

  it("update_comment with slim:true never echoes comment_html", async () => {
    const comment = {
      id: "c1",
      issueId: "i1",
      actorId: ME,
      commentHtml: "<p>edited</p>",
      access: "internal",
      deletedAt: null,
    };
    const { db } = mockDb({
      issue_comments: [comment],
      issues: [{ projectId: "p1" }],
      projects: [{ workspaceId: "ws-1" }],
      workspaces: [{ ownerId: "owner1" }],
      workspace_members: [{ id: "m1" }],
    });

    const result = (await handleTool(
      db,
      ENV,
      "update_comment",
      { comment_id: "c1", comment_html: "<p>edited</p>", slim: true },
      ME,
    )) as any;

    expect(result.id).toBe("c1");
    expect(Object.keys(result)).not.toContain("commentHtml");
  });

  it("add_comment-style projection keeps the comment id for the caller", () => {
    const out = slimResponse(
      "add_comment",
      { slim: true },
      [{ id: "c9", issueId: "i1", actorId: ME, commentHtml: "<p>hey</p>", access: "internal", createdAt: "t" }],
    );
    expect(out).toEqual([
      { id: "c9", issueId: "i1", actorId: ME, access: "internal", createdAt: "t" },
    ]);
  });
});

describe("mcp slim responses — lists", () => {
  it("list_issues with slim:true slims every row and omits heavy fields", async () => {
    const rows = [issueRow(), issueRow({ id: "i2", sequenceId: 8 })];
    const { db } = mockDb(issueTables(rows));

    const result = (await handleTool(
      db,
      ENV,
      "list_issues",
      { workspace: "acme", project_id: "p1", slim: true },
      ME,
    )) as any;

    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual(
        ["id", "name", "priority", "projectId", "sequenceId", "stateId"],
      );
      expect(row.descriptionHtml).toBeUndefined();
    }
  });

  it("search_issues slim:true omits description fields", async () => {
    const { db } = mockDb(issueTables([issueRow()]));

    const result = (await handleTool(
      db,
      ENV,
      "search_issues",
      { workspace: "acme", query: "ship", slim: true },
      ME,
    )) as any;

    expect(Object.keys(result[0])).not.toContain("descriptionHtml");
    expect(result[0].id).toBe("i1");
  });
});

describe("mcp slim responses — include opt-back-in and truncation", () => {
  it("get_issue slim + include:['description'] restores descriptionHtml, truncated at the limit", async () => {
    const long = "<p>" + "x".repeat(600) + "</p>";
    const row = issueRow({ descriptionHtml: long, descriptionStripped: "y".repeat(600) });
    const { db } = mockDb(issueTables([row]));

    const result = (await handleTool(
      db,
      ENV,
      "get_issue",
      { workspace: "acme", issue_id: "i1", slim: true, include: ["description"] },
      ME,
    )) as any;

    expect(result.descriptionHtml).toBe(long.slice(0, SLIM_STRING_LIMIT) + "…[truncated]");
    expect(result.descriptionHtml).not.toBe(long);
    expect(result.descriptionStripped).toBe("y".repeat(500) + "…[truncated]");
    expect(result.id).toBe("i1");
  });

  it("include matches underscore/case-insensitively: ['comment_html'] restores commentHtml", () => {
    const out = slimResponse(
      "list_comments",
      { slim: true, include: ["comment_html"] },
      [{ id: "c1", issueId: "i1", actorId: ME, commentHtml: "<p>full</p>", access: "internal", createdAt: "t" }],
    ) as any[];
    expect(out[0].commentHtml).toBe("<p>full</p>");
  });

  it("without include, heavy fields stay omitted even when long strings are kept", () => {
    const out = slimResponse(
      "list_time_entries",
      { slim: true },
      [
        {
          id: "t1",
          issueId: "i1",
          userId: ME,
          durationSeconds: 90 * 60,
          description: "z".repeat(700),
          startedAt: "t",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    ) as any[];
    expect(out[0].description).toBe("z".repeat(SLIM_STRING_LIMIT) + "…[truncated]");
  });
});

describe("mcp slim responses — irregular shapes", () => {
  it("get_contact bundle keeps slimmed contact+company, drops collections", () => {
    const out = slimResponse("get_contact", { slim: true }, {
      contact: { id: "cu1", email: "a@b.c", name: "A", status: "lead", sessionToken: "tok" },
      company: { id: "co1", name: "Co", description: "d".repeat(600) },
      deals: [{ id: "d1" }],
      tickets: [{ id: "t1" }],
      facts: [{ id: "f1" }],
    }) as any;
    expect(out.company).toEqual({ id: "co1", name: "Co" });
    expect(out.company.description).toBeUndefined();
    expect(out.deals).toBeUndefined();
    expect(out.tickets).toBeUndefined();
  });

  it("pagination envelopes keep total, project only the rows", () => {
    const out = slimResponse(
      "list_contacts",
      { slim: true },
      { results: [{ id: "cu1", email: "a@b.c", status: "lead", sessionToken: "tok" }], total: 1 },
    ) as any;
    expect(out.total).toBe(1);
    expect(out.results).toEqual([{ id: "cu1", email: "a@b.c", status: "lead" }]);
  });

  it("already-minimal responses (delete) pass through untouched even with slim:true", async () => {
    const row = issueRow();
    const { db } = mockDb(issueTables([row]));

    const result = (await handleTool(
      db,
      ENV,
      "delete_issue",
      { workspace: "acme", project_id: "p1", issue_id: "i1", slim: true },
      ME,
    )) as any;
    expect(result).toEqual({ success: true });
  });
});

describe("mcp tools/list advertises slim fields", () => {
  it("every tool takes slim; list tools with heavy fields also take include", () => {
    const byName = new Map(TOOLS.map((t) => [t.name, t]));
    for (const tool of TOOLS) {
      expect(tool.inputSchema.properties?.slim, `${tool.name} should accept slim`).toBeDefined();
    }
    expect(byName.get("list_issues")?.inputSchema.properties?.include).toBeDefined();
    expect(byName.get("get_issue")?.inputSchema.properties?.include).toBeDefined();
    expect(byName.get("delete_issue")?.inputSchema.properties?.include).toBeUndefined();
  });

  it("slim/include are optional — no required array gains entries", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.required ?? []).not.toContain("slim");
      expect(tool.inputSchema.required ?? []).not.toContain("include");
    }
  });
});

describe("mcp slim responses — authz errors still raise", () => {
  it("HTTPException passes through the slim wrapper untouched", async () => {
    const { db } = mockDb({ workspaces: [] });
    await expect(
      handleTool(
        db,
        ENV,
        "update_issue",
        { workspace: "ghost", project_id: "p1", issue_id: "i1", slim: true },
        ME,
      ),
    ).rejects.toBeInstanceOf(HTTPException);
  });
});
