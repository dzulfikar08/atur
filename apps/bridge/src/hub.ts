/**
 * PaneHub: shared pane watchers + browser WebSocket fan-out.
 *
 * Protocol (JSON text frames, browser ⇄ bridge):
 *   bridge → client: {type:"hello", pane:{...info, cols, rows}}
 *                    {type:"snapshot", revision, ansi}
 *                    {type:"pong"} | {type:"error", message} | {type:"exit", reason}
 *   client → bridge: {type:"input", data:"..."}   (xterm.js onData verbatim)
 *                    {type:"ping"}
 */
import type { ServerWebSocket } from "bun";
import { rpc } from "./herdr";

export interface BridgeMeta {
  paneId: string;
  joined: boolean;
}

type Ws = ServerWebSocket<BridgeMeta>;

interface PaneInfo {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  cwd?: string | null;
  agent?: string | null;
  agent_status?: string | null;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  revision: number;
}

interface PaneRect {
  pane_id: string;
  rect: { width: number; height: number };
}

interface PaneReadPayload {
  read: { pane_id: string; text: string; revision: number; truncated: boolean };
}

/** Live mirroring polls `pane.read`. Protocol 20 (herdr 0.8.2) publishes no
 *  output events for plain shell panes — `pane.updated` covers agent state
 *  only, and `pane.output_matched` fires once at subscribe time — so polling
 *  with screen-text change detection is the mechanism. */
const WATCHDOG_POLL_MS = 400;

