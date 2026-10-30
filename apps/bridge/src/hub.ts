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
import { PaneGoneError, type PaneBackend, type PaneSummary } from "./backend";
import { clampGrid } from "./sizer";

export interface BridgeMeta {
  paneId: string;
  joined: boolean;
  /** /observe connection: read-only transcript stream — routed to the
   *  ObserveHub, never to the attach input path. */
  observe?: boolean;
}

type Ws = ServerWebSocket<BridgeMeta>;

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

export function listItem(pane: PaneSummary): PaneListItem {
  return {
    pane_id: pane.id,
    workspace_id: pane.workspaceId,
    workspace_label: pane.workspaceLabel,
    tab_id: pane.tabId,
    cwd: pane.cwd,
    agent: pane.agent,
    agent_status: pane.agentStatus,
    title: pane.title,
    revision: pane.revision,
  };
}

/** Live mirroring polls the visible screen. herdr protocol 20 (0.8.2) publishes no
 *  output events for plain shell panes (`pane.updated` covers agent state
 *  only, and `pane.output_matched` fires once at subscribe time) and tmux has
 *  none at all, so polling with per-row screen diffing is the mechanism.
 *  Cadence is adaptive: after a change the watcher polls fast for a burst
 *  (spinner animation), then settles back to the idle rate. */
const IDLE_POLL_MS = 400;
const FAST_POLL_MS = 100;
const ACTIVITY_BURST_MS = 1_500;

/** Fan-out backpressure cap: a client whose socket buffer exceeds this is
 *  skipped until it drains. Each client is diffed against the screen it was
 *  last sent, so a skip only delays it: the next send carries every row it missed. */
const MAX_BUFFERED_BYTES = 1_000_000;
/** Upper bound on one `history` request (rows of scrollback). */
const MAX_HISTORY_LINES = 3000;

class Watcher {
  readonly clients = new Map<Ws, BridgeMeta>();
  private lastText: string | null = null;
  private lastLines: string[] | null = null;
  private lastRevision = 0;
  /** Per client, the grid it was last sent (snapshot or diff applied). Diffing
   *  against each client's own copy keeps every viewer exact: a skipped (slow)
   *  client and one that joined between polls never apply a diff to the wrong base. */
  private readonly sent = new Map<Ws, string[]>();
  private pumping = false;
  /** Poll fast briefly after a change so spinners animate, then settle. */
  private fastUntil = 0;
  /** Last pane size told to viewers; checked about once a second while streaming. */
  private geometry: { cols: number; rows: number } | null = null;
  private geometryCheckedAt = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current keyboard owner — daemon state, never client-declared. Null =
   *  everyone read-only. Claim may steal from the current owner. */
  private owner: Ws | null = null;

