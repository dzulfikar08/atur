import type { Context, Next, ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "../lib/env";
import type { AuthUser } from "../lib/token";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as usersRepo from "../repositories/users";
import {
  SESSION_TTL_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
  sessionExpiryISO,
} from "../lib/session";

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractToken(c: Context<{ Bindings: Env }>): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const apiKey = c.req.header("X-API-Key");
  if (apiKey) {
    return apiKey;
  }
  return getCookie(c, "plane-session") ?? null;
}

type ResolvedUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatar: string | null;
  isActive: number | null;
  deletedAt?: string | null;
  sessionExpiresAt?: string | null;
};

// A session is expired when its stamp is in the past. A NULL stamp (legacy
// rows created before session_expires_at existed) is treated as always valid
// so existing users are not logged out by the migration.
function isSessionExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires <= Date.now();
}

// Sliding-window extension: when a session token is still valid but inside the
// back half of its TTL, push the expiry back out to a full SESSION_TTL_SECONDS
// and return the new expiry so the caller can refresh the cookie Max-Age.
// Best-effort: registered with ctx.waitUntil so the write persists after the
// response returns. A failed write never fails the request.
function refreshSessionIfNeeded(
  db: DbClient,
  userId: string,
  token: string,
  expiresAt: string | null | undefined,
  ctx?: ExecutionContext,
): string | null {
  if (!expiresAt) return null;
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return null;
  const now = Date.now();
  const refreshAt = expires - SESSION_REFRESH_THRESHOLD_SECONDS * 1000;
  if (now < refreshAt) return null; // still in the front half — no extension needed

  const nextExpiry = sessionExpiryISO();
  const updatePromise = db.update(schema.users)
    .set({ sessionExpiresAt: nextExpiry, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.users.id, userId), eq(schema.users.token, token)))
    .catch(() => {});
  // Register the write with the Workers event context so it survives past the
  // response. Without waitUntil the runtime freezes/cancels this promise when
  // the response returns, so sessionExpiresAt never actually advances and an
  // active user gets logged out 24h after their last login. fire-and-forget
  // after the response keeps the request fast (zero added latency) while the
  // write still persists — active sessions slide, idle ones expire.
  ctx?.waitUntil(updatePromise);
  return nextExpiry;
}

// Resolve a raw token to a user. Two paths:
//  1. pk_live_* API key → sha256-hashed lookup against api_keys. Long-lived,
//     minted via POST /me/api-keys. Active, non-expired, non-deleted only.
//  2. anything else → opaque session token stored on users.token.
async function resolveUserByToken(db: DbClient, token: string): Promise<ResolvedUser | null> {
  if (token.startsWith("pk_live_")) {
    const keyHash = await sha256Hex(token);
    const now = new Date().toISOString();
    const [key] = await db
      .select({
        id: schema.apiKeys.id,
        userId: schema.apiKeys.userId,
        expiresAt: schema.apiKeys.expiresAt,
      })
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.keyHash, keyHash),
          eq(schema.apiKeys.isActive, 1),
          isNull(schema.apiKeys.deletedAt),
        ),
      )
      .limit(1);
    if (!key) return null;
    if (key.expiresAt && key.expiresAt <= now) return null;
    const user = await usersRepo.findById(db, key.userId);
    if (!user || !user.isActive || user.deletedAt) return null;
    // Best-effort last-used stamp; never block the request on it.
    db.update(schema.apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(schema.apiKeys.id, key.id))
      .catch(() => {});
    return user;
  }
  return usersRepo.findByToken(db, token);
}

function toAuthUser(user: ResolvedUser): AuthUser {
  return {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
  };
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c);
  if (!token) {
    throw new HTTPException(401, { message: "Missing or invalid token" });
  }
  const db = getDb(c.env.DB);
  const user = await resolveUserByToken(db, token);
  if (!user) {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }

  // Opaque session tokens carry a sliding expiry; reject when past it. API
  // keys (pk_live_*) have their own expires_at handled in resolveUserByToken.
  if (!token.startsWith("pk_live_") && isSessionExpired(user.sessionExpiresAt)) {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }

  // Sliding session window: extend the expiry (DB + cookie Max-Age) when the
  // session has entered the back half of its TTL.
  if (!token.startsWith("pk_live_")) {
    // c.executionCtx throws if absent (e.g. unit tests); fall back to no-op.
    let execCtx: ExecutionContext | undefined;
    try {
      execCtx = c.executionCtx;
    } catch {
      /* no Workers execution context — session extension skipped */
    }
    const nextExpiry = refreshSessionIfNeeded(db, user.id, token, user.sessionExpiresAt, execCtx);
    if (nextExpiry) {
      const isHttps = c.req.url.startsWith("https://");
      c.header(
        "Set-Cookie",
        `plane-session=${token}; HttpOnly; Secure=${isHttps}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
        { append: true },
      );
    }
  }

  c.set("user", toAuthUser(user));
  await next();
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c);
  if (token) {
    const db = getDb(c.env.DB);
    const user = await resolveUserByToken(db, token);
    if (user) {
      c.set("user", toAuthUser(user));
    }
  }
  await next();
}
