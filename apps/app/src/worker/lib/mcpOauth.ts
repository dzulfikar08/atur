// Pure helpers for the MCP OAuth 2.1 authorization server (no DB, no Hono).
// The authorization server and the protected resource (/mcp) share one origin,
// so every URL below derives from the request origin.

import { sha256Base64Url } from "./oauth";

export const MCP_SCOPE = "mcp";
export const ACCESS_TOKEN_PREFIX = "atur_at_";
export const REFRESH_TOKEN_PREFIX = "atur_rt_";

// Access tokens are short-lived; refresh tokens rotate on every use, so the
// 30 days is a sliding idle window, not an absolute lifetime.
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 120;

export const MAX_REDIRECT_URIS = 10;
export const MAX_URI_LENGTH = 2048;

/** Scheme + host of the request, honoring a clean x-forwarded-proto (see routes/auth.ts). */
export function requestOrigin(url: string, forwardedProto?: string | null): string {
  const u = new URL(url);
  const fwd = forwardedProto?.split(",")[0]?.trim();
  const proto = fwd === "http" || fwd === "https" ? fwd : u.protocol.replace(":", "");
  return `${proto}://${u.host}`;
}

/** Canonical MCP resource identifier (RFC 8707) for an origin. */
export function mcpResource(origin: string): string {
  return `${origin}/mcp`;
}

/** Trailing-slash-insensitive resource comparison. */
export function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Atur MCP",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };
const BLOCKED_SCHEMES: Record<string, true> = {
  "javascript:": true,
  "data:": true,
  "file:": true,
  "vbscript:": true,
  "blob:": true,
  "about:": true,
  "ftp:": true,
  "ws:": true,
  "wss:": true,
};

function isLoopbackHttp(u: URL): boolean {
  return u.protocol === "http:" && Object.hasOwn(LOOPBACK_HOSTS, u.hostname);
}

/**
 * Validates a redirect URI at registration. Allowed: https, http on a loopback
 * host (native clients), and private-use custom schemes (cursor://, vscode://).
 * Returns an error message, or null when acceptable.
 */
export function validateRedirectUri(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URI_LENGTH) {
    return "redirect_uris must be non-empty strings";
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `redirect_uri is not a valid URI: ${raw.slice(0, 80)}`;
  }
  if (u.hash || raw.includes("#")) return "redirect_uri must not contain a fragment";
  if (u.username || u.password) return "redirect_uri must not contain credentials";
  if (Object.hasOwn(BLOCKED_SCHEMES, u.protocol))
    return `redirect_uri scheme ${u.protocol} is not allowed`;
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:") {
    return isLoopbackHttp(u) ? null : "http redirect_uri is only allowed for localhost/127.0.0.1";
  }
  return null; // private-use custom scheme
}

/**
 * Exact-match against the registered URIs, except that a registered loopback
 * http URI matches any port on the same host and path (RFC 8252 §7.3).
 */
export function redirectUriAllowed(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopbackHttp(req)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return (
        isLoopbackHttp(reg) &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

// ── PKCE (RFC 7636) ──────────────────────────────────────────────────────────

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && CHALLENGE_RE.test(challenge);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPkce(verifier: unknown, challenge: string): Promise<boolean> {
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) return false;
  return timingSafeEqual(await sha256Base64Url(verifier), challenge);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
