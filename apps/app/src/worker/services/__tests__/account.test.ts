import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DbClient } from "../../db/index";
import * as schema from "../../db/schema";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { resolveRequestUser } from "../../middleware/auth";
import { userRoutes } from "../../routes/users";
import { siwaEnv } from "../../test/appleKeys";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import * as authService from "../auth";
import * as sessionsRepo from "../../repositories/sessions";
import { deleteAccount, deletedEmail, pickSuccessor } from "../account";
import { signInWithApple } from "../appleAuth";
import { signInWithGoogle } from "../googleAuth";
import { HTTPException } from "hono/http-exception";

describe("pickSuccessor", () => {
  const c = (memberId: string, role: number, joinedAt: string | null) => ({
    memberId,
    role,
    joinedAt,
  });

  it("prefers the earliest-joined admin over an earlier-joined member", () => {
    const picked = pickSuccessor([
      c("m1", 15, "2026-01-01"),
      c("a2", 20, "2026-03-01"),
      c("a1", 20, "2026-02-01"),
    ]);
    expect(picked?.memberId).toBe("a1");
  });

  it("falls back to the earliest-joined member when there is no admin", () => {
    const picked = pickSuccessor([
      c("m2", 15, "2026-02-01"),
      c("g1", 5, "2026-03-01"),
      c("m1", 15, "2026-01-01"),
    ]);
    expect(picked?.memberId).toBe("m1");
  });

  it("returns null when nobody is left", () => {
    expect(pickSuccessor([])).toBeNull();
  });
});

