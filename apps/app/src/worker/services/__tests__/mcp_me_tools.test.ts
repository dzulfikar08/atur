import { beforeAll, describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import * as schema from "../../db/schema";
import { handleTool, TOOLS } from "../../routes/mcp/index";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { TODAY, seedMyWork } from "../../test/meFixture";

const ME = "me";
const ENV: any = {};
const ROW_FIELDS = [
  "id",
  "name",
  "sequenceId",
  "key",
  "priority",
  "stateId",
  "stateKey",
  "stateName",
  "stateGroup",
  "projectId",
  "projectName",
  "projectIdentifier",
  "workspaceSlug",
  "workspaceName",
  "targetDate",
  "updatedAt",
  "assignees",
].sort();

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

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

describe("me tools are advertised", () => {
  it("lists whoami, my_issues, my_today, list_notifications, mark_notification_read, get_workspace_logo once each", () => {
    for (const name of [
      "whoami",
      "my_issues",
      "my_today",
      "list_notifications",
      "mark_notification_read",
      "get_workspace_logo",
    ]) {
      const tools = TOOLS.filter((t) => t.name === name);
      expect(tools, name).toHaveLength(1);
      expect(tools[0].inputSchema.type).toBe("object");
    }
  });
});

describe.skipIf(!sqliteSupported)("my work MCP tools (real SQLite)", () => {
  let t: TestDb;
  const call = (tool: string, params: Record<string, unknown> = {}, as = ME) =>
    handleTool(t.db, ENV, tool, params, as);

  beforeAll(async () => {
    t = await createTestDb();
    await seedMyWork(t.db);
  });

  describe("whoami", () => {
    it("returns the authenticated user's identity", async () => {
      expect(await call("whoami")).toEqual({
        id: "me",
        email: "me@example.com",
        displayName: "Me Myself",
        avatar: "a.png",
      });
    });
  });

  describe("my_issues", () => {
    it("only returns issues assigned to the caller, as slim rows", async () => {
      const out = (await call("my_issues", { today: TODAY })) as { results: any[]; total: number };
      expect(ids(out.results)).toEqual(["i-done", "i-overdue", "i-today", "i-week"]);
      expect(out.total).toBe(4);
      for (const row of out.results) expect(Object.keys(row).sort()).toEqual(ROW_FIELDS);
      expect(out.results.find((r) => r.id === "i-overdue")).toMatchObject({
        key: "ALP-1",
        stateKey: "in_progress",
        stateName: "in_progress",
        stateGroup: "started",
        workspaceSlug: "alpha",
        projectIdentifier: "ALP",
        assignees: [{ id: "me", displayName: "Me Myself" }],
      });
    });

    it("never leaks other people's issues even when asked by another user", async () => {
      const out = (await call("my_issues", { today: TODAY }, "other")) as any;
      expect(ids(out.results)).toEqual(["i-theirs"]);
    });

    it("respects workspace, due and state_key filters", async () => {
      const run = async (params: Record<string, unknown>) =>
        ids(((await call("my_issues", { today: TODAY, ...params })) as any).results);
      expect(await run({ workspace: "beta" })).toEqual(["i-week"]);
      expect(await run({ workspace: "w-alpha" })).toEqual(["i-done", "i-overdue", "i-today"]);
      expect(await run({ workspace: "gamma" })).toEqual([]);
      expect(await run({ due: "overdue" })).toEqual(["i-overdue"]);
      expect(await run({ due: "today" })).toEqual(["i-today"]);
      expect(await run({ due: "week" })).toEqual(["i-today", "i-week"]);
      expect(await run({ state_key: "in_progress,needs_you" })).toEqual(["i-overdue", "i-today"]);
      expect(await run({ q: "ALP-2" })).toEqual(["i-today"]);
    });

    it("pages with limit/offset and reports the full total", async () => {
      const out = (await call("my_issues", { today: TODAY, limit: 1, offset: 1 })) as any;
      expect(out.results).toHaveLength(1);
      expect(out.total).toBe(4);
    });

    it("rejects an unknown due value", async () => {
      await expectStatus(() => call("my_issues", { due: "tomorrow" }), 400);
    });
  });

  describe("my_today", () => {
    it("returns the buckets and counts with slim rows", async () => {
      const out = (await call("my_today", { today: TODAY })) as any;
      expect(ids(out.overdue)).toEqual(["i-overdue"]);
      expect(ids(out.due_today)).toEqual(["i-free-alpha", "i-today"]);
      expect(ids(out.due_this_week)).toEqual(["i-week"]);
      expect(out.counts).toEqual({
        overdue: 1,
        due_today: 2,
        needs_you: 0,
        need_review: 0,
        in_progress: 0,
        due_this_week: 1,
        total: 4,
      });
      for (const row of [...out.overdue, ...out.due_today, ...out.due_this_week]) {
        expect(Object.keys(row).sort()).toEqual(ROW_FIELDS);
      }
    });

    it("scopes to a workspace", async () => {
      const out = (await call("my_today", { today: TODAY, workspace: "beta" })) as any;
      expect(ids(out.due_this_week)).toEqual(["i-week"]);
      expect(out.counts.total).toBe(1);
    });

    it("caps each bucket at 50 rows while counts stay full", async () => {
      const big = await createTestDb();
      await seedMyWork(big.db);
      const many = Array.from({ length: 60 }, (_, i) => ({
        id: `bulk-${i}`,
        name: `Bulk ${i}`,
        sequenceId: 100 + i,
        projectId: "p-alpha",
        workspaceId: "w-alpha",
        targetDate: "2026-09-01",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }));
      for (let i = 0; i < many.length; i += 10) {
        await big.db.insert(schema.issues).values(many.slice(i, i + 10));
        await big.db
          .insert(schema.issueAssignees)
          .values(
            many
              .slice(i, i + 10)
              .map((m) => ({ id: `ba-${m.id}`, issueId: m.id, assigneeId: "me" })),
          );
      }
      const out = (await handleTool(big.db, ENV, "my_today", { today: TODAY }, ME)) as any;
      expect(out.overdue).toHaveLength(50);
      expect(out.counts.overdue).toBe(61);
      expect(out.counts.total).toBe(64);
    });
  });
});

describe.skipIf(!sqliteSupported)("notification MCP tools (real SQLite)", () => {
  let t: TestDb;
  const call = (tool: string, params: Record<string, unknown> = {}, as = ME) =>
    handleTool(t.db, ENV, tool, params, as);
  const unreadOf = async () => ((await call("list_notifications")) as any).unread;

  beforeAll(async () => {
    t = await createTestDb();
    await seedMyWork(t.db);
    const base = {
      workspaceId: "w-alpha",
      projectId: "p-alpha",
      receiverId: "me",
      entityName: "Overdue thing",
      entityIdentifier: "ALP-1",
    };
    await t.db.insert(schema.notifications).values([
      {
        ...base,
        id: "n1",
        title: "New comment",
        message: "Someone commented",
        data: JSON.stringify({ issue_id: "i-overdue", comment_id: "c1" }),
        createdAt: "2026-10-29T10:00:00.000Z",
      },
      {
        ...base,
        id: "n2",
        title: "Assigned",
        message: "You were assigned",
        data: "not json",
        readAt: "2026-10-29T12:00:00.000Z",
        createdAt: "2026-10-29T09:00:00.000Z",
      },
      { ...base, id: "n3", title: "Old", createdAt: "2026-10-28T09:00:00.000Z" },
      {
        ...base,
        id: "n-other",
        receiverId: "other",
        title: "Not mine",
        createdAt: "2026-10-29T11:00:00.000Z",
      },
    ]);
  });

  it("list_notifications returns my rows newest first, parsed, with workspace and unread count", async () => {
    const out = (await call("list_notifications")) as any;
    expect(out.total).toBe(3);
    expect(out.unread).toBe(2);
    expect(out.results.map((n: any) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(out.results[0]).toEqual({
      id: "n1",
      title: "New comment",
      message: "Someone commented",
      entityName: "Overdue thing",
      entityIdentifier: "ALP-1",
      issueId: "i-overdue",
      workspaceSlug: "alpha",
      workspaceName: "Alpha",
      projectId: "p-alpha",
      read: false,
      createdAt: "2026-10-29T10:00:00.000Z",
    });
    // Unparseable payloads and read rows degrade instead of failing the list.
    expect(out.results[1]).toMatchObject({ issueId: null, read: true });
  });

  it("pages with limit/offset", async () => {
    const out = (await call("list_notifications", { limit: 1, offset: 1 })) as any;
    expect(out.results.map((n: any) => n.id)).toEqual(["n2"]);
    expect(out.total).toBe(3);
  });

  it("mark_notification_read marks one of mine and refuses someone else's", async () => {
    expect(await call("mark_notification_read", { id: "n1" })).toEqual({ ok: true });
    expect(await unreadOf()).toBe(1);
    await expectStatus(() => call("mark_notification_read", { id: "n-other" }), 404);
    await expectStatus(() => call("mark_notification_read", { id: "missing" }), 404);
    expect(((await call("list_notifications", {}, "other")) as any).unread).toBe(1);
  });

  it("mark_notification_read all clears mine only; no argument is a 400", async () => {
    await expectStatus(() => call("mark_notification_read"), 400);
    expect(await call("mark_notification_read", { all: true })).toEqual({ ok: true });
    expect(await unreadOf()).toBe(0);
    expect(((await call("list_notifications", {}, "other")) as any).unread).toBe(1);
  });
});

describe.skipIf(!sqliteSupported)("workspace logos (real SQLite)", () => {
  let t: TestDb;
  const PNG = Uint8Array.from(atob("iVBORw0KGgo="), (c) => c.charCodeAt(0));
  const objects = new Map<string, Uint8Array>();
  const env: any = {
    R2: {
      get: async (key: string) => {
        const bytes = objects.get(key);
        return bytes ? { body: new Response(bytes as BodyInit).body, size: bytes.length } : null;
      },
    },
  };
  const call = (tool: string, params: Record<string, unknown> = {}, as = ME, origin?: string) =>
    handleTool(t.db, env, tool, params, as, origin);

  const setLogo = (workspaceSlug: string, logo: string | null) =>
    t.sqlite.prepare("update workspaces set logo = ? where slug = ?").run(logo, workspaceSlug);
  const addAsset = async (
    id: string,
    bytes: Uint8Array,
    contentType: string,
    size = bytes.length,
  ) => {
    objects.set(`k/${id}`, bytes);
    await t.db
      .insert(schema.fileAssets)
      .values({ id, asset: `k/${id}`, size, contentType, createdById: "me" });
  };

  beforeAll(async () => {
    t = await createTestDb();
    await seedMyWork(t.db);
  });

  it("list_workspaces returns each workspace's stored logo (null when unset)", async () => {
    setLogo("alpha", "/api/assets/logo-1");
    const rows = (await call("list_workspaces")) as any[];
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug.alpha).toEqual({
      id: "w-alpha",
      name: "Alpha",
      slug: "alpha",
      logo: "/api/assets/logo-1",
    });
    expect(bySlug.beta.logo).toBeNull();
    expect(bySlug.gamma).toBeUndefined();
  });

  it("get_workspace_logo inlines a small image asset as a data URL", async () => {
    await addAsset("logo-1", PNG, "image/png");
    expect(await call("get_workspace_logo", { workspace: "alpha" })).toEqual({
      contentType: "image/png",
      dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`,
    });
  });

  it("accepts an absolute logo URL on this deployment's origin", async () => {
    setLogo("alpha", "https://app.example.com/api/assets/logo-1?v=2");
    const out = (await call(
      "get_workspace_logo",
      { workspace: "alpha" },
      ME,
      "https://app.example.com",
    )) as any;
    expect(out.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("returns dataUrl null for oversized, non-image, missing and unset logos", async () => {
    await addAsset("big", PNG, "image/png", 300 * 1024);
    await addAsset("html", PNG, "text/html");
    for (const logo of ["/api/assets/big", "/api/assets/html", "/api/assets/ghost", null]) {
      setLogo("alpha", logo);
      expect(await call("get_workspace_logo", { workspace: "alpha" })).toEqual({ dataUrl: null });
    }
  });

  it("passes a public https logo through as logo with dataUrl null", async () => {
    setLogo("alpha", "https://cdn.example.com/alpha.png");
    expect(await call("get_workspace_logo", { workspace: "alpha" })).toEqual({
      logo: "https://cdn.example.com/alpha.png",
      dataUrl: null,
    });
  });

  it("requires workspace membership", async () => {
    setLogo("gamma", "/api/assets/logo-1");
    await expectStatus(() => call("get_workspace_logo", { workspace: "gamma" }), 403);
  });
});
