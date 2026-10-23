import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import {
  ACCESS_TOKEN_PREFIX,
  mcpResource,
  protectedResourceMetadataUrl,
  requestOrigin,
} from "../lib/mcpOauth";
import { resolveAccessToken } from "../services/mcpOauth";
import { authMiddleware, extractToken } from "./auth";

// MCP authorization spec: a 401 carries WWW-Authenticate pointing at the RFC 9728
// protected-resource metadata so clients can discover the authorization server.
function unauthorized(
  c: Context<{ Bindings: Env }>,
  origin: string,
  invalid: boolean,
  kind: string,
): Response {
  // Which credential type failed, never the credential itself.
  console.log(
    JSON.stringify({
      event: "mcp.unauthorized",
      kind,
      ua: c.req.header("user-agent")?.slice(0, 80),
      has_x_api_key: Boolean(c.req.header("x-api-key")),
      has_authorization: Boolean(c.req.header("authorization")),
    }),
  );
  const challenge = invalid
    ? `Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="${protectedResourceMetadataUrl(origin)}"`
    : `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`;
  c.header("WWW-Authenticate", challenge);
  c.header("Access-Control-Expose-Headers", "WWW-Authenticate");
  return c.json(
    {
      error: invalid ? "invalid_token" : "unauthorized",
      error_description: invalid
        ? "Invalid or expired token"
        : "Authentication required: OAuth bearer token or X-API-Key",
    },
    401,
  );
}

/**
 * Authentication for POST /mcp: an OAuth access token (audience-bound to this
 * MCP resource) or, unchanged, a pk_live_ API key / session token.
 */
export async function mcpAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const origin = requestOrigin(c.req.url, c.req.header("x-forwarded-proto"));
  const token = extractToken(c);
  if (!token) return unauthorized(c, origin, false, "no_credentials");

  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const user = await resolveAccessToken(getDb(c.env.DB), token, mcpResource(origin));
    if (!user) return unauthorized(c, origin, true, "oauth_access_token");
    c.set("user", {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
    });
    return next();
  }

  // API key / session path. authMiddleware throws 401 itself; only that throw
  // (before it calls next) is converted — errors from the tool handlers pass through.
  let reachedHandler = false;
  try {
    await authMiddleware(c, async () => {
      reachedHandler = true;
      await next();
    });
  } catch (e) {
    if (!reachedHandler && e instanceof HTTPException && e.status === 401) {
      return unauthorized(c, origin, true, token.startsWith("pk_live_") ? "api_key" : "session");
    }
    throw e;
  }
}
