/**
 * tmux backend: drives a tmux server through its CLI, so the phone app works
 * for anyone running agents (Claude Code, Codex, omp, ...) in plain tmux.
 *
 * Mapping: workspace = session, tab = window, pane = pane (`%N`, unique per
 * server). Agent state has no tmux-native source; hooks in the agent write the
 * pane user options `@atur_status` (idle|working|blocked|done), `@atur_agent`
 * and optionally `@atur_session` (see apps/bridge/hooks and docs/bridge.md).
 */
import { hostname } from "node:os";
import { basename } from "node:path";
import {
  ConflictError,
  PaneGoneError,
  type AgentStatus,
  type CreatedWorkspace,
  type PaneBackend,
  type PaneSummary,
  type ScreenRead,
  type SplitDirection,
} from "./backend";
import { SizeHolders, type GridSize, type SizeTiming } from "./sizer";

/**
 * Field separator for `-F` output. Printable ASCII on purpose: tmux escapes
 * control characters in format output (always on older releases such as the
 * 3.4 in Ubuntu 24.04, and without a UTF-8 locale on newer ones), which turned
 * the former 0x1f separator into `_` and emptied the pane list. Long and odd
 * enough never to appear in a pane path or title.
 */
export const SEP = "|:atur:|";

const LIST_FORMAT = [
  "#{pane_id}",
  "#{session_id}",
  "#{session_name}",
  "#{window_id}",
  "#{pane_current_path}",
  "#{pane_title}",
  "#{pane_current_command}",
  "#{pane_dead}",
  "#{@atur_status}",
  "#{@atur_agent}",
  "#{@atur_session}",
].join(SEP);
const LIST_FIELDS = 11;

const COMMAND_TIMEOUT_MS = 8000;
const PANE_ID = /^%\d+$/;
const WINDOW_ID = /^@\d+$/;

/** Process names that identify an agent when no hook set `@atur_agent`. */
const KNOWN_AGENTS: Record<string, true> = {
  claude: true,
  codex: true,
  omp: true,
  opencode: true,
  gemini: true,
  aider: true,
};

const STATUSES: Record<string, true> = {
  idle: true,
  working: true,
  blocked: true,
  done: true,
  unknown: true,
};

function nonEmpty(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Parse `list-panes -F LIST_FORMAT` output. Dead panes (remain-on-exit) are
 * skipped; malformed lines are ignored rather than failing the whole list.
 * `host` is the machine hostname: tmux's default pane title, which carries no
 * information.
 */
export function parsePaneList(stdout: string, host: string = hostname()): PaneSummary[] {
  const panes: PaneSummary[] = [];
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const f = line.split(SEP);
    if (f.length < LIST_FIELDS) continue;
    const [
      id,
      sessionId,
      sessionName,
      windowId,
      cwd,
      rawTitle,
      command,
      dead,
      status,
      agent,
      session,
    ] = f as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!PANE_ID.test(id) || dead === "1") continue;

    const title = nonEmpty(rawTitle);
    const statusValue = nonEmpty(status)?.toLowerCase() ?? null;
    const hookAgent = nonEmpty(agent);
    const inferred = Object.hasOwn(KNOWN_AGENTS, command) ? command : null;
    // A hook-reported status implies an agent even if nothing named it.
    const agentName = hookAgent ?? inferred ?? (statusValue ? "agent" : null);
    let agentStatus: AgentStatus | null = null;
    if (agentName) {
      agentStatus =
        statusValue && Object.hasOwn(STATUSES, statusValue)
          ? (statusValue as AgentStatus)
          : "unknown";
    }
    panes.push({
      id,
      workspaceId: sessionId,
      workspaceLabel: sessionName,
      tabId: windowId,
      cwd: nonEmpty(cwd),
      title: title === host ? null : title,
      agent: agentName,
      agentStatus,
      agentSessionPath: nonEmpty(session),
      revision: 0,
    });
  }
  return panes;
}

const NAMED_KEYS: Record<string, string> = {
  enter: "Enter",
  tab: "Tab",
  space: "Space",
  backspace: "BSpace",
  esc: "Escape",
  escape: "Escape",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  delete: "DC",
  pageup: "PageUp",
  pagedown: "PageDown",
  "shift+tab": "BTab",
};

