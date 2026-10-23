// MCP authorization (spec 2025-06-18): OAuth 2.1 authorization server +
// RFC 9728 / RFC 8414 discovery documents. Mounted at the app root because the
// well-known paths are fixed by the RFCs. See docs/mcp-oauth.md.
//
// The browser step (/oauth/authorize) reuses Atur's normal login session — the
// `plane-session` cookie — and renders a server-side consent screen; sign-in
// itself stays on the SPA (/auth/login, incl. Google) and bounces back here.

import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { resolveRequestUser } from "../middleware/auth";
import { randomToken } from "../lib/oauth";
import {
  MCP_SCOPE,
  authorizationServerMetadata,
  isValidCodeChallenge,
  mcpResource,
  protectedResourceMetadata,
  redirectUriAllowed,
  requestOrigin,
  sameResource,
} from "../lib/mcpOauth";
import * as oauth from "../services/mcpOauth";

type C = Context<{ Bindings: Env }>;

const SESSION_COOKIE = "plane-session";
// Dynamic registration is open by design (RFC 7591 public clients); this keeps
// one address from filling the table. Best-effort: skipped without the KV.
const REGISTER_LIMIT_PER_HOUR = 30;

function origin(c: C): string {
  return requestOrigin(c.req.url, c.req.header("x-forwarded-proto"));
}

async function readParams(c: C): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body: unknown = await c.req.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, string | File>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") out[k] = v;
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function oauthJsonError(c: C, err: oauth.OAuthError): Response {
  c.header("Cache-Control", "no-store");
  return c.json({ error: err.code, error_description: err.description }, err.status as 400 | 401);
}

