import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import { snakeCaseMiddleware } from "../../middleware/snakecase";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { agentSessionRoutes, workspaceAgentSessionRoutes } from "../agentSessions";
import { bridgeEventRoutes } from "../bridgeEvents";

const NOW = "2026-10-30T00:00:00.000Z";
const I1 = "11111111-1111-4111-8111-111111111111";

describe.skipIf(!sqliteSupported)("agent session routes", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let caller = "u1";

  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(
      path,
      {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { DB: t.d1, HERDR_BRIDGE_TOKEN: "tok" } as never,
    );

  beforeEach(async () => {
    t = await createTestDb();
    caller = "u1";
    await t.db.insert(schema.users).values([
      { id: "u1", email: "u1@example.com", username: "u1" },
      { id: "u2", email: "u2@example.com", username: "u2" },
    ]);
    await t.db.insert(schema.workspaces).values([
      { id: "ws-a", name: "Acme", slug: "acme", ownerId: "u1" },
      { id: "ws-b", name: "Other", slug: "other", ownerId: "u2" },
    ]);
    await t.db
      .insert(schema.projects)
      .values({ id: "pr-a", name: "App", identifier: "APP", workspaceId: "ws-a" });
    await t.db.insert(schema.issues).values({
      id: I1,
      name: "Fix login",
      sequenceId: 7,
      projectId: "pr-a",
      workspaceId: "ws-a",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await t.db.insert(schema.bridgeMachines).values({
      id: "m1",
      userId: "u1",
      name: "Laptop",
      tokenHash: "h",
      createdAt: NOW,
    });
    app = new Hono<{ Bindings: Env }>();
    app.use("*", snakeCaseMiddleware);
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: caller, email: `${caller}@example.com` } as never);
      await next();
    });
    app.route("/api/agent-sessions", agentSessionRoutes);
    app.route("/api/workspaces/:slug/agent-sessions", workspaceAgentSessionRoutes);
    app.route("/api/bridge", bridgeEventRoutes);
  });

  const link = (body: object = {}) =>
    call("PUT", "/api/agent-sessions/link", {
      pane_id: "m1~p1",
      workspace: "acme",
      issue_id: "APP-7",
      session_id: "s1",
      ...body,
    });

  it("PUT /link then GET by pane returns snake_case sessions with the issue", async () => {
    const res = await link();
    expect(res.status).toBe(200);
    const get = await call("GET", "/api/agent-sessions?pane=m1~p1&pane=m1~nope");
    const body = (await get.json()) as { sessions: Record<string, any>[] };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      pane_id: "m1~p1",
      machine_id: "m1",
      local_pane_id: "p1",
      session_id: "s1",
      source: "manual",
      issue: { key: "APP-7", workspace_slug: "acme", state_key: null },
    });
  });

  it("rejects links to someone else's machine and foreign workspaces; validates the body", async () => {
    expect((await link({ pane_id: "m9~p1" })).status).toBe(403);
    caller = "u2";
    expect((await link()).status).toBe(403); // u2 is not a member of acme
    expect((await link({ workspace: "acme", pane_id: undefined })).status).toBe(400);
  });

  it("another user sees nothing of acme's sessions", async () => {
    await link();
    caller = "u2";
    const body = (await (await call("GET", "/api/agent-sessions")).json()) as {
      sessions: unknown[];
    };
    expect(body.sessions).toEqual([]);
    expect((await call("GET", "/api/workspaces/acme/agent-sessions")).status).toBe(403);
  });

  it("lists per workspace with state and active filters", async () => {
    await link();
    const all = (await (
      await call("GET", "/api/workspaces/acme/agent-sessions?active=1")
    ).json()) as {
      sessions: unknown[];
    };
    expect(all.sessions).toHaveLength(1);
    const blocked = (await (
      await call("GET", "/api/workspaces/acme/agent-sessions?state=blocked")
    ).json()) as { sessions: unknown[] };
    expect(blocked.sessions).toHaveLength(0);
  });

  it("DELETE /link unlinks; POST /end keeps the row but ends it", async () => {
    await link();
    expect(
      (await call("POST", "/api/agent-sessions/end", { pane_id: "m1~p1", session_id: "s1" }))
        .status,
    ).toBe(200);
    const active = (await (await call("GET", "/api/agent-sessions?active=1")).json()) as {
      sessions: unknown[];
    };
    expect(active.sessions).toEqual([]);
    expect((await call("DELETE", "/api/agent-sessions/link?pane=m1~p1")).status).toBe(204);
    const gone = (await (await call("GET", "/api/agent-sessions")).json()) as {
      sessions: unknown[];
    };
    expect(gone.sessions).toEqual([]);
  });

  it("settings: members read, admins write, defaults keep state changes off", async () => {
    const get = await call("GET", "/api/workspaces/acme/agent-sessions/settings");
    expect(await get.json()).toEqual({ on_blocked: "comment", on_done: "off" });
    const put = await call("PUT", "/api/workspaces/acme/agent-sessions/settings", {
      on_done: "suggest",
    });
    expect(await put.json()).toEqual({ on_blocked: "comment", on_done: "suggest" });
    expect(
      (await call("PUT", "/api/workspaces/acme/agent-sessions/settings", { on_done: "bogus" }))
        .status,
    ).toBe(400);
  });

  it("a legacy bridge agent event updates the linked session and comments on blocked", async () => {
    await link({ pane_id: "p-legacy" });
    const res = await call(
      "POST",
      "/api/bridge/agent-events",
      { pane_id: "p-legacy", status: "blocked", agent: "omp", detail: "Which db?" },
      { "x-bridge-token": "tok" },
    );
    expect(res.status).toBe(200);
    const [row] = (
      (await (await call("GET", "/api/agent-sessions?pane=p-legacy")).json()) as {
        sessions: { state: string }[];
      }
    ).sessions;
    expect(row!.state).toBe("blocked");
    const comments = await t.db.select().from(schema.issueComments);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.commentHtml).toContain("Which db?");
  });
});
