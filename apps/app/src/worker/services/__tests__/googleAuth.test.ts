import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../lib/env";
import {
  GOOGLE_ERROR_MESSAGES,
  GoogleAuthError,
  googleAuthorizeUrl,
  pkcePair,
  randomToken,
} from "../../lib/oauth";
import {
  consumeState,
  exchangeCode,
  fetchProfile,
  oauthStateKey,
  saveState,
  signInWithGoogle,
} from "../googleAuth";
import { authRoutes } from "../../routes/auth";

// Thenable that also chains like a drizzle query builder (same pattern as
// dev8_authz.test.ts). Each select() call consumes the next fixture.
function chainy(rows: any[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    limit: () => chain,
    orderBy: () => chain,
    offset: () => chain,
    where: () => chain,
  };
  return chain;
}

// mockDb + insert capture (usersRepo.createUser plain insert and
// accountsRepo.create onConflictDoNothing insert) + update capture (for
// usersRepo.updateUser / accountsRepo.updateTokens).
function mockDb(selectFixtures: any[][]) {
  const updates: any[] = [];
  const inserts: any[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      return { from: () => ({ where: () => chainy(rows) }) };
    },
    insert: () => ({
      values: (v: any) => {
        inserts.push(v);
        // Plain await (users insert) and .onConflictDoNothing() (accounts).
        const pending = Promise.resolve();
        return {
          // oxlint-disable-next-line unicorn/no-thenable -- drizzle insert builder is awaitable
          then: pending.then.bind(pending),
          onConflictDoNothing: () => pending,
        };
      },
    }),
    update: () => ({
      set: (patch: any) => ({ where: () => Promise.resolve(updates.push(patch)) }),
    }),
  };
  return { db, updates, inserts };
}

function fakeKv(map = new Map<string, string>()) {
  const kv = {
    get: (k: string) => Promise.resolve(map.get(k) ?? null),
    put: (k: string, v: string) => {
      map.set(k, v);
      return Promise.resolve();
    },
    delete: (k: string) => {
      map.delete(k);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
  return { kv, map };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROFILE = {
  sub: "g-sub-1",
  email: "User@Example.com",
  emailVerified: true,
  name: "Test User",
  picture: "https://lh3.googleusercontent.com/a.jpg",
};

describe("oauth helpers (lib/oauth)", () => {
  it("pkcePair: verifier is base64url and challenge is its SHA-256", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
    // Recompute independently with WebCrypto.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const bin = String.fromCharCode(...new Uint8Array(digest));
    const expected = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("randomToken: base64url only, unguessable length", () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBe(43); // 32 bytes → 43 base64url chars, unpadded
  });

  it("googleAuthorizeUrl: code flow + S256 PKCE + online access", () => {
    const url = new URL(
      googleAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://app.diatur.com/auth/google/callback",
        state: "st-1",
        challenge: "cha-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.diatur.com/auth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("code_challenge")).toBe("cha-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("access_type")).toBe("online");
  });
});

describe("oauth state KV (services/googleAuth)", () => {
  it("saveState/consumeState round-trips the verifier", async () => {
    const { kv } = fakeKv();
    await saveState(kv, "s1", "ver-1");
    expect(await consumeState(kv, "s1")).toBe("ver-1");
  });

  it("consumeState: unknown state → null", async () => {
    expect(await consumeState(fakeKv().kv, "missing")).toBeNull();
  });

  it("consumeState is single-use: second call → null", async () => {
    const { kv } = fakeKv();
    await saveState(kv, "s1", "ver-1");
    expect(await consumeState(kv, "s1")).toBe("ver-1");
    expect(await consumeState(kv, "s1")).toBeNull();
  });

  it("state key is namespaced under auth:oauth:google:", async () => {
    const { kv, map } = fakeKv();
    await saveState(kv, "s1", "ver-1");
    expect(map.has(oauthStateKey("s1"))).toBe(true);
  });
});

describe("exchangeCode", () => {
  const args = {
    clientId: "cid",
    clientSecret: "sec",
    code: "c-1",
    redirectUri: "https://app.diatur.com/auth/google/callback",
    verifier: "v-1",
  };

  it("POSTs the form-encoded exchange and returns the tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at", id_token: "it" }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCode(args);
    expect(tokens).toEqual({ accessToken: "at", idToken: "it" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c-1");
    expect(body.get("code_verifier")).toBe("v-1");
    expect(body.get("redirect_uri")).toBe(args.redirectUri);
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("sec");
  });

  it("non-ok response → GoogleAuthError(token_exchange_failed) with truncated body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)));
    try {
      await exchangeCode(args);
      throw new Error("expected GoogleAuthError");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).code).toBe("token_exchange_failed");
      expect((err as Error).message).toContain("invalid_grant");
    }
  });

  it("200 without access_token → GoogleAuthError(token_exchange_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    await expect(exchangeCode(args)).rejects.toMatchObject({ code: "token_exchange_failed" });
  });
});

