import { join } from "node:path";
import { homedir } from "node:os";
import { HerdrClient, HerdrError, type HerdrPaneInfo } from "./herdr";

// Companion daemon (diatur-32): exposes herdr panes to Atur's Worker over WS
// so a claim-comment link renders the live pane in a browser (xterm.js).
//
// Topology:  browser ⇄ Atur Worker (auth + per-pane authz + audit)
//            ⇄ cloudflared tunnel ⇄ this daemon (127.0.0.1 only) ⇄ herdr socket.
//
// Security model (the PTY-over-WS threat class is a remote shell):
//   - binds 127.0.0.1 only; never a public interface,
//   - every request carries the Worker↔daemon shared secret (the daemon holds
//     NO Atur credentials — the Worker already did auth + membership authz),
//   - browser-Origin WS connections are refused (only the Worker proxy may
//     attach; browsers always send Origin, the proxy does not),
//   - input is serialized here: exactly one keyboard owner per pane,
//     everyone else is read-only. Client state is never trusted.
//
// Output fan-out: herdr's socket API has no raw PTY streaming, so the daemon
// polls `pane.read` (ANSI snapshot) and broadcasts on text change (revisions
// proved unreliable — see herdr.ts). Input is a byte passthrough via
// `pane.send_text` (verified: control chars and CSI sequences reach the PTY
// verbatim).

export interface DaemonConfig {
  port: number;
  secret: string;
  socketPath: string;
  origins: string[];
  snapshotLines: number;
  pollMs: number;
}

export function configFromEnv(env = process.env): DaemonConfig | { error: string } {
  const secret = env.COMPANION_SECRET;
  if (!secret) {
    return { error: "COMPANION_SECRET is required (Worker↔daemon shared secret)" };
  }
  const origins = (env.COMPANION_ORIGINS ?? "https://app.diatur.com,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: Number(env.COMPANION_PORT ?? 4071),
    secret,
    socketPath: env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock"),
    origins,
    snapshotLines: Number(env.COMPANION_SNAPSHOT_LINES ?? 2000),
    pollMs: Number(env.COMPANION_POLL_MS ?? 150),
  };
}

// ── Wire protocol (daemon ⇄ viewer, JSON text frames) ───────────────────────
// daemon → viewer:
//   {t:"hello", viewerId, pane, owner}     attach ack + pane meta + keyboard owner
//   {t:"out", data}                        full ANSI snapshot (client resets + writes)
//   {t:"owner", owner}                     keyboard ownership changed (null = free)
//   {t:"claimed", ok, owner}               response to a claim request
//   {t:"meta", pane}                       title/agent status refresh
//   {t:"dead"}                             pane gone (closed or herdr unreachable)
// viewer → daemon:
//   {t:"input", data}                      raw bytes for the PTY (owner only)
//   {t:"claim"}                            request keyboard ownership
//   {t:"release"}                          give up keyboard ownership

export interface ViewerInfo {
  id: string;
  name: string;
}

/** Payload attached to upgraded viewer sockets. */
interface UpgradeData {
  paneId: string;
  pane: HerdrPaneInfo;
  viewer: ViewerInfo;
}

interface Viewer {
  info: ViewerInfo;
  send: (msg: JsonMsg) => void;
  close: (code: number, reason: string) => void;
}

type JsonMsg = Record<string, unknown>;

interface Session {
  paneId: string;
  viewers: Map<string, Viewer>; // dynamic membership: viewer id → socket
  ownerId: string | null;
  lastText: string | null;
  lastMeta: string | null;
  interval: number; // current adaptive poll interval (ms)
  ticks: number;
  failures: number;
  timer: Timer;
  polling: boolean;
}

const DEAD_AFTER_FAILURES = 4;

export interface StartedDaemon {
  port: number;
  stop: () => Promise<void>;
}

