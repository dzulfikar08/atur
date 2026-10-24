import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { bridgeEventRoutes } from "../bridgeEvents";
import { agentPushMessage, type AgentEvent } from "../../services/agentPush";

const TOKEN = "bridge-secret";
const GOOD = "ExponentPushToken[good]";
const DEAD = "ExponentPushToken[dead]";
const OTHER = "ExponentPushToken[other-ws]";

describe("agentPushMessage", () => {
  const base: AgentEvent = { pane_id: "wR:p2", status: "done" };

  it("prefers the event title and falls back to agent in folder, then agent, then Agent", () => {
    expect(
      agentPushMessage({ ...base, title: "PANE: x", agent: "omp", cwd: "/a/b" }, "acme").title,
    ).toBe("PANE: x");
    expect(agentPushMessage({ ...base, agent: "omp", cwd: "/srv/atur/" }, "acme").title).toBe(
      "omp in atur",
    );
    expect(agentPushMessage({ ...base, agent: "omp", cwd: null }, "acme").title).toBe("omp");
    expect(agentPushMessage(base, "acme").title).toBe("Agent");
  });

  it("builds body text per status with and without detail, always suffixed by the slug", () => {
    expect(agentPushMessage({ ...base, detail: "Shipped it" }, "acme").body).toBe(
      "Done: Shipped it · acme",
    );
    expect(agentPushMessage(base, "acme").body).toBe("Finished · acme");
    expect(agentPushMessage({ ...base, status: "blocked", detail: "Which db?" }, "acme").body).toBe(
      "Needs you: Which db? · acme",
    );
    expect(agentPushMessage({ ...base, status: "blocked" }, "acme").body).toBe("Needs you · acme");
  });

  it("carries the deep-link data and the agents channel", () => {
    expect(agentPushMessage({ ...base, status: "blocked" }, "acme")).toMatchObject({
      sound: "default",
      priority: "high",
      channelId: "agents",
      data: { type: "agent", pane_id: "wR:p2", status: "blocked" },
    });
  });
});

describe.skipIf(!sqliteSupported)("POST /api/bridge/agent-events", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let expoCalls: { to: string }[][];
  let expoTickets: (to: string) => unknown;

  const post = (
    body: unknown,
    headers: Record<string, string> = { "x-bridge-token": TOKEN },
    env?: object,
  ) =>
    app.request(
      "/api/bridge/agent-events",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      { DB: t.d1, HERDR_BRIDGE_TOKEN: TOKEN, ...env } as never,
    );

  const remainingTokens = async () =>
    (await t.db.select({ token: schema.pushTokens.token }).from(schema.pushTokens))
      .map((r) => r.token)
      .sort();

  beforeEach(async () => {
    t = await createTestDb();
    const { db } = t;
    await db.insert(schema.users).values([
      { id: "owner", email: "o@example.com", username: "owner" },
      { id: "member", email: "m@example.com", username: "member" },
      { id: "stranger", email: "s@example.com", username: "stranger" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: "w-acme", name: "Acme", slug: "acme", ownerId: "owner" },
      { id: "w-other", name: "Other", slug: "other", ownerId: "stranger" },
    ]);
    await db
      .insert(schema.workspaceMembers)
      .values({ id: "m1", workspaceId: "w-acme", memberId: "member", role: 15, isActive: 1 });
    await db.insert(schema.workspaceLinks).values({
      id: "l1",
      workspaceSlug: "acme",
      localPath: "/srv/acme",
    });
    const now = "2026-01-01T00:00:00Z";
    await db.insert(schema.pushTokens).values([
      { id: "t1", userId: "owner", token: GOOD, platform: "ios", createdAt: now, updatedAt: now },
      {
        id: "t2",
        userId: "member",
        token: DEAD,
        platform: "android",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "t3",
        userId: "stranger",
        token: OTHER,
        platform: "ios",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expoCalls = [];
    expoTickets = (to) =>
      to === DEAD
        ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: "x" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const msgs = JSON.parse(String(init?.body)) as { to: string }[];
        expoCalls.push(msgs);
        return Response.json({ data: msgs.map((m) => expoTickets(m.to)) });
      }),
    );

    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.route("/api/bridge", bridgeEventRoutes);
  });

  afterEach(() => vi.unstubAllGlobals());

  const event = { pane_id: "wR:p2", status: "done", agent: "omp", cwd: "/srv/acme/sub" };

  it("answers 503 when the Worker has no bridge token", async () => {
    const res = await post(event, {}, { HERDR_BRIDGE_TOKEN: undefined });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "bridge events not configured" });
  });

  it("rejects a missing or wrong token with 401 and sends nothing", async () => {
    expect((await post(event, {})).status).toBe(401);
    expect((await post(event, { "x-bridge-token": "nope" })).status).toBe(401);
    expect(expoCalls).toHaveLength(0);
  });

  it("rejects an invalid status or empty pane id with 400", async () => {
    expect((await post({ ...event, status: "idle" })).status).toBe(400);
    expect((await post({ ...event, pane_id: "" })).status).toBe(400);
  });

  it("reports sent 0 for an unbound pane without calling Expo", async () => {
    const res = await post({ ...event, cwd: "/tmp/elsewhere" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0 });
    expect(expoCalls).toHaveLength(0);
  });

  it("pushes a done event to the workspace members only, and prunes dead tokens", async () => {
    const res = await post({ ...event, title: "PANE: ship it", detail: "All green" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1 });

    expect(expoCalls).toHaveLength(1);
    expect(expoCalls[0]!.map((m) => m.to).sort()).toEqual([DEAD, GOOD].sort());
    expect(expoCalls[0]![0]).toMatchObject({
      title: "PANE: ship it",
      body: "Done: All green · acme",
      channelId: "agents",
      data: { type: "agent", pane_id: "wR:p2", status: "done" },
    });
    expect(await remainingTokens()).toEqual([GOOD, OTHER].sort());
  });

  it("pushes a blocked event with the needs-you body", async () => {
    await post({ ...event, status: "blocked", detail: "Which database?" });
    expect(expoCalls[0]![0]).toMatchObject({
      title: "omp in sub",
      body: "Needs you: Which database? · acme",
      data: { status: "blocked" },
    });
  });

  it("answers 502 when Expo is unreachable and keeps every token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const res = await post(event);
    expect(res.status).toBe(502);
    expect(await remainingTokens()).toEqual([DEAD, GOOD, OTHER].sort());
  });
});
