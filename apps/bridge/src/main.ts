/**
 * atur-bridge: exposes the local herdr execution plane to the Atur web app.
 *
 * Binds 127.0.0.1 only, holds no secrets. The Atur Worker is the front door:
 * browser → Worker (auth + audit) → Cloudflare Tunnel → this daemon.
 * Optional shared-secret for the tunnel leg: set BRIDGE_TOKEN; clients must
 * then present it via the `x-bridge-token` header or `?token=` query param.
 *
 * Routes:
 *   GET /health           → liveness
 *   GET /panes            → live pane list (workspace, agent, status, title)
 *   GET /attach?pane=<id> → WebSocket upgrade: snapshot mirror + input
 */
import { PaneHub, type BridgeMeta } from "./hub";

const PORT = Number(process.env.BRIDGE_PORT ?? 7601);
const TOKEN = process.env.BRIDGE_TOKEN ?? "";

function authorized(req: Request): boolean {
  if (TOKEN === "") return true;
  const url = new URL(req.url);
  return (
    req.headers.get("x-bridge-token") === TOKEN ||
    url.searchParams.get("token") === TOKEN
  );
}

const hub = new PaneHub();
hub.start();

Bun.serve<BridgeMeta>({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, server): Promise<Response> {
    if (!authorized(req)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/panes") {
      try {
        return Response.json(await hub.listPanes());
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 502 },
        );
      }
    }
    if (url.pathname === "/attach") {
      const paneId = url.searchParams.get("pane");
      if (!paneId) {
        return Response.json({ error: "missing pane param" }, { status: 400 });
      }
      const upgraded = server.upgrade(req, { data: { paneId, joined: false } });
      if (!upgraded) {
        return Response.json({ error: "websocket upgrade failed" }, { status: 426 });
      }
      return undefined as unknown as Response; // upgraded — Bun ignores this
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
  websocket: {
    open(ws): void {
      hub.register(ws);
      void hub
        .handleUpgrade(ws)
        .then((ok) => {
          if (!ok) ws.close(1008, "pane not found");
        })
        .catch((e: unknown) => {
          console.error("attach error:", e);
          ws.close(1011, "attach error");
        });
    },
    async message(ws, message): Promise<void> {
      if (typeof message !== "string") return;
      await hub.handleMessage(ws, message);
    },
    close(ws): void {
      hub.detach(ws);
    },
  },
});

console.log(`atur-bridge listening on 127.0.0.1:${PORT}`);