/** herdr key name → tmux `send-keys` key name; unknown keys throw (tmux would type them as text). */
export function tmuxKeyName(key: string): string {
  const k = key.toLowerCase();
  const named = NAMED_KEYS[k];
  if (named) return named;
  const ctrl = /^ctrl\+([a-z\\\]^_])$/.exec(k);
  if (ctrl) return `C-${ctrl[1]}`;
  const alt = /^(ctrl\+)?alt\+([^\s+]|backspace)$/.exec(k);
  if (alt) return `${alt[1] ? "C-" : ""}M-${alt[2] === "backspace" ? "BSpace" : alt[2]}`;
  throw new Error(`tmux: unsupported key "${key}"`);
}

/**
 * `capture-pane -p` output (one `\n`-terminated line per grid row) → the
 * `\r\n`-joined grid the app expects. tmux ends every row with a reset when
 * styled (`-e`), so rows are self-contained.
 */
export function captureToText(stdout: string): string {
  const body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  return body.split("\n").join("\r\n");
}

/** Last `lines` rows of a `capture-pane -p` dump, oldest first. */
export function captureToRows(stdout: string, lines: number): string[] {
  const body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const rows = body.split("\n");
  return rows.length > lines ? rows.slice(rows.length - lines) : rows;
}

const GONE =
  /can't find (pane|window|session)|no server running|error connecting to|server exited|no current/i;
/** No server at all means no panes, which is a valid (empty) answer for a list. */
const NO_SERVER = /no server running|error connecting to|no sessions/i;

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface TmuxOptions {
  /** `-S` socket path when it contains `/`, otherwise a `-L` socket name; default server when unset. */
  socket?: string;
  bin?: string;
  timing?: SizeTiming;
}

export class TmuxBackend implements PaneBackend {
  readonly kind = "tmux";
  private readonly bin: string;
  private readonly socketArgs: string[];
  private readonly timing: SizeTiming | undefined;
  private bufferSeq = 0;
  private readonly lastScreen = new Map<string, { text: string; revision: number }>();
  /** One holder set per window: a phone viewer sizes the window its pane lives in. */
  private readonly windows = new Map<string, SizeHolders>();
  private readonly holderWindow = new Map<unknown, string>();
  /** Windows currently resized by us → what to put back. */
  private readonly borrowed = new Map<string, { prior: string; cols: number; rows: number }>();

  constructor(opts: TmuxOptions = {}) {
    this.bin = opts.bin ?? "tmux";
    const socket = opts.socket?.trim();
    // `-u` forces UTF-8 mode: without a UTF-8 locale (systemd and launchd
    // services often run with LANG unset) tmux mangles non-ASCII screen content.
    const target = !socket ? [] : socket.includes("/") ? ["-S", socket] : ["-L", socket];
    this.socketArgs = ["-u", ...target];
    this.timing = opts.timing;
  }

