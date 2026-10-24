/**
 * Pane routes for customer-run bridges (relay): `<machineId>~<paneId>` ids are
 * authorised by machine ownership and routed through the caller's BridgeRelay
 * DO; legacy ids keep the env-configured bridge path (covered by panes.test.ts).
 *
 * The DO is a fake (test/fakeRelay.ts): the 101 upgrade itself needs workerd,
 * so these assert what the route sends the DO and how it audits and refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import * as machines from "../../services/bridgeMachines";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { fakeRelay, type FakeRelay } from "../../test/fakeRelay";
import { paneRoutes } from "../panes";

const WS = { Upgrade: "websocket" };

describe.skipIf(!sqliteSupported)("relay pane routes", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let relay: FakeRelay;
  let env: Partial<Env>;
  let mine: machines.BridgeMachine;
  let theirs: machines.BridgeMachine;

  const call = (path: string, init: RequestInit = {}) => app.request(path, init, env as never);
  const audit = () => t.db.select().from(schema.paneAudit);

  beforeEach(async () => {
    t = await createTestDb();
    relay = fakeRelay();
    env = { DB: t.d1, BRIDGE_RELAY: relay.namespace };
    await t.db.insert(schema.users).values([
      { id: "me", email: "me@example.com", username: "me" },
      { id: "them", email: "them@example.com", username: "them" },
    ]);
    ({ machine: mine } = await machines.createMachine(t.db, "me", "Laptop"));
    ({ machine: theirs } = await machines.createMachine(t.db, "them", "Their box"));
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: "me", email: "me@example.com" } as never);
      await next();
    });
    app.route("/api/panes", paneRoutes);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("GET /", () => {
    const list = (panes: unknown[]) => JSON.stringify({ panes });

    it("lists panes of the caller's machines with namespaced ids and the machine", async () => {
      relay.panes = [
        {
          machineId: mine.id,
          body: list([
            { pane_id: "w1:p1", cwd: "/a" },
            { pane_id: "w1:p1", cwd: "/a" },
          ]),
        },
      ];
      const res = await call("/api/panes");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        panes: [
          {
            pane_id: `${mine.id}~w1:p1`,
            cwd: "/a",
            machine: { id: mine.id, name: "Laptop" },
          },
        ],
      });
      expect(relay.names).toEqual(["user:me"]);
    });

    it("skips a machine that failed, one that is revoked, and ones that are not the caller's", async () => {
      const { machine: second } = await machines.createMachine(t.db, "me", "Desktop");
      const { machine: gone } = await machines.createMachine(t.db, "me", "Gone");
      await machines.revoke(t.db, "me", gone.id);
      relay.panes = [
        { machineId: mine.id, body: null },
        { machineId: second.id, body: list([{ pane_id: "p9" }]) },
        { machineId: gone.id, body: list([{ pane_id: "p1" }]) },
        { machineId: theirs.id, body: list([{ pane_id: "p2" }]) },
        { machineId: second.id, body: "not json" },
      ];
      const res = await call("/api/panes");
      expect(res.status).toBe(200);
      const { panes } = (await res.json()) as { panes: { pane_id: string }[] };
      expect(panes.map((p) => p.pane_id)).toEqual([`${second.id}~p9`]);
    });

    it("is an empty list, not an error, when the caller's machines are offline", async () => {
      const res = await call("/api/panes");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ panes: [] });
    });

    it("keeps 502 for a caller with neither a reachable bridge nor machines", async () => {
      await machines.revoke(t.db, "me", mine.id);
      const res = await call("/api/panes");
      expect(res.status).toBe(502);
      expect(relay.names).toEqual([]);
    });

    it("appends relay panes to the legacy bridge's, and survives a down legacy bridge", async () => {
      env = { ...env, HERDR_BRIDGE_URL: "http://127.0.0.1:7601" };
      relay.panes = [{ machineId: mine.id, body: list([{ pane_id: "p1" }]) }];

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ panes: [{ pane_id: "legacy", cwd: "/nowhere" }] })),
      );
      let res = await call("/api/panes");
      // The legacy pane is unbound (no workspace link) so it is filtered as before.
      expect(
        ((await res.json()) as { panes: { pane_id: string }[] }).panes.map((p) => p.pane_id),
      ).toEqual([`${mine.id}~p1`]);

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("tunnel down");
        }),
      );
      res = await call("/api/panes");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { panes: unknown[] }).panes).toHaveLength(1);
    });
  });

  describe("attach / observe", () => {
    it("403s another user's machine and an unknown machine, before touching the relay", async () => {
      for (const path of [
        `/api/panes/attach?pane=${encodeURIComponent(`${theirs.id}~p1`)}`,
        `/api/panes/observe?pane=${encodeURIComponent(`${theirs.id}~p1`)}`,
        `/api/panes/attach?pane=${encodeURIComponent("mzzzzz~p1")}`,
      ]) {
        const res = await call(path, { headers: WS });
        expect(res.status).toBe(403);
      }
      expect(relay.fetched).toHaveLength(0);
      expect(await audit()).toHaveLength(0);
    });

    it("403s a revoked machine", async () => {
      await machines.revoke(t.db, "me", mine.id);
      const res = await call(`/api/panes/attach?pane=${encodeURIComponent(`${mine.id}~p1`)}`, {
        headers: WS,
      });
      expect(res.status).toBe(403);
    });

    it("426s a non-websocket request before any lookup", async () => {
      const res = await call(`/api/panes/attach?pane=${mine.id}~p1`);
      expect(res.status).toBe(426);
    });

    it("forwards attach to the relay with the machine-local pane id and an audit row", async () => {
      const res = await call(`/api/panes/attach?pane=${encodeURIComponent(`${mine.id}~w1:p2`)}`, {
        headers: WS,
      });
      // The fake relay answers "machine offline" instead of a 101.
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "machine offline" });

      const [forwarded] = relay.fetched;
      const url = new URL(forwarded!.url);
      expect(url.pathname).toBe("/client");
      expect(url.searchParams.get("machine")).toBe(mine.id);
      expect(url.searchParams.get("path")).toBe("/attach?pane=w1%3Ap2");
      expect(forwarded!.headers.get("upgrade")).toBe("websocket");

      // The audit row carries the client-facing id and is closed because no stream opened.
      const [row] = await audit();
      expect(row).toMatchObject({ userId: "me", paneId: `${mine.id}~w1:p2` });
      expect(url.searchParams.get("audit")).toBe(row!.id);
      expect(row!.detachedAt).not.toBeNull();
    });

    it("observe uses the observe stream and writes no audit row", async () => {
      const res = await call(`/api/panes/observe?pane=${encodeURIComponent(`${mine.id}~p1`)}`, {
        headers: WS,
      });
      expect(res.status).toBe(502);
      const url = new URL(relay.fetched[0]!.url);
      expect(url.searchParams.get("path")).toBe("/observe?pane=p1");
      expect(url.searchParams.has("audit")).toBe(false);
      expect(await audit()).toHaveLength(0);
    });

    it("502s when the relay itself throws, and still closes the audit row", async () => {
      relay.stubOverride = {
        fetch: async () => {
          throw new Error("relay down");
        },
      };
      const res = await call(`/api/panes/attach?pane=${mine.id}~p1`, { headers: WS });
      expect(res.status).toBe(502);
      const [row] = await t.db
        .select()
        .from(schema.paneAudit)
        .where(eq(schema.paneAudit.userId, "me"));
      expect(row!.detachedAt).not.toBeNull();
    });

    it("leaves legacy pane ids on the legacy path: no relay call, workspace authz", async () => {
      const res = await call("/api/panes/attach?pane=w1:p2", { headers: WS });
      // No env bridge configured: the pane is unbound, so the legacy 403 applies.
      expect(res.status).toBe(403);
      expect(relay.fetched).toHaveLength(0);
      expect(relay.names).toEqual([]);
    });
  });

  describe("paste", () => {
    const paste = (pane: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
      call(`/api/panes/paste?pane=${encodeURIComponent(pane)}`, { method: "POST", body, headers });

    it("relays the image with the machine-local pane id and passes the reply through", async () => {
      relay.respond = () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ path: "/home/x/paste-1.png", bytes: 3 })),
      });
      const res = await paste(`${mine.id}~w1:p2`, new Uint8Array([1, 2, 3]));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: "/home/x/paste-1.png", bytes: 3 });

      const [{ machineId, req }] = relay.requests as [(typeof relay.requests)[number]];
      expect(machineId).toBe(mine.id);
      expect(req).toMatchObject({
        method: "POST",
        path: "/panes/paste?pane=w1%3Ap2",
        headers: { "content-type": "application/octet-stream" },
      });
      expect(Array.from(req.body!)).toEqual([1, 2, 3]);
    });

    it("passes a machine's error status through (offline, timeout)", async () => {
      relay.respond = () => ({
        status: 504,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode('{"error":"machine did not answer in time"}'),
      });
      const res = await paste(`${mine.id}~p1`, new Uint8Array([1]));
      expect(res.status).toBe(504);
    });

    it("403s another user's machine and never relays", async () => {
      const res = await paste(`${theirs.id}~p1`, new Uint8Array([1]));
      expect(res.status).toBe(403);
      expect(relay.requests).toHaveLength(0);
    });

    it("400s an empty body and 413s an oversized one (relay limit is 10 MiB)", async () => {
      expect((await paste(`${mine.id}~p1`, new Uint8Array(0))).status).toBe(400);
      const big = await paste(`${mine.id}~p1`, new Uint8Array([1]), {
        "content-length": String(11 * 1024 * 1024),
      });
      expect(big.status).toBe(413);
      expect(relay.requests).toHaveLength(0);
    });

    it("502s when the relay throws", async () => {
      relay.stubOverride = {
        request: async () => {
          throw new Error("relay down");
        },
      };
      const res = await paste(`${mine.id}~p1`, new Uint8Array([1]));
      expect(res.status).toBe(502);
    });
  });

  describe("split / close / new workspace", () => {
    const json = (status: number, body: unknown) => ({
      status,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    const post = (path: string, body: unknown) =>
      call(`/api/panes${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const sent = (i = 0) => {
      const { machineId, req } = relay.requests[i]!;
      return { machineId, ...req, body: JSON.parse(new TextDecoder().decode(req.body)) as unknown };
    };

    it("splits through the owner's relay with the machine-local id and namespaces the new pane", async () => {
      relay.respond = () =>
        json(201, { pane: { pane_id: "w1:p3", workspace_id: "w1", cwd: "/a" } });
      const res = await post("/split", { pane: `${mine.id}~w1:p2`, direction: "down" });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        pane: {
          pane_id: `${mine.id}~w1:p3`,
          workspace_id: "w1",
          cwd: "/a",
          machine: { id: mine.id, name: "Laptop" },
        },
      });
      expect(sent()).toEqual({
        machineId: mine.id,
        method: "POST",
        path: "/panes/split",
        headers: { "content-type": "application/json" },
        body: { pane: "w1:p2", direction: "down" },
      });
      expect(relay.names).toEqual(["user:me"]);
      expect(await audit()).toMatchObject([
        { userId: "me", paneId: `pane.split:${mine.id}~w1:p2` },
      ]);
    });

    it("closes through the relay: 204 passes through with an empty body", async () => {
      relay.respond = () => ({ status: 204, headers: {}, body: new Uint8Array(0) });
      const res = await post("/close", { pane: `${mine.id}~w1:p2` });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(sent()).toMatchObject({
        machineId: mine.id,
        path: "/panes/close",
        body: { pane: "w1:p2" },
      });
      expect(await audit()).toMatchObject([
        { userId: "me", paneId: `pane.close:${mine.id}~w1:p2` },
      ]);
    });

    it("403s another user's, an unknown and a revoked machine before relaying or auditing", async () => {
      const { machine: gone } = await machines.createMachine(t.db, "me", "Gone");
      await machines.revoke(t.db, "me", gone.id);
      for (const id of [theirs.id, "mzzzzz", gone.id]) {
        expect((await post("/close", { pane: `${id}~p1` })).status).toBe(403);
        expect((await post("/split", { pane: `${id}~p1`, direction: "right" })).status).toBe(403);
        expect((await post("/workspaces", { cwd: "/home/x", machine_id: id })).status).toBe(403);
      }
      expect(relay.requests).toHaveLength(0);
      expect(await audit()).toHaveLength(0);
    });

    it("passes machine errors through, flags an old bridge, and 502s when the relay throws", async () => {
      relay.respond = () => json(404, { error: "pane not found" });
      let res = await post("/close", { pane: `${mine.id}~p1` });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "pane not found" });

      relay.respond = () => json(502, { error: "machine offline" });
      res = await post("/split", { pane: `${mine.id}~p1`, direction: "right" });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "machine offline" });

      relay.respond = () => json(404, { error: "not found" });
      res = await post("/close", { pane: `${mine.id}~p1` });
      expect(res.status).toBe(501);
      expect(((await res.json()) as { error: string }).error).toMatch(/update atur-bridge/);

      relay.stubOverride = {
        request: async () => {
          throw new Error("relay down");
        },
      };
      expect((await post("/close", { pane: `${mine.id}~p1` })).status).toBe(502);
    });

    it("keeps legacy pane ids off the relay", async () => {
      expect((await post("/close", { pane: "w1:p2" })).status).toBe(403);
      expect((await post("/split", { pane: "w1:p2", direction: "right" })).status).toBe(403);
      expect(relay.requests).toHaveLength(0);
      expect(relay.names).toEqual([]);
    });

    it("opens a workspace on the caller's machine at any absolute path, with a normalised cwd", async () => {
      relay.respond = () =>
        json(201, {
          workspace: { id: "w2", label: "scratch", cwd: "/home/me/scratch", pane_count: 1 },
          pane: { pane_id: "w2:p1", workspace_id: "w2", cwd: "/home/me/scratch" },
        });
      const res = await post("/workspaces", {
        cwd: "/home/me/other/../scratch/",
        label: "scratch",
        machine_id: mine.id,
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        workspace: {
          id: "w2",
          label: "scratch",
          cwd: "/home/me/scratch",
          pane_count: 1,
          machine: { id: mine.id, name: "Laptop" },
        },
        pane: {
          pane_id: `${mine.id}~w2:p1`,
          workspace_id: "w2",
          cwd: "/home/me/scratch",
          machine: { id: mine.id, name: "Laptop" },
        },
      });
      expect(sent()).toMatchObject({
        machineId: mine.id,
        path: "/workspaces",
        body: { cwd: "/home/me/scratch", label: "scratch" },
      });
      expect(await audit()).toMatchObject([
        { userId: "me", paneId: `workspace.create:${mine.id}:/home/me/scratch` },
      ]);
    });

    it("without machine_id a workspace targets the legacy bridge, which needs a bound repo", async () => {
      const res = await post("/workspaces", { cwd: "/home/me/scratch" });
      expect(res.status).toBe(403);
      expect(relay.requests).toHaveLength(0);
    });

    it("GET /workspaces groups each machine's panes on their own and lists the caller's machines", async () => {
      const { machine: second } = await machines.createMachine(t.db, "me", "Desktop");
      const panes = (rows: unknown[]) => JSON.stringify({ panes: rows });
      relay.panes = [
        {
          machineId: mine.id,
          body: panes([
            { pane_id: "a", workspace_id: "w1", workspace_label: "alpha", cwd: "/a" },
            { pane_id: "b", workspace_id: "w1", workspace_label: "alpha", cwd: "/a/b" },
          ]),
        },
        {
          machineId: second.id,
          body: panes([{ pane_id: "a", workspace_id: "w1", workspace_label: "other", cwd: "/z" }]),
        },
        { machineId: theirs.id, body: panes([{ pane_id: "x", workspace_id: "w9" }]) },
      ];
      const res = await call("/api/panes/workspaces");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        workspaces: { id: string; label: string; pane_count: number; machine: { id: string } }[];
        machines: { id: string; name: string }[];
        roots: unknown[];
      };
      expect(
        body.workspaces.map((w) => [w.machine.id, w.id, w.label, w.pane_count]).sort(),
      ).toEqual(
        [
          [mine.id, "w1", "alpha", 2],
          [second.id, "w1", "other", 1],
        ].sort(),
      );
      expect(body.machines.map((m) => m.name).sort()).toEqual(["Desktop", "Laptop"]);
      expect(body.roots).toEqual([]);
    });
  });
});
