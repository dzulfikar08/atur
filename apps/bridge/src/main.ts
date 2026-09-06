/**
 * atur-bridge: exposes the local herdr execution plane to the Atur web app.
 *
 * Binds 127.0.0.1 only, holds no secrets. The Atur Worker is the front door:
 * browser → Worker (auth + audit) → Cloudflare Tunnel → this daemon.
 * Optional shared-secret for the tunnel leg: set BRIDGE_TOKEN; clients must
 * then present it via the `x-bridge-token` header (never a query param —
 * tokens in URLs leak into logs).
 *
 * Routes:
 *   GET /health           → liveness
 *   GET /panes            → live pane list (workspace, agent, status, title)
 *   GET /pane-repo        → main repo path for a pane cwd (worktree-aware)
 *   GET /attach?pane=<id> → WebSocket upgrade: snapshot mirror + input
 *   GET /observe?pane=<id> → WebSocket upgrade: read-only structured transcript
 */
import { PaneHub, type BridgeMeta } from "./hub";
import { ObserveHub } from "./observe";

const PORT = Number(process.env.BRIDGE_PORT ?? 7601);
const TOKEN = process.env.BRIDGE_TOKEN ?? "";

function authorized(req: Request): boolean {
  // Header-only by design: accepting the secret via ?token= would put it in
  // URLs that tunnel/ingress components may log.
  if (TOKEN === "") return true;
  return req.headers.get("x-bridge-token") === TOKEN;
}

const hub = new PaneHub();
const observeHub = new ObserveHub();
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
    if (url.pathname === "/pane-repo") {
      // Main repository containing the pane's cwd (git-worktree-aware). The
      // Worker uses it to bind a pane to the Atur workspace whose
      // workspace_links.local_path matches — crew worktrees resolve to their
      // parent repo, so they inherit its binding.
      const paneId = url.searchParams.get("pane");
      if (!paneId) {
        return Response.json({ error: "missing pane param" }, { status: 400 });
      }
      try {
        const path = await hub.mainRepoPath(paneId);
        if (!path) {
          return Response.json({ error: "no repo for pane cwd" }, { status: 404 });
        }
        return Response.json({ path });
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
    if (url.pathname === "/observe") {
      const paneId = url.searchParams.get("pane");
      if (!paneId) {
        return Response.json({ error: "missing pane param" }, { status: 400 });
      }
      const upgraded = server.upgrade(req, { data: { paneId, joined: false, observe: true } });
      if (!upgraded) {
        return Response.json({ error: "websocket upgrade failed" }, { status: 426 });
      }
      return undefined as unknown as Response; // upgraded — Bun ignores this
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
  websocket: {
    open(ws): void {
      if (ws.data.observe) {
        void observeHub
          .subscribe(ws, ws.data.paneId)
          .then((ok) => {
            if (!ok) {
              ws.send(JSON.stringify({ type: "error", error: "unknown pane" }));
              ws.close(1008, "pane not found");
            }
          })
          .catch((e: unknown) => {
            console.error("observe error:", e);
            ws.send(
              JSON.stringify({
                type: "error",
                error: e instanceof Error ? e.message : String(e),
              }),
            );
            ws.close(1011, "observe error");
          });
        return;
      }
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
    message(ws, _message): void {
      // Read-only by protocol: client frames are never read or buffered —
      // there is no input path from /observe to the pane, period.
      if (ws.data.observe) {
        ws.close(1008, "observe channel is read-only");
        return;
      }
      if (typeof _message !== "string") return;
      void hub.handleMessage(ws, _message);
    },
    close(ws): void {
      if (ws.data.observe) {
        observeHub.detach(ws);
        return;
      }
      hub.detach(ws);
    },
  },
});

console.log(`atur-bridge listening on 127.0.0.1:${PORT}`);