  private async run(args: string[], stdin?: string): Promise<Ran> {
    const proc = Bun.spawn([this.bin, ...this.socketArgs, ...args], {
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  private runSync(args: string[]): Ran {
    const proc = Bun.spawnSync([this.bin, ...this.socketArgs, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
  }

  private failure(command: string | undefined, stderr: string): Error {
    const message = stderr.trim() || "failed";
    return GONE.test(message)
      ? new PaneGoneError(message)
      : new Error(`tmux ${command ?? ""}: ${message}`);
  }

  /** Run a pane-scoped command; a missing pane/server surfaces as PaneGoneError. */
  private async paneRun(id: string, args: string[], stdin?: string): Promise<string> {
    if (!PANE_ID.test(id)) throw new PaneGoneError(`invalid pane id: ${id}`);
    const res = await this.run(args, stdin);
    if (res.code !== 0) throw this.failure(args[0], res.stderr);
    return res.stdout;
  }

  async listPanes(): Promise<PaneSummary[]> {
    const res = await this.run(["list-panes", "-a", "-F", LIST_FORMAT]);
    if (res.code !== 0) {
      if (NO_SERVER.test(res.stderr)) return [];
      throw this.failure("list-panes", res.stderr);
    }
    return parsePaneList(res.stdout);
  }

  pollPanes(): Promise<PaneSummary[]> {
    return this.listPanes();
  }

  async getPane(id: string): Promise<PaneSummary> {
    const out = await this.paneRun(id, ["list-panes", "-t", id, "-F", LIST_FORMAT]);
    const pane = parsePaneList(out).find((p) => p.id === id);
    if (!pane) throw new PaneGoneError(`can't find pane: ${id}`);
    return pane;
  }

  async readVisible(id: string): Promise<ScreenRead> {
    try {
      const out = await this.paneRun(id, ["capture-pane", "-e", "-p", "-t", id]);
      const text = captureToText(out);
      const last = this.lastScreen.get(id);
      if (last && last.text === text) return { text, revision: last.revision };
      const revision = (last?.revision ?? 0) + 1;
      if (this.lastScreen.size > 200) this.lastScreen.clear();
      this.lastScreen.set(id, { text, revision });
      return { text, revision };
    } catch (e) {
      if (e instanceof PaneGoneError) this.lastScreen.delete(id);
      throw e;
    }
  }

  async readHistory(id: string, lines: number): Promise<string[]> {
    const out = await this.paneRun(id, ["capture-pane", "-e", "-p", "-S", `-${lines}`, "-t", id]);
    return captureToRows(out, lines);
  }

  async geometry(id: string): Promise<GridSize | null> {
    try {
      const out = await this.paneRun(id, [
        "list-panes",
        "-t",
        id,
        "-F",
        "#{pane_id} #{pane_width} #{pane_height}",
      ]);
      for (const line of out.split("\n")) {
        const [paneId, cols, rows] = line.split(" ");
        if (paneId === id && Number(cols) > 0 && Number(rows) > 0) {
          return { cols: Number(cols), rows: Number(rows) };
        }
      }
      return null;
    } catch {
      return null; // geometry unavailable — callers keep what they have
    }
  }

  async sendText(id: string, text: string): Promise<void> {
    if (text === "") return;
    if (!/[\r\n]/.test(text) && text.length <= 2000) {
      await this.paneRun(id, ["send-keys", "-t", id, "-l", "--", text]);
      return;
    }
    // Multi-line (or huge) text goes through a tmux buffer as one bracketed
    // paste: argv has size limits and send-keys -l types each LF as Enter.
    const name = `atur-${process.pid}-${++this.bufferSeq}`;
    try {
      await this.paneRun(id, ["load-buffer", "-b", name, "-"], text);
      // -r keeps LF as LF (tmux would otherwise turn it into CR).
      await this.paneRun(id, ["paste-buffer", "-p", "-r", "-d", "-b", name, "-t", id]);
    } catch (e) {
      await this.run(["delete-buffer", "-b", name]).catch(() => undefined);
      throw e;
    }
  }

  async sendKeys(id: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const names = keys.map(tmuxKeyName);
    await this.paneRun(id, ["send-keys", "-t", id, ...names]);
  }

  async createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedWorkspace> {
    // A tmux workspace is a detached session. tmux itself turns "." and ":" in a name into "_".
    const name = opts.label ?? (basename(opts.cwd) || "shell");
    const res = await this.run([
      "new-session",
      "-d",
      "-s",
      name,
      "-c",
      opts.cwd,
      "-P",
      "-F",
      "#{pane_id}",
    ]);
    if (res.code !== 0) {
      if (/duplicate session/i.test(res.stderr)) {
        throw new ConflictError(`a workspace named "${name}" already exists`);
      }
      throw new Error(`tmux new-session: ${res.stderr.trim() || "failed"}`);
    }
    const pane = await this.getPane(res.stdout.trim());
    return {
      workspace: { id: pane.workspaceId, label: pane.workspaceLabel, cwd: pane.cwd, paneCount: 1 },
      pane,
    };
  }

  async splitPane(id: string, direction: SplitDirection, cwd?: string): Promise<PaneSummary> {
    const source = await this.getPane(id);
    const start = cwd ?? source.cwd;
    // -d keeps the active pane where it is: a phone request must not move the desktop focus.
    const out = await this.paneRun(id, [
      "split-window",
      "-d",
      "-t",
      id,
      direction === "right" ? "-h" : "-v",
      ...(start ? ["-c", start] : []),
      "-P",
      "-F",
      "#{pane_id}",
    ]);
    return this.getPane(out.trim());
  }

  async closePane(id: string): Promise<void> {
    await this.paneRun(id, ["kill-pane", "-t", id]);
    this.lastScreen.delete(id);
  }

  private async windowOf(id: string): Promise<string> {
    const out = await this.paneRun(id, ["list-panes", "-t", id, "-F", "#{pane_id} #{window_id}"]);
    for (const line of out.split("\n")) {
      const [paneId, windowId] = line.split(" ");
      if (paneId === id && windowId && WINDOW_ID.test(windowId)) return windowId;
    }
    throw new PaneGoneError(`can't find pane: ${id}`);
  }

  async resize(holder: unknown, id: string, size: GridSize): Promise<void> {
    const windowId = await this.windowOf(id);
    const previous = this.holderWindow.get(holder);
    if (previous !== undefined && previous !== windowId) this.windows.get(previous)?.drop(holder);
    this.holderWindow.set(holder, windowId);
    let holders = this.windows.get(windowId);
    if (!holders) {
      holders = new SizeHolders(
        {
          apply: (s) => void this.applyWindow(windowId, s),
          restore: () => this.restoreWindow(windowId),
        },
        this.timing,
      );
      this.windows.set(windowId, holders);
    }
    holders.request(holder, size);
  }

  release(holder: unknown): void {
    const windowId = this.holderWindow.get(holder);
    this.holderWindow.delete(holder);
    if (windowId !== undefined) this.windows.get(windowId)?.drop(holder);
  }

  stop(): void {
    for (const holders of this.windows.values()) holders.stop();
    this.windows.clear();
    this.holderWindow.clear();
  }

  private async applyWindow(windowId: string, size: GridSize): Promise<void> {
    try {
      if (!this.borrowed.has(windowId)) {
        const info = await this.run([
          "display-message",
          "-p",
          "-t",
          windowId,
          `#{window_width}${SEP}#{window_height}`,
        ]);
        if (info.code !== 0) throw this.failure("display-message", info.stderr);
        const [cols, rows] = info.stdout.trim().split(SEP);
        // Window-local value only: `show-options -w` without -g ignores inherited defaults.
        const prior = await this.run(["show-options", "-wv", "-t", windowId, "window-size"]);
        this.borrowed.set(windowId, {
          prior: prior.code === 0 ? prior.stdout.trim() : "",
          cols: Number(cols) || size.cols,
          rows: Number(rows) || size.rows,
        });
      }
      // resize-window with -x/-y switches the window to window-size manual.
      const res = await this.run([
        "resize-window",
        "-t",
        windowId,
        "-x",
        String(size.cols),
        "-y",
        String(size.rows),
      ]);
      if (res.code !== 0) throw this.failure("resize-window", res.stderr);
      console.log(`sizer: tmux window ${windowId} resized to ${size.cols}x${size.rows}`);
    } catch (e) {
      console.error(`sizer: could not resize tmux window ${windowId}:`, e);
    }
  }

  private restoreWindow(windowId: string): void {
    const original = this.borrowed.get(windowId);
    this.borrowed.delete(windowId);
    const holders = this.windows.get(windowId);
    if (holders?.isEmpty) this.windows.delete(windowId);
    if (!original) return;
    // A window that was manual before goes back to its old size, anything
    // else re-derives from the attached clients (-A). Size first: resize-window
    // (-x/-y and -A alike) leaves window-size at "manual", so the option is
    // put back last.
    const back =
      original.prior === "manual"
        ? ["-x", String(original.cols), "-y", String(original.rows)]
        : ["-A"];
    this.runSync(["resize-window", "-t", windowId, ...back]);
    if (original.prior) {
      this.runSync(["set-option", "-w", "-t", windowId, "window-size", original.prior]);
    } else {
      this.runSync(["set-option", "-w", "-t", windowId, "-u", "window-size"]);
    }
    console.log(`sizer: tmux window ${windowId} restored`);
  }
}
