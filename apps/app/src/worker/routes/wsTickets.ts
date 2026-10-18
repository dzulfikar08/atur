import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "../lib/env";
import { issueWsTicket, WS_TICKET_SCOPES, type WsTicketScope } from "../lib/wsTicket";

// Mint a one-time WebSocket ticket (see lib/wsTicket.ts). Mounted behind the
// global /api/* session gate, so the caller already proved a session/API key.
export const wsTicketRoutes = new Hono<{ Bindings: Env }>({ strict: false });

wsTicketRoutes.post("/", async (c) => {
  const body = await c.req.json<{ scope?: unknown }>().catch(() => ({}) as { scope?: unknown });
  const scope = WS_TICKET_SCOPES.find((s) => s === body.scope) as WsTicketScope | undefined;
  if (!scope) throw new HTTPException(400, { message: "unknown ticket scope" });

  const db = getDb(c.env.DB);
  const userId = c.get("user").sub;
  // Refuse to mint what the upgrade would refuse to honour: the screen is the
  // whole desktop, so only a platform superuser gets a ticket for it.
  if (scope === "screen") {
    const user = await db
      .select({ isSuperuser: schema.users.isSuperuser })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!user?.isSuperuser) return c.json({ error: "forbidden" }, 403);
  }

  const { ticket, expiresAt } = await issueWsTicket(db, userId, scope);
  return c.json({ ticket, expires_at: expiresAt });
});
