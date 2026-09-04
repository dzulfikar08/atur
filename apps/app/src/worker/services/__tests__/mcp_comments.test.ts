import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

const CALLER = "u1";
const AUTHOR = "u2";
const OWNER = "owner1";

// Comment tools never touch bindings — an empty env is enough.
const ENV: any = {};

// Thenable that also chains like a drizzle query builder (same pattern as
// mcp_upload_image.test.ts). update_comment/delete_comment only need select
// chains and update().set().
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

// Routes every select to per-table rows; captures update().set() payloads and
// applies them to the rows so a post-update re-read sees the new values.
// Where-clauses are ignored — tests express access outcomes through the
// rows themselves (membership rows present/absent, actor ids, empty tables).
function mockDb(tables: Record<string, any[]>) {
  const updates: { table: string; values: any }[] = [];
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
        updates.push({ table: name, values });
        for (const row of tables[name] ?? []) Object.assign(row, values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db, updates };
}

function commentRow(overrides: any = {}) {
  return {
    id: "c1",
    issueId: "i1",
    actorId: AUTHOR,
    commentHtml: "<p>garbled text</p>",
    access: "internal",
    deletedAt: null,
    ...overrides,
  };
}

// comment → issue → project → workspace, caller an active non-owner member.
function accessTables(comment: any = commentRow()) {
  return {
    issue_comments: [comment],
    issues: [{ projectId: "p1" }],
    projects: [{ workspaceId: "w1" }],
    workspaces: [{ ownerId: OWNER }],
    workspace_members: [{ id: "m1" }],
  };
}

async function expectStatus(fn: () => Promise<unknown>, status: number, message?: string) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
    if (message) expect((err as HTTPException).message).toBe(message);
    return;
  }
  throw new Error(`expected HTTPException(${status})`);
}

describe("mcp comment tools", () => {
  it("update_comment: author edits comment_html and gets the updated row back", async () => {
    const { db, updates } = mockDb(accessTables());

    const result = (await handleTool(
      db,
      ENV,
      "update_comment",
      { comment_id: "c1", comment_html: "<p>fixed text</p>", slim: false },
      AUTHOR,
    )) as any;

    expect(result.commentHtml).toBe("<p>fixed text</p>");
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("issue_comments");
    expect(updates[0].values.commentHtml).toBe("<p>fixed text</p>");
    expect(updates[0].values.updatedAt).toBeTruthy();
    expect(updates[0].values.deletedAt).toBeUndefined();
  });

  it("update_comment: 403 when the caller is not the author, nothing written", async () => {
    const { db, updates } = mockDb(accessTables());

    await expectStatus(
      () =>
        handleTool(
          db,
          ENV,
          "update_comment",
          { comment_id: "c1", comment_html: "<p>hijack</p>" },
          CALLER,
        ),
      403,
      "You can only edit your own comments",
    );
    expect(updates).toHaveLength(0);
  });

  it("update_comment: 404 for an unknown comment id", async () => {
    const tables = accessTables();
    tables.issue_comments = [];
    const { db, updates } = mockDb(tables);

    await expectStatus(
      () =>
        handleTool(
          db,
          ENV,
          "update_comment",
          { comment_id: "nope", comment_html: "<p>x</p>" },
          AUTHOR,
        ),
      404,
      "Comment not found",
    );
    expect(updates).toHaveLength(0);
  });

  it("update_comment: 400 on an empty comment_html body, nothing written", async () => {
    const { db, updates } = mockDb(accessTables());

    await expectStatus(
      () =>
        handleTool(db, ENV, "update_comment", { comment_id: "c1", comment_html: "   " }, AUTHOR),
      400,
      "comment_html cannot be empty",
    );
    expect(updates).toHaveLength(0);
  });

  it("delete_comment: author soft-deletes and gets success", async () => {
    const { db, updates } = mockDb(accessTables());

    const result = (await handleTool(
      db,
      ENV,
      "delete_comment",
      { comment_id: "c1" },
      AUTHOR,
    )) as any;

    expect(result).toEqual({ success: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("issue_comments");
    expect(updates[0].values.deletedAt).toBeTruthy();
  });

  it("delete_comment: 403 when the caller is not the author", async () => {
    const { db, updates } = mockDb(accessTables());

    await expectStatus(
      () => handleTool(db, ENV, "delete_comment", { comment_id: "c1" }, CALLER),
      403,
      "You can only delete your own comments",
    );
    expect(updates).toHaveLength(0);
  });

  it("delete_comment: 403 for a non-member of the workspace", async () => {
    const tables = accessTables();
    tables.workspace_members = [];
    const { db, updates } = mockDb(tables);

    await expectStatus(
      () => handleTool(db, ENV, "delete_comment", { comment_id: "c1" }, CALLER),
      403,
      "Not a member of this workspace",
    );
    expect(updates).toHaveLength(0);
  });

  it("delete_comment: 404 when the comment's issue is gone", async () => {
    const tables = accessTables();
    tables.issues = [];
    const { db, updates } = mockDb(tables);

    await expectStatus(
      () => handleTool(db, ENV, "delete_comment", { comment_id: "c1" }, AUTHOR),
      404,
      "Issue not found",
    );
    expect(updates).toHaveLength(0);
  });
});
