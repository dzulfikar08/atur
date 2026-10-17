import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
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
  // audit row. waitUntil: the execution context may end once both sockets
  // close, which would cancel a plain await.
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    try {
      origin.close();
    } catch {
      /* already closed */
    }
    try {
      server.close();
    } catch {
      /* already closed */
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
  origin.addEventListener("error", detach);
  server.addEventListener("close", detach);
  server.addEventListener("error", detach);

  return new Response(null, { status: 101, webSocket: pair[0] });
});
