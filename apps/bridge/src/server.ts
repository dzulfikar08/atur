/**
 * atur-bridge server: exposes the local terminal execution plane (herdr or
 * tmux) to the Atur web app and the phone app. Started by main.ts.
 *
 * Binds 127.0.0.1 only. Two ways in from Atur Cloud:
 *  - relay (customers): ATUR_CONNECT_TOKEN set, the bridge dials OUT to
 *    ATUR_URL/api/bridge/connect (connect.ts) and the cloud multiplexes pane
 *    listing, attach/observe sockets, pastes and agent events over it. No
 *    tunnel, no open port.
 *  - tunnel (owner/self-host): browser → Worker (auth + audit) → Cloudflare
 *    Tunnel → this daemon, with the shared secret BRIDGE_TOKEN presented via
 *    the `x-bridge-token` header (never a query param: tokens in URLs leak
 *    into logs). Without BRIDGE_TOKEN a random per-run token keeps the
 *    loopback server from ever being open.
 *
 * Routes:
 *   GET /health           → liveness
 *   GET /panes            → live pane list (workspace, agent, status, title)
 *   GET /workspaces       → herdr workspaces / tmux sessions with their pane counts
 *   POST /workspaces      → create a workspace {cwd,label?}; answers {workspace, pane}
 *   POST /panes/split     → split a pane {pane,direction,cwd?}; answers {pane}
 *   POST /panes/close     → close a pane {pane}; 204
 *   GET /pane-repo        → main repo path for a pane cwd (worktree-aware)
 *   GET /attach?pane=<id> → WebSocket upgrade: snapshot mirror + input
 *   GET /observe?pane=<id> → WebSocket upgrade: read-only structured transcript (+ opt-in session-log chat feed)
 *   GET /screen/status    → desktop-sharing availability, running state, viewer count
 *   GET /screen           → WebSocket upgrade: raw RFB bytes to the loopback wayvnc
 *                           (text frames are the viewer's ping/pong, answered here)
 *
 * Agent events: a poller watches the backend's panes and reports "done"/"blocked"
 * transitions, over the relay socket in relay mode, else by POST to
 * ATUR_URL/api/bridge/agent-events (x-bridge-token = BRIDGE_TOKEN; disabled
 * when BRIDGE_TOKEN is unset).
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { ServerWebSocket } from "bun";
import { AgentEventWatcher, agentEventsConfigFromEnv } from "./agent-events";
import { DEFAULT_ATUR_URL, RelayConnector } from "./connect";
import { PaneHub, type BridgeMeta } from "./hub";
import { handleManage } from "./manage";
import { ObserveHub } from "./observe";
import { imageExtension, MAX_PASTE_BYTES, PasteError, pasteDirFromEnv, savePaste } from "./pastes";
import { ScreenHub, screenConfigFromEnv, type ScreenMeta } from "./screen";
import { createBackend } from "./select-backend";
import { BRIDGE_VERSION } from "./version";

const PORT = Number(process.env.BRIDGE_PORT ?? 7601);
const CONNECT_TOKEN = process.env.ATUR_CONNECT_TOKEN ?? "";
// The loopback server is never open: without BRIDGE_TOKEN a random one is
// generated for this run (the relay connector uses it to reach the server).
const TOKEN = process.env.BRIDGE_TOKEN || randomBytes(24).toString("hex");
if (!process.env.BRIDGE_TOKEN && !CONNECT_TOKEN) {
  console.log(
    "BRIDGE_TOKEN unset: using a random token for this run (set it to call the bridge yourself)",
  );
}

function authorized(req: Request): boolean {
  // Header-only by design: accepting the secret via ?token= would put it in
  // URLs that tunnel/ingress components may log.
  return req.headers.get("x-bridge-token") === TOKEN;
}

const backend = createBackend(process.env);
console.log(`terminal backend: ${backend.kind}`);

const hub = new PaneHub(backend);
const observeHub = new ObserveHub(backend);
const screenHub = new ScreenHub(screenConfigFromEnv(process.env));
const pasteDir = pasteDirFromEnv(process.env);

type Meta = BridgeMeta | ScreenMeta;

function isScreen(ws: ServerWebSocket<Meta>): ws is ServerWebSocket<ScreenMeta> {
  return "screen" in ws.data;
}

hub.start();

Bun.serve<Meta>({
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
    if (url.pathname === "/panes/paste" && req.method === "POST") {
      // Image pasted into a pane's prompt: saved here, its path goes into the prompt.
      const image = new Uint8Array(await req.arrayBuffer());
      try {
        const saved = await savePaste(pasteDir, image);
        console.log(
          `paste: pane=${url.searchParams.get("pane") ?? "-"} ${saved.bytes} bytes → ${saved.path}`,
        );
        return Response.json(saved);
      } catch (e) {
        if (e instanceof PasteError)
          return Response.json({ error: e.message }, { status: e.status });
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/screen/clipboard" && req.method === "POST") {
      const png = new Uint8Array(await req.arrayBuffer());
      if (png.length > MAX_PASTE_BYTES) {
        return Response.json({ error: "image too large" }, { status: 413 });
      }
      if (imageExtension(png) !== "png")
        return Response.json({ error: "not a PNG" }, { status: 415 });
      try {
        await screenHub.setClipboardImage(png);
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 502 },
        );
      }
    }
    if (url.pathname === "/screen/status") {
      return Response.json(screenHub.status());
    }
    if (url.pathname === "/screen") {
      const upgraded = server.upgrade(req, { data: screenHub.newMeta() });
      if (!upgraded) {
        return Response.json({ error: "websocket upgrade failed" }, { status: 426 });
      }
      return undefined as unknown as Response; // upgraded — Bun ignores this
    }
    const managed = await handleManage(req, url, backend);
    if (managed) return managed;
    return Response.json({ error: "not found" }, { status: 404 });
  },
  websocket: {
    open(ws): void {
      if (isScreen(ws)) {
        void screenHub.open(ws);
        return;
      }
      const paneWs = ws as ServerWebSocket<BridgeMeta>;
      if (paneWs.data.observe) {
        void observeHub
          .subscribe(paneWs, paneWs.data.paneId)
          .then((ok) => {
            if (!ok) {
              paneWs.send(JSON.stringify({ type: "error", error: "unknown pane" }));
              paneWs.close(1008, "pane not found");
            }
          })
          .catch((e: unknown) => {
            console.error("observe error:", e);
            paneWs.send(
              JSON.stringify({
                type: "error",
                error: e instanceof Error ? e.message : String(e),
              }),
            );
            paneWs.close(1011, "observe error");
          });
        return;
      }
      hub.register(paneWs);
      void hub
        .handleUpgrade(paneWs)
        .then((ok) => {
          if (!ok) paneWs.close(1008, "pane not found");
        })
        .catch((e: unknown) => {
          console.error("attach error:", e);
          paneWs.close(1011, "attach error");
        });
    },
    message(ws, _message): void {
      if (isScreen(ws)) {
        screenHub.message(ws, _message);
        return;
      }
      const paneWs = ws as ServerWebSocket<BridgeMeta>;
      // Read-only by protocol: there is no input path from /observe to the
      // pane. The only client frames honoured are the transcript opt-in and
      // paging (they read the agent's session log); anything else closes.
      if (paneWs.data.observe) {
        if (
          typeof _message !== "string" ||
          !observeHub.message(paneWs, paneWs.data.paneId, _message)
        ) {
          paneWs.close(1008, "observe channel is read-only");
        }
        return;
      }
      if (typeof _message !== "string") return;
      void hub.handleMessage(paneWs, _message);
    },
    drain(ws): void {
      if (isScreen(ws)) screenHub.drain(ws);
    },
    close(ws, code, reason): void {
      if (isScreen(ws)) {
        screenHub.close(ws, code, reason);
        return;
      }
      const paneWs = ws as ServerWebSocket<BridgeMeta>;
      if (paneWs.data.observe) {
        observeHub.detach(paneWs);
        return;
      }
      hub.detach(paneWs);
    },
  },
});

console.log(`atur-bridge listening on 127.0.0.1:${PORT}`);

const connector = CONNECT_TOKEN
  ? new RelayConnector({
      baseUrl: (process.env.ATUR_URL || DEFAULT_ATUR_URL).replace(/\/+$/, ""),
      token: CONNECT_TOKEN,
      localPort: PORT,
      localToken: TOKEN,
      backend: backend.kind,
      version: BRIDGE_VERSION,
      hostname: hostname(),
    })
  : null;
connector?.start();

// Relay mode delivers events over the relay socket; otherwise the owner's
// tunnel setup POSTs them (needs BRIDGE_TOKEN, shared with the Worker).
const agentEventsConfig = connector ? null : agentEventsConfigFromEnv(process.env);
const agentEvents =
  connector || agentEventsConfig
    ? new AgentEventWatcher(agentEventsConfig, backend, { relay: connector ?? undefined })
    : null;
if (agentEvents) {
  agentEvents.start();
  console.log(
    connector
      ? "agent events → relay"
      : `agent events → ${agentEventsConfig?.url}/api/bridge/agent-events`,
  );
} else {
  console.log("agent events disabled: BRIDGE_TOKEN unset");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    connector?.stop();
    agentEvents?.stop();
    // A tmux window resized for a phone must not stay phone-sized after we exit.
    backend.stop();
    // Stop wayvnc with the daemon so a restart never leaves an orphan listener.
    void screenHub.shutdown().finally(() => process.exit(0));
  });
}
