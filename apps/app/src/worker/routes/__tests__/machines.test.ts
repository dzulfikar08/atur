import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { sha256Hex } from "../../lib/identify";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { fakeRelay, type FakeRelay } from "../../test/fakeRelay";
import { machineRoutes } from "../machines";

const now = "2026-10-01T00:00:00.000Z";

interface MachineJson {
  id: string;
  name: string;
  online: boolean;
  last_seen_at: string | null;
  hostname: string | null;
  backend: string | null;
  version: string | null;
}
interface CreateJson {
  token: string;
  machine: MachineJson;
}

describe.skipIf(!sqliteSupported)("/api/me/machines", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let relay: FakeRelay;
  let env: Partial<Env>;
  let caller = "buyer";

  const call = (method: string, path = "/api/me/machines", body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env as never,
    );
  const create = async (name = "Work laptop") => {
    const res = await call("POST", "/api/me/machines", { name });
    return { res, json: (await res.json()) as CreateJson };
  };
  const rows = () => t.db.select().from(schema.bridgeMachines);

  beforeEach(async () => {
    t = await createTestDb();
    relay = fakeRelay();
    // Billing is managed on this server: only subscribers are entitled.
    env = { DB: t.d1, ATUR_BILLING_WEBHOOK_SECRET: "whsec_x", BRIDGE_RELAY: relay.namespace };
    caller = "buyer";
    await t.db.insert(schema.users).values([
      { id: "buyer", email: "buyer@example.com", username: "buyer" },
      { id: "free", email: "free@example.com", username: "free" },
      { id: "other", email: "other@example.com", username: "other" },
    ]);
    await t.db.insert(schema.billingSubscriptions).values([
      {
        polarSubscriptionId: "sub_1",
        userId: "buyer",
        customerEmail: "buyer@example.com",
        plan: "solo",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        polarSubscriptionId: "sub_2",
        userId: "other",
        customerEmail: "other@example.com",
        plan: "solo",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: caller, email: `${caller}@example.com` } as never);
      await next();
    });
    app.route("/api/me/machines", machineRoutes);
  });

  describe("create", () => {
    it("returns the machine and a one-time atb_ token; only the hash is stored", async () => {
      const { res, json } = await create("  Work laptop  ");
      expect(res.status).toBe(201);
      expect(json.token).toMatch(/^atb_[0-9a-f]{64}$/);
      expect(json.machine).toMatchObject({
        name: "Work laptop",
        online: false,
        last_seen_at: null,
      });
      expect(json.machine.id).toMatch(/^m[a-z0-9]{5}$/);

      const [row] = await rows();
      expect(row).toMatchObject({ id: json.machine.id, userId: "buyer", revokedAt: null });
      expect(row!.tokenHash).toBe(await sha256Hex(json.token));
      expect(JSON.stringify(row)).not.toContain(json.token);
    });

    it("never shows the token again", async () => {
      const { json } = await create();
      const list = await call("GET");
      expect(JSON.stringify(await list.json())).not.toContain(json.token);
    });

    it("402s a user without an entitling plan and creates nothing", async () => {
      caller = "free";
      const { res, json } = await create();
      expect(res.status).toBe(402);
      expect(json).toEqual({ error: "plan_required" });
      expect(await rows()).toHaveLength(0);
    });

    it("is open to everyone when billing is not managed (self-host)", async () => {
      caller = "free";
      env = { DB: t.d1, BRIDGE_RELAY: relay.namespace };
      expect((await create()).res.status).toBe(201);
    });

    it("rejects missing, blank and over-long names with 400", async () => {
      expect((await call("POST", "/api/me/machines", {})).status).toBe(400);
      expect((await call("POST", "/api/me/machines", { name: "   " })).status).toBe(400);
      expect((await call("POST", "/api/me/machines", { name: "x".repeat(65) })).status).toBe(400);
      expect((await call("POST", "/api/me/machines")).status).toBe(400);
      expect(await rows()).toHaveLength(0);
    });

    it("mints a distinct token per machine", async () => {
      const a = await create("a");
      const b = await create("b");
      expect(a.json.token).not.toBe(b.json.token);
      expect(await rows()).toHaveLength(2);
    });
  });

  describe("list", () => {
    it("lists only the caller's live machines with online state from the relay", async () => {
      const a = await create("a");
      const b = await create("b");
      caller = "other";
      await create("theirs");
      caller = "buyer";
      relay.online[a.json.machine.id] = {
        hostname: "box",
        backend: "tmux",
        version: "0.3.0",
        connected_at: 1,
      };

      const res = await call("GET");
      expect(res.status).toBe(200);
      const { machines } = (await res.json()) as { machines: MachineJson[] };
      expect(machines.map((m) => m.name).sort()).toEqual(["a", "b"]);
      const byId = Object.fromEntries(machines.map((m) => [m.id, m]));
      expect(byId[a.json.machine.id]).toMatchObject({
        online: true,
        hostname: "box",
        backend: "tmux",
        version: "0.3.0",
      });
      expect(byId[b.json.machine.id]).toMatchObject({ online: false, hostname: null });
      expect(relay.names).toEqual(["user:buyer"]);
    });

    it("works for a lapsed subscriber (no plan gate on listing)", async () => {
      await create();
      await t.db.delete(schema.billingSubscriptions);
      const res = await call("GET");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { machines: unknown[] }).machines).toHaveLength(1);
    });

    it("still lists when the relay is unreachable, everything offline", async () => {
      await create();
      relay.stubOverride = {
        onlineMachines: async () => {
          throw new Error("relay down");
        },
      };
      const res = await call("GET");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { machines: MachineJson[] }).machines[0]?.online).toBe(false);
    });

    it("works without a relay binding", async () => {
      await create();
      env = { DB: t.d1, ATUR_BILLING_WEBHOOK_SECRET: "whsec_x" };
      const res = await call("GET");
      expect(((await res.json()) as { machines: MachineJson[] }).machines[0]?.online).toBe(false);
    });
  });

  describe("revoke", () => {
    it("revokes, drops the live socket, and hides the machine", async () => {
      const { json } = await create();
      const res = await call("DELETE", `/api/me/machines/${json.machine.id}`);
      expect(res.status).toBe(200);
      expect(relay.closed).toEqual([json.machine.id]);
      expect(relay.names).toEqual(["user:buyer"]);

      const [row] = await rows();
      expect(row!.revokedAt).not.toBeNull();
      const list = (await (await call("GET")).json()) as { machines: unknown[] };
      expect(list.machines).toEqual([]);
    });

    it("404s unknown, already-revoked and other users' machines without touching them", async () => {
      const { json } = await create();
      expect((await call("DELETE", "/api/me/machines/mnope1")).status).toBe(404);

      caller = "other";
      expect((await call("DELETE", `/api/me/machines/${json.machine.id}`)).status).toBe(404);
      expect(relay.closed).toEqual([]);
      caller = "buyer";
      const [untouched] = await rows();
      expect(untouched!.revokedAt).toBeNull();

      expect((await call("DELETE", `/api/me/machines/${json.machine.id}`)).status).toBe(200);
      expect((await call("DELETE", `/api/me/machines/${json.machine.id}`)).status).toBe(404);
    });

    it("lets a lapsed subscriber revoke", async () => {
      const { json } = await create();
      await t.db.delete(schema.billingSubscriptions);
      expect((await call("DELETE", `/api/me/machines/${json.machine.id}`)).status).toBe(200);
    });

    it("still revokes when the relay call fails", async () => {
      const { json } = await create();
      relay.stubOverride = {
        closeMachine: async () => {
          throw new Error("relay down");
        },
      };
      expect((await call("DELETE", `/api/me/machines/${json.machine.id}`)).status).toBe(200);
      const [row] = await t.db
        .select()
        .from(schema.bridgeMachines)
        .where(eq(schema.bridgeMachines.id, json.machine.id));
      expect(row!.revokedAt).not.toBeNull();
    });
  });
});