// ── HTML (authorize step) ────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAGE_CSS = `
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#ededf0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:100%;max-width:420px;margin:24px;padding:32px;border:1px solid #2a2a30;border-radius:18px;background:#141418}
h1{font-size:21px;margin:0 0 6px}
p{margin:8px 0;color:#a9a9b3}
.box{margin:16px 0;padding:12px 14px;border:1px solid #2a2a30;border-radius:10px;background:#0f0f12;font-size:13.5px}
.box b{color:#ededf0}
ul{margin:6px 0 0;padding-left:18px;color:#a9a9b3}
.row{display:flex;gap:10px;margin-top:22px}
button{flex:1;padding:12px;border-radius:10px;border:1px solid #2a2a30;font:inherit;font-weight:700;cursor:pointer;background:#1c1c22;color:#ededf0}
button.primary{background:#ededf0;color:#0b0b0d;border-color:#ededf0}
`;

function htmlResponse(body: string, status = 200, nonce?: string): Response {
  const script = nonce ? ` script-src 'nonce-${nonce}';` : "";
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline';${script} frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main>${inner}</main></body></html>`;
}

function errorPage(message: string): Response {
  return htmlResponse(
    page(
      "Authorization error",
      `<h1>Can't authorize</h1><p>${esc(message)}</p><p>Return to the application and start the sign-in again.</p>`,
    ),
    400,
  );
}

// ── Authorize request parsing ────────────────────────────────────────────────

type AuthorizeRequest = {
  client: oauth.OAuthClient;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string;
};

function redirectWith(
  c: C,
  redirectUri: string,
  params: Record<string, string>,
  status: 302 | 303,
) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  c.header("Cache-Control", "no-store");
  return c.redirect(url.toString(), status);
}

/**
 * Validates an authorize request. client_id / redirect_uri problems must never
 * redirect (the URI is untrusted) → HTML error page. Everything after that is
 * reported to the validated redirect_uri per RFC 6749 §4.1.2.1.
 */
async function parseAuthorize(
  c: C,
  p: Record<string, unknown>,
  status: 302 | 303,
): Promise<{ req: AuthorizeRequest } | { response: Response }> {
  const db = getDb(c.env.DB);
  const clientId = str(p.client_id);
  const found = clientId ? await oauth.getClient(db, clientId) : null;
  if (!found) return { response: errorPage("Unknown client_id.") };
  const redirectUri = str(p.redirect_uri);
  if (!redirectUri || !redirectUriAllowed(found.redirectUris, redirectUri)) {
    return { response: errorPage("redirect_uri is not registered for this client.") };
  }
  const state = str(p.state);
  const iss = origin(c);
  const fail = (error: string, description: string) => ({
    response: redirectWith(
      c,
      redirectUri,
      { error, error_description: description, iss, ...(state ? { state } : {}) },
      status,
    ),
  });

  if (p.response_type !== "code") {
    return fail("unsupported_response_type", "response_type must be 'code'");
  }
  if (!isValidCodeChallenge(p.code_challenge) || p.code_challenge_method !== "S256") {
    return fail(
      "invalid_request",
      "PKCE is required: code_challenge with code_challenge_method=S256",
    );
  }
  const expected = mcpResource(iss);
  const asked = str(p.resource);
  if (asked && !sameResource(asked, expected)) {
    return fail("invalid_target", `resource must be ${expected}`);
  }
  return {
    req: {
      client: found.client,
      redirectUri,
      state,
      codeChallenge: p.code_challenge,
      resource: expected,
    },
  };
}

async function sessionUser(c: C) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return resolveRequestUser(getDb(c.env.DB), token);
}

// No session: send the browser through the SPA login, then back here. The
// hop first retries the same URL from a same-site navigation, because the
// session cookie is SameSite=Strict and is withheld on navigations that begin
// in another app (the MCP client launching the browser).
function loginInterstitial(): Response {
  const nonce = randomToken(16);
  const script = `
var u=new URL(location.href);
if(!u.searchParams.has("_hop")){u.searchParams.set("_hop","1");location.replace(u.toString());}
else{u.searchParams.delete("_hop");sessionStorage.setItem("redirect_after_login",u.pathname+u.search);location.replace("/auth/login");}`;
  return htmlResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in to Atur</title><style>${PAGE_CSS}</style></head><body><main><h1>Sign in to Atur</h1><p>Redirecting to sign-in…</p><noscript><p><a href="/auth/login">Sign in</a>, then restart the connection from your MCP client.</p></noscript></main><script nonce="${nonce}">${script}</script></body></html>`,
    200,
    nonce,
  );
}

function hiddenFields(req: AuthorizeRequest): string {
  const fields: Record<string, string> = {
    client_id: req.client.id,
    redirect_uri: req.redirectUri,
    response_type: "code",
    code_challenge: req.codeChallenge,
    code_challenge_method: "S256",
    resource: req.resource,
    scope: MCP_SCOPE,
    ...(req.state ? { state: req.state } : {}),
  };
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join("");
}

function redirectTarget(uri: string): string {
  const u = new URL(uri);
  return u.host ? `${u.protocol}//${u.host}` : `${u.protocol}…`;
}

function consentPage(
  req: AuthorizeRequest,
  user: { email: string },
  workspaces: { name: string; slug: string }[],
): Response {
  const shown = workspaces.slice(0, 15);
  const more = workspaces.length - shown.length;
  const list = shown.length
    ? `<ul>${shown.map((w) => `<li>${esc(w.name)} <span style="opacity:.6">(${esc(w.slug)})</span></li>`).join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>`
    : `<p>You are not a member of any workspace yet.</p>`;
  const name = req.client.clientName ?? "An MCP client";
  return htmlResponse(
    page(
      "Authorize access",
      `<h1>Connect ${esc(name)} to Atur</h1>
<p>Signed in as <b>${esc(user.email)}</b></p>
<div class="box"><b>${esc(name)}</b> will be able to read and change your Atur data through MCP, acting as you, in these workspaces:${list}</div>
<div class="box">After you approve, you are sent back to <b>${esc(redirectTarget(req.redirectUri))}</b>. Only continue if you started this connection.</div>
<form method="post" action="/oauth/authorize">${hiddenFields(req)}<div class="row"><button type="submit" name="decision" value="deny">Deny</button><button class="primary" type="submit" name="decision" value="approve">Allow access</button></div></form>`,
    ),
  );
}

// Fetch Metadata is authoritative where the browser sends it: a form posted
// from our own consent page is "same-origin" even when `Origin` is "null"
// (which Chrome/Firefox send under Referrer-Policy: no-referrer). Without it
// (non-browser clients), fall back to comparing `Origin` with our host.
function sameOriginPost(c: C): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site) return site === "same-origin";
  const originHeader = c.req.header("origin");
  if (!originHeader) return false;
  try {
    return new URL(originHeader).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const oauthRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  // RFC 9728. The path-suffixed variant is what clients derive from the
  // resource URL (…/oauth-protected-resource/mcp); both describe the same resource.
  .get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(origin(c))))
  .get("/.well-known/oauth-protected-resource/mcp", (c) =>
    c.json(protectedResourceMetadata(origin(c))),
  )
  // RFC 8414.
  .get("/.well-known/oauth-authorization-server", (c) =>
    c.json(authorizationServerMetadata(origin(c))),
  )

  // RFC 7591 dynamic client registration (public clients).
  .post("/oauth/register", async (c) => {
    const kv = c.env.RATE_LIMIT;
    if (kv) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const key = `oauth-register:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
      const used = Number((await kv.get(key).catch(() => null)) ?? 0);
      if (used >= REGISTER_LIMIT_PER_HOUR) {
        return c.json(
          { error: "invalid_client_metadata", error_description: "Too many registrations" },
          429,
        );
      }
      await kv.put(key, String(used + 1), { expirationTtl: 3600 }).catch(() => {});
    }
    try {
      const body = await readParams(c);
      const { client, redirectUris } = await oauth.registerClient(getDb(c.env.DB), body);
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          client_id: client.id,
          client_id_issued_at: Math.floor(Date.parse(client.createdAt ?? "") / 1000) || undefined,
          client_name: client.clientName ?? undefined,
          redirect_uris: redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: MCP_SCOPE,
        },
        201,
      );
    } catch (e) {
      if (e instanceof oauth.OAuthError) return oauthJsonError(c, e);
      throw e;
    }
  })

  .get("/oauth/authorize", async (c) => {
    const parsed = await parseAuthorize(c, c.req.query(), 302);
    if ("response" in parsed) return parsed.response;
    const user = await sessionUser(c);
    if (!user) return loginInterstitial();
    const workspaces = await oauth.listUserWorkspaces(getDb(c.env.DB), user.id);
    return consentPage(parsed.req, user, workspaces);
  })

  .post("/oauth/authorize", async (c) => {
    // The approval is a state-changing action authorised by the cookie alone:
    // refuse anything not submitted from this origin's own consent form.
    if (!sameOriginPost(c)) return errorPage("Cross-site request blocked.");
    const p = await readParams(c);
    const parsed = await parseAuthorize(c, p, 303);
    if ("response" in parsed) return parsed.response;
    const { req } = parsed;
    const user = await sessionUser(c);
    if (!user) return errorPage("Your Atur session expired. Start the sign-in again.");
    const iss = origin(c);
    const extra = { iss, ...(req.state ? { state: req.state } : {}) };
    if (p.decision !== "approve") {
      return redirectWith(
        c,
        req.redirectUri,
        { error: "access_denied", error_description: "The user denied the request", ...extra },
        303,
      );
    }
    const code = await oauth.createAuthorizationCode(getDb(c.env.DB), {
      clientId: req.client.id,
      userId: user.id,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      resource: req.resource,
    });
    return redirectWith(c, req.redirectUri, { code, ...extra }, 303);
  })

  .post("/oauth/token", async (c) => {
    try {
      const p = await readParams(c);
      const db = getDb(c.env.DB);
      const clientId = str(p.client_id);
      if (!clientId) throw new oauth.OAuthError("invalid_request", "client_id is required");
      if (!(await oauth.getClient(db, clientId))) {
        throw new oauth.OAuthError("invalid_client", "Unknown client_id", 401);
      }
      const resource = str(p.resource);
      let tokens: oauth.TokenResponse;
      if (p.grant_type === "authorization_code") {
        const code = str(p.code);
        const redirectUri = str(p.redirect_uri);
        if (!code || !redirectUri) {
          throw new oauth.OAuthError("invalid_request", "code and redirect_uri are required");
        }
        tokens = await oauth.exchangeAuthorizationCode(db, {
          code,
          clientId,
          redirectUri,
          codeVerifier: str(p.code_verifier),
          resource,
        });
      } else if (p.grant_type === "refresh_token") {
        const refreshToken = str(p.refresh_token);
        if (!refreshToken)
          throw new oauth.OAuthError("invalid_request", "refresh_token is required");
        tokens = await oauth.refreshAccessToken(db, { refreshToken, clientId, resource });
      } else {
        throw new oauth.OAuthError(
          "unsupported_grant_type",
          "grant_type must be authorization_code or refresh_token",
        );
      }
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json(tokens);
    } catch (e) {
      if (e instanceof oauth.OAuthError) return oauthJsonError(c, e);
      throw e;
    }
  })

  // RFC 7009. Always 200 for well-formed requests, whether or not the token existed.
  .post("/oauth/revoke", async (c) => {
    const p = await readParams(c);
    const token = str(p.token);
    const clientId = str(p.client_id);
    if (!token || !clientId) {
      return oauthJsonError(
        c,
        new oauth.OAuthError("invalid_request", "token and client_id are required"),
      );
    }
    await oauth.revokeToken(getDb(c.env.DB), token, clientId);
    c.header("Cache-Control", "no-store");
    return c.body(null, 200);
  });
