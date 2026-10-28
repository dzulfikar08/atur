/**
 * Screen (desktop sharing) routes: superuser-only gate and bridge forwarding.
 *
 * The bridge is stubbed at `fetch` level. WebSocket upgrade itself needs
 * workerd, so the superuser case asserts the forwarded upgrade request
 * (headers incl. the bridge token) and surfaces the bridge's non-101 reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import type { AuthUser } from "../../lib/token";
import { errorMiddleware } from "../../middleware/error";

vi.mock("../../middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (k: "user", v: AuthUser) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { sub: "user-1", email: "op@example.com" });
    await next();
  },
  optionalAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// requireSuperuser reads users.is_superuser through select().from().where().get().
const superuserRow = vi.fn();
const auditInsert = vi.fn().mockResolvedValue(undefined);
vi.mock("../../db/index", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: superuserRow }) }) }),
    insert: () => ({ values: auditInsert }),
  }),
}));

import { screenRoutes } from "../screen";
import { authMiddleware } from "../../middleware/auth";

const env = {
  DB: {},
  HERDR_BRIDGE_URL: "http://127.0.0.1:7601",
  HERDR_BRIDGE_TOKEN: "bridge-secret",
} as unknown as Env;
let directUrl: string | null = null;

let upgradeHeaders: Headers | null = null;
const fetchStub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/screen/status")) {
    return Promise.resolve(
      Response.json({ available: true, running: false, viewers: 0, direct: directUrl }),
    );
  }
  if (url.endsWith("/screen")) {
    upgradeHeaders = new Headers(init?.headers);
    return Promise.resolve(Response.json({ error: "bridge refused" }, { status: 404 }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
});

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.use("*", authMiddleware);
  app.route("/api/screen", screenRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  upgradeHeaders = null;
  directUrl = null;
  superuserRow.mockResolvedValue({ isSuperuser: 1 });
  vi.stubGlobal("fetch", fetchStub);
});

describe("screen routes", () => {
  it("403s a non-superuser on every route without touching the bridge", async () => {
    superuserRow.mockResolvedValue({ isSuperuser: 0 });
    const app = testApp();
    expect((await app.request("/api/screen/status", undefined, env)).status).toBe(403);
    const ws = await app.request("/api/screen/ws", { headers: { upgrade: "websocket" } }, env);
    expect(ws.status).toBe(403);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("403s when the user row is missing", async () => {
    superuserRow.mockResolvedValue(undefined);
    const res = await testApp().request("/api/screen/status", undefined, env);
    expect(res.status).toBe(403);
  });

  it("proxies the bridge status for a superuser", async () => {
    const res = await testApp().request("/api/screen/status", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: true,
      running: false,
      viewers: 0,
      direct: null,
    });
  });

  it("502s status when the bridge is not configured", async () => {
    const res = await testApp().request("/api/screen/status", undefined, {
      DB: {},
    } as unknown as Env);
    expect(res.status).toBe(502);
  });

  it("ws without an upgrade header is 426", async () => {
    const res = await testApp().request("/api/screen/ws", undefined, env);
    expect(res.status).toBe(426);
  });

  it("ws forwards the upgrade with the bridge token header", async () => {
    const secureEnv = { ...env, HERDR_BRIDGE_TOKEN: "sekrit" } as unknown as Env;
    const res = await testApp().request(
      "/api/screen/ws",
      { headers: { upgrade: "websocket" } },
      secureEnv,
    );
    expect(res.status).toBe(404); // stubbed bridge refusal surfaced
    expect(upgradeHeaders?.get("upgrade")).toBe("websocket");
    expect(upgradeHeaders?.get("x-bridge-token")).toBe("sekrit");
  });

  describe("POST /clipboard", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const post = (body: BodyInit, e: Env = env) =>
      testApp().request(
        "/api/screen/clipboard",
        { method: "POST", headers: { "content-type": "image/png" }, body },
        e,
      );

    it("forwards the image bytes to the bridge with its token", async () => {
      let forwarded: { body: Uint8Array; token: string | null } | null = null;
      fetchStub.mockImplementationOnce(async (_input, init) => {
        forwarded = {
          body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
          token: new Headers(init?.headers).get("x-bridge-token"),
        };
        return Response.json({ ok: true });
      });
      const res = await post(png, { ...env, HERDR_BRIDGE_TOKEN: "sekrit" } as Env);
      expect(res.status).toBe(200);
      expect(forwarded).toEqual({ body: png, token: "sekrit" });
    });

    it("refuses oversized and empty bodies before calling the bridge", async () => {
      expect((await post(new Uint8Array(20 * 1024 * 1024 + 1))).status).toBe(413);
      expect((await post(new Uint8Array(0))).status).toBe(400);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it("is superuser-only", async () => {
      superuserRow.mockResolvedValue({ isSuperuser: 0 });
      expect((await post(png)).status).toBe(403);
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });

  describe("POST /direct", () => {
    it("403s a non-superuser before minting anything", async () => {
      superuserRow.mockResolvedValue({ isSuperuser: 0 });
      directUrl = "wss://box.example.ts.net:7602/screen";
      const res = await testApp().request("/api/screen/direct", { method: "POST" }, env);
      expect(res.status).toBe(403);
      expect(auditInsert).not.toHaveBeenCalled();
    });

    it("404s when the bridge advertises no direct listener", async () => {
      const res = await testApp().request("/api/screen/direct", { method: "POST" }, env);
      expect(res.status).toBe(404);
      expect(auditInsert).not.toHaveBeenCalled();
    });

    it("mints a screen ticket bound to the caller and writes the audit row", async () => {
      directUrl = "wss://box.example.ts.net:7602/screen";
      const res = await testApp().request("/api/screen/direct", { method: "POST" }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; ticket: string; expires_at: number };
      expect(body.url).toBe(directUrl);
      expect(body.expires_at).toBeGreaterThan(Date.now());
      const [payload] = body.ticket.split(".");
      const claims = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
      const audit = auditInsert.mock.calls[0]![0] as { id: string; userId: string; paneId: string };
      expect(claims).toMatchObject({ v: 1, aud: "screen", sub: "user-1", audit: audit.id });
      expect(audit).toMatchObject({ userId: "user-1", paneId: "screen:desktop" });
      expect(JSON.stringify(body)).not.toContain("bridge-secret");
    });
  });
});
