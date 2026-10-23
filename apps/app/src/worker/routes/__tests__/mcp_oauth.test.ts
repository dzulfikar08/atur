import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { pkcePair } from "../../lib/oauth";
import { redirectUriAllowed, sha256Hex, validateRedirectUri } from "../../lib/mcpOauth";
import { createTestDb, sqliteSupported } from "../../test/sqliteD1";

const ORIGIN = "http://localhost";
const RESOURCE = `${ORIGIN}/mcp`;
const LOOPBACK_CB = "http://127.0.0.1:41234/callback";
const NOW = "2026-10-18T00:00:00.000Z";

type Json = Record<string, any>;

describe.skipIf(!sqliteSupported)("MCP OAuth authorization", () => {
  const app = createApp();
  let db: DbClient;
  let env: Env;

  const call = (path: string, init?: RequestInit) => app.request(path, init, env);
  const form = (body: Record<string, string>) => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const mcp = (token: string | null, method = "tools/list", params?: Json) =>
    call("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

  async function register(redirectUris = [LOOPBACK_CB], extra: Json = {}): Promise<Json> {
    const res = await call("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test <b>Client</b>",
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        ...extra,
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as Json;
  }

  function authorizeQuery(clientId: string, challenge: string, over: Json = {}): string {
    return new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: LOOPBACK_CB,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st-1",
      resource: RESOURCE,
      ...over,
    }).toString();
  }

  const SESSION = { cookie: "plane-session=tok-member" };

  /** Walks register → authorize (logged in) → approve and returns the code. */
  async function obtainCode(clientId: string, challenge: string, redirect = LOOPBACK_CB) {
    const res = await call("/oauth/authorize", {
      ...form({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "st-1",
        resource: RESOURCE,
        decision: "approve",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
        ...SESSION,
      },
    });
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    return loc.searchParams.get("code")!;
  }

  async function tokens(clientId: string, over: Json = {}) {
    const { verifier, challenge } = await pkcePair();
    const code = await obtainCode(clientId, challenge);
    const res = await call(
      "/oauth/token",
      form({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: LOOPBACK_CB,
        code_verifier: verifier,
        resource: RESOURCE,
        ...over,
      }),
    );
    return { res, body: (await res.json()) as Json, code, verifier };
  }

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;
    await db.insert(schema.users).values([
      {
        id: "member",
        email: "member@x.test",
        username: "member",
        token: "tok-member",
      },
      { id: "other", email: "other@x.test", username: "other", token: "tok-other" },
    ]);
    await db
      .insert(schema.workspaces)
      .values({ id: "ws-1", name: "Acme", slug: "acme", ownerId: "member", createdAt: NOW });
    await db
      .insert(schema.workspaceMembers)
      .values({ id: "m1", workspaceId: "ws-1", memberId: "member" });
  });

  describe("discovery", () => {
    it("serves RFC 9728 protected resource metadata on both well-known paths", async () => {
      for (const path of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ]) {
        const res = await call(path);
        expect(res.status).toBe(200);
        const doc = (await res.json()) as Json;
        expect(doc.resource).toBe(RESOURCE);
        expect(doc.authorization_servers).toEqual([ORIGIN]);
        expect(doc.bearer_methods_supported).toEqual(["header"]);
      }
    });

    it("serves RFC 8414 authorization server metadata", async () => {
      const res = await call("/.well-known/oauth-authorization-server");
      expect(res.status).toBe(200);
      const doc = (await res.json()) as Json;
      expect(doc.issuer).toBe(ORIGIN);
      expect(doc.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
      expect(doc.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
      expect(doc.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
      expect(doc.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
      expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
      expect(doc.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
      expect(doc.token_endpoint_auth_methods_supported).toEqual(["none"]);
    });
  });

  describe("401 challenge", () => {
    it("unauthenticated MCP requests get WWW-Authenticate with resource_metadata", async () => {
      const res = await mcp(null);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
      );
    });

    it("invalid tokens get invalid_token plus resource_metadata", async () => {
      for (const token of ["atur_at_bogus", "pk_live_bogus", "not-a-session"]) {
        const res = await mcp(token);
        expect(res.status).toBe(401);
        const header = res.headers.get("www-authenticate")!;
        expect(header).toContain('error="invalid_token"');
        expect(header).toContain(
          `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
        );
      }
    });
  });

  describe("dynamic client registration", () => {
    it("registers a public client and returns RFC 7591 metadata", async () => {
      const client = await register([LOOPBACK_CB, "https://claude.ai/api/mcp/auth_callback"]);
      expect(client.client_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(client.token_endpoint_auth_method).toBe("none");
      expect(client.redirect_uris).toHaveLength(2);
      expect(client.client_secret).toBeUndefined();
      const [row] = await db.select().from(schema.oauthClients);
      expect(row.id).toBe(client.client_id);
    });

    it.each([
      ["javascript scheme", ["javascript:alert(1)"]],
      ["plain http on a public host", ["http://evil.example/cb"]],
      ["fragment", ["https://app.example/cb#x"]],
      ["file scheme", ["file:///etc/passwd"]],
      ["empty list", []],
      ["not an array", "https://a.example/cb"],
    ])("rejects %s with invalid_redirect_uri", async (_name, redirect_uris) => {
      const res = await call("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Json).error).toBe("invalid_redirect_uri");
    });

    it("rejects confidential clients", async () => {
      const res = await call("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [LOOPBACK_CB],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Json).error).toBe("invalid_client_metadata");
    });
  });

  describe("redirect URI policy", () => {
    it("matches exactly, except loopback http which may use any port", () => {
      expect(redirectUriAllowed(["https://a.example/cb"], "https://a.example/cb")).toBe(true);
      expect(redirectUriAllowed(["https://a.example/cb"], "https://a.example/cb2")).toBe(false);
      expect(redirectUriAllowed(["https://a.example/cb"], "https://a.example:444/cb")).toBe(false);
      expect(redirectUriAllowed(["http://localhost:1/cb"], "http://localhost:59999/cb")).toBe(true);
      expect(redirectUriAllowed(["http://127.0.0.1/cb"], "http://127.0.0.1:8123/cb")).toBe(true);
      expect(redirectUriAllowed(["http://127.0.0.1/cb"], "http://localhost:8123/cb")).toBe(false);
      expect(redirectUriAllowed(["http://127.0.0.1/cb"], "http://127.0.0.1:8123/other")).toBe(
        false,
      );
      expect(redirectUriAllowed(["http://127.0.0.1/cb"], "http://constructor:8123/cb")).toBe(false);
    });

    it("accepts custom schemes and rejects dangerous ones", () => {
      expect(validateRedirectUri("cursor://anysphere.cursor/oauth/callback")).toBeNull();
      expect(validateRedirectUri("https://x.example/cb")).toBeNull();
      expect(validateRedirectUri("data:text/html,x")).not.toBeNull();
      expect(validateRedirectUri("https://u:p@x.example/cb")).not.toBeNull();
    });
  });

  describe("authorize endpoint", () => {
    it("shows an error page (no redirect) for an unknown client or unregistered redirect", async () => {
      const { challenge } = await pkcePair();
      const unknown = await call(`/oauth/authorize?${authorizeQuery("nope", challenge)}`);
      expect(unknown.status).toBe(400);
      expect(unknown.headers.get("location")).toBeNull();

      const client = await register();
      const bad = await call(
        `/oauth/authorize?${authorizeQuery(client.client_id, challenge, { redirect_uri: "https://evil.example/cb" })}`,
      );
      expect(bad.status).toBe(400);
      expect(bad.headers.get("location")).toBeNull();
    });

    it("allows a loopback redirect on any port", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const res = await call(
        `/oauth/authorize?${authorizeQuery(client.client_id, challenge, { redirect_uri: "http://127.0.0.1:55555/callback" })}`,
        { headers: SESSION },
      );
      expect(res.status).toBe(200);
    });

    it.each([
      ["missing code_challenge", { code_challenge: "" }, "invalid_request"],
      ["plain method", { code_challenge_method: "plain" }, "invalid_request"],
      ["malformed challenge", { code_challenge: "short" }, "invalid_request"],
      ["token response_type", { response_type: "token" }, "unsupported_response_type"],
      ["foreign resource", { resource: "https://other.example/mcp" }, "invalid_target"],
    ])("redirects %s as %s", async (_name, over, error) => {
      const client = await register();
      const { challenge } = await pkcePair();
      const res = await call(
        `/oauth/authorize?${authorizeQuery(client.client_id, challenge, over)}`,
        { headers: SESSION },
      );
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe(LOOPBACK_CB);
      expect(loc.searchParams.get("error")).toBe(error);
      expect(loc.searchParams.get("state")).toBe("st-1");
    });

    it("sends logged-out browsers through the SPA login", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const res = await call(`/oauth/authorize?${authorizeQuery(client.client_id, challenge)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("redirect_after_login");
      expect(html).toContain("/auth/login");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    });

    it("renders a consent screen for a signed-in user, escaping client input", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const res = await call(`/oauth/authorize?${authorizeQuery(client.client_id, challenge)}`, {
        headers: SESSION,
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("member@x.test");
      expect(html).toContain("Acme");
      expect(html).toContain("Test &lt;b&gt;Client&lt;/b&gt;");
      expect(html).not.toContain("<b>Client</b>");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    });

    it("POST deny redirects with access_denied", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const res = await call("/oauth/authorize", {
        ...form({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: LOOPBACK_CB,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "st-1",
          decision: "deny",
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          ...SESSION,
        },
      });
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
      expect(await db.select().from(schema.oauthCodes)).toHaveLength(0);
    });

    it("POST approve is refused cross-site and without a session", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const body = {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: LOOPBACK_CB,
        code_challenge: challenge,
        code_challenge_method: "S256",
        decision: "approve",
      };
      const crossSite = await call("/oauth/authorize", {
        ...form(body),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example",
          ...SESSION,
        },
      });
      expect(crossSite.status).toBe(400);
      const noSession = await call("/oauth/authorize", {
        ...form(body),
        headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      });
      expect(noSession.status).toBe(400);
      expect(await db.select().from(schema.oauthCodes)).toHaveLength(0);
    });

    it("trusts Sec-Fetch-Site: same-origin even when Origin is the opaque 'null'", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const post = (headers: Record<string, string>) =>
        call("/oauth/authorize", {
          ...form({
            response_type: "code",
            client_id: client.client_id,
            redirect_uri: LOOPBACK_CB,
            code_challenge: challenge,
            code_challenge_method: "S256",
            decision: "approve",
          }),
          headers: { "content-type": "application/x-www-form-urlencoded", ...SESSION, ...headers },
        });
      expect((await post({ origin: "null", "sec-fetch-site": "same-origin" })).status).toBe(303);
      expect((await post({ origin: ORIGIN, "sec-fetch-site": "cross-site" })).status).toBe(400);
      expect((await post({ "sec-fetch-site": "same-site" })).status).toBe(400);
    });

    it("stores the code hashed", async () => {
      const client = await register();
      const { challenge } = await pkcePair();
      const code = await obtainCode(client.client_id, challenge);
      const [row] = await db.select().from(schema.oauthCodes);
      expect(row.codeHash).toBe(await sha256Hex(code));
      expect(JSON.stringify(row)).not.toContain(code);
    });
  });

  describe("token endpoint", () => {
    it("completes the flow and the access token lists MCP tools", async () => {
      const client = await register();
      const { res, body } = await tokens(client.client_id);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBe(3600);
      expect(body.scope).toBe("mcp");
      expect(body.access_token).toMatch(/^atur_at_/);
      expect(body.refresh_token).toMatch(/^atur_rt_/);

      const list = await mcp(body.access_token);
      expect(list.status).toBe(200);
      const listed = (await list.json()) as Json;
      expect(listed.result.tools.length).toBeGreaterThan(10);

      const ws = await mcp(body.access_token, "tools/call", {
        name: "list_workspaces",
        arguments: {},
      });
      expect(ws.status).toBe(200);
      const text = ((await ws.json()) as Json).result.content[0].text as string;
      expect(JSON.parse(text).map((w: Json) => w.slug)).toEqual(["acme"]);
    });

    it("stores access and refresh tokens hashed only", async () => {
      const client = await register();
      const { body } = await tokens(client.client_id);
      const [row] = await db.select().from(schema.oauthTokens);
      expect(row.accessHash).toBe(await sha256Hex(body.access_token));
      expect(row.refreshHash).toBe(await sha256Hex(body.refresh_token));
      const dump = JSON.stringify(row);
      expect(dump).not.toContain(body.access_token);
      expect(dump).not.toContain(body.refresh_token);
      expect(row.userId).toBe("member");
      expect(row.resource).toBe(RESOURCE);
    });

    it("rejects a wrong PKCE verifier and burns the code", async () => {
      const client = await register();
      const wrong = (await pkcePair()).verifier;
      const bad = await tokens(client.client_id, { code_verifier: wrong });
      expect(bad.res.status).toBe(400);
      expect(bad.body.error).toBe("invalid_grant");
      // The correct verifier no longer redeems the burnt code.
      const retry = await call(
        "/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: bad.code,
          redirect_uri: LOOPBACK_CB,
          code_verifier: bad.verifier,
        }),
      );
      expect(retry.status).toBe(400);
      expect(await db.select().from(schema.oauthTokens)).toHaveLength(0);
    });

    it("rejects a missing or malformed code_verifier", async () => {
      const client = await register();
      for (const code_verifier of ["", "short", "x".repeat(200)]) {
        const { res, body } = await tokens(client.client_id, { code_verifier });
        expect(res.status).toBe(400);
        expect(body.error).toBe("invalid_grant");
      }
    });

    it("rejects redirect_uri mismatch, foreign client and foreign resource", async () => {
      const client = await register();
      const other = await register();
      const mismatch = await tokens(client.client_id, { redirect_uri: "http://127.0.0.1:1/other" });
      expect(mismatch.body.error).toBe("invalid_grant");

      const { verifier, challenge } = await pkcePair();
      const code = await obtainCode(client.client_id, challenge);
      const foreign = await call(
        "/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: other.client_id,
          code,
          redirect_uri: LOOPBACK_CB,
          code_verifier: verifier,
        }),
      );
      expect(((await foreign.json()) as Json).error).toBe("invalid_grant");

      const wrongResource = await tokens(client.client_id, {
        resource: "https://other.example/mcp",
      });
      expect(wrongResource.body.error).toBe("invalid_target");
    });

    it("rejects an expired code", async () => {
      const client = await register();
      const { verifier, challenge } = await pkcePair();
      const code = await obtainCode(client.client_id, challenge);
      await db.update(schema.oauthCodes).set({ expiresAt: Date.now() - 1000 });
      const res = await call(
        "/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code,
          redirect_uri: LOOPBACK_CB,
          code_verifier: verifier,
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as Json).error).toBe("invalid_grant");
    });

    it("rejects code reuse and revokes the tokens minted from it", async () => {
      const client = await register();
      const first = await tokens(client.client_id);
      expect(first.res.status).toBe(200);
      expect((await mcp(first.body.access_token)).status).toBe(200);

      const replay = await call(
        "/oauth/token",
        form({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: first.code,
          redirect_uri: LOOPBACK_CB,
          code_verifier: first.verifier,
        }),
      );
      expect(replay.status).toBe(400);
      expect(((await replay.json()) as Json).error).toBe("invalid_grant");
      expect((await mcp(first.body.access_token)).status).toBe(401);
    });

    it("rejects unknown clients and unsupported grants", async () => {
      const unknown = await call(
        "/oauth/token",
        form({ grant_type: "authorization_code", client_id: "nope" }),
      );
      expect(unknown.status).toBe(401);
      expect(((await unknown.json()) as Json).error).toBe("invalid_client");

      const client = await register();
      const grant = await call(
        "/oauth/token",
        form({ grant_type: "client_credentials", client_id: client.client_id }),
      );
      expect(((await grant.json()) as Json).error).toBe("unsupported_grant_type");
    });
  });

  describe("refresh token rotation", () => {
    const refresh = (clientId: string, refreshToken: string) =>
      call(
        "/oauth/token",
        form({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }),
      );

    it("rotates: new pair works, old refresh and old access stop working", async () => {
      const client = await register();
      const first = (await tokens(client.client_id)).body;
      const res = await refresh(client.client_id, first.refresh_token);
      expect(res.status).toBe(200);
      const second = (await res.json()) as Json;
      expect(second.refresh_token).not.toBe(first.refresh_token);
      expect(second.access_token).not.toBe(first.access_token);

      expect((await mcp(second.access_token)).status).toBe(200);
      expect((await mcp(first.access_token)).status).toBe(401);
      expect((await refresh(client.client_id, first.refresh_token)).status).toBe(400);
    });

    it("reuse of a rotated refresh token revokes the whole chain", async () => {
      const client = await register();
      const first = (await tokens(client.client_id)).body;
      const second = (await (await refresh(client.client_id, first.refresh_token)).json()) as Json;
      expect((await mcp(second.access_token)).status).toBe(200);

      const replay = await refresh(client.client_id, first.refresh_token);
      expect(replay.status).toBe(400);
      expect(((await replay.json()) as Json).error).toBe("invalid_grant");
      expect((await mcp(second.access_token)).status).toBe(401);
      expect((await refresh(client.client_id, second.refresh_token)).status).toBe(400);
    });

    it("refuses a refresh token presented by another client, or an expired one", async () => {
      const client = await register();
      const other = await register();
      const first = (await tokens(client.client_id)).body;
      expect((await refresh(other.client_id, first.refresh_token)).status).toBe(400);

      await db.update(schema.oauthTokens).set({ refreshExpiresAt: Date.now() - 1000 });
      expect((await refresh(client.client_id, first.refresh_token)).status).toBe(400);
    });
  });

  describe("access token validation", () => {
    it("rejects expired access tokens", async () => {
      const client = await register();
      const { body } = await tokens(client.client_id);
      expect((await mcp(body.access_token)).status).toBe(200);
      await db.update(schema.oauthTokens).set({ accessExpiresAt: Date.now() - 1 });
      const res = await mcp(body.access_token);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("invalid_token");
    });

    it("rejects tokens bound to a different audience", async () => {
      const client = await register();
      const { body } = await tokens(client.client_id);
      await db
        .update(schema.oauthTokens)
        .set({ resource: "https://other.example/mcp" })
        .where(eq(schema.oauthTokens.accessHash, await sha256Hex(body.access_token)));
      expect((await mcp(body.access_token)).status).toBe(401);
    });

    it("rejects tokens of a deactivated user", async () => {
      const client = await register();
      const { body } = await tokens(client.client_id);
      await db.update(schema.users).set({ isActive: 0 }).where(eq(schema.users.id, "member"));
      expect((await mcp(body.access_token)).status).toBe(401);
    });

    it("is not accepted by the REST API (audience is the MCP resource only)", async () => {
      const client = await register();
      const { body } = await tokens(client.client_id);
      const res = await call("/api/me", {
        headers: { authorization: `Bearer ${body.access_token}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("revocation", () => {
    it("revokes the grant for the owning client, no-op for others", async () => {
      const client = await register();
      const other = await register();
      const { body } = await tokens(client.client_id);

      await call("/oauth/revoke", form({ token: body.refresh_token, client_id: other.client_id }));
      expect((await mcp(body.access_token)).status).toBe(200);

      const res = await call(
        "/oauth/revoke",
        form({ token: body.refresh_token, client_id: client.client_id }),
      );
      expect(res.status).toBe(200);
      expect((await mcp(body.access_token)).status).toBe(401);

      const unknown = await call(
        "/oauth/revoke",
        form({ token: "atur_at_nothing", client_id: client.client_id }),
      );
      expect(unknown.status).toBe(200);
    });
  });

  describe("existing credentials keep working", () => {
    it("accepts a pk_live_ API key via X-API-Key and Bearer", async () => {
      const key = "pk_live_test-key-for-mcp";
      await db.insert(schema.apiKeys).values({
        id: "key-1",
        keyHash: await sha256Hex(key),
        userId: "member",
        isActive: 1,
        createdAt: NOW,
      });
      const viaHeader = await call("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(viaHeader.status).toBe(200);
      expect(((await viaHeader.json()) as Json).result.tools.length).toBeGreaterThan(10);
      expect((await mcp(key)).status).toBe(200);
    });

    it("accepts a session token, and still 401s a revoked API key", async () => {
      expect((await mcp("tok-member")).status).toBe(200);

      const key = "pk_live_revoked";
      await db.insert(schema.apiKeys).values({
        id: "key-2",
        keyHash: await sha256Hex(key),
        userId: "member",
        isActive: 0,
        createdAt: NOW,
      });
      const res = await mcp(key);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    });

    it("tool errors under an API key are not turned into auth challenges", async () => {
      const res = await mcp("tok-member", "tools/call", {
        name: "list_projects",
        arguments: { workspace: "nonexistent" },
      });
      expect(res.headers.get("www-authenticate")).toBeNull();
    });
  });
});