export async function startDaemon(config: DaemonConfig): Promise<StartedDaemon> {
  const herdr = new HerdrClient(config.socketPath);
  /** Sessions keyed by pane id — dynamic per-attach lifecycle. */
  const sessions = new Map<string, Session>();

  const broadcast = (s: Session, msg: JsonMsg) => {
    const frame = JSON.stringify(msg);
    for (const v of s.viewers.values()) v.send({ __frame: frame });
  };

  const dropSession = (s: Session) => {
    clearInterval(s.timer);
    sessions.delete(s.paneId);
  };

  const killViewers = (s: Session, msg: JsonMsg, code: number, reason: string) => {
    broadcast(s, msg);
    for (const v of s.viewers.values()) v.close(code, reason);
  };

  async function poll(s: Session): Promise<void> {
    if (s.polling || s.viewers.size === 0) return;
    s.polling = true;
    try {
      const { text } = await herdr.paneRead(s.paneId, { lines: config.snapshotLines });
      s.failures = 0;
      if (s.lastText === null || text !== s.lastText) {
        s.lastText = text;
        s.interval = config.pollMs; // output flowing — stay responsive
        broadcast(s, { t: "out", data: text });
      } else {
        // Quiet pane — back off (saves herdr round-trips for idle panes).
        s.interval = Math.min(Math.round(s.interval * 1.5), 1000);
      }
      // Meta (title/agent status) refreshes on a ~10th-tick cadence.
      if (++s.ticks % 10 === 0) {
        const info = await herdr.paneGet(s.paneId);
        const meta = paneMeta(info);
        const key = JSON.stringify(meta);
        if (key !== s.lastMeta) {
          s.lastMeta = key;
          broadcast(s, { t: "meta", pane: meta });
        }
      }
    } catch {
      s.failures += 1;
      if (s.failures >= DEAD_AFTER_FAILURES) {
        dropSession(s);
        killViewers(s, { t: "dead" }, 4000, "pane dead");
        return;
      }
    } finally {
      s.polling = false;
    }
    if (sessions.has(s.paneId)) {
      clearInterval(s.timer);
      s.timer = setInterval(() => void poll(s), s.interval);
    }
  }

  function startSession(paneId: string, meta: JsonMsg): Session {
    const s: Session = {
      paneId,
      viewers: new Map(),
      ownerId: null,
      lastText: null,
      lastMeta: JSON.stringify(meta),
      interval: config.pollMs,
      ticks: 0,
      failures: 0,
      timer: null as unknown as Timer,
      polling: false,
    };
    s.timer = setInterval(() => void poll(s), s.interval);
    sessions.set(paneId, s);
    return s;
  }

  function setOwner(s: Session, ownerId: string | null) {
    s.ownerId = ownerId;
    broadcast(s, { t: "owner", owner: ownerMsg(s) });
  }

  function ownerMsg(s: Session): { id: string; name: string } | null {
    if (!s.ownerId) return null;
    const v = s.viewers.get(s.ownerId);
    return v ? { id: v.info.id, name: v.info.name } : { id: s.ownerId, name: "unknown" };
  }

  const bearerOk = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    return header === `Bearer ${config.secret}`;
  };

  async function panesWithLabels(): Promise<PaneWithLabel[]> {
    const [panes, workspaces] = await Promise.all([herdr.paneList(), herdr.workspaceList()]);
    const labelById = new Map(workspaces.map((w) => [w.workspace_id, w.label ?? w.workspace_id]));
    return panes.map((p) => ({
      ...p,
      workspace_label: labelById.get(p.workspace_id) ?? p.workspace_id,
    }));
  }

  interface PaneWithLabel extends HerdrPaneInfo {
    workspace_label: string;
  }

  const server = Bun.serve<UpgradeData>({
    hostname: "127.0.0.1",
    port: config.port,
    async fetch(req, bunServer) {
      const url = new URL(req.url);

      if (url.pathname === "/health") return new Response("ok");

      if (url.pathname === "/panes") {
        if (!bearerOk(req)) return json(401, { error: "unauthorized" });
        try {
          const panes = await panesWithLabels();
          return json(200, {
            panes: panes.map((p) => ({
              pane_id: p.pane_id,
              title: p.terminal_title_stripped ?? p.terminal_title ?? p.pane_id,
              workspace_id: p.workspace_id,
              workspace_label: p.workspace_label,
              agent: p.agent ?? null,
              agent_status: p.agent_status ?? null,
            })),
          });
        } catch (err) {
          return json(502, { error: `herdr unreachable: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      if (url.pathname === "/attach") {
        if (req.headers.get("x-companion-auth") !== config.secret) {
          return json(401, { error: "unauthorized" });
        }
        const paneId = url.searchParams.get("pane");
        if (!paneId) return json(400, { error: "pane query param required" });

        let pane: HerdrPaneInfo;
        try {
          pane = await herdr.paneGet(paneId);
        } catch (err) {
          if (err instanceof HerdrError && err.code === "pane_not_found") {
            return json(404, { error: `pane not found: ${paneId}` });
          }
          return json(502, { error: `herdr unreachable: ${err instanceof Error ? err.message : String(err)}` });
        }

        // Diagnostics: a plain GET (no Upgrade) returns the authz verdict so
        // curl can verify 401/403/404 without opening a socket.
        const upgrade = req.headers.get("upgrade")?.toLowerCase();
        if (upgrade !== "websocket") {
          return json(200, { ok: true, pane: paneId });
        }

        const viewer: ViewerInfo = {
          id: req.headers.get("x-atur-user-id") || crypto.randomUUID(),
          name: req.headers.get("x-atur-user-name") || "unknown",
        };
        const ok = bunServer.upgrade(req, {
          data: { paneId, pane, viewer } satisfies UpgradeData,
          headers: { "x-companion-attached": paneId },
        });
        if (!ok) return json(500, { error: "upgrade failed" });
        return undefined; // upgraded — Bun already responded 101
      }

      return json(404, { error: "not found" });
    },
    websocket: {
      open(ws) {
        const data = ws.data as {
          paneId: string;
          pane: HerdrPaneInfo;
          viewer: ViewerInfo;
        };
        const viewer: Viewer = {
          info: data.viewer,
          send: (m) => ws.sendText(m.__frame as string),
          close: (code, reason) => ws.close(code, reason),
        };
        const s = sessions.get(data.paneId) ?? startSession(data.paneId, paneMeta(data.pane));
        s.viewers.set(data.viewer.id, viewer);
        ws.sendText(
          JSON.stringify({
            t: "hello",
            viewerId: data.viewer.id,
            pane: paneMeta(data.pane),
            owner: ownerMsg(s),
          }),
        );
        if (s.lastText !== null) {
          viewer.send({ __frame: JSON.stringify({ t: "out", data: s.lastText }) });
        }
        console.log(`[companion] attach ${data.paneId} viewer=${data.viewer.name} (${s.viewers.size} watching)`);
        void poll(s);
      },
      async message(ws, raw) {
        const data = ws.data as { paneId: string; viewer: ViewerInfo };
        const s = sessions.get(data.paneId);
        if (!s) return;
        let m: JsonMsg;
        try {
          m = JSON.parse(raw as string);
        } catch {
          return;
        }
        if (m.t === "input") {
          // Input serialization: only the keyboard owner's bytes reach the PTY.
          if (s.ownerId !== data.viewer.id || typeof m.data !== "string") return;
          try {
            await herdr.sendText(data.paneId, m.data);
          } catch {
            // herdr hiccup — viewer sees it as a stale snapshot, not a crash.
          }
          return;
        }
        if (m.t === "claim") {
          if (s.ownerId === null || s.ownerId === data.viewer.id) {
            setOwner(s, data.viewer.id);
            ws.sendText(JSON.stringify({ t: "claimed", ok: true, owner: ownerMsg(s) }));
          } else {
            ws.sendText(JSON.stringify({ t: "claimed", ok: false, owner: ownerMsg(s) }));
          }
          return;
        }
        if (m.t === "release") {
          if (s.ownerId === data.viewer.id) setOwner(s, null);
          return;
        }
      },
      close(ws) {
        const data = ws.data as { paneId: string; viewer: ViewerInfo };
        const s = sessions.get(data.paneId);
        if (!s) return;
        s.viewers.delete(data.viewer.id);
        if (s.ownerId === data.viewer.id) setOwner(s, null);
        if (s.viewers.size === 0) dropSession(s);
        console.log(`[companion] detach ${data.paneId} viewer=${data.viewer.name}`);
      },
    },
  });

  console.log(
    `[companion] listening on 127.0.0.1:${server.port} · herdr=${config.socketPath} · origins=${config.origins.join(",")}`,
  );

  return {
    port: server.port ?? config.port,
    stop: async () => {
      for (const s of sessions.values()) dropSession(s);
      herdr.close();
      await server.stop(true);
    },
  };
}

function paneMeta(pane: HerdrPaneInfo): JsonMsg {
  return {
    pane_id: pane.pane_id,
    title: pane.terminal_title_stripped ?? pane.terminal_title ?? pane.pane_id,
    workspace_id: pane.workspace_id,
    agent: pane.agent ?? null,
    agent_status: pane.agent_status ?? null,
  };
}


function json(status: number, body: JsonMsg): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


if (import.meta.main) {
  const cfg = configFromEnv();
  if ("error" in cfg) {
    console.error(`[companion] ${cfg.error}`);
    process.exit(1);
  }
  void startDaemon(cfg);
}
