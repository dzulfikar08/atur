import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import { requirePlanForNative } from "../../middleware/planGate";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { billingWebhookRoutes } from "../billing";
import { billingFor, subscriptionGrantsAccess } from "../../services/billing";

const SECRET = `whsec_${btoa("billing-secret")}`;

async function hmacBase64(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("billing-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

let seq = 0;
function subPayload(over: Record<string, unknown> = {}, type = "subscription.active") {
  const data = {
    id: "sub_1",
    status: "active",
    modified_at: "2026-10-01T00:00:00Z",
    current_period_end: "2099-01-01T00:00:00Z",
    cancel_at_period_end: false,
    metadata: {},
    customer: { id: "cus_1", email: "Buyer@Example.com", external_id: null },
    product: { id: "p1", metadata: { app: "atur", plan: "solo" } },
    ...over,
  };
  return { id: `evt_${seq++}`, type, data };
}

describe.skipIf(!sqliteSupported)("atur billing", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let env: Partial<Env>;

  const post = async (payload: unknown, signed = true) => {
    const body = JSON.stringify(payload);
    const id = `msg_${seq++}`;
    const ts = Math.floor(Date.now() / 1000);
    const sig = signed ? `v1,${await hmacBase64(`${id}.${ts}.${body}`)}` : "v1,deadbeef";
    return app.request(
      "/webhooks/atur-billing",
      {
        method: "POST",
        headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig },
        body,
      },
      env as never,
    );
  };
  const subs = () => t.db.select().from(schema.billingSubscriptions);
  const user = (id: string, email: string, isSuperuser = 0) => ({
    id,
    email,
    username: id,
    isSuperuser,
  });
  const billing = async (id: string) => {
    const rows = await t.db.select().from(schema.users);
    const row = rows.find((r) => r.id === id)!;
    return billingFor(t.db, env as Env, row);
  };

  beforeEach(async () => {
    t = await createTestDb();
    env = { DB: t.d1, ATUR_BILLING_WEBHOOK_SECRET: SECRET };
    await t.db
      .insert(schema.users)
      .values([
        user("u1", "buyer@example.com"),
        user("u2", "member@example.com"),
        user("admin", "admin@example.com", 1),
        user("u3", "stranger@example.com"),
      ]);
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.route("/webhooks/atur-billing", billingWebhookRoutes);
  });

  it("503 without a secret, 403 on a bad signature", async () => {
    expect((await post(subPayload(), false)).status).toBe(403);
    env = { DB: t.d1 };
    expect((await post(subPayload())).status).toBe(503);
  });

  it("ignores subscriptions of non-atur products with 202", async () => {
    const res = await post(subPayload({ product: { metadata: { app: "other", plan: "solo" } } }));
    expect(res.status).toBe(202);
    expect(await subs()).toHaveLength(0);
  });

  it("resolves the user by email case-insensitively and grants access", async () => {
    expect((await post(subPayload())).status).toBe(200);
    const [row] = await subs();
    expect(row).toMatchObject({ userId: "u1", plan: "solo", status: "active" });
    expect(await billing("u1")).toEqual({
      plan: "solo",
      status: "active",
      entitled: true,
      managed: true,
    });
    expect((await billing("u3")).entitled).toBe(false);
  });

  it("prefers reference_id over email", async () => {
    await post(subPayload({ metadata: { reference_id: "u3" } }));
    expect((await subs())[0]!.userId).toBe("u3");
  });

  it("falls back to customer.external_id", async () => {
    await post(subPayload({ customer: { email: "nobody@example.com", external_id: "u2" } }));
    expect((await subs())[0]!.userId).toBe("u2");
  });

  it("revoke removes access; replays are idempotent; stale events are dropped", async () => {
    await post(subPayload());
    await post(subPayload());
    expect(await subs()).toHaveLength(1);
    await post(
      subPayload(
        { status: "revoked", modified_at: "2026-10-02T00:00:00Z" },
        "subscription.revoked",
      ),
    );
    expect((await billing("u1")).entitled).toBe(false);
    // out-of-order: older "active" arrives late
    const res = await post(subPayload({ modified_at: "2026-10-01T12:00:00Z" }));
    expect((await res.json()) as unknown).toMatchObject({ result: "stale" });
    expect((await subs())[0]!.status).toBe("revoked");
  });

  it("keeps access for a canceled sub until period end", () => {
    const future = "2099-01-01T00:00:00Z";
    expect(
      subscriptionGrantsAccess({
        status: "canceled",
        cancelAtPeriodEnd: 1,
        currentPeriodEnd: future,
      }),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({
        status: "canceled",
        cancelAtPeriodEnd: 1,
        currentPeriodEnd: "2000-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      subscriptionGrantsAccess({
        status: "past_due",
        cancelAtPeriodEnd: 0,
        currentPeriodEnd: future,
      }),
    ).toBe(false);
  });

  it("team plan covers members of the owner's workspaces; solo does not", async () => {
    await t.db.insert(schema.workspaces).values({ id: "w1", name: "W", slug: "w", ownerId: "u1" });
    await t.db
      .insert(schema.workspaceMembers)
      .values({ id: "m1", workspaceId: "w1", memberId: "u2" });
    await post(subPayload());
    expect((await billing("u2")).entitled).toBe(false);
    await post(
      subPayload({
        modified_at: "2026-10-03T00:00:00Z",
        product: { metadata: { app: "atur", plan: "team" } },
      }),
    );
    expect((await billing("u2")).entitled).toBe(true);
    expect((await billing("u3")).entitled).toBe(false);
  });

  it("superusers are entitled; unmanaged servers entitle everyone", async () => {
    expect((await billing("admin")).entitled).toBe(true);
    env = { DB: t.d1 };
    expect(await billing("u3")).toEqual({
      plan: null,
      status: null,
      entitled: true,
      managed: false,
    });
  });

  describe("native gate", () => {
    let gated: Hono<{ Bindings: Env }>;
    beforeEach(() => {
      gated = new Hono<{ Bindings: Env }>();
      gated.use("*", async (c, next) => {
        c.set("user", { sub: c.req.header("x-test-user") ?? "u3", email: "x" } as never);
        await next();
      });
      gated.use("/api/*", requirePlanForNative);
      gated.all("/api/*", (c) => c.json({ ok: true }));
    });
    const call = (path: string, init: RequestInit = {}, user = "u3") =>
      gated.request(
        path,
        { ...init, headers: { "x-atur-client": "native", "x-test-user": user } },
        env as never,
      );

    it("402s unentitled native requests except the exempt ones", async () => {
      const res = await call("/api/workspaces");
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: "plan_required" });
      expect((await call("/api/users/me")).status).toBe(200);
      expect((await call("/api/me/push-tokens", { method: "DELETE" })).status).toBe(200);
      expect((await call("/api/me/push-tokens", { method: "PUT" })).status).toBe(402);
    });

    it("lets web clients and entitled users through", async () => {
      expect((await gated.request("/api/workspaces", {}, env as never)).status).toBe(200);
      await post(subPayload());
      expect((await call("/api/workspaces", {}, "u1")).status).toBe(200);
    });
  });
});
