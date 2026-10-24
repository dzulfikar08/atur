import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { newMachineToken } from "../../lib/relayProtocol";
import { RELAY_HEADER } from "../../lib/relayProtocol";
import { errorMiddleware } from "../../middleware/error";
import * as machines from "../../services/bridgeMachines";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { fakeRelay, type FakeRelay } from "../../test/fakeRelay";
import { bridgeConnectRoutes } from "../bridgeConnect";

const now = "2026-10-01T00:00:00.000Z";

describe.skipIf(!sqliteSupported)("GET /api/bridge/connect", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let relay: FakeRelay;
  let env: Partial<Env>;
  let machine: machines.BridgeMachine;
  let token: string;

  const connect = (headers: Record<string, string> = {}, upgrade = true) =>
    app.request(
      "/api/bridge/connect",
      {
        headers: {
          ...(upgrade ? { Upgrade: "websocket" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      env as never,
    );

  beforeEach(async () => {
    t = await createTestDb();
    relay = fakeRelay();
    env = { DB: t.d1, ATUR_BILLING_WEBHOOK_SECRET: "whsec_x", BRIDGE_RELAY: relay.namespace };
    await t.db.insert(schema.users).values([
      { id: "buyer", email: "buyer@example.com", username: "buyer" },
      { id: "free", email: "free@example.com", username: "free" },
    ]);
    await t.db.insert(schema.billingSubscriptions).values({
      polarSubscriptionId: "sub_1",
      userId: "buyer",
      customerEmail: "buyer@example.com",
      plan: "solo",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    ({ machine, token } = await machines.createMachine(t.db, "buyer", "Work laptop"));
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.route("/api/bridge", bridgeConnectRoutes);
  });

  it("401s a missing, malformed, unknown or non-machine token before looking at the upgrade", async () => {
    const saved = token;
    token = "";
    expect((await connect({}, false)).status).toBe(401);
    expect((await connect()).status).toBe(401);

    for (const bad of ["atb_short", newMachineToken(), "pk_live_abc", `atb_${"0".repeat(64)}`]) {
      token = bad;
      const res = await connect({}, false);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(relay.fetched).toHaveLength(0);
    token = saved;
  });

  it("401s a revoked machine", async () => {
    await machines.revoke(t.db, "buyer", machine.id);
    expect((await connect()).status).toBe(401);
    expect(relay.fetched).toHaveLength(0);
  });

  it("401s when the owner is deactivated or deleted", async () => {
    await t.db.update(schema.users).set({ isActive: 0 });
    expect((await connect()).status).toBe(401);
  });

  it("402s when the owner is not entitled, even without an upgrade", async () => {
    ({ machine, token } = await machines.createMachine(t.db, "free", "Free box"));
    const res = await connect({}, false);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "plan_required" });
    expect((await connect()).status).toBe(402);
    expect(relay.fetched).toHaveLength(0);
  });

  it("402s once the subscription lapses", async () => {
    await t.db.delete(schema.billingSubscriptions);
    expect((await connect()).status).toBe(402);
  });

  it("426s a valid token without a websocket upgrade", async () => {
    expect((await connect({}, false)).status).toBe(426);
    expect(relay.fetched).toHaveLength(0);
  });

  it("503s when the relay binding is missing", async () => {
    env = { DB: t.d1, ATUR_BILLING_WEBHOOK_SECRET: "whsec_x" };
    expect((await connect()).status).toBe(503);
  });

  it("forwards a valid upgrade to the owner's relay with the machine identity", async () => {
    relay.fetchResponse = () => new Response("relayed", { status: 200 });
    const res = await connect({ [RELAY_HEADER.userId]: "someone-else" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("relayed");

    expect(relay.names).toEqual(["user:buyer"]);
    const [forwarded] = relay.fetched;
    expect(new URL(forwarded!.url).pathname).toBe("/bridge");
    expect(forwarded!.headers.get("upgrade")).toBe("websocket");
    expect(forwarded!.headers.get(RELAY_HEADER.machineId)).toBe(machine.id);
    expect(forwarded!.headers.get(RELAY_HEADER.machineName)).toBe("Work laptop");
    // A caller-supplied identity header cannot override the authenticated one,
    // and the machine token never reaches the DO.
    expect(forwarded!.headers.get(RELAY_HEADER.userId)).toBe("buyer");
    expect(forwarded!.headers.get("authorization")).toBeNull();
  });

  it("entitles everyone when billing is not managed (self-host)", async () => {
    ({ machine, token } = await machines.createMachine(t.db, "free", "Free box"));
    env = { DB: t.d1, BRIDGE_RELAY: relay.namespace };
    relay.fetchResponse = () => new Response(null, { status: 200 });
    expect((await connect()).status).toBe(200);
    expect(relay.names).toEqual(["user:free"]);
  });
});
