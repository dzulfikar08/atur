import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
import { wsTicketAuth } from "../lib/wsTicket";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import { requireSuperuser } from "./admin";
import { bridgeBase, bridgeHeaders } from "./panes";

// Desktop sharing ("Screen" mode). The bridge daemon owns a loopback-only
// wayvnc on the dev box; GET /ws relays raw RFB bytes (binary frames, never
// parsed here) between the browser's noVNC and the bridge's /screen socket.
//
// Gate: platform superuser only — the session shows and controls the whole
// desktop, so workspace membership is nowhere near enough.
//
// Audit: every session start/stop is a pane_audit row with pane_id
// SCREEN_AUDIT_PANE (attached_at / detached_at). Reusing the table avoids a
// schema migration; the reserved id can never collide with a herdr pane id.
export const SCREEN_AUDIT_PANE = "screen:desktop";

export const screenRoutes = new Hono<{ Bindings: Env }>({ strict: false });

// The native WebView redeems a one-time ticket instead of a session (see
// lib/wsTicket.ts); requireSuperuser below still runs on the resulting user.
screenRoutes.use("/ws", wsTicketAuth("screen"));
screenRoutes.use("*", requireSuperuser);

// Is the desktop-sharing side reachable and ready, and who's watching.
screenRoutes.get("/status", async (c) => {
  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);
  try {
    const res = await fetch(`${base}/screen/status`, { headers: bridgeHeaders(c.env) });
    if (!res.ok) return c.json({ error: "execution plane unreachable" }, 502);
    return c.json(await res.json());
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }
});

screenRoutes.get("/ws", async (c) => {
  // Without an upgrade request (e.g. a stray curl) workerd would reject the
  // 101 below as a 500 — be explicit.
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "websocket upgrade required" });
  }
  const user = c.get("user");

  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);
  const headers = bridgeHeaders(c.env);
  headers.set("Upgrade", "websocket");
  let upgrade: Response;
  try {
    upgrade = await fetch(`${base}/screen`, { headers });
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }

  // Bridge refused the upgrade — surface its JSON reply.
  if (upgrade.status !== 101 || !upgrade.webSocket) {
    return new Response(upgrade.body, {
      status: upgrade.status,
      headers: { "content-type": upgrade.headers.get("content-type") ?? "application/json" },
    });
  }

  // Audit before the response so the row exists even for instant disconnects.
  const db = getDb(c.env.DB);
  const auditId = uuid();
  try {
    await db.insert(schema.paneAudit).values({
      id: auditId,
      userId: user.sub,
      paneId: SCREEN_AUDIT_PANE,
      attachedAt: Date.now(),
      detachedAt: null,
    });
  } catch (err) {
    console.error("screen audit insert failed:", err);
  }
  console.log(`screen session start user=${user.sub} audit=${auditId}`);

  const origin = upgrade.webSocket; // bridge side
  origin.accept();

  const pair = new WebSocketPair();
  const server = pair[1]; // browser side of the relay
  server.accept();

  // RFB is binary; frames are piped verbatim both directions. workerd's default
  // binaryType follows the compat date (Blob on newer ones, which send() would
  // stringify), so pin ArrayBuffer on both legs.
  origin.binaryType = "arraybuffer";
  server.binaryType = "arraybuffer";
  origin.addEventListener("message", (event) => server.send(event.data));
  server.addEventListener("message", (event) => origin.send(event.data));

  // Either side closing (or erroring) tears the relay down and stamps the
  // audit row. The close code and reason travel to the other leg: the app
  // needs the bridge's 4001 (replaced) to know not to reconnect. Reserved
  // codes can't be sent: 1005 (closed without a code, i.e. an ordinary
  // disconnect) becomes 1000, 1006/1015 and errors become 1011. waitUntil:
  // the execution context may end once both sockets close, which would
  // cancel a plain await.
  let detached = false;
  const detach = (event?: Event) => {
    if (detached) return;
    detached = true;
    const closed = event && "code" in event ? (event as CloseEvent) : null;
    const code = !closed
      ? 1011
      : closed.code === 1005
        ? 1000
        : sendableCloseCode(closed.code)
          ? closed.code
          : 1011;
    const reason = closed?.reason ?? "";
    for (const leg of [origin, server]) {
      try {
        leg.close(code, reason);
      } catch {
        /* already closed */
      }
    }
    console.log(`screen session stop user=${user.sub} audit=${auditId}`);
    let execCtx: ExecutionContext;
    try {
      execCtx = c.executionCtx;
    } catch {
      return; // no Workers execution context (unit tests) — skip the stamp
    }
    execCtx.waitUntil(
      db
        .update(schema.paneAudit)
        .set({ detachedAt: Date.now() })
        .where(eq(schema.paneAudit.id, auditId)),
    );
  };
  origin.addEventListener("close", detach);
  origin.addEventListener("error", () => detach());
  server.addEventListener("close", detach);
  server.addEventListener("error", () => detach());

  return new Response(null, { status: 101, webSocket: pair[0] });
});

/** Codes a WebSocket may send in a close frame (RFC 6455 §7.4). */
function sendableCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}
