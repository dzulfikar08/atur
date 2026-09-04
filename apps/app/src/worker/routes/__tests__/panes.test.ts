/**
 * Pane observation routes (DEV-32): per-pane workspace authorization.
 *
 * The bridge (execution plane) is stubbed at `fetch` level; the DB is a
 * table-keyed stub resolving the drizzle builder chains the route uses.
 * WebSocket upgrade itself needs workerd, so the member case asserts the
 * forwarded upgrade request (headers incl. the bridge token) and surfaces
 * the bridge's non-101 reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import type { AuthUser } from "../../lib/token";
import { errorMiddleware } from "../../middleware/error";
import * as schema from "../../db/schema";

vi.mock("../../middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (k: "user", v: AuthUser) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { sub: "user-1", email: "member@example.com" });
    await next();
  },
  optionalAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../../repositories/members", () => ({
  isWorkspaceMember: vi.fn(),
}));

vi.mock("../../db/index", () => ({
  getDb: vi.fn(() => mockDb),
}));
import { paneRoutes } from "../../routes/panes";
import { authMiddleware } from "../../middleware/auth";
import { isWorkspaceMember } from "../../repositories/members";

const isMember = vi.mocked(isWorkspaceMember);

// Table-keyed DB stub: the route issues exactly three shapes of query —
// select-from-workspaceLinks (await), select-from-workspaces where/limit
// ([row]), insert into paneAudit (values).
const links = [{ workspaceSlug: "acme", localPath: "/srv/acme" }];
const workspaceRows = [{ id: "ws-uuid-1" }];

function rowsFor(table: unknown): unknown[] {
  if (table === schema.workspaceLinks) return links;
  if (table === schema.workspaces) return workspaceRows;
  return [];
}

function chain(table: unknown) {
  const rows = rowsFor(table);
  const q = {
    where: () => q,
    limit: () => Promise.resolve(rows),
    then: (
      resolve: (v: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return q;
}

const mockDb = {
  select: () => ({
    from: (table: unknown) => chain(table),
  }),
  insert: () => ({
    values: () => Promise.resolve(undefined),
  }),
};

const env = { DB: {}, HERDR_BRIDGE_URL: "http://127.0.0.1:7601" } as unknown as Env;

// Bridge state, reconfigured per test.
let bridgePanes: { pane_id: string; cwd: string | null }[] = [];
let bridgeRepoPath: { status: number; body: unknown } | null = null;
let lastUpgradeHeaders: Headers | null = null;

function stubFetch(input: string | URL | Request, init?: RequestInit): Response {
  const url = String(input);
  if (url.endsWith("/panes")) {
    return Response.json({ panes: bridgePanes });
  }
  if (url.includes("/pane-repo")) {
    if (!bridgeRepoPath) return Response.json({ error: "no repo" }, { status: 404 });
    return Response.json(bridgeRepoPath.body, { status: bridgeRepoPath.status });
  }
  if (url.includes("/attach")) {
    // The route calls fetch(url, init) — capture the forwarded init headers.
    lastUpgradeHeaders = new Headers(init?.headers);
    return Response.json({ error: "bridge refused" }, { status: 404 });
  }
  return new Response("not found", { status: 404 });
}

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.use("*", authMiddleware); // mocked above → sets user-1
  app.route("/api/panes", paneRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastUpgradeHeaders = null;
  bridgeRepoPath = null;
  isMember.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn(stubFetch));
});

describe("pane routes (DEV-32 per-pane authz)", () => {
  it("GET / lists only panes bound to workspaces the viewer is a member of", async () => {
    bridgePanes = [
      { pane_id: "p1", cwd: "/srv/acme/main" },
      { pane_id: "p2", cwd: "/tmp" }, // unbound → hidden
    ];
    const res = await testApp().request("/api/panes", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ panes: [bridgePanes[0]] });
  });

  it("GET / hides panes of workspaces the viewer does not belong to", async () => {
    bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme/main" }];
    isMember.mockResolvedValue(false);
    const res = await testApp().request("/api/panes", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ panes: [] });
  });

  it("attach without upgrade header is 426", async () => {
    bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
    const res = await testApp().request("/api/panes/attach?pane=p1", undefined, env);
    expect(res.status).toBe(426);
  });

  it("attach to an unbound pane is 403 (deny by default)", async () => {
    bridgePanes = [{ pane_id: "p9", cwd: "/tmp" }];
    const res = await testApp().request(
      "/api/panes/attach?pane=p9",
      { headers: { upgrade: "websocket" } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/not bound/);
  });

  it("attach resolves crew worktrees to the main repo binding via the bridge", async () => {
    bridgePanes = [{ pane_id: "p3", cwd: "/home/x/.local/state/spawn-loop/worktrees/acme-7" }];
    bridgeRepoPath = { status: 200, body: { path: "/srv/acme" } };
    const res = await testApp().request(
      "/api/panes/attach?pane=p3",
      { headers: { upgrade: "websocket" } },
      env,
    );
    // Authz passed; the bridge refused the (stubbed) upgrade and that reply
    // surfaces verbatim.
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "bridge refused" });
  });

  it("attach by a non-member is 403 before any upgrade", async () => {
    bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
    isMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/panes/attach?pane=p1",
      { headers: { upgrade: "websocket" } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/not a member/);
  });

  it("member attach forwards the upgrade with the bridge token header", async () => {
    bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
    const secureEnv = {
      ...env,
      HERDR_BRIDGE_TOKEN: "sekrit",
    } as unknown as Env;
    const res = await testApp().request(
      "/api/panes/attach?pane=p1",
      { headers: { upgrade: "websocket" } },
      secureEnv,
    );
    expect(res.status).toBe(404); // stubbed bridge refusal surfaced
    expect(lastUpgradeHeaders?.get("upgrade")).toBe("websocket");
    expect(lastUpgradeHeaders?.get("x-bridge-token")).toBe("sekrit");
  });
});
