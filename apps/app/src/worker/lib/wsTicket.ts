import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "./env";

// One-time WebSocket tickets. A WebView cannot attach an Authorization header
// to a WS upgrade and the session token must never ride in a URL, so the
// native app mints a short-lived, single-use ticket over an authenticated
// POST and opens the socket with `?ticket=`. The ticket is scoped to one WS
// route, dies after one redemption or WS_TICKET_TTL_MS, and only its SHA-256
// is stored.
export const WS_TICKET_TTL_MS = 60_000;

/** Routes that accept `?ticket=`; the value is also the ticket's scope. */
export const WS_TICKET_SCOPES = ["screen"] as const;
export type WsTicketScope = (typeof WS_TICKET_SCOPES)[number];

const SCOPE_PATH: Record<WsTicketScope, string> = { screen: "/api/screen/ws" };

async function hashTicket(ticket: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function issueWsTicket(
  db: DbClient,
  userId: string,
  scope: WsTicketScope,
  now = Date.now(),
): Promise<{ ticket: string; expiresAt: number }> {
  // Opportunistic sweep: tickets are worthless once expired, so the table
  // stays tiny without a cron.
  await db.delete(schema.wsTickets).where(lt(schema.wsTickets.expiresAt, now));
  const ticket = randomTicket();
  const expiresAt = now + WS_TICKET_TTL_MS;
  await db.insert(schema.wsTickets).values({
    hash: await hashTicket(ticket),
    userId,
    scope,
    expiresAt,
  });
  return { ticket, expiresAt };
}

/**
 * Redeem a ticket: the owning user id, or null when it is unknown, expired,
 * already used or minted for another scope. The single UPDATE ... WHERE
 * used_at IS NULL is the atomic claim — two racing upgrades cannot both win.
 */
export async function redeemWsTicket(
  db: DbClient,
  ticket: string,
  scope: WsTicketScope,
  now = Date.now(),
): Promise<string | null> {
  const [row] = await db
    .update(schema.wsTickets)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.wsTickets.hash, await hashTicket(ticket)),
        eq(schema.wsTickets.scope, scope),
        isNull(schema.wsTickets.usedAt),
        gt(schema.wsTickets.expiresAt, now),
      ),
    )
    .returning({ userId: schema.wsTickets.userId });
  return row?.userId ?? null;
}

/** A WS upgrade that authenticates with `?ticket=` instead of a session. */
export function isWsTicketUpgrade(c: Context): boolean {
  return (
    c.req.header("Upgrade")?.toLowerCase() === "websocket" &&
    Boolean(c.req.query("ticket")) &&
    Object.values(SCOPE_PATH).includes(c.req.path)
  );
}

/**
 * Per-route ticket auth. Must sit on a route whose path is in SCOPE_PATH:
 * app.ts skips the session gate for ticket upgrades of exactly those paths, so
 * this middleware either sets the user or throws 401 — it never falls through
 * unauthenticated. Without a ticket it does nothing (the session gate ran).
 */
export function wsTicketAuth(scope: WsTicketScope) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (!isWsTicketUpgrade(c)) return next();
    const db = getDb(c.env.DB);
    const userId = await redeemWsTicket(db, c.req.query("ticket") ?? "", scope);
    if (!userId) throw new HTTPException(401, { message: "Invalid or expired ticket" });
    const [user] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        isActive: schema.users.isActive,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user || !user.isActive || user.deletedAt) {
      throw new HTTPException(401, { message: "Invalid or expired ticket" });
    }
    c.set("user", {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
    });
    await next();
  });
}