class Watcher {
  readonly clients = new Map<Ws, BridgeMeta>();
  private lastText: string | null = null;
  private lastRevision = 0;
  private pumping = false;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    readonly paneId: string,
    private readonly onIdle: (watcher: Watcher) => void,
  ) {
    this.watchdog = setInterval(() => void this.pump(), WATCHDOG_POLL_MS);
  }

  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /** Stop background work when the last viewer leaves. */
  dispose(): void {
    clearInterval(this.watchdog);
  }

  join(ws: Ws): BridgeMeta {
    const meta: BridgeMeta = { paneId: this.paneId, joined: false };
    this.clients.set(ws, meta);
    return meta;
  }

  detach(ws: Ws): void {
    this.clients.delete(ws);
    if (this.isEmpty) this.onIdle(this);
  }

  /** Initial handshake for one freshly-attached client: pane meta + grid size,
   *  then an immediate snapshot. */
  async greet(ws: Ws): Promise<void> {
    try {
      const { pane } = await rpc<{ pane: PaneInfo }>("pane.get", {
        pane_id: this.paneId,
      });
      let cols = 120;
      let rows = 32;
      try {
        const { layout } = await rpc<{ layout: { panes: PaneRect[] } }>(
          "pane.layout",
          { pane_id: this.paneId },
        );
        const rect = layout.panes.find((p) => p.pane_id === this.paneId)?.rect;
        if (rect) {
          cols = rect.width;
          rows = rect.height;
        }
      } catch {
        // geometry unavailable — keep defaults
      }
      ws.send(JSON.stringify({ type: "hello", pane: { ...pane, cols, rows } }));
      // Initial snapshot goes straight to the newcomer: a broadcast pump
      // would filter them out (not yet "joined") and skip if the screen
      // content hasn't changed since the last watcher read.
      const res = await this.readScreen();
      this.lastText = res.read.text;
      this.lastRevision = res.read.revision;
      ws.send(
        JSON.stringify({
          type: "snapshot",
          revision: res.read.revision,
          ansi: res.read.text,
        }),
      );
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      ws.close(1011, "greet failed");
    }
  }

  private readScreen(): Promise<PaneReadPayload> {
    return rpc<PaneReadPayload>("pane.read", {
      pane_id: this.paneId,
      source: "visible",
      format: "ansi",
      strip_ansi: false,
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    if (this.isEmpty) return;
    this.pumping = true;
    try {
      const res = await this.readScreen();
      // herdr's pane revision has proven unreliable across pane kinds — the
      // screen text is the source of truth for change detection.
      if (res.read.text === this.lastText) return;
      this.lastText = res.read.text;
      this.lastRevision = res.read.revision;
      const payload = JSON.stringify({
        type: "snapshot",
        revision: res.read.revision,
        ansi: res.read.text,
      });
      for (const [ws, client] of this.clients) {
        if (client.joined) ws.send(payload);
      }
    } catch (e) {
      // Pane died (agent exited, tab closed): tell clients and stop.
      const reason = e instanceof Error ? e.message : String(e);
      this.dispose();
      for (const [ws] of this.clients) {
        ws.send(JSON.stringify({ type: "exit", reason }));
        ws.close(1001, "pane gone");
      }
      this.clients.clear();
      this.onIdle(this);
    } finally {
      this.pumping = false;
    }
  }
}

/**
 * xterm.js `onData` chunks mix printable text with terminal escape sequences.
 * herdr's `pane.send_input.text` is literal paste — it never presses keys — so
 * control sequences must be translated to herdr key-combo strings
 * (lowercase: "enter", "esc", "ctrl+c", …). Unrecognized sequences are dropped
 * (herdr cannot synthesize arbitrary bytes).
 */
interface InputSegment {
  text?: string;
  keys?: string[];
}

const CTRL_SEQUENCES: [string, string[]][] = [
  ["\x1b[A", ["up"]],
  ["\x1b[B", ["down"]],
  ["\x1b[C", ["right"]],
  ["\x1b[D", ["left"]],
  ["\x1b[H", ["home"]],
  ["\x1b[F", ["end"]],
  ["\x1b[3~", ["delete"]],
  ["\x1b[5~", ["pageup"]],
  ["\x1b[6~", ["pagedown"]],
  ["\x1b", ["esc"]],
  ["\r", ["enter"]],
  ["\n", ["enter"]],
  ["\t", ["tab"]],
  ["\x7f", ["backspace"]],
  ["\x08", ["backspace"]],
  ["\x03", ["ctrl+c"]],
  ["\x04", ["ctrl+d"]],
  ["\x1a", ["ctrl+z"]],
  ["\x1c", ["ctrl+\\"]],
];

export function translateInput(data: string): InputSegment[] {
  const segments: InputSegment[] = [];
  let textRun = "";
  const flush = () => {
    if (textRun !== "") {
      segments.push({ text: textRun });
      textRun = "";
    }
  };
  let i = 0;
  outer: while (i < data.length) {
    for (const [seq, keys] of CTRL_SEQUENCES) {
      if (data.startsWith(seq, i)) {
        flush();
        segments.push({ keys });
        i += seq.length;
        continue outer;
      }
    }
    const code = data.charCodeAt(i);
    if (code < 32 || code === 127) {
      // Unknown control byte — drop rather than corrupt the input line.
      flush();
      i += 1;
      continue;
    }
    textRun += data[i];
    i += 1;
  }
  flush();
  return segments;
}

export interface PaneListItem {
  pane_id: string;
  workspace_id: string;
  workspace_label: string;
  tab_id: string;
  cwd: string | null;
  agent: string | null;
  agent_status: string | null;
  title: string | null;
  revision: number;
}

export interface PaneListResponse {
  panes: PaneListItem[];
}

export class PaneHub {
  private watchers = new Map<string, Watcher>();
  private clients = new Map<Ws, BridgeMeta>();
  /** Per-connection FIFO: every herdr RPC opens its own unix connection, so
   *  concurrent input frames would race and scramble keystroke order. */
  private inputQueues = new Map<Ws, Promise<void>>();

  start(): void {
    // No global state needed: watchers own their poll intervals.
  }

  stop(): void {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
  }

  async listPanes(): Promise<PaneListResponse> {
    const { workspaces } = await rpc<{
      workspaces: { workspace_id: string; label: string }[];
    }>("workspace.list");
    const perWorkspace = await Promise.all(
      workspaces.map(async (workspace): Promise<PaneListItem[]> => {
        const res = await rpc<{ panes: PaneInfo[] }>("pane.list", {
          workspace: workspace.workspace_id,
        });
        return res.panes.map((pane): PaneListItem => {
          const title = pane.terminal_title_stripped ?? pane.terminal_title ?? null;
          return {
            pane_id: pane.pane_id,
            workspace_id: pane.workspace_id,
            workspace_label: workspace.label,
            tab_id: pane.tab_id,
            cwd: pane.cwd ?? null,
            agent: pane.agent ?? null,
            agent_status: pane.agent_status ?? null,
            title,
            revision: pane.revision,
          };
        });
      }),
    );
    return { panes: perWorkspace.flat() };
  }

  /** Synchronous registration in the websocket open handler, before any
   *  await — client input/ping arriving during greet must not be dropped. */
  register(ws: Ws): void {
    this.clients.set(ws, { paneId: ws.data.paneId, joined: false });
    this.inputQueues.set(ws, Promise.resolve());
  }

  async handleUpgrade(ws: Ws): Promise<boolean> {
    const paneId = ws.data.paneId;
    try {
      await rpc("pane.get", { pane_id: paneId }, 4000);
    } catch (e) {
      console.error(`pane.get ${paneId} failed:`, e);
      return false;
    }
    let watcher = this.watchers.get(paneId);
    if (!watcher) {
      watcher = new Watcher(paneId, (idle) => {
        if (idle.isEmpty) this.watchers.delete(idle.paneId);
      });
      this.watchers.set(paneId, watcher);
    }
    // The hub map and the watcher share ONE meta object so `joined` flips
    // everywhere at once.
    const meta = watcher.join(ws);
    this.clients.set(ws, meta);
    void watcher.greet(ws).then(() => {
      meta.joined = true;
    });
    return true;
  }

  async handleMessage(ws: Ws, raw: string): Promise<void> {
    let msg: { type?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw) as { type?: unknown; data?: unknown };
    } catch {
      return;
    }
    const client = this.clients.get(ws);
    if (!client) return;
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      const segments = translateInput(msg.data);
      const prev = this.inputQueues.get(ws) ?? Promise.resolve();
      const next = prev
        .then(async () => {
          for (const segment of segments) {
            await rpc("pane.send_input", { pane_id: client.paneId, ...segment });
          }
        })
        .catch((e: unknown) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        });
      // Swallow rejections here: the catch above already reported them, and
      // the queue must keep draining for subsequent frames.
      this.inputQueues.set(ws, next.then(() => undefined));
      await next;
    }
  }

  detach(ws: Ws): void {
    const client = this.clients.get(ws);
    this.clients.delete(ws);
    this.inputQueues.delete(ws);
    if (client) this.watchers.get(client.paneId)?.detach(ws);
  }
}
