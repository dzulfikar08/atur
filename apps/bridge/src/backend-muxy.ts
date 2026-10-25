/**
 * Muxy backend: drives a Muxy 2 server through its `muxy` CLI (JSON output),
 * so agents running in Muxy tabs show up in the web and phone app.
 *
 * Mapping: workspace = Muxy project, tab = pane = Muxy session (a decimal
 * 64-bit id). Muxy keeps tabs and splits in its UI clients; the server, and so
 * the bridge, only sees sessions. Agent state comes from Muxy's own detection
 * (`muxy activity list`). Differences from herdr/tmux, all inherent to the CLI:
 * - no resize: a session keeps the size of the Muxy window showing it;
 * - a split creates a new session in the same project (the desktop app lists
 *   it under Existing Terminals) instead of a visible split;
 * - no terminal title and no agent transcript path.
 */
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import {
  InputError,
  PaneGoneError,
  type AgentStatus,
  type CreatedWorkspace,
  type PaneBackend,
  type PaneSummary,
  type ScreenRead,
  type SplitDirection,
} from "./backend";
import type { GridSize } from "./sizer";

const COMMAND_TIMEOUT_MS = 8000;
/** `muxy session history --limit` rejects anything larger. */
const HISTORY_PAGE = 500;
/** Characters per `session send` call: argv has a size limit. */
const SEND_CHUNK = 16_384;
const SESSION_ID = /^[1-9][0-9]{0,19}$/;
const MAC_APP_BINARY = "/Applications/Muxy.app/Contents/MacOS/muxy";

/** Muxy's data directory, resolved the way Muxy itself does (stable channel). */
export function muxyDirectory(
  env: Record<string, string | undefined>,
  platform: string = process.platform,
): string {
  if (env.MUXY_DIR) return env.MUXY_DIR;
  if (platform === "linux") {
    const state = env.XDG_STATE_HOME;
    return state?.startsWith("/") ? join(state, "muxy") : join(`${env.HOME}`, ".local/state/muxy");
  }
  return join(`${env.HOME}`, "Library/Application Support/Muxy 2");
}