  constructor(
    readonly paneId: string,
    private readonly backend: PaneBackend,
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
    this.sent.delete(ws);
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
      const pane = await this.backend.getPane(this.paneId);
      let cols = 120;
      let rows = 32;
      const rect = await this.backend.geometry(this.paneId);
      if (rect) {
        cols = rect.cols;
        rows = rect.rows;
        this.geometry = rect;
      }
      ws.send(
        JSON.stringify({
          type: "hello",
          pane: { ...(pane.raw ?? listItem(pane)), cols, rows },
          keyboard: this.hasKeyboard(ws),
        }),
      );
      // Initial snapshot goes straight to the newcomer: a broadcast pump
      // would filter them out (not yet "joined"). It becomes this client's
      // diff base; the shared poll state is left alone so the other viewers'
      // next diff still covers everything that changed since their last frame.
      const res = await this.backend.readVisible(this.paneId);
      this.sent.set(ws, res.text.split("\r\n"));
      ws.send(
        JSON.stringify({
          type: "snapshot",
          revision: res.revision,
          ansi: res.text,
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

  /**
   * A resize (another client became active, or the phone sizer attached) keeps
   * the row count when only the width changes, so diffs alone never tell the
   * viewers. Rate-limited to one layout read per second.
   */
  private async checkGeometry(): Promise<void> {
    const now = Date.now();
    if (now - this.geometryCheckedAt < 1000) return;
    this.geometryCheckedAt = now;
    const next = await this.backend.geometry(this.paneId);
    if (!next) return;
    const prev = this.geometry;
    this.geometry = next;
    if (prev && (prev.cols !== next.cols || prev.rows !== next.rows)) {
      this.broadcast(JSON.stringify({ type: "geometry", ...next }));
    }
  }

  /** Line-level diff from what a client has to the current screen. The
   *  visible-screen dump is a flat \r\n-joined grid, so equal-height frames
   *  diff per row safely; anything else (height change) is a full snapshot.
   *  "" when the client is already up to date. */
  private frameFor(prev: string[] | undefined, lines: string[], text: string): string {
    if (prev && prev.length === lines.length) {
      const rows: [number, string][] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && line !== prev[i]) rows.push([i, line]);
      }
      return rows.length > 0
        ? JSON.stringify({ type: "diff", revision: this.lastRevision, rows })
        : "";
    }
    return JSON.stringify({ type: "snapshot", revision: this.lastRevision, ansi: text });
  }

  /** Bring every joined client to the current screen; a backed-up client is
   *  retried on the next tick. Returns whether anything was sent. */
  private flush(): boolean {
    const lines = this.lastLines;
    const text = this.lastText;
    if (!lines || text === null) return false;
    let sentAny = false;
    for (const [ws, client] of this.clients) {
      if (!client.joined) continue;
      const base = this.sent.get(ws);
      if (base === lines) continue;
      if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) continue;
      const frame = this.frameFor(base, lines, text);
      if (frame !== "") {
        ws.send(frame);
        sentAny = true;
      }
      this.sent.set(ws, lines);
    }
    return sentAny;
  }

  private broadcast(payload: string): void {
    for (const [ws, client] of this.clients) {
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
      const res = await this.backend.readVisible(this.paneId);
      await this.checkGeometry();
      // herdr's pane revision has proven unreliable across pane kinds — the
      // screen text is the source of truth for change detection.
      if (res.text !== this.lastText) {
        this.lastText = res.text;
        this.lastLines = res.text.split("\r\n");
        this.lastRevision = res.revision;
      }
      // Also on an unchanged screen: catches up a client that was backed up
      // or joined since the last change.
      if (this.flush()) this.fastUntil = Date.now() + ACTIVITY_BURST_MS;
    } catch (e) {
      // Only a missing pane is terminal (agent exited, tab closed). Transient
      // backend hiccups (restart, socket timeout) must not kill the watcher and
      // flag live panes as exited — the next tick retries.
      if (!(e instanceof PaneGoneError)) {
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
  ["\x1d", ["ctrl+]"]],
  ["\x1e", ["ctrl+^"]],
  ["\x1f", ["ctrl+_"]],
];

/**
 * The key combo for the character that follows an ESC byte: Alt+letter/symbol, Alt+Ctrl+letter,
 * Alt+Backspace. Null for anything else (a bare ESC key press); "[" and "O" are left to the
 * escape-sequence parser, so an unfinished sequence stays a plain esc.
 */
function altKey(next: string | undefined): string | null {
  if (next === undefined || next === "[" || next === "O") return null;
  const code = next.charCodeAt(0);
  if (code === 0x7f) return "alt+backspace";
  if (code >= 1 && code <= 26 && next !== "\t" && next !== "\r" && next !== "\n" && next !== "\b") {
    return `ctrl+alt+${String.fromCharCode(96 + code)}`;
  }
  return code > 0x20 && code < 0x7f ? `alt+${next}` : null;
}

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
        // ESC then one key is Alt (Meta) + that key, as the app sends it for a latched Alt.
        const alt = altKey(data[i + 1]);
        if (alt) {
          segments.push({ keys: [alt] });
          i += 2;
        } else {
          segments.push({ keys: ["esc"] });
          i += 1;
        }
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

export class PaneHub {
  private watchers = new Map<string, Watcher>();
  private clients = new Map<Ws, BridgeMeta>();
  /** Per-connection FIFO: herdr opens one unix connection per RPC and tmux one
   *  process per command, so concurrent input frames would race and scramble
   *  keystroke order. */
  private inputQueues = new Map<Ws, Promise<void>>();

  constructor(private readonly backend: PaneBackend) {}

  start(): void {
    // No global state needed: watchers own their poll intervals.
  }

  stop(): void {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
    this.backend.stop();
  }

  async listPanes(): Promise<PaneListResponse> {
    return { panes: (await this.backend.listPanes()).map(listItem) };
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
      await this.backend.getPane(paneId, 4000);
    } catch (e) {
      console.error(`pane.get ${paneId} failed:`, e);
      return false;
    }
    void this.backend.acknowledge?.(paneId).catch((e: unknown) => {
      console.error(`acknowledge ${paneId} failed:`, e);
    });
    let watcher = this.watchers.get(paneId);
    if (!watcher) {
      watcher = new Watcher(paneId, this.backend, (idle) => {
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
    let msg: {
      type?: unknown;
      data?: unknown;
      text?: unknown;
      submit?: unknown;
      lines?: unknown;
      cols?: unknown;
      rows?: unknown;
    };
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
    if (msg.type === "resize") {
      // Only the keyboard owner sizes panes, so two viewers never fight over it.
      const size = clampGrid(msg.cols, msg.rows);
      if (size && this.watchers.get(client.paneId)?.hasKeyboard(ws)) {
        await this.backend.resize(ws, client.paneId, size).catch((e: unknown) => {
          console.error(`resize ${client.paneId} failed:`, e);
        });
        // The viewer may have left while the backend looked the pane up.
        if (!this.clients.has(ws)) this.backend.release(ws);
      }
      return;
    }
    if (msg.type === "history") {
      // Read-only, so any viewer may ask: the last `lines` rows of the pane
      // including host scrollback (the live stream carries the visible grid only).
      const lines = Math.min(Math.max(Math.trunc(Number(msg.lines)) || 0, 1), MAX_HISTORY_LINES);
      try {
        const rows = await this.backend.readHistory(client.paneId, lines);
        // How many trailing rows are the visible grid, read right after: herdr
        // trims trailing blank rows from both reads, so the grid height would
        // cut real scrollback. The app drops exactly these from the end.
        const visible = await this.backend
          .readVisible(client.paneId)
          .then((v) => Math.min(v.text.split("\r\n").length, rows.length))
          .catch(() => undefined);
        ws.send(JSON.stringify({ type: "history", rows, visible }));
      } catch (e) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `history: ${e instanceof Error ? e.message : String(e)}`,
          }),
        );
      }
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
            if (segment.text !== undefined) {
              await this.backend.sendText(client.paneId, segment.text);
            } else if (segment.keys) {
              await this.backend.sendKeys(client.paneId, segment.keys);
            }
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
    this.backend.release(ws);
  }

  /** Main repository for a pane's cwd, resolving through git worktrees so a
   *  crew worktree (outside its bound checkout) still maps to the workspace
   *  bound to the main repo. Cached per cwd — git never moves a repo. */
  private repoCache = new Map<string, string | null>();

  async mainRepoPath(paneId: string): Promise<string | null> {
    const { cwd } = await this.backend.getPane(paneId);
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
