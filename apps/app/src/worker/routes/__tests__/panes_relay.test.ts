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
});