/** Muxy server socket; shared by the backend and auto-detection. */
export function muxySocketPath(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string {
  return join(muxyDirectory(env, platform), "server.sock");
}

/** `MUXY_BIN`, else `muxy` on PATH, else the binary inside the macOS app bundle. */
export function muxyBinary(env: Record<string, string | undefined> = process.env): string {
  if (env.MUXY_BIN) return env.MUXY_BIN;
  const onPath = Bun.which("muxy");
  if (onPath) return onPath;
  return existsSync(MAC_APP_BINARY) ? MAC_APP_BINARY : "muxy";
}

// ── Wire shapes (`--json` output of muxy 2.2) ─────────────────────────────

export type MuxyColor = "Default" | { Indexed: number } | { Rgb: [number, number, number] };

export interface MuxyStyle {
  fg: MuxyColor;
  bg: MuxyColor;
  bold: boolean;
  italic: boolean;
  /** None | Single | Double | Curly | Dotted | Dashed */
  underline: string;
  underline_color: MuxyColor;
  invisible: boolean;
  overline: boolean;
  inverse: boolean;
  strikethrough: boolean;
  faint: boolean;
}

export interface MuxyRun {
  text: string;
  style: Partial<MuxyStyle>;
}

export interface MuxyRow {
  index: number;
  runs: MuxyRun[];
}

interface MuxyHistory {
  /** Scrollback above the screen, oldest first. */
  rows: MuxyRow[];
  /** Cursor for the next older page; null at the top. */
  next: string | null;
  screen: { size: { cols: number; rows: number }; rows: MuxyRow[] };
}

export interface MuxySession {
  id: string;
  project_id: string;
  directory: string;
  status: string;
}

export interface MuxyProject {
  id: string;
  name: string;
}

export interface MuxyAgent {
  session: string;
  /** Provider name (`OhMyPi`, `Claude`, ...); other shapes for providers newer than this bridge. */
  provider: unknown;
  /** unknown | idle | working | blocked */
  state: unknown;
}

// ── Screen rendering ──────────────────────────────────────────────────────

function colorParams(color: unknown, base: number): string[] {
  if (!color || typeof color !== "object") return [];
  if ("Indexed" in color && typeof color.Indexed === "number") {
    const n = color.Indexed;
    if (base !== 58 && n < 8) return [String(base + n)];
    if (base !== 58 && n < 16) return [String(base + 60 + n - 8)];
    return [`${base + (base === 58 ? 0 : 8)};5;${n}`];
  }
  if ("Rgb" in color && Array.isArray(color.Rgb) && color.Rgb.length === 3) {
    const [r, g, b] = color.Rgb as [number, number, number];
    return [`${base + (base === 58 ? 0 : 8)};2;${r};${g};${b}`];
  }
  return [];
}

const UNDERLINE_PARAMS: Record<string, string> = {
  Single: "4",
  Double: "4:2",
  Curly: "4:3",
  Dotted: "4:4",
  Dashed: "4:5",
};

/** SGR parameters for a run's style; empty for the default style. */
export function sgrParams(style: Partial<MuxyStyle>): string[] {
  const params: string[] = [];
  if (style.bold) params.push("1");
  if (style.faint) params.push("2");
  if (style.italic) params.push("3");
  const underline = style.underline ? UNDERLINE_PARAMS[style.underline] : undefined;
  if (underline) params.push(underline);
  if (style.inverse) params.push("7");
  if (style.invisible) params.push("8");
  if (style.strikethrough) params.push("9");
  if (style.overline) params.push("53");
  params.push(...colorParams(style.fg, 30), ...colorParams(style.bg, 40));
  if (underline) params.push(...colorParams(style.underline_color, 58));
  return params;
}

/**
 * One screen row as ANSI, self-contained: it ends with a reset when styled.
 * Muxy splits rows into many runs of the same style (box drawing comes one
 * cell per run), so an SGR is only written when the style changes.
 */
export function renderRow(row: MuxyRow): string {
  let out = "";
  let current = "";
  for (const run of row.runs) {
    const sgr = sgrParams(run.style).join(";");
    if (sgr !== current) {
      out += sgr === "" ? "\x1b[0m" : `\x1b[0;${sgr}m`;
      current = sgr;
    }
    out += run.text;
  }
  return current === "" ? out : `${out}\x1b[0m`;
}

/** Rows in screen order with gaps filled, `height` rows when the size is known. */
export function renderRows(rows: readonly MuxyRow[], height?: number): string[] {
  const byIndex = new Map(rows.map((r) => [r.index, r]));
  const count = height ?? (rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.index)) + 1);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = byIndex.get(i);
    out.push(row ? renderRow(row) : "");
  }
  return out;
}

// ── Input ─────────────────────────────────────────────────────────────────

const KEY_BYTES: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  space: " ",
  backspace: "\x7f",
  esc: "\x1b",
  escape: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  delete: "\x1b[3~",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  "shift+tab": "\x1b[Z",
  "ctrl+\\": "\x1c",
};

/**
 * herdr key name → the bytes a terminal sends for it. `muxy session send-keys`
 * only knows a handful of keys, so every key goes through `session send`,
 * which writes bytes to the terminal unchanged. Unknown keys throw.
 */
