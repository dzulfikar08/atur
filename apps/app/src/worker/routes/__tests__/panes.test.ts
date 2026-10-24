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
  findMembership: vi.fn(),
}));

vi.mock("../../db/index", () => ({
  getDb: vi.fn(() => mockDb),
}));
import { paneRoutes } from "../../routes/panes";
import { authMiddleware } from "../../middleware/auth";
import {
  isWorkspaceMember,
  findMembership as membersFindMembership,
} from "../../repositories/members";

const isMember = vi.mocked(isWorkspaceMember);
const findMembership = vi.mocked(membersFindMembership);

// Table-keyed DB stub: the route issues exactly three shapes of query —
// select-from-workspaceLinks (await), select-from-workspaces where/limit
// ([row]), insert into paneAudit (values).
const links = [{ workspaceSlug: "acme", localPath: "/srv/acme" }];
const workspaceRows: { id: string; name: string; ownerId: string }[] = [
  { id: "ws-uuid-1", name: "Acme", ownerId: "someone-else" },
];

function rowsFor(table: unknown): unknown[] {
  if (table === schema.workspaceLinks) return links;
  if (table === schema.workspaces) return workspaceRows;
  return [];
}

function chain(table: unknown) {
  const rows = rowsFor(table);
  const q = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    where: () => q,
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return q;
}

const mockDb = {
  select: () => ({
    from: (table: unknown) => chain(table),
  }),
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      auditRows.push(row);
      return Promise.resolve(undefined);
    },
  }),
};

const env = { DB: {}, HERDR_BRIDGE_URL: "http://127.0.0.1:7601" } as unknown as Env;