// Real SQLite (see test/sqliteD1.ts). Skipped where node:sqlite is missing.
describe.skipIf(!sqliteSupported)("deleteAccount", () => {
  let t: TestDb;
  let db: DbClient;

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function addUser(
    id: string,
    email = `${id}@example.com`,
    extra: Partial<typeof schema.users.$inferInsert> = {},
  ) {
    await db.insert(schema.users).values({
      id,
      email,
      username: id,
      displayName: `Name of ${id}`,
      avatar: `https://img.example.com/${id}.png`,
      passwordHash: "hash",
      token: `session-${id}`,
      sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      isEmailVerified: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    });
  }

  async function addWorkspace(id: string, ownerId: string) {
    await db.insert(schema.workspaces).values({ id, name: id, slug: id, ownerId });
  }

  async function join(
    workspaceId: string,
    memberId: string,
    role: number,
    joinedAt: string,
    isActive = 1,
  ) {
    await db.insert(schema.workspaceMembers).values({
      id: `${workspaceId}-${memberId}`,
      workspaceId,
      memberId,
      role,
      isActive,
      createdAt: joinedAt,
    });
  }

  const workspace = async (id: string) =>
    (await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)))[0]!;
  const membership = async (workspaceId: string, memberId: string) =>
    (
      await db
        .select()
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, workspaceId),
            eq(schema.workspaceMembers.memberId, memberId),
          ),
        )
    )[0]!;
  const user = async (id: string) =>
    (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!;

  it("scrubs PII and revokes sessions, API keys and linked identities", async () => {
    await addUser("u1", "Real.Person@Example.com");
    await db.insert(schema.apiKeys).values({ id: "k1", keyHash: "abc", userId: "u1", isActive: 1 });
    await db.insert(schema.accounts).values({
      id: "acc1",
      provider: "google",
      providerAccountId: "g-sub",
      userId: "u1",
      accessToken: "secret",
    });
    await db.insert(schema.profiles).values({ id: "p1", userId: "u1", role: "founder" });
    await db.insert(schema.notes).values({ id: "n1", userId: "u1", content: "private" });
    await addWorkspace("w-hidden", "u1");
    await db.insert(schema.userHiddenWorkspaces).values({ userId: "u1", workspaceId: "w-hidden" });
    await db
      .insert(schema.notificationPreferences)
      .values({ id: "np1", userId: "u1", notificationType: "comment" });
    await db
      .insert(schema.integrationTokens)
      .values({ id: "it1", service: "github", userId: "u1", accessToken: "gh" });

    await deleteAccount(db, "u1");

    const row = await user("u1");
    expect(row.email).toBe(deletedEmail("u1"));
    expect(row.email).not.toContain("example.com");
    expect(row.username).toMatch(/^deleted-/);
    expect(row.displayName).toBe("Deleted user");
    expect(row.avatar).toBeNull();
    expect(row.passwordHash).toBeNull();
    expect(row.token).toBeNull();
    expect(row.sessionExpiresAt).toBeNull();
    expect(row.isActive).toBe(0);
    expect(row.deletedAt).toBeTruthy();

    const [key] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, "k1"));
    expect(key?.isActive).toBe(0);
    expect(key?.deletedAt).toBeTruthy();

    for (const table of [
      schema.accounts,
      schema.profiles,
      schema.notes,
      schema.notificationPreferences,
      schema.integrationTokens,
      schema.userHiddenWorkspaces,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });

  it("removes every per-device session row of the user, and only theirs", async () => {
    await addUser("u1");
    await addUser("u2");
    const t1 = await sessionsRepo.createSession(db, "u1", "iPhone");
    const t2 = await sessionsRepo.createSession(db, "u1", "Android");
    const t3 = await sessionsRepo.createSession(db, "u2", "Web");
    expect(await resolveRequestUser(db, t1)).not.toBeNull();

    await deleteAccount(db, "u1");

    const rows = await db.select().from(schema.userSessions);
    expect(rows.map((r) => r.userId)).toEqual(["u2"]);
    expect(await resolveRequestUser(db, t1)).toBeNull();
    expect(await resolveRequestUser(db, t2)).toBeNull();
    expect(await resolveRequestUser(db, t3)).not.toBeNull();
  });

  it("no longer authenticates by session, API key, password, or provider identity", async () => {
    const registered = await authService.register(db, {
      email: "gone@example.com",
      username: "gone",
      password: "correct-horse",
    });
    // A pk_live_ key as the middleware stores it: sha256 hex of the raw key.
    const rawKey = "pk_live_test-key";
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey)),
    );
    await db.insert(schema.apiKeys).values({
      id: "k1",
      keyHash: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
      userId: registered.user.id,
      isActive: 1,
    });
    expect(await resolveRequestUser(db, registered.token)).not.toBeNull();
    expect(await resolveRequestUser(db, rawKey)).not.toBeNull();

    await deleteAccount(db, registered.user.id);

    expect(await resolveRequestUser(db, registered.token)).toBeNull();
    expect(await resolveRequestUser(db, rawKey)).toBeNull();
    await expect(
      authService.login(db, { email: "gone@example.com", password: "correct-horse" }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authService.login(db, { email: deletedEmail(registered.user.id), password: "correct-horse" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("frees the email so the person can sign up again as a new user", async () => {
    const first = await authService.register(db, {
      email: "again@example.com",
      username: "again",
      password: "password-1",
    });
    await deleteAccount(db, first.user.id);

    const second = await authService.register(db, {
      email: "again@example.com",
      username: "again",
      password: "password-2",
    });
    expect(second.user.id).not.toBe(first.user.id);
    expect(await resolveRequestUser(db, second.token)).not.toBeNull();
  });

  it("does not resurrect a deleted account through a Google or Apple identity", async () => {
    await addUser("u1", "social@example.com");
    await db.insert(schema.accounts).values([
      { id: "ga", provider: "google", providerAccountId: "g-sub", userId: "u1" },
      { id: "aa", provider: "apple", providerAccountId: "a-sub", userId: "u1" },
    ]);
    await deleteAccount(db, "u1");

    const google = await signInWithGoogle(db, {
      sub: "g-sub",
      email: "social@example.com",
      emailVerified: true,
      name: "Social",
      picture: null,
      accessToken: "at",
      idToken: null,
    });
    const apple = await signInWithApple(db, {
      sub: "a-sub",
      email: "social@example.com",
      emailVerified: true,
      isPrivateEmail: false,
    });
    expect(google.user.id).not.toBe("u1");
    expect(apple.user.id).not.toBe("u1");
    expect((await user("u1")).deletedAt).toBeTruthy();
  });

  it("transfers an owned workspace to the earliest-joined admin and leaves the rest alone", async () => {
    await addUser("owner");
    await addUser("early-member");
    await addUser("late-admin");
    await addUser("early-admin");
    await addWorkspace("w1", "owner");
    await join("w1", "owner", 20, "2026-01-01");
    await join("w1", "early-member", 15, "2026-01-02");
    await join("w1", "late-admin", 20, "2026-03-01");
    await join("w1", "early-admin", 20, "2026-02-01");

    await deleteAccount(db, "owner");

    const w = await workspace("w1");
    expect(w.ownerId).toBe("early-admin");
    expect(w.deletedAt).toBeNull();
    expect((await membership("w1", "owner")).deletedAt).toBeTruthy();
    expect((await membership("w1", "early-member")).deletedAt).toBeNull();
  });

  it("promotes the earliest-joined member to admin when no admin remains", async () => {
    await addUser("owner");
    await addUser("m1");
    await addUser("m2");
    await addWorkspace("w1", "owner");
    await join("w1", "owner", 20, "2026-01-01");
    await join("w1", "m2", 15, "2026-03-01");
    await join("w1", "m1", 15, "2026-02-01");

    await deleteAccount(db, "owner");

    expect((await workspace("w1")).ownerId).toBe("m1");
    expect((await membership("w1", "m1")).role).toBe(20);
    expect((await membership("w1", "m2")).role).toBe(15);
  });

  it("skips suspended members and deleted users when choosing a successor", async () => {
    await addUser("owner");
    await addUser("suspended");
    await addUser("ghost");
    await addUser("ok");
    await addWorkspace("w1", "owner");
    await join("w1", "owner", 20, "2026-01-01");
    await join("w1", "suspended", 20, "2026-01-02", 0);
    await join("w1", "ghost", 20, "2026-01-03");
    await join("w1", "ok", 15, "2026-01-04");
    await deleteAccount(db, "ghost");

    await deleteAccount(db, "owner");

    expect((await workspace("w1")).ownerId).toBe("ok");
  });

  it("soft-deletes a workspace when the owner was its only member", async () => {
    await addUser("solo");
    await addWorkspace("w1", "solo");
    await join("w1", "solo", 20, "2026-01-01");

    await deleteAccount(db, "solo");

    expect((await workspace("w1")).deletedAt).toBeTruthy();
  });

  it("removes only the user's own membership from workspaces they do not own", async () => {
    await addUser("boss");
    await addUser("leaver");
    await addUser("peer");
    await addWorkspace("w1", "boss");
    await join("w1", "boss", 20, "2026-01-01");
    await join("w1", "leaver", 15, "2026-01-02");
    await join("w1", "peer", 15, "2026-01-03");

    await deleteAccount(db, "leaver");

    const w = await workspace("w1");
    expect(w.ownerId).toBe("boss");
    expect(w.deletedAt).toBeNull();
    const leaver = await membership("w1", "leaver");
    expect(leaver.deletedAt).toBeTruthy();
    expect(leaver.isActive).toBe(0);
    expect((await membership("w1", "peer")).deletedAt).toBeNull();
    expect((await user("peer")).deletedAt).toBeNull();
  });

  it("is rejected for an account that is already deleted", async () => {
    await addUser("u1");
    await deleteAccount(db, "u1");
    await expect(deleteAccount(db, "u1")).rejects.toBeInstanceOf(HTTPException);
    await expect(deleteAccount(db, "nobody")).rejects.toMatchObject({ status: 404 });
  });

  describe("Apple grant revocation", () => {
    beforeEach(async () => {
      await addUser("u1");
      await db.insert(schema.accounts).values({
        id: "aa",
        provider: "apple",
        providerAccountId: "a-sub",
        userId: "u1",
        refreshToken: "apple-refresh",
      });
    });

    it("revokes the stored refresh token at Apple when the key is configured", async () => {
      const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await deleteAccount(db, "u1", await siwaEnv());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://appleid.apple.com/auth/revoke");
      const form = new URLSearchParams(String(init.body));
      expect(form.get("token")).toBe("apple-refresh");
      expect(form.get("client_id")).toBe("com.diatur.app");
      expect((await user("u1")).deletedAt).toBeTruthy();
    });

    it("still deletes the account when Apple's revoke call fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status: 500 })),
      );
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      await deleteAccount(db, "u1", await siwaEnv());

      expect((await user("u1")).deletedAt).toBeTruthy();
      expect(await db.select().from(schema.accounts)).toHaveLength(0);
      err.mockRestore();
    });

    it("does not call Apple when the key is not configured", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await deleteAccount(db, "u1", {});
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/users/me", () => {
    function app() {
      const a = new Hono<{ Bindings: Env }>();
      a.use("*", errorMiddleware);
      a.route("/api/users", userRoutes);
      return a;
    }
    const call = (headers: Record<string, string>, body?: unknown) =>
      app().request(
        "/api/users/me",
        {
          method: "DELETE",
          headers: { "content-type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        { DB: t.d1 } as unknown as Env,
      );

    it("requires the typed confirmation", async () => {
      await addUser("u1");
      expect((await call({ authorization: "Bearer session-u1" })).status).toBe(400);
      expect((await call({ authorization: "Bearer session-u1" }, { confirm: "nope" })).status).toBe(
        400,
      );
      expect((await user("u1")).deletedAt).toBeNull();
    });

    it("requires authentication", async () => {
      expect((await call({}, { confirm: "DELETE" })).status).toBe(401);
    });

    it("refuses API-key callers", async () => {
      await addUser("u1");
      const rawKey = "pk_live_abc";
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey)),
      );
      await db.insert(schema.apiKeys).values({
        id: "k1",
        keyHash: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
        userId: "u1",
        isActive: 1,
      });
      const res = await call({ "x-api-key": rawKey }, { confirm: "DELETE" });
      expect(res.status).toBe(403);
      expect((await user("u1")).deletedAt).toBeNull();
    });

    it("deletes the account, clears the cookie, and the session stops working", async () => {
      await addUser("u1");
      const res = await call({ authorization: "Bearer session-u1" }, { confirm: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get("set-cookie")).toContain("plane-session=;");

      const after = await app().request(
        "/api/users/me",
        { headers: { authorization: "Bearer session-u1" } },
        { DB: t.d1 } as unknown as Env,
      );
      expect(after.status).toBe(401);
    });
  });
});