export function muxyKeyBytes(key: string): string {
  const k = key.toLowerCase();
  const named = KEY_BYTES[k];
  if (named) return named;
  const ctrl = /^ctrl\+([a-z])$/.exec(k);
  if (ctrl) return String.fromCharCode((ctrl[1] as string).charCodeAt(0) - 96);
  throw new Error(`muxy: unsupported key "${key}"`);
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Literal text → `session send` payloads. `send` types bytes as-is, so a bare
 * newline would press Enter; multi-line text is wrapped in bracketed-paste
 * markers instead (every agent CLI and modern shell enables bracketed paste).
 * Paste markers inside the text are removed until none is left (a nested
 * marker reappears after one pass), so the text can neither open a paste nor
 * end one early. The text is chunked before wrapping, so a marker is never
 * split across two calls, and chunks split on code points, never inside a
 * surrogate pair.
 */
export function pastePayloads(text: string, chunk: number = SEND_CHUNK): string[] {
  let clean = text;
  for (let prev = ""; prev !== clean;) {
    prev = clean;
    clean = clean.split(PASTE_END).join("").split(PASTE_START).join("");
  }
  const points = Array.from(clean);
  const out: string[] = [];
  for (let i = 0; i < points.length; i += chunk) out.push(points.slice(i, i + chunk).join(""));
  if (out.length > 0 && /[\r\n]/.test(clean)) {
    out[0] = `${PASTE_START}${out[0]}`;
    out[out.length - 1] = `${out[out.length - 1]}${PASTE_END}`;
  }
  return out;
}

/**
 * Environment for the `muxy` CLI. A CLI call starts the Muxy server when none
 * runs, and that server hands its environment to every terminal it opens: the
 * bridge's own settings (machine token, loopback token) must not reach them,
 * nor the id of a Muxy terminal the bridge itself may have been started from.
 */
export function muxyChildEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(ATUR_|BRIDGE_|HERDR_BRIDGE_)/.test(key) || key === "MUXY_SESSION_ID") continue;
    out[key] = value;
  }
  return out;
}

// ── Pane list ─────────────────────────────────────────────────────────────

const PROVIDER_AGENTS: Record<string, string> = {
  Claude: "claude",
  Codex: "codex",
  OpenCode: "opencode",
  Cursor: "cursor",
  Copilot: "copilot",
  Droid: "droid",
  Pi: "pi",
  Grok: "grok",
  Kiro: "kiro",
  Xal: "xal",
  Antigravity: "antigravity",
  OhMyPi: "omp",
};

const STATES: Record<string, AgentStatus> = {
  unknown: "unknown",
  idle: "idle",
  working: "working",
  blocked: "blocked",
};

/** Live sessions → pane summaries, labelled by project and tagged by detected agent. */
export function summarizeSessions(
  sessions: readonly MuxySession[],
  projects: readonly MuxyProject[],
  agents: readonly MuxyAgent[],
): PaneSummary[] {
  const labels = new Map(projects.map((p) => [p.id, p.name]));
  const bySession = new Map(agents.map((a) => [a.session, a]));
  return sessions
    .filter((s) => s.status === "Live")
    .map((s) => {
      const agent = bySession.get(s.id);
      const provider = typeof agent?.provider === "string" ? agent.provider : null;
      const state = typeof agent?.state === "string" ? STATES[agent.state] : undefined;
      return {
        id: s.id,
        workspaceId: s.project_id,
        workspaceLabel: labels.get(s.project_id) ?? "",
        tabId: s.id,
        cwd: s.directory || null,
        title: null,
        agent: agent ? ((provider && PROVIDER_AGENTS[provider]) ?? "agent") : null,
        agentStatus: agent ? (state ?? "unknown") : null,
        agentSessionPath: null,
        revision: 0,
      };
    });
}

// ── Backend ───────────────────────────────────────────────────────────────

const GONE = /UnknownSession|does not exist|session ID must be/i;

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MuxyOptions {
  bin?: string;
  /** Environment the backend runs in (e.g. `MUXY_DIR` selects the server); the process env when unset. */
  env?: Record<string, string | undefined>;
}

export class MuxyBackend implements PaneBackend {
  readonly kind = "muxy";
  private readonly bin: string;
  private readonly env: Record<string, string | undefined>;
  private readonly socket: string;
  private readonly lastScreen = new Map<string, { text: string; revision: number }>();