describe("fetchProfile", () => {
  it("sends the Bearer token and normalizes the profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sub: "g-sub-1",
        email: "User@Example.com",
        email_verified: true,
        name: "Test User",
        picture: "https://pic",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchProfile("at");
    expect(profile).toEqual({
      sub: "g-sub-1",
      email: "user@example.com",
      emailVerified: true,
      name: "Test User",
      picture: "https://pic",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at");
  });

  it("missing sub or email → GoogleAuthError(userinfo_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ sub: "s" })));
    await expect(fetchProfile("at")).rejects.toMatchObject({ code: "userinfo_failed" });
  });

  it("email_verified is true only when Google says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ sub: "s", email: "a@b.c" })),
    );
    const profile = await fetchProfile("at");
    expect(profile.emailVerified).toBe(false);
  });
});

describe("signInWithGoogle", () => {
  const base = { ...PROFILE, accessToken: "at", idToken: "it" };

  it("new email → passwordless user created, account linked, session minted", async () => {
    // selects: accounts.findByProvider → [], users.findByEmailCaseInsensitive
    // → [], users.findByUsername → [], createUser's findById → created row.
    const { db, inserts } = mockDb([
      [],
      [],
      [],
      [{ id: "u-new", email: "user@example.com", username: "user" }],
    ]);
    const result = await signInWithGoogle(db, base);

    expect(result.user.email).toBe("user@example.com");
    expect(result.user.username).toBe("user"); // usernameFromEmail local part
    expect(result.token).toBeTruthy();

    expect(inserts).toHaveLength(2); // the users row + the accounts link row
    const userInsert = inserts.find((i) => i.email);
    expect(userInsert).toMatchObject({
      email: "user@example.com",
      username: "user",
      displayName: "Test User",
      avatar: "https://lh3.googleusercontent.com/a.jpg",
      passwordHash: null,
      // Google verified the address — the new account must not look unverified.
      isEmailVerified: 1,
      sessionExpiresAt: expect.any(String),
    });
    expect(typeof result.token).toBe("string");
    const accountInsert = inserts.find((i) => i.provider);
    expect(accountInsert).toMatchObject({
      provider: "google",
      providerAccountId: "g-sub-1",
    });
    expect(JSON.parse(accountInsert.metadata)).toEqual({
      email: "user@example.com",
      name: "Test User",
      picture: "https://lh3.googleusercontent.com/a.jpg",
    });
  });

  it("existing user with same email (mixed case in DB) → linked, spelling preserved", async () => {
    const existing = {
      id: "u1",
      email: "User@Example.com", // registered with capitals — CI lookup must find it
      username: "existing",
      isActive: 1,
      deletedAt: null,
    };
    const { db, updates, inserts } = mockDb([[], [existing]]); // no account, user found
    const result = await signInWithGoogle(db, base);

    expect(result.user).toMatchObject({ id: "u1", email: "User@Example.com", username: "existing" });
    expect(inserts).toHaveLength(1); // the accounts link row only
    const userPatch = updates.find((u) => u.isEmailVerified === 1);
    expect(userPatch?.token).toBeTruthy();
  });

  it("already-linked google sub → straight to session, no insert", async () => {
    const account = { id: "a1", userId: "u1" };
    const user = {
      id: "u1",
      email: "user@example.com",
      username: "existing",
      isActive: 1,
      deletedAt: null,
    };
    const { db, updates, inserts } = mockDb([[account], [user]]);
    const result = await signInWithGoogle(db, base);

    expect(result.user.id).toBe("u1");
    expect(inserts).toHaveLength(0);
    // updateTokens refresh runs best-effort on the link row.
    expect(updates.some((u) => "accessToken" in u || "updatedAt" in u)).toBe(true);
  });

  it("linked but disabled user → account_disabled", async () => {
    const { db, updates, inserts } = mockDb([
      [{ id: "a1", userId: "u1" }],
      [{ id: "u1", isActive: 0, deletedAt: null }],
    ]);
    try {
      await signInWithGoogle(db, base);
      throw new Error("expected GoogleAuthError");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("account_disabled");
    }
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("email match but disabled user → account_disabled", async () => {
    const { db } = mockDb([[], [{ id: "u1", isActive: 0, deletedAt: null }]]);
    await expect(signInWithGoogle(db, base)).rejects.toMatchObject({ code: "account_disabled" });
  });

  it("unverified google email → email_unverified, nothing written", async () => {
    const { db, updates, inserts } = mockDb([[], []]);
    try {
      await signInWithGoogle(db, { ...base, emailVerified: false });
      throw new Error("expected GoogleAuthError");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("email_unverified");
      expect(GOOGLE_ERROR_MESSAGES.email_unverified).toBeTruthy();
    }
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

// Route-level smoke tests: the OAuth endpoints are browser navigations, so
// every failure must be a redirect to the SPA callback — never a JSON page.
// authRoutes.request(input, requestInit, Env) — bindings go in slot 3.
function oauthEnv(over: Record<string, unknown>): Env {
  return { DB: {} as unknown as D1Database, ...over } as unknown as Env;
}

describe("GET /auth/google routes", () => {
  it("unconfigured secrets → 302 to SPA callback with oauth_disabled", async () => {
    const res = await authRoutes.request("/google", {}, oauthEnv({}));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!, "https://app.diatur.com");
    expect(location.pathname).toBe("/auth/callback/google");
    expect(location.searchParams.get("error")).toBe("oauth_disabled");
    expect(location.searchParams.get("error_description")).toBe(
      GOOGLE_ERROR_MESSAGES.oauth_disabled,
    );
    // Internal errors must not leak into the redirect URL.
    expect(location.search).not.toContain("error_detail");
  });

  it("configured → 302 to Google with state cookie bound to the browser", async () => {
    const { kv } = fakeKv();
    const res = await authRoutes.request(
      "/google",
      {},
      oauthEnv({ RATE_LIMIT: kv, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" }),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("state")).toBeTruthy();

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("plane-oauth-state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // The issued state is stored in KV with the PKCE verifier.
    const state = location.searchParams.get("state")!;
    const raw = await kv.get(`auth:oauth:google:${state}`);
    expect(JSON.parse(raw!).verifier).toBeTruthy();
  });

  it("callback with a state that doesn't match the cookie → state_invalid redirect", async () => {
    const { kv } = fakeKv();
    await saveState(kv, "attacker-state", "ver");
    const res = await authRoutes.request(
      "/google/callback?code=c&state=attacker-state",
      { headers: { cookie: "plane-oauth-state=victims-own-state" } },
      oauthEnv({ RATE_LIMIT: kv, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" }),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!, "https://app.diatur.com");
    expect(location.searchParams.get("error")).toBe("state_invalid");
    // The attacker's state must NOT have been consumed from KV.
    expect(await kv.get("auth:oauth:google:attacker-state")).not.toBeNull();
  });
});