// Bridge state, reconfigured per test.
let bridgePanes: {
  pane_id: string;
  cwd: string | null;
  workspace_id?: string;
  workspace_label?: string;
}[] = [];
let bridgeRepoPath: { status: number; body: unknown } | null = null;
let lastUpgradeHeaders: Headers | null = null;
let lastPaste: { url: string; body: Uint8Array } | null = null;
// Management calls the Worker made to the bridge, and what the bridge answers.
let bridgeCalls: { url: string; body: unknown; headers: Headers }[] = [];
let bridgeManage: () => Response = () => new Response(null, { status: 500 });
let auditRows: Record<string, unknown>[] = [];

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
  if (url.includes("/panes/paste")) {
    lastPaste = { url, body: init?.body as Uint8Array };
    return Response.json({ path: "/home/x/.cache/atur/pastes/paste-1.png", bytes: 3 });
  }
  if (/\/(panes\/split|panes\/close|workspaces)$/.test(url)) {
    bridgeCalls.push({
      url,
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    });
    return bridgeManage();
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
  lastPaste = null;
  bridgeRepoPath = null;
  bridgeCalls = [];
  auditRows = [];
  bridgeManage = () =>
    Response.json({ pane: { pane_id: "p2", cwd: "/srv/acme" } }, { status: 201 });
  workspaceRows[0] = { id: "ws-uuid-1", name: "Acme", ownerId: "someone-else" };
  isMember.mockResolvedValue(true);
  findMembership.mockResolvedValue({ id: "m1", role: 20, isActive: 1 });
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
    // The visible row carries the Atur workspace its folder is bound to.
    expect(await res.json()).toEqual({ panes: [{ ...bridgePanes[0], workspace_slug: "acme" }] });
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

  describe("POST /paste", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const post = (pane: string, body: BodyInit = png) =>
      testApp().request(`/api/panes/paste?pane=${pane}`, { method: "POST", body }, env);

    it("saves a member's image on the execution plane and returns its path", async () => {
      bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
      const res = await post("p1");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        path: "/home/x/.cache/atur/pastes/paste-1.png",
        bytes: 3,
      });
      expect(lastPaste?.url).toBe("http://127.0.0.1:7601/panes/paste?pane=p1");
      expect(new Uint8Array(lastPaste!.body)).toEqual(png);
    });

    it("refuses non-members and unbound panes before touching the bridge", async () => {
      bridgePanes = [{ pane_id: "p9", cwd: "/tmp" }];
      expect((await post("p9")).status).toBe(403);
      bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
      isMember.mockResolvedValue(false);
      expect((await post("p1")).status).toBe(403);
      expect(lastPaste).toBeNull();
    });

    it("refuses empty and oversized bodies", async () => {
      bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
      expect((await post("p1", new Uint8Array(0))).status).toBe(400);
      expect((await post("p1", new Uint8Array(20 * 1024 * 1024 + 1))).status).toBe(413);
      expect(lastPaste).toBeNull();
    });
  });

  describe("pane management (legacy bridge)", () => {
    const post = (path: string, body: unknown, e: Env = env) =>
      testApp().request(
        `/api/panes${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        },
        e,
      );
    const bridgeUrls = () => bridgeCalls.map((call) => call.url);

    beforeEach(() => {
      bridgePanes = [{ pane_id: "p1", cwd: "/srv/acme" }];
    });

    describe("POST /split", () => {
      it("forwards a member's split with the bridge token and answers the new pane", async () => {
        const res = await post("/split", { pane: "p1", direction: "right" }, {
          ...env,
          HERDR_BRIDGE_TOKEN: "sekrit",
        } as unknown as Env);
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ pane: { pane_id: "p2", cwd: "/srv/acme" } });
        expect(bridgeCalls).toHaveLength(1);
        expect(bridgeCalls[0]).toMatchObject({
          url: "http://127.0.0.1:7601/panes/split",
          body: { pane: "p1", direction: "right" },
        });
        expect(bridgeCalls[0]!.headers.get("x-bridge-token")).toBe("sekrit");
        expect(bridgeCalls[0]!.headers.get("content-type")).toBe("application/json");
        expect(auditRows).toMatchObject([{ userId: "user-1", paneId: "pane.split:p1" }]);
      });

      it("refuses non-members and unbound panes before touching the bridge", async () => {
        isMember.mockResolvedValue(false);
        expect((await post("/split", { pane: "p1", direction: "down" })).status).toBe(403);
        isMember.mockResolvedValue(true);
        bridgePanes = [{ pane_id: "p9", cwd: "/tmp" }];
        expect((await post("/split", { pane: "p9", direction: "down" })).status).toBe(403);
        bridgePanes = [];
        expect((await post("/split", { pane: "ghost", direction: "down" })).status).toBe(403);
        expect(bridgeCalls).toEqual([]);
        expect(auditRows).toEqual([]);
      });

      it("validates the body", async () => {
        for (const body of [
          { direction: "right" },
          { pane: "p1" },
          { pane: "p1", direction: "left" },
          { pane: 7, direction: "right" },
          "not json",
          "[]",
        ]) {
          expect((await post("/split", body)).status).toBe(400);
        }
        expect(bridgeCalls).toEqual([]);
      });
    });

    describe("POST /close", () => {
      it("closes a member's pane: bridge 204 becomes an empty 204, and it is audited", async () => {
        bridgeManage = () => new Response(null, { status: 204 });
        const res = await post("/close", { pane: "p1" });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe("");
        expect(bridgeCalls[0]).toMatchObject({
          url: "http://127.0.0.1:7601/panes/close",
          body: { pane: "p1" },
        });
        expect(auditRows).toMatchObject([{ userId: "user-1", paneId: "pane.close:p1" }]);
      });

      it("refuses non-members and unbound panes", async () => {
        isMember.mockResolvedValue(false);
        expect((await post("/close", { pane: "p1" })).status).toBe(403);
        isMember.mockResolvedValue(true);
        bridgePanes = [{ pane_id: "p9", cwd: "/tmp" }];
        expect((await post("/close", { pane: "p9" })).status).toBe(403);
        expect((await post("/close", {})).status).toBe(400);
        expect(bridgeCalls).toEqual([]);
      });

      it("passes the bridge's 404 through, tells an old bridge to update, and 502s when down", async () => {
        bridgeManage = () => Response.json({ error: "pane not found" }, { status: 404 });
        let res = await post("/close", { pane: "p1" });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "pane not found" });

        bridgeManage = () => Response.json({ error: "not found" }, { status: 404 });
        res = await post("/close", { pane: "p1" });
        expect(res.status).toBe(501);
        expect(((await res.json()) as { error: string }).error).toMatch(/update atur-bridge/);

        bridgeManage = () => {
          throw new Error("tunnel down");
        };
        expect((await post("/close", { pane: "p1" })).status).toBe(502);
      });
    });

    describe("POST /workspaces", () => {
      const created = {
        workspace: { id: "w9", label: "app", cwd: "/srv/acme/app", pane_count: 1 },
        pane: { pane_id: "w9:p1", cwd: "/srv/acme/app" },
      };
      beforeEach(() => {
        bridgeManage = () => Response.json(created, { status: 201 });
      });

      it("lets the owner open a workspace inside a bound repo, with the cwd normalised", async () => {
        workspaceRows[0]!.ownerId = "user-1";
        findMembership.mockResolvedValue(undefined as never); // the owner needs no membership row
        const res = await post("/workspaces", { cwd: "/srv/acme/./x/../app/", label: "app" });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual(created);
        expect(bridgeCalls[0]).toMatchObject({
          url: "http://127.0.0.1:7601/workspaces",
          body: { cwd: "/srv/acme/app", label: "app" },
        });
        expect(auditRows).toMatchObject([
          { userId: "user-1", paneId: "workspace.create:bridge:/srv/acme/app" },
        ]);
      });

      it("lets an active admin member in, and omits an absent label", async () => {
        findMembership.mockResolvedValue({ id: "m1", role: 20, isActive: 1 });
        expect((await post("/workspaces", { cwd: "/srv/acme" })).status).toBe(201);
        expect(bridgeCalls[0]!.body).toEqual({ cwd: "/srv/acme" });
      });

      it("refuses plain members, suspended admins and non-members", async () => {
        // findMembership is typed as always finding a row; "not a member" is no row at all.
        const noMembership = undefined as never;
        for (const membership of [
          { id: "m1", role: 15, isActive: 1 },
          { id: "m1", role: 20, isActive: 0 },
          noMembership,
        ]) {
          findMembership.mockResolvedValue(membership);
          const res = await post("/workspaces", { cwd: "/srv/acme/app" });
          expect(res.status).toBe(403);
          expect(await res.text()).toMatch(/owner or an admin/);
        }
        expect(bridgeCalls).toEqual([]);
      });

      it("refuses paths outside every binding, including `..` escapes and sibling prefixes", async () => {
        workspaceRows[0]!.ownerId = "user-1";
        for (const cwd of ["/tmp", "/srv/acme/../etc", "/srv/acme-evil", "/", "/srv"]) {
          const res = await post("/workspaces", { cwd });
          expect(res.status).toBe(403);
          expect(await res.text()).toMatch(/not inside a repo bound/);
        }
        expect(bridgeCalls).toEqual([]);
        expect(auditRows).toEqual([]);
      });

      it("validates the body", async () => {
        workspaceRows[0]!.ownerId = "user-1";
        for (const body of [
          {},
          { cwd: "relative/path" },
          { cwd: "/srv/acme\n" },
          { cwd: "/srv/acme", label: "x".repeat(65) },
          { cwd: "/srv/acme", label: 4 },
          { cwd: "/srv/acme", machine_id: 4 },
        ]) {
          expect((await post("/workspaces", body)).status).toBe(400);
        }
        expect(bridgeCalls).toEqual([]);
      });

      it("passes a bridge validation error through", async () => {
        workspaceRows[0]!.ownerId = "user-1";
        bridgeManage = () =>
          Response.json({ error: "cwd is not an existing directory" }, { status: 400 });
        const res = await post("/workspaces", { cwd: "/srv/acme/gone" });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "cwd is not an existing directory" });
      });
    });

    describe("GET /workspaces", () => {
      it("groups visible panes into workspaces and offers the repo roots the caller administers", async () => {
        bridgePanes = [
          { pane_id: "a", cwd: "/srv/acme/one", workspace_id: "w1", workspace_label: "acme" },
          { pane_id: "b", cwd: "/srv/acme/two", workspace_id: "w1", workspace_label: "acme" },
          { pane_id: "c", cwd: "/srv/acme", workspace_id: "w2", workspace_label: "second" },
          { pane_id: "d", cwd: "/tmp", workspace_id: "w3", workspace_label: "hidden" },
        ];
        workspaceRows[0]!.ownerId = "user-1";
        const res = await testApp().request("/api/panes/workspaces", undefined, env);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          workspaces: [
            { id: "w1", label: "acme", cwd: "/srv/acme/one", pane_count: 2 },
            { id: "w2", label: "second", cwd: "/srv/acme", pane_count: 1 },
          ],
          machines: [],
          roots: [{ path: "/srv/acme", label: "Acme" }],
        });
        expect(bridgeUrls()).toEqual([]); // grouped from /panes, no management call
      });

      it("offers no roots to a plain member", async () => {
        findMembership.mockResolvedValue({ id: "m1", role: 15, isActive: 1 });
        const res = await testApp().request("/api/panes/workspaces", undefined, env);
        expect(((await res.json()) as { roots: unknown[] }).roots).toEqual([]);
      });
    });
  });
});
