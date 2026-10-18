/**
 * PaneHub: shared pane watchers + browser WebSocket fan-out.
 *
 * Protocol (JSON text frames, browser ⇄ bridge):
 *   bridge → client: {type:"hello", pane:{...info, cols, rows}}
 *                    {type:"snapshot", revision, ansi}
 *                    {type:"pong"} | {type:"error", message} | {type:"exit", reason}
 *   client → bridge: {type:"input", data:"..."}   (xterm.js onData verbatim)
 *                    {type:"paste", text, submit?}   (literal text; newlines stay newlines; submit = then Enter)
 *                    {type:"ping"}
 */
import type { ServerWebSocket } from "bun";
import { HerdrError, rpc } from "./herdr";

export interface BridgeMeta {
  paneId: string;
  joined: boolean;
  /** /observe connection: read-only transcript stream — routed to the
   *  ObserveHub, never to the attach input path. */
  observe?: boolean;
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
 *  with per-row screen diffing is the mechanism. Cadence is adaptive: after
 *  a change the watcher polls fast for a burst (spinner animation), then
 *  settles back to the idle rate. */
const IDLE_POLL_MS = 400;
const FAST_POLL_MS = 100;
const ACTIVITY_BURST_MS = 1_500;

/** Fan-out backpressure cap: a client whose socket buffer exceeds this is
 *  skipped until it drains (full-state snapshots make skips lossless). */
const MAX_BUFFERED_BYTES = 1_000_000;

class Watcher {
  readonly clients = new Map<Ws, BridgeMeta>();
  private lastText: string | null = null;
  private lastLines: string[] | null = null;
  private lastRevision = 0;
  private pumping = false;
  /** Poll fast briefly after a change so spinners animate, then settle. */
  private fastUntil = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current keyboard owner — daemon state, never client-declared. Null =
   *  everyone read-only. Claim may steal from the current owner. */
  private owner: Ws | null = null;

  constructor(
    readonly paneId: string,
    private readonly onIdle: (watcher: Watcher) => void,
  ) {
    this.scheduleNext();
  }

  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /** Stop background work when the last viewer leaves. */
  dispose(): void {
    clearTimeout(this.pollTimer ?? undefined);
    this.pollTimer = null;
  }

  /** Grant the keyboard to this viewer (first claim, or steal from the
   *  current owner). Idempotent for the owner. */
  claim(ws: Ws): void {
    if (this.owner === ws) return;
    this.owner = ws;
    this.broadcastKeyboard();
  }

  hasKeyboard(ws: Ws): boolean {
    return this.owner === ws;
  }

  /** Per-client keyboard state so every viewer's UI reflects who can type. */
  private broadcastKeyboard(): void {
    for (const [ws] of this.clients) {
      ws.send(JSON.stringify({ type: "keyboard", you: ws === this.owner }));
    }
  }

  detach(ws: Ws): void {
    this.clients.delete(ws);
    // A departing owner frees the keyboard; remaining viewers are told.
    if (this.owner === ws) {
      this.owner = null;
      this.broadcastKeyboard();
    }
    if (this.isEmpty) this.onIdle(this);
  }

