import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DbClient } from "../../db/index";
import * as schema from "../../db/schema";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { resolveRequestUser } from "../../middleware/auth";
import { authRoutes } from "../auth";
import {
  appleClaims,
  createAppleSigner,
  sha256Hex,
  siwaEnv,
  type AppleTestSigner,
} from "../../test/appleKeys";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";

const RAW_NONCE = "native-raw-nonce";
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

let signer: AppleTestSigner;
let hashedNonce: string;

beforeAll(async () => {
  signer = await createAppleSigner("route-kid");
  hashedNonce = await sha256Hex(RAW_NONCE);
});

const identityToken = (over: Record<string, unknown> = {}) =>
  signer.sign(appleClaims(hashedNonce, over));

const jwksResponse = () => Response.json({ keys: [signer.jwk] });

describe.skipIf(!sqliteSupported)("POST /auth/apple/native", () => {
  let t: TestDb;
  let db: DbClient;
  let env: Partial<Env>;

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse()),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function post(body: unknown, routes = authRoutes, bindings: Partial<Env> = env) {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.route("/auth", routes);
    return app.request(
      "/auth/apple/native",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      bindings as Env,
    );
  }

  const allUsers = () => db.select().from(schema.users);

  it("creates a user from a valid token and returns a working session", async () => {
    const res = await post({
      identity_token: await identityToken(),
      nonce: RAW_NONCE,
      full_name: { given: "Ada", family: "Lovelace" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_token: string;
      user: { id: string; email: string };
    };
    expect(body.user.email).toBe("apple.user@example.com");

    const [row] = await allUsers();
    expect(row?.displayName).toBe("Ada Lovelace");
    expect(row?.passwordHash).toBeNull();
    expect(row?.isEmailVerified).toBe(1);
    const links = await db.select().from(schema.accounts);
    expect(links).toMatchObject([{ provider: "apple", providerAccountId: "apple-sub-1" }]);
    expect((await resolveRequestUser(db, body.session_token))?.id).toBe(body.user.id);
  });

  it("signs the same Apple user back in (even without a name) instead of creating another", async () => {
    const first = (await (
      await post({ identity_token: await identityToken(), nonce: RAW_NONCE })
    ).json()) as { session_token: string; user: { id: string } };
    const second = (await (
      await post({ identity_token: await identityToken(), nonce: RAW_NONCE })
    ).json()) as { session_token: string; user: { id: string } };

    expect(second.user.id).toBe(first.user.id);
    expect(second.session_token).not.toBe(first.session_token);
    expect(await allUsers()).toHaveLength(1);
    // Per-device sessions: a second sign-in does not sign out the first device.
    expect((await resolveRequestUser(db, first.session_token))?.id).toBe(first.user.id);
    expect((await resolveRequestUser(db, second.session_token))?.id).toBe(first.user.id);
  });

  it("links to an existing account with the same verified email", async () => {
    await db.insert(schema.users).values({
      id: "existing",
      email: "Apple.User@Example.com",
      username: "existing",
      passwordHash: "hash",
    });
    const res = await post({ identity_token: await identityToken(), nonce: RAW_NONCE });
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe("existing");
    expect(await allUsers()).toHaveLength(1);
    const [link] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, "existing"));
    expect(link?.providerAccountId).toBe("apple-sub-1");
  });

  it("does not link by an unverified email", async () => {
    await db.insert(schema.users).values({
      id: "existing",
      email: "apple.user@example.com",
      username: "existing",
    });
    const res = await post({
      identity_token: await identityToken({ email_verified: "false" }),
      nonce: RAW_NONCE,
    });
    expect(((await res.json()) as { user: { id: string } }).user.id).not.toBe("existing");
  });

  it("works for a token with no email by synthesizing one", async () => {
    const res = await post({
      identity_token: await identityToken({ email: undefined, email_verified: undefined }),
      nonce: RAW_NONCE,
    });
    expect(res.status).toBe(200);
    const [row] = await allUsers();
    expect(row?.email).toBe("apple-sub-1@appleid.invalid");
    expect(row?.isEmailVerified).toBe(0);
  });

  it("rejects the wrong audience, issuer, expiry and nonce with 401 and creates nothing", async () => {
    const cases: [string, Record<string, unknown>, string?][] = [
      ["audience", { aud: "com.someone.else" }],
      ["issuer", { iss: "https://evil.example.com" }],
      ["expiry", { exp: Math.floor(Date.now() / 1000) - 5 }],
      ["nonce", {}, "a-different-raw-nonce"],
    ];
    for (const [, claims, nonce] of cases) {
      const res = await post({
        identity_token: await identityToken(claims),
        nonce: nonce ?? RAW_NONCE,
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ message: expect.any(String) });
    }
    expect(await allUsers()).toHaveLength(0);
  });

  it("rejects a forged signature", async () => {
    const token = await identityToken();
    const [h, p] = token.split(".");
    const res = await post({
      identity_token: `${h}.${p}.${b64url(new Uint8Array(256))}`,
      nonce: RAW_NONCE,
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ nonce: RAW_NONCE })).status).toBe(400);
    expect((await post({ identity_token: "x" })).status).toBe(400);
  });

  it("refuses a disabled account (403)", async () => {
    await db.insert(schema.users).values({
      id: "off",
      email: "off@example.com",
      username: "off",
      isActive: 0,
    });
    await db.insert(schema.accounts).values({
      id: "a1",
      provider: "apple",
      providerAccountId: "apple-sub-1",
      userId: "off",
    });
    const res = await post({ identity_token: await identityToken(), nonce: RAW_NONCE });
    expect(res.status).toBe(403);
  });

  it("answers 502 when Apple's keys cannot be fetched", async () => {
    // The route's JWKS cache is module state; reload the route for a cold cache.
    vi.resetModules();
    const { authRoutes: cold } = await import("../auth");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ identity_token: await identityToken(), nonce: RAW_NONCE }, cold);
    expect(res.status).toBe(502);
    err.mockRestore();
  });

  it("stores the Apple grant when the authorization code can be redeemed", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "https://appleid.apple.com/auth/token"
        ? Response.json({ refresh_token: "apple-refresh-1" })
        : jwksResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(
      {
        identity_token: await identityToken(),
        nonce: RAW_NONCE,
        authorization_code: "one-shot-code",
      },
      authRoutes,
      { DB: t.d1, ...(await siwaEnv()) },
    );
    expect(res.status).toBe(200);
    const [link] = await db.select().from(schema.accounts);
    expect(link?.refreshToken).toBe("apple-refresh-1");
    const tokenCall = fetchMock.mock.calls.find(
      (call) => call[0] === "https://appleid.apple.com/auth/token",
    ) as unknown as [string, RequestInit];
    expect(new URLSearchParams(String(tokenCall[1].body)).get("code")).toBe("one-shot-code");
  });

  it("still signs in when the authorization code exchange fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "https://appleid.apple.com/auth/token"
          ? new Response("bad", { status: 400 })
          : jwksResponse(),
      ),
    );
    const res = await post(
      { identity_token: await identityToken(), nonce: RAW_NONCE, authorization_code: "stale" },
      authRoutes,
      { DB: t.d1, ...(await siwaEnv()) },
    );
    expect(res.status).toBe(200);
    expect((await db.select().from(schema.accounts))[0]?.refreshToken).toBeNull();
    err.mockRestore();
  });
});