  constructor(opts: MuxyOptions = {}) {
    const env = opts.env ?? process.env;
    this.bin = opts.bin ?? muxyBinary(env);
    this.env = muxyChildEnv(env);
    this.socket = muxySocketPath(env);
  }

  /**
   * Every CLI call except `server status/stop` starts a server when none runs.
   * Only creating a workspace may do that (like tmux `new-session`): polling
   * and pane commands must never resurrect a server the user stopped or that
   * crashed, so they first connect to its socket (a crash leaves the socket
   * file behind, so its existence proves nothing). A connect costs ~2 ms, far
   * less than the CLI spawn it guards.
   */
  private serverRunning(): Promise<boolean> {
    if (!existsSync(this.socket)) return Promise.resolve(false);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const probe = connect(this.socket);
    const done = (up: boolean) => {
      probe.destroy();
      resolve(up);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
    probe.setTimeout(1000, () => done(false));
    return promise;
  }

  private async requireServer(): Promise<void> {
    if (!(await this.serverRunning())) throw new PaneGoneError("muxy server is not running");
  }

  private async run(args: string[], timeoutMs: number = COMMAND_TIMEOUT_MS): Promise<Ran> {
    const proc = Bun.spawn([this.bin, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: this.env,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  /** A missing session surfaces as PaneGoneError; anything else is transient. */
  private failure(args: string[], stderr: string): Error {
    const message = stderr.trim().replace(/^muxy:\s*/, "") || "failed";
    if (GONE.test(message)) return new PaneGoneError(message);
    return new Error(`muxy ${args.slice(0, 2).join(" ")}: ${message}`);
  }

  /** Run a command and parse its JSON output. */
  private async json<T>(args: string[], timeoutMs?: number): Promise<T> {
    const res = await this.run(args, timeoutMs);
    if (res.code !== 0) throw this.failure(args, res.stderr);
    return JSON.parse(res.stdout) as T;
  }

  /** A session-scoped command; ids Muxy would reject are gone by definition. */
  private async session<T>(id: string, args: string[], timeoutMs?: number): Promise<T> {
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    await this.requireServer();
    return this.json<T>(["session", args[0] as string, id, ...args.slice(1)], timeoutMs);
  }

  /** Detected agents; detection failing must not hide the panes themselves. */
  private async agents(timeoutMs?: number): Promise<MuxyAgent[]> {
    try {
      const res = await this.json<{ agents?: MuxyAgent[] }>(
        ["activity", "list", "--json"],
        timeoutMs,
      );
      return res.agents ?? [];
    } catch (e) {
      console.error("muxy: activity list failed:", e);
      return [];
    }
  }

  async listPanes(): Promise<PaneSummary[]> {
    if (!(await this.serverRunning())) return [];
    const [sessions, projects, agents] = await Promise.all([
      this.json<MuxySession[]>(["session", "list", "--json"]),
      this.json<MuxyProject[]>(["project", "list", "--json"]),
      this.agents(),
    ]);
    return summarizeSessions(sessions, projects, agents);
  }

  async pollPanes(): Promise<PaneSummary[]> {
    if (!(await this.serverRunning())) return [];
    const [sessions, agents] = await Promise.all([
      this.json<MuxySession[]>(["session", "list", "--json"]),
      this.agents(),
    ]);
    return summarizeSessions(sessions, [], agents);
  }

  async getPane(id: string, timeoutMs?: number): Promise<PaneSummary> {
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    await this.requireServer();
    const [sessions, projects, agents] = await Promise.all([
      this.json<MuxySession[]>(["session", "list", "--json"], timeoutMs),
      this.json<MuxyProject[]>(["project", "list", "--json"], timeoutMs),
      this.agents(timeoutMs),
    ]);
    const pane = summarizeSessions(sessions, projects, agents).find((p) => p.id === id);
    if (!pane) throw new PaneGoneError(`session ${id} does not exist`);
    return pane;
  }

  private history(id: string, limit: number, before?: string): Promise<MuxyHistory> {
    const page = ["history", "--limit", String(limit), ...(before ? ["--before", before] : [])];
    return this.session<MuxyHistory>(id, page);
  }

  async readVisible(id: string): Promise<ScreenRead> {
    try {
      const { screen } = await this.history(id, 1);
      const text = renderRows(screen.rows, screen.size.rows).join("\r\n");
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
    const first = await this.history(id, Math.min(Math.max(lines, 1), HISTORY_PAGE));
    const screen = renderRows(first.screen.rows, first.screen.size.rows);
    let scrollback = first.rows.map(renderRow);
    let next = first.next;
    while (next && scrollback.length + screen.length < lines) {
      const page = await this.history(id, HISTORY_PAGE, next);
      if (page.rows.length === 0) break;
      scrollback = [...page.rows.map(renderRow), ...scrollback];
      next = page.next;
    }
    const rows = [...scrollback, ...screen];
    return rows.length > lines ? rows.slice(rows.length - lines) : rows;
  }

  async geometry(id: string): Promise<GridSize | null> {
    try {
      const { screen } = await this.history(id, 1);
      const { cols, rows } = screen.size;
      return cols > 0 && rows > 0 ? { cols, rows } : null;
    } catch {
      return null; // geometry unavailable — callers keep what they have
    }
  }

  private async send(id: string, payload: string): Promise<void> {
    await this.requireServer();
    // `--` keeps text starting with a dash literal.
    const args = ["session", "send", id, "--", payload];
    const res = await this.run(args);
    if (res.code !== 0) throw this.failure(args, res.stderr);
  }

  async sendText(id: string, text: string): Promise<void> {
    if (text === "") return;
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    for (const payload of pastePayloads(text)) await this.send(id, payload);
  }

  async sendKeys(id: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    await this.send(id, keys.map(muxyKeyBytes).join(""));
  }

  private async createSession(projectId: string, cwd: string): Promise<PaneSummary> {
    const created = await this.json<{ id: string }>([
      "session",
      "create",
      projectId,
      "--directory",
      cwd,
      "--json",
    ]);
    return this.getPane(created.id);
  }

  async createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedWorkspace> {
    // The CLI reads any argument starting with `--` as an option, even after --name.
    if (opts.label?.startsWith("--")) {
      throw new InputError('a Muxy project name cannot start with "--"');
    }
    // --reuse: a folder Muxy already knows opens in its existing project.
    // This is the one call that may start the server (see serverRunning).
    const project = await this.json<{ id: string; name: string }>([
      "project",
      "add",
      opts.cwd,
      "--reuse",
      ...(opts.label ? ["--name", opts.label] : []),
      "--json",
    ]);
    const pane = await this.createSession(project.id, opts.cwd);
    const sessions = await this.json<MuxySession[]>([
      "session",
      "list",
      "--project",
      project.id,
      "--json",
    ]);
    return {
      workspace: {
        id: project.id,
        label: project.name,
        cwd: pane.cwd ?? opts.cwd,
        paneCount: Math.max(sessions.filter((s) => s.status === "Live").length, 1),
      },
      pane,
    };
  }

  /**
   * Muxy has no server-side splits: the new session joins the source's project.
   * Muxy reports only the directory a session started in, so that is where the
   * new one starts unless `cwd` is given.
   */
  async splitPane(id: string, _direction: SplitDirection, cwd?: string): Promise<PaneSummary> {
    const source = await this.getPane(id);
    const start = cwd ?? source.cwd;
    if (!start) throw new Error(`muxy: no directory for a session next to ${id}`);
    return this.createSession(source.workspaceId, start);
  }

  async closePane(id: string): Promise<void> {
    await this.session(id, ["end", "--yes", "--json"]);
    this.lastScreen.delete(id);
  }

  // A session takes the size of the Muxy window showing it; the CLI cannot resize.
  resize(_holder: unknown, _id: string, _size: GridSize): Promise<void> {
    return Promise.resolve();
  }

  release(_holder: unknown): void {}

  stop(): void {}
}