  private scheduleNext(): void {
    if (this.pollTimer) return;
    const ms = Date.now() < this.fastUntil ? FAST_POLL_MS : IDLE_POLL_MS;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pump();
      this.scheduleNext();
    }, ms);
  }

  join(ws: Ws): BridgeMeta {
    const meta: BridgeMeta = { paneId: this.paneId, joined: false };
    this.clients.set(ws, meta);
    return meta;
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
        const { layout } = await rpc<{ layout: { panes: PaneRect[] } }>("pane.layout", {
          pane_id: this.paneId,
        });
        const rect = layout.panes.find((p) => p.pane_id === this.paneId)?.rect;
        if (rect) {
          cols = rect.width;
          rows = rect.height;
        }
      } catch {
        // geometry unavailable — keep defaults
      }
      ws.send(
        JSON.stringify({
          type: "hello",
          pane: { ...pane, cols, rows },
          keyboard: this.hasKeyboard(ws),
        }),
      );
      // Initial snapshot goes straight to the newcomer: a broadcast pump
      // would filter them out (not yet "joined") and skip if the screen
      // content hasn't changed since the last watcher read.
      const res = await this.readScreen();
      this.lastText = res.read.text;
      this.lastLines = res.read.text.split("\r\n");
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

  /** Line-level diff against the previous screen. The visible-screen dump is
   *  a flat \r\n-joined grid, so equal-height frames diff per row safely;
   *  anything else (first frame, height change, reconnect) falls back to a
   *  full snapshot. */
  private buildFrame(text: string, revision: number): string {
    const lines = text.split("\r\n");
    const prev = this.lastLines;
    if (prev && prev.length === lines.length) {
      const rows: [number, string][] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && line !== prev[i]) rows.push([i, line]);
      }
      if (rows.length > 0) {
        return JSON.stringify({ type: "diff", revision, rows });
      }
      // Identical lines with differing raw text (normalization noise) —
      // nothing to repaint.
      return "";
    }
    return JSON.stringify({ type: "snapshot", revision, ansi: text });
  }

  private broadcast(payload: string): void {
    for (const [ws, client] of this.clients) {
      // Snapshots are full-state, so skipping a slow client is lossless —
      // its next change supersedes anything we would send now.
      if (!client.joined) continue;
      if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) continue;
      ws.send(payload);
    }
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
      const frame = this.buildFrame(res.read.text, res.read.revision);
      this.lastText = res.read.text;
      this.lastLines = res.read.text.split("\r\n");
      this.lastRevision = res.read.revision;
      if (frame !== "") {
        this.broadcast(frame);
        this.fastUntil = Date.now() + ACTIVITY_BURST_MS;
      }
    } catch (e) {
      // Only a missing pane is terminal (agent exited, tab closed). Transient
      // herdr hiccups (restart, socket timeout) must not kill the watcher and
      // flag live panes as exited — the next tick retries.
      const gone = e instanceof HerdrError && /not_found|no such/i.test(e.code + " " + e.message);
      if (!gone) {
        console.error(`pane.read ${this.paneId} failed (transient, will retry):`, e);
        return;
      }
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

const SIMPLE_KEYS: [string, string[]][] = [
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

/** CSI/SS3 final byte → herdr key combo. Params (modifiers, repeats) are
 *  intentionally degraded: a remote viewer gets plain keys. */
const CSI_FINAL_KEYS: Record<string, string[]> = {
  A: ["up"],
  B: ["down"],
  C: ["right"],
  D: ["left"],
  H: ["home"],
  F: ["end"],
  Z: ["shift+tab"],
};

const TILDE_PARAM_KEYS: Record<string, string[]> = {
  "3": ["delete"],
  "5": ["pageup"],
  "6": ["pagedown"],
};

/** Map a parsed CSI/SS3 body (e.g. "[A", "[3~", "OB") to keys, or null when
 *  the sequence is unrecognized — it is then dropped, never leaked as text. */
function escapeSequenceKeys(body: string): string[] | null {
  if (body.startsWith("[")) {
    const final = body[body.length - 1];
    if (final === undefined) return null;
    if (final === "~") {
      const firstParam = body.slice(1, -1).split(";")[0] ?? "";
      return TILDE_PARAM_KEYS[firstParam] ?? null;
    }
    return CSI_FINAL_KEYS[final] ?? null;
  }
  if (body.startsWith("O")) {
    return CSI_FINAL_KEYS[body[1] ?? ""] ?? null;
  }
  return null;
}

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
  while (i < data.length) {
    let simple: { keys: string[]; len: number } | null = null;
    for (const [seq, keys] of SIMPLE_KEYS) {
      if (data.startsWith(seq, i)) {
        simple = { keys, len: seq.length };
        break;
      }
    }
    if (simple) {
      flush();
      segments.push({ keys: simple.keys });
      i += simple.len;
      continue;
    }
    if (data[i] === "\x1b") {
      flush();
      // Consume one full CSI/SS3 sequence; only a lone ESC maps to the esc
      // key. Bracketed-paste markers (\x1b[200~ / \x1b[201~) fall out here —
      // ESC itself is already verified below; match the sequence body.
      const m = /^(\[[0-9;:?]*[A-Za-z~]|O[A-Za-z])/.exec(data.slice(i + 1, i + 64));
      if (m) {
        const keys = escapeSequenceKeys(m[1] ?? "");
        if (keys) segments.push({ keys });
        i += m[0].length + 1; // matched body + the ESC byte itself
      } else {
        segments.push({ keys: ["esc"] });
        i += 1;
      }
      continue;
    }
    const code = data.charCodeAt(i);
    if (code >= 1 && code <= 26) {
      // Remaining Ctrl+A..Z (the common ones are in SIMPLE_KEYS above): herdr
      // takes the same lowercase combo strings.
      flush();
      segments.push({ keys: [`ctrl+${String.fromCharCode(96 + code)}`] });
      i += 1;
      continue;
    }
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

/**
 * Composer send: `text` is one literal paste (newlines stay newlines instead of
 * becoming Enter presses), optionally followed by Enter to submit it.
 */
export function pasteSegments(text: string, submit: boolean): InputSegment[] {
  const segments: InputSegment[] = text === "" ? [] : [{ text }];
  if (submit) segments.push({ keys: ["enter"] });
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
        if (idle.isEmpty) {
          idle.dispose();
          this.watchers.delete(idle.paneId);
        }
      });
      this.watchers.set(paneId, watcher);
    }
    // The hub map and the watcher share ONE meta object so `joined` flips
    // everywhere at once. Awaiting greet keeps the upgrade contract honest:
    // when this resolves, hello + first snapshot are already in flight —
    // input/ping frames during greet are still safe (register ran first).
    const meta = watcher.join(ws);
    this.clients.set(ws, meta);
    await watcher.greet(ws);
    meta.joined = true;
    return true;
  }

  async handleMessage(ws: Ws, raw: string): Promise<void> {
    let msg: { type?: unknown; data?: unknown; text?: unknown; submit?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    const client = this.clients.get(ws);
    if (!client) return;
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "claim") {
      this.watchers.get(client.paneId)?.claim(ws);
      return;
    }
    const segments =
      msg.type === "input" && typeof msg.data === "string"
        ? translateInput(msg.data)
        : msg.type === "paste" && typeof msg.text === "string"
          ? pasteSegments(msg.text, msg.submit === true)
          : null;
    if (segments) {
      const watcher = this.watchers.get(client.paneId);
      if (!watcher?.hasKeyboard(ws)) {
        // Enforced here, not in the UI: a second viewer is read-only even if
        // its client pretends otherwise.
        ws.send(
          JSON.stringify({
            type: "error",
            message: "read-only: take the keyboard to send input",
          }),
        );
        return;
      }
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
      this.inputQueues.set(
        ws,
        next.then(() => undefined),
      );
      await next;
    }
  }

  detach(ws: Ws): void {
    const client = this.clients.get(ws);
    this.clients.delete(ws);
    this.inputQueues.delete(ws);
    if (client) this.watchers.get(client.paneId)?.detach(ws);
  }

  /** Main repository for a pane's cwd, resolving through git worktrees so a
   *  crew worktree (outside its bound checkout) still maps to the workspace
   *  bound to the main repo. Cached per cwd — git never moves a repo. */
  private repoCache = new Map<string, string | null>();

  async mainRepoPath(paneId: string): Promise<string | null> {
    const { pane } = await rpc<{ pane: { cwd?: string | null } }>("pane.get", {
      pane_id: paneId,
    });
    const cwd = pane.cwd;
    if (!cwd) return null;
    const cached = this.repoCache.get(cwd);
    if (cached !== undefined) return cached;
    const proc = Bun.spawnSync([
      "git",
      "-C",
      cwd,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    let repo: string | null = null;
    if (proc.exitCode === 0) {
      // <main-repo>/.git (worktree or checkout alike); bare repos keep their
      // own path — not a topology this deployment produces.
      repo = proc.stdout
        .toString()
        .trim()
        .replace(/\/\.git$/, "");
    }
    if (this.repoCache.size > 500) this.repoCache.clear();
    this.repoCache.set(cwd, repo);
    return repo;
  }
}
