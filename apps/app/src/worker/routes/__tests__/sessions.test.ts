/**
 * Per-device sessions: every sign-in mints its own user_sessions row, signing
 * out ends only that device, legacy users.token sessions keep working, and the
 * 24h window slides per session row. Real SQLite (test/sqliteD1.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DbClient } from "../../db/index";
import * as schema from "../../db/schema";
import type { Env } from "../../lib/env";
import { sha256Hex } from "../../lib/identify";
import { SESSION_TTL_SECONDS } from "../../lib/session";
import { errorMiddleware } from "../../middleware/error";
import { authRoutes } from "../auth";
import * as authService from "../../services/auth";
import * as sessionsRepo from "../../repositories/sessions";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";

describe.skipIf(!sqliteSupported)("per-device sessions", () => {
  let t: TestDb;
  let db: DbClient;
  let env: Env;
  let waitUntil: Promise<unknown>[];

  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/auth", authRoutes);

  const call = (path: string, init: RequestInit = {}) => {
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void waitUntil.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return app.request(path, init, env, ctx);
  };
  const me = (token: string) => call("/auth/me", { headers: { authorization: `Bearer ${token}` } });
  const signIn = async (email: string, password: string, userAgent?: string) => {
    const res = await call("/auth/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(userAgent ? { "user-agent": userAgent } : {}),
      },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { session_token: string }).session_token;
  };
  const signOut = (token: string) =>
    call("/auth/sign-out", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const sessionRow = async (token: string) =>
    (
      await db
        .select()
        .from(schema.userSessions)
        .where(eq(schema.userSessions.tokenHash, await sha256Hex(token)))
    )[0];

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;
    waitUntil = [];
    await authService.register(db, {
      email: "dev@example.com",
      username: "dev",
      password: "correct-horse",
    });
  });

  it("two sign-ins yield two different tokens that both authenticate", async () => {
    const web = await signIn("dev@example.com", "correct-horse", "Mozilla/5.0");
    const phone = await signIn("dev@example.com", "correct-horse", "Atur/1.0 iOS");
    expect(web).not.toBe(phone);
    expect((await me(web)).status).toBe(200);
    expect((await me(phone)).status).toBe(200);
    expect(await db.select().from(schema.userSessions)).toHaveLength(3); // register + 2 sign-ins
  });

  it("stores only the token hash, never the raw token or users.token", async () => {
    const token = await signIn("dev@example.com", "correct-horse", "x".repeat(500));
    const row = await sessionRow(token);
    expect(row?.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(await db.select().from(schema.userSessions))).not.toContain(token);
    expect(row?.userAgent).toHaveLength(200);
    const [user] = await db.select().from(schema.users);
    expect(user?.token).toBeNull();
  });

  it("signing out with one token leaves the other valid", async () => {
    const a = await signIn("dev@example.com", "correct-horse");
    const b = await signIn("dev@example.com", "correct-horse");
    expect((await signOut(a)).status).toBe(200);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(200);
  });

  it("a legacy users.token with a future expiry still authenticates, and signs out the old way", async () => {
    await db
      .update(schema.users)
      .set({
        token: "legacy-token",
        sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .where(eq(schema.users.username, "dev"));
    const fresh = await signIn("dev@example.com", "correct-horse");
    // The new sign-in must not touch the legacy device.
    expect((await me("legacy-token")).status).toBe(200);
    expect((await me(fresh)).status).toBe(200);

    expect((await signOut("legacy-token")).status).toBe(200);
    expect((await me("legacy-token")).status).toBe(401);
    expect((await me(fresh)).status).toBe(200);
  });

  it("an expired legacy users.token is rejected", async () => {
    await db
      .update(schema.users)
      .set({ token: "legacy-old", sessionExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.users.username, "dev"));
    expect((await me("legacy-old")).status).toBe(401);
  });

  it("an expired session row is rejected", async () => {
    const token = await signIn("dev@example.com", "correct-horse");
    await db
      .update(schema.userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.userSessions.tokenHash, await sha256Hex(token)));
    expect((await me(token)).status).toBe(401);
  });

  it("slides expires_at only once less than half the TTL remains", async () => {
    const token = await signIn("dev@example.com", "correct-horse");
    const hash = await sha256Hex(token);
    const setExpiry = (ms: number) =>
      db
        .update(schema.userSessions)
        .set({ expiresAt: new Date(Date.now() + ms).toISOString(), lastUsedAt: null })
        .where(eq(schema.userSessions.tokenHash, hash));

    // Front half of the window (> 12h left): no write, no cookie refresh.
    const frontHalf = (SESSION_TTL_SECONDS / 2 + 3600) * 1000;
    await setExpiry(frontHalf);
    const before = (await sessionRow(token))!;
    const res1 = await me(token);
    await Promise.all(waitUntil);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("Set-Cookie")).toBeNull();
    const untouched = (await sessionRow(token))!;
    expect(untouched.expiresAt).toBe(before.expiresAt);
    expect(untouched.lastUsedAt).toBeNull();

    // Back half (< 12h left): extended to a full TTL and last_used_at stamped.
    await setExpiry(3600 * 1000);
    const res2 = await me(token);
    await Promise.all(waitUntil);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("Set-Cookie")).toContain("plane-session=");
    const renewed = (await sessionRow(token))!;
    const remaining = Date.parse(renewed.expiresAt) - Date.now();
    expect(remaining).toBeGreaterThan((SESSION_TTL_SECONDS - 60) * 1000);
    expect(renewed.lastUsedAt).not.toBeNull();
  });

  it("the session cookie authenticates like the bearer token", async () => {
    const token = await signIn("dev@example.com", "correct-horse");
    const res = await call("/auth/me", { headers: { cookie: `plane-session=${token}` } });
    expect(res.status).toBe(200);
  });

  it("deleteByToken removes only the matching row", async () => {
    const [user] = await db.select().from(schema.users);
    const a = await sessionsRepo.createSession(db, user!.id);
    const b = await sessionsRepo.createSession(db, user!.id);
    expect(await sessionsRepo.deleteByToken(db, a)).toBe(true);
    expect(await sessionsRepo.deleteByToken(db, a)).toBe(false);
    expect(await sessionsRepo.findByToken(db, b)).not.toBeNull();
  });
});
