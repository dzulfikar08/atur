import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { TODAY, seedMyWork } from "../../test/meFixture";
import { meRoutes } from "../me";

// GET /api/me/issues and /api/me/today are thin callers of services/meIssues;
// this pins the response envelopes the web client reads.
describe.skipIf(!sqliteSupported)("/api/me/issues and /api/me/today", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let caller = "me";

  beforeAll(async () => {
    t = await createTestDb();
    await seedMyWork(t.db);
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: caller, email: "x@example.com" } as never);
      await next();
    });
    app.route("/api/me", meRoutes);
  });

  const get = async (path: string, as = "me") => {
    caller = as;
    const res = await app.request(path, undefined, { DB: t.d1 } as never);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it("paginates enriched rows with the legacy envelope", async () => {
    const { status, body } = await get(
      `/api/me/issues?assignee=me&today=${TODAY}&limit=2&sort=name:asc`,
    );
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["results", "total", "offset", "limit", "next_offset"]);
    expect(body).toMatchObject({ total: 4, offset: 0, limit: 2, next_offset: 2 });
    expect(body.results.map((r: any) => r.id)).toEqual(["i-done", "i-week"]);
    expect(body.results[0]).toMatchObject({
      workspaceSlug: "alpha",
      projectIdentifier: "ALP",
      state: { key: "done", group: "completed" },
      assignees: [{ id: "me" }],
      labels: [],
    });
    expect(body.results[0]).not.toHaveProperty("descriptionHtml");
  });

  it("filters via query params", async () => {
    const { body } = await get(
      `/api/me/issues?assignee=me&workspace=alpha&due=overdue&state_key=in_progress&today=${TODAY}`,
    );
    expect(body.results.map((r: any) => r.id)).toEqual(["i-overdue"]);
  });

  it("an unknown workspace is an empty page with the requested offset/limit", async () => {
    const { body } = await get("/api/me/issues?workspace=gamma&limit=7&offset=3");
    expect(body).toEqual({ results: [], total: 0, offset: 3, limit: 7, next_offset: null });
  });

  it("a user without workspaces gets the fixed 0/50 empty page", async () => {
    const { body } = await get("/api/me/issues?limit=7&offset=3", "nobody");
    expect(body).toEqual({ results: [], total: 0, offset: 0, limit: 50, next_offset: null });
  });

  it("returns the today buckets object", async () => {
    const { status, body } = await get(`/api/me/today?today=${TODAY}`);
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual([
      "overdue",
      "due_today",
      "needs_you",
      "need_review",
      "in_progress",
      "due_this_week",
      "counts",
    ]);
    expect(body.counts).toMatchObject({ overdue: 1, due_today: 2, due_this_week: 1, total: 4 });
    expect(body.overdue[0]).toMatchObject({ id: "i-overdue", workspaceName: "Alpha" });
  });
});
