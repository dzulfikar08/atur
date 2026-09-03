import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";

// Herdr execution-plane proxy (ATUR-2). The bridge daemon (apps/bridge) runs
// on the dev box and owns the real terminal panes; these routes relay its JSON
// list and WebSocket protocol to authenticated Atur users. Frames are piped
// verbatim in both directions — the Worker never parses pane traffic.
//
// Single-tenant phase: any authenticated user may reach any bridge pane (no
// per-pane workspace ACL yet — see the issue).
export const paneRoutes = new Hono<{ Bindings: Env }>({ strict: false });

// Base URL without a trailing slash so `${base}/panes` never doubles up.
function bridgeBase(env: Env): string | null {
  const raw = env.HERDR_BRIDGE_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

// Optional shared secret; the bridge validates x-bridge-token when configured.
function bridgeHeaders(env: Env): Headers {
  const headers = new Headers();
  if (env.HERDR_BRIDGE_TOKEN) headers.set("x-bridge-token", env.HERDR_BRIDGE_TOKEN);
  return headers;
}

paneRoutes.get("/", async (c) => {
  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);

  let res: Response;
  try {
    res = await fetch(`${base}/panes`, { headers: bridgeHeaders(c.env) });
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
});

paneRoutes.get("/attach", async (c) => {
  const pane = c.req.query("pane");
  if (!pane) throw new HTTPException(400, { message: "pane is required" });
  // The relay below answers with a WebSocket; without an upgrade request
  // (e.g. a stray curl) workerd would reject the 101 as a 500 — be explicit.
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "websocket upgrade required" });
  }
  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);
  const user = c.get("user");

  const headers = bridgeHeaders(c.env);
  headers.set("Upgrade", "websocket");
  let upgrade: Response;
  try {
    upgrade = await fetch(`${base}/attach?pane=${encodeURIComponent(pane)}`, { headers });
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }

  // Bridge refused the upgrade (e.g. unknown pane) — surface its JSON reply.
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
      paneId: pane,
      attachedAt: Date.now(),
      detachedAt: null,
    });
  } catch (err) {
    console.error("pane_audit insert failed:", err);
  }

  const origin = upgrade.webSocket; // bridge side
  origin.accept();

  const pair = new WebSocketPair();
  const server = pair[1]; // browser side of the relay
  server.accept();

  // Text frames only, verbatim both directions (see protocol in the issue).
  origin.addEventListener("message", (event) => {
    if (typeof event.data === "string") server.send(event.data);
  });
  server.addEventListener("message", (event) => {
    if (typeof event.data === "string") origin.send(event.data);
  });

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
