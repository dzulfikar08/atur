/**
 * Atur Terminal backend (a fork of Muxy 2; kind `atur-terminal`, alias `muxy`):
 * one persistent connection to the server's socket, speaking its native
 * protocol (muxy-wire.ts), so agents running in its tabs show up in the web and
 * phone app. A pre-rename Muxy server is found and driven the same way.
 *
 * Mapping: workspace = Muxy project, tab = pane = Muxy session (a decimal
 * 64-bit id). Muxy keeps tabs and splits in its UI clients; the server, and so
 * the bridge, only sees sessions.
 *
 * State is pushed, not polled: the server tells the connection when sessions,
 * projects or agent activity change, and the bridge keeps a cache that
 * listPanes/pollPanes/getPane answer from. A terminal read or typed into is
 * attached once and stays attached while it is in use: its visible grid, title,
 * directory and foreground process arrive as pushed frames and events.
 *
 * What a session has from Muxy that the old CLI hid: its live title and
 * working directory, the foreground process, a resizable PTY. What stays
 * different from herdr/tmux: a split is a new session in the same project
 * (the desktop app lists it under Existing Terminals).
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readlink, stat } from "node:fs/promises";
import { basename, join } from "node:path";
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
import { MuxyConnection, MuxyServerError, MuxyUnsupportedError } from "./muxy-client";
import { muxyKeyEvent, pasteChunks } from "./muxy-render";
import { MuxyTerminal, type PageSource } from "./muxy-terminal";
import {
  CONTROL,
  ErrorCode,
  Kind,
  MAX_INPUT,
  Topic,
  frameAck,
  keyFrame,
  parseScreenFrame,
  parseSessionMetadata,
  parseTerminalEvent,
  pasteFrame,
  randomUuid,
  requests,
  sessionIdText,
  type AgentActivity,
  type Cbor,
  type Message,
  type ProjectInfo,
  type SessionInfo,
  type SessionMeta,
  type U64,
} from "./muxy-wire";
import { SizeHolders, type GridSize, type SizeTiming } from "./sizer";

const SESSION_ID = /^[1-9][0-9]{0,19}$/;
const MAC_APP_BINARY = "/Applications/Atur Terminal.app/Contents/MacOS/atur-term";
/** The pre-rename Muxy build, still accepted until a machine upgrades. */
const LEGACY_MAC_APP_BINARY = "/Applications/Muxy.app/Contents/MacOS/muxy";
/** Muxy's CLI default for a session nobody has opened in a window yet. */
const NEW_SESSION_SIZE = { cols: 80, rows: 24 };
/** How long a metadata window waits for every session to report. */
const META_WINDOW_MS = 400;
/** A pane list older than this re-reads titles first (GET /panes); the poller re-reads in the background. */
const META_TTL_MS = 5_000;
const META_POLL_TTL_MS = 30_000;
/** Activity changes often; a title read at most this long ago is fresh enough. */
const MIN_EVENT_REFRESH_MS = 3_000;
/** An attached terminal nobody read or typed into for this long is detached. */
const IDLE_DETACH_MS = 20_000;
const SWEEP_MS = 5_000;
const TRANSCRIPT_RETRY_MS = 10_000;
const TRANSCRIPT_REFRESH_MS = 60_000;
const SERVER_START_TIMEOUT_MS = 20_000;
/** Longest stop() waits for a phone-sized session to be given back. */
const STOP_WAIT_MS = 3_000;
const PROJECT_COLORS = [
  "#e5484d",
  "#f76b15",
  "#f5a623",
  "#ebcb00",
  "#9bcd1e",
  "#30a46c",
  "#12a594",
  "#05a2c2",
  "#3e63dd",
  "#5b5bd6",
  "#8e4ec6",
  "#d6409f",
];

/** Atur Terminal's data directory (`ATUR_TERM_DIR`, else the platform default). */
export function aturTerminalDirectory(
  env: Record<string, string | undefined>,
  platform: string = process.platform,
): string {
  if (env.ATUR_TERM_DIR) return env.ATUR_TERM_DIR;
  if (platform === "linux") {
    const state = env.XDG_STATE_HOME;
    return state?.startsWith("/")
      ? join(state, "atur-terminal")
      : join(`${env.HOME}`, ".local/state/atur-terminal");
  }
  return join(`${env.HOME}`, "Library/Application Support/Atur Terminal");
}

/** The pre-rename Muxy data directory (`MUXY_DIR`, else the platform default). */
export function legacyMuxyDirectory(
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

/**
 * Data directories to look in, preferred first. An explicit `ATUR_TERM_DIR`
 * pins the instance: it never falls back to a Muxy server, so an isolated
 * instance cannot end up driving someone's real one.
 */
function candidateDirectories(env: Record<string, string | undefined>, platform: string): string[] {
  const current = aturTerminalDirectory(env, platform);
  if (env.ATUR_TERM_DIR) return [current];
  return [current, legacyMuxyDirectory(env, platform)];
}

/**
 * The server socket to use: the first candidate directory whose `server.sock`
 * exists (Atur Terminal before the old Muxy), else the Atur Terminal path, where
 * a server this bridge starts will create it.
 */
export function muxySocketPath(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string {
  const sockets = candidateDirectories(env, platform).map((dir) => join(dir, "server.sock"));
  return sockets.find((socket) => existsSync(socket)) ?? sockets[0]!;
}

/** True when an Atur Terminal or (legacy) Muxy server socket exists. */
export function muxySocketExists(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): boolean {
  return candidateDirectories(env, platform).some((dir) => existsSync(join(dir, "server.sock")));
}

/**
 * `ATUR_TERM_BIN`, else `atur-term` on PATH, else the binary in the macOS app
 * bundle; then the same for the old Muxy names (`MUXY_BIN`, `muxy`). Only used
 * to start a server. With nothing installed it returns `atur-term`.
 */
export function muxyBinary(env: Record<string, string | undefined> = process.env): string {
  if (env.ATUR_TERM_BIN) return env.ATUR_TERM_BIN;
  const onPath = Bun.which("atur-term");
  if (onPath) return onPath;
  if (existsSync(MAC_APP_BINARY)) return MAC_APP_BINARY;
  if (env.MUXY_BIN) return env.MUXY_BIN;
  const legacy = Bun.which("muxy");
  if (legacy) return legacy;
  return existsSync(LEGACY_MAC_APP_BINARY) ? LEGACY_MAC_APP_BINARY : "atur-term";
}

/**
 * Environment for the `atur-term` CLI. Starting the server is the one thing
 * the protocol cannot do, and that server hands its environment to every
 * terminal it opens: the bridge's own settings (machine token, loopback
 * token) must not reach them, nor the id of a terminal the bridge itself may
 * have been started from. `ATUR_TERM_*` is the terminal's own configuration
 * (`ATUR_TERM_DIR` picks the server) and passes, except the session id.
 */
export function muxyChildEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(ATUR_(?!TERM_)|BRIDGE_|HERDR_BRIDGE_)/.test(key)) continue;
    if (key === "ATUR_TERM_SESSION_ID" || key === "MUXY_SESSION_ID") continue;
    out[key] = value;
  }
  return out;
}

// ── Pane list ─────────────────────────────────────────────────────────────

/** `AgentProvider` numbers → the agent names the app knows. */
const PROVIDER_AGENTS: Record<number, string> = {
  0: "claude",
  1: "codex",
  2: "opencode",
  3: "cursor",
  4: "copilot",
  5: "droid",
  6: "pi",
  7: "grok",
  8: "kiro",
  9: "xal",
  10: "antigravity",
  11: "omp",
};

/** `AgentState` numbers. */
const STATES: Record<number, AgentStatus> = {
  0: "unknown",
  1: "idle",
  2: "working",
  3: "blocked",
  4: "done",
};

/** `ActivityKind::Completed`. */
const COMPLETED_EVENT = 1;

export interface PaneSources {
  sessions: Iterable<SessionInfo>;
  /** Projects in Muxy's order; sessions are listed project by project. */
  projects: readonly ProjectInfo[];
  agents: ReadonlyMap<string, AgentActivity>;
  meta: ReadonlyMap<string, SessionMeta>;
  transcripts: ReadonlyMap<string, string | null>;
}

/** Live sessions → pane summaries, labelled by project and tagged by detected agent. */
export function summarizePanes(sources: PaneSources): PaneSummary[] {
  const order = new Map(sources.projects.map((p, i) => [p.id, i]));
  const labels = new Map(sources.projects.map((p) => [p.id, p.name]));
  const sorted = [...sources.sessions].sort(
    (a, b) =>
      (order.get(a.project) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.project) ?? Number.MAX_SAFE_INTEGER) ||
      (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0),
  );
  return sorted.map((s) => {
    const agent = sources.agents.get(s.id);
    const meta = sources.meta.get(s.id);
    return {
      id: s.id,
      workspaceId: s.project,
      workspaceLabel: labels.get(s.project) ?? "",
      tabId: s.id,
      cwd: meta?.directory || s.directory || null,
      title: meta?.title || null,
      agent: agent ? (PROVIDER_AGENTS[agent.provider] ?? "agent") : null,
      agentStatus: agent ? (STATES[agent.state] ?? "unknown") : null,
      agentSessionPath: sources.transcripts.get(s.id) ?? null,
      revision: 0,
    };
  });
}

// ── Agent transcripts ─────────────────────────────────────────────────────

/** An omp session file: `.../sessions/<project dir>/<timestamp>_<id>.jsonl`; sub-agent files sit one level deeper. */
const OMP_TRANSCRIPT = /\/sessions\/[^/]+\/[^/]+\.jsonl$/;
const SESSION_ENV = /(?:^|\0)(?:ATUR_TERM|MUXY)_SESSION_ID=([0-9]+)(?:\0|$)/;

/**
 * omp keeps its session transcript open for appending, and a process started
 * in a terminal has that terminal's id in `ATUR_TERM_SESSION_ID` (`MUXY_SESSION_ID`
 * before the rename). Linux only:
 * it reads `/proc/<pid>/environ` and `/proc/<pid>/fd`. Muxy does not report
 * the pid of a terminal's foreground process, so this is the only link
 * between a session and its transcript.
 */
export async function findOmpTranscripts(
  sessionIds: ReadonlySet<string>,
  procRoot = "/proc",
): Promise<Map<string, string>> {
  const found = new Map<string, { path: string; mtime: number }>();
  const pids = (await readdir(procRoot).catch(() => [])).filter((name) => /^[0-9]+$/.test(name));
  const inspect = async (pid: string): Promise<void> => {
    const environ = await Bun.file(join(procRoot, pid, "environ"))
      .text()
      .catch(() => "");
    const session = SESSION_ENV.exec(environ)?.[1];
    if (!session || !sessionIds.has(session)) return;
    const fds = await readdir(join(procRoot, pid, "fd")).catch(() => []);
    for (const fd of fds) {
      const target = await readlink(join(procRoot, pid, "fd", fd)).catch(() => "");
      if (!OMP_TRANSCRIPT.test(target)) continue;
      const mtime = (await stat(target).catch(() => null))?.mtimeMs;
      if (mtime === undefined) continue;
      const current = found.get(session);
      if (!current || mtime > current.mtime) found.set(session, { path: target, mtime });
    }
  };
  for (let i = 0; i < pids.length; i += 64) await Promise.all(pids.slice(i, i + 64).map(inspect));
  return new Map([...found].map(([id, v]) => [id, v.path]));
}

// ── Backend ───────────────────────────────────────────────────────────────

export interface MuxyOptions {
  /** The `atur-term` CLI, used only to start a server when a workspace is created and none runs. */
  bin?: string;
  /** Environment the backend runs in (e.g. `ATUR_TERM_DIR` selects the server); the process env when unset. */
  env?: Record<string, string | undefined>;
  /** Phone-size timing (tests shorten it). */
  timing?: SizeTiming;
}

type RefreshName = "sessions" | "catalog" | "activity";

export class MuxyBackend implements PaneBackend {
  readonly kind = "atur-terminal";
  private readonly bin: string;
  private readonly env: Record<string, string | undefined>;
  private readonly socketEnv: Record<string, string | undefined>;
  private readonly timing: SizeTiming | undefined;

  private conn: MuxyConnection | null = null;
  private connecting: Promise<MuxyConnection | null> | null = null;
  private unsupported: { error: MuxyUnsupportedError; at: number } | null = null;
  private readonly logged = new Set<string>();
  /** Set while stop() closes the connection: that is not a lost server. */
  private stopping = false;

  private sessions = new Map<string, SessionInfo>();
  private projects: ProjectInfo[] = [];
  private agents = new Map<string, AgentActivity>();
  /** Unread `Completed` event ids by session; acknowledging them is what turns Done back to Idle. */
  private completions = new Map<string, string[]>();
  private meta = new Map<string, SessionMeta>();
  private transcripts = new Map<string, { path: string | null; at: number }>();
  private metaAt = 0;
  private metaRun: Promise<void> | null = null;
  private metaWaiter: { waiting: Set<string>; done: () => void } | null = null;
  private transcriptRun: Promise<void> | null = null;
  private readonly refresh: Record<RefreshName, { running: boolean; dirty: boolean }> = {
    sessions: { running: false, dirty: false },
    catalog: { running: false, dirty: false },
    activity: { running: false, dirty: false },
  };

  private readonly terminals = new Map<string, MuxyTerminal>();
  private readonly byChannel = new Map<number, MuxyTerminal>();
  private readonly attaching = new Map<string, Promise<MuxyTerminal>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  /** One holder set per session: a phone viewer sizes the PTY of the session it watches. */
  private readonly sizers = new Map<string, SizeHolders>();
  private readonly holderSession = new Map<unknown, string>();
  /** Sessions whose PTY we resized → the size to put back, and the phone size we set. */
  private readonly borrowed = new Map<string, { original: GridSize; applied: GridSize }>();
  /** Size restores in flight: stop() waits for them. */
  private readonly restoring = new Set<Promise<void>>();

  constructor(opts: MuxyOptions = {}) {
    const env = opts.env ?? process.env;
    this.bin = opts.bin ?? muxyBinary(env);
    const child = muxyChildEnv(env);
    // A pre-rename `muxy` binary reads MUXY_DIR, so an explicit ATUR_TERM_DIR must reach it too.
    if (child.ATUR_TERM_DIR && !child.MUXY_DIR) child.MUXY_DIR = child.ATUR_TERM_DIR;
    this.env = child;
    this.socketEnv = env;
    this.timing = opts.timing;
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private logOnce(key: string, ...args: unknown[]): void {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    console.error(...args);
  }

  /**
   * The live connection, connecting when there is none; null when no server
   * answers. Only creating a workspace may start a server (like tmux
   * `new-session`): polling and pane commands must never resurrect a server
   * the user stopped or that crashed, and a connect does not start one. A
   * server this bridge cannot talk to throws (loudly, once per retry window)
   * instead of looking like a stopped one.
   */
  private async connection(): Promise<MuxyConnection | null> {
    if (this.connecting) return this.connecting;
    if (this.conn?.isOpen) return this.conn;
    if (this.unsupported && Date.now() - this.unsupported.at < 5_000) throw this.unsupported.error;
    // Resolved per attempt: a server started later may live in the Atur Terminal or the old Muxy directory.
    if (!existsSync(muxySocketPath(this.socketEnv))) return null;
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async requireConnection(): Promise<MuxyConnection> {
    const conn = await this.connection();
    if (!conn) throw new PaneGoneError("atur-term server is not running");
    return conn;
  }

  private async connect(): Promise<MuxyConnection | null> {
    let conn: MuxyConnection;
    try {
      conn = await MuxyConnection.open(muxySocketPath(this.socketEnv), {
        onMessage: (message) => this.onMessage(message),
        onClose: (reason) => this.onClose(reason),
      });
    } catch (e) {
      if (e instanceof MuxyUnsupportedError) {
        this.unsupported = { error: e, at: Date.now() };
        this.logOnce(`unsupported:${e.message}`, `atur-term: ${e.message}`);
        throw e;
      }
      // Refused or vanished: no server is answering on that socket.
      return null;
    }
    this.conn = conn;
    this.unsupported = null;
    try {
      await Promise.all([this.refreshSessions(), this.refreshCatalog(), this.refreshActivity()]);
      await this.refreshMetadata();
      await this.resolveTranscripts();
    } catch (e) {
      conn.close();
      this.logOnce(`prime:${String(e)}`, "atur-term: reading the server's state failed:", e);
      return null;
    }
    this.logged.delete("closed");
    return conn;
  }

  private onClose(reason: Error): void {
    this.conn = null;
    this.sessions = new Map();
    this.projects = [];
    this.agents = new Map();
    this.meta = new Map();
    this.transcripts = new Map();
    this.metaAt = 0;
    this.metaWaiter?.done();
    this.terminals.clear();
    this.byChannel.clear();
    clearInterval(this.sweeper ?? undefined);
    this.sweeper = null;
    for (const refresh of Object.values(this.refresh)) refresh.dirty = false;
    if (this.stopping) return;
    this.logOnce(
      "closed",
      `atur-term: connection lost (${reason.message}); will reconnect when it answers`,
    );
  }

  // ── Pushed state ────────────────────────────────────────────────────────

  private onMessage(message: Message): void {
    const fields = message.fields as Cbor[];
    if (message.channel === CONTROL) {
      if (message.kind === Kind.Changed) {
        const topic = fields[0];
        if (topic === Topic.Sessions) this.coalesce("sessions", () => this.onSessionsChanged());
        else if (topic === Topic.Catalog) this.coalesce("catalog", () => this.refreshCatalog());
        else if (topic === Topic.Activity)
          this.coalesce("activity", () => this.onActivityChanged());
      } else if (message.kind === Kind.SessionMetadata) {
        const { session, meta } = parseSessionMetadata(fields);
        this.meta.set(session, meta);
        if (this.metaWaiter?.waiting.delete(session) && this.metaWaiter.waiting.size === 0) {
          this.metaWaiter.done();
        }
      } else if (message.kind === Kind.SessionEnded) {
        this.dropSession(sessionIdText(fields[0] as Cbor));
      }
      return;
    }
    const terminal = this.byChannel.get(message.channel);
    if (!terminal) return;
    if (message.kind === Kind.Frame) {
      const frame = parseScreenFrame(fields);
      terminal.applyFrame(frame);
      // The server sends the next frame only after this one is acknowledged.
      this.conn?.send(frameAck(terminal.channel, frame.seq));
    } else if (message.kind === Kind.Metadata) {
      const event = parseTerminalEvent(fields);
      if (!event) return;
      terminal.applyEvent(event);
      if (event.type !== "history") {
        this.meta.set(terminal.id, {
          title: terminal.title,
          directory: terminal.directory,
          process: terminal.process,
        });
      }
    }
  }

  /** Runs `fn`, once more if another invalidation arrived meanwhile. */
  private coalesce(name: RefreshName, fn: () => Promise<void>): void {
    const state = this.refresh[name];
    if (state.running) {
      state.dirty = true;
      return;
    }
    state.running = true;
    void (async () => {
      do {
        state.dirty = false;
        try {
          await fn();
        } catch (e) {
          // A connection that is gone is reported once by onClose.
          if (this.conn?.isOpen) {
            this.logOnce(
              `refresh:${name}:${String(e)}`,
              `atur-term: refreshing ${name} failed:`,
              e,
            );
          }
        }
      } while (state.dirty);
      state.running = false;
    })();
  }

  private async onSessionsChanged(): Promise<void> {
    if (await this.refreshSessions()) {
      void this.refreshMetadata();
      void this.resolveTranscripts();
    }
  }

  private async onActivityChanged(): Promise<void> {
    await this.refreshActivity();
    void this.refreshMetadata(MIN_EVENT_REFRESH_MS);
    void this.resolveTranscripts();
  }

  private async refreshSessions(): Promise<boolean> {
    const conn = this.conn;
    if (!conn) return false;
    const reply = await conn.request(requests.listSessions);
    if (reply.type !== "sessions") throw new Error("unexpected reply to ListSessions");
    const next = new Map(reply.sessions.map((s) => [s.id, s]));
    const gone = [...this.sessions.keys()].filter((id) => !next.has(id));
    const added = [...next.keys()].some((id) => !this.sessions.has(id));
    for (const id of gone) this.dropSession(id);
    this.sessions = next;
    return added;
  }

  private async refreshCatalog(): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const projects: ProjectInfo[] = [];
      let after: string | null = null;
      let revision: U64 | null = null;
      try {
        do {
          const cursor: string | null = after;
          const pinned: U64 | null = revision;
          const reply = await conn.request((id) => requests.readCatalog(id, cursor, pinned));
          if (reply.type !== "catalog") throw new Error("unexpected reply to ReadCatalog");
          projects.push(...reply.page.projects);
          after = reply.page.next;
          revision = reply.page.revision;
        } while (after !== null);
      } catch (e) {
        if (e instanceof MuxyServerError && e.code === ErrorCode.CatalogChanged) continue;
        throw e;
      }
      this.projects = projects;
      return;
    }
    throw new Error("the Atur Terminal project catalog kept changing");
  }

  private async refreshActivity(): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    const reply = await conn.request(requests.readActivity);
    if (reply.type !== "activity") throw new Error("unexpected reply to ReadActivity");
    this.agents = new Map(reply.activity.agents.map((a) => [a.session, a]));
    this.completions.clear();
    for (const e of reply.activity.events) {
      if (e.kind !== COMPLETED_EVENT || e.read) continue;
      this.completions.set(e.session, [...(this.completions.get(e.session) ?? []), e.id]);
    }
  }

  async acknowledge(id: string): Promise<void> {
    const events = this.completions.get(id);
    const conn = this.conn;
    if (!events?.length || !conn) return;
    this.completions.delete(id);
    await conn.request((rid) => requests.acknowledgeActivity(rid, events));
  }

  /**
   * Live title, directory and foreground process of every session. The server
   * pushes them only for sessions this connection references, and a reference
   * has a side effect (Muxy keeps a session a window closes alive while
   * another client references it), so the references are held for the few
   * tens of milliseconds the server needs to report, not kept. Terminals the
   * bridge has attached get the same data pushed without this.
   */
  private refreshMetadata(minGapMs = 0): Promise<void> {
    if (!this.metaRun && Date.now() - this.metaAt < minGapMs) return Promise.resolve();
    this.metaRun ??= this.metadataWindow().finally(() => {
      this.metaRun = null;
      this.metaAt = Date.now();
    });
    return this.metaRun;
  }

  private async metadataWindow(): Promise<void> {
    const conn = this.conn;
    const ids = [...this.sessions.keys()];
    if (!conn || ids.length === 0) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.metaWaiter = { waiting: new Set(ids), done: resolve };
    const timer = setTimeout(resolve, META_WINDOW_MS);
    try {
      await conn.request((id) => requests.syncSessionReferences(id, ids));
      await promise;
    } catch (e) {
      this.logOnce(`meta:${String(e)}`, "atur-term: reading session titles failed:", e);
    } finally {
      clearTimeout(timer);
      this.metaWaiter = null;
      await conn.request((id) => requests.syncSessionReferences(id, [])).catch(() => undefined);
    }
  }

  /** Finds omp transcripts of omp panes that have none yet (or whose answer is old). */
  private resolveTranscripts(): Promise<void> {
    if (process.platform !== "linux") return Promise.resolve();
    const now = Date.now();
    const wanted = new Set<string>();
    for (const [id, agent] of this.agents) {
      if (PROVIDER_AGENTS[agent.provider] !== "omp" || !this.sessions.has(id)) continue;
      const known = this.transcripts.get(id);
      const age = known ? now - known.at : Infinity;
      if (!known || age > (known.path ? TRANSCRIPT_REFRESH_MS : TRANSCRIPT_RETRY_MS))
        wanted.add(id);
    }
    if (wanted.size === 0) return this.transcriptRun ?? Promise.resolve();
    this.transcriptRun ??= findOmpTranscripts(wanted)
      .then((paths) => {
        const at = Date.now();
        for (const id of wanted) this.transcripts.set(id, { path: paths.get(id) ?? null, at });
      })
      .catch((e: unknown) =>
        this.logOnce(`transcripts:${String(e)}`, "atur-term: finding transcripts failed:", e),
      )
      .finally(() => {
        this.transcriptRun = null;
      });
    return this.transcriptRun;
  }

  private dropSession(id: string): void {
    this.sessions.delete(id);
    this.meta.delete(id);
    this.agents.delete(id);
    this.transcripts.delete(id);
    this.borrowed.delete(id);
    this.dropTerminal(id, false);
    const holders = this.sizers.get(id);
    if (holders) {
      holders.stop();
      this.sizers.delete(id);
    }
  }

  private panes(): PaneSummary[] {
    const transcripts = new Map<string, string | null>();
    for (const [id, t] of this.transcripts) transcripts.set(id, t.path);
    return summarizePanes({
      sessions: this.sessions.values(),
      projects: this.projects,
      agents: this.agents,
      meta: this.meta,
      transcripts,
    });
  }

  // ── PaneBackend: panes ──────────────────────────────────────────────────

  async listPanes(): Promise<PaneSummary[]> {
    if (!(await this.connection())) return [];
    if (Date.now() - this.metaAt > META_TTL_MS) await this.refreshMetadata();
    void this.resolveTranscripts();
    return this.panes();
  }

  async pollPanes(): Promise<PaneSummary[]> {
    if (!(await this.connection())) return [];
    if (Date.now() - this.metaAt > META_POLL_TTL_MS) void this.refreshMetadata();
    void this.resolveTranscripts();
    return this.panes();
  }

  async getPane(id: string): Promise<PaneSummary> {
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    await this.requireConnection();
    if (!this.sessions.has(id)) await this.refreshSessions();
    if (!this.sessions.has(id)) throw new PaneGoneError(`session ${id} does not exist`);
    if (!this.transcripts.has(id)) await this.resolveTranscripts();
    const pane = this.panes().find((p) => p.id === id);
    if (!pane) throw new PaneGoneError(`session ${id} does not exist`);
    return pane;
  }

  // ── Terminals ───────────────────────────────────────────────────────────

  /** A session id Muxy would reject is gone by definition. */
  private asGone(e: unknown, id: string): unknown {
    if (
      e instanceof MuxyServerError &&
      (e.code === ErrorCode.UnknownSession || e.code === ErrorCode.UnknownChannel)
    ) {
      this.dropTerminal(id, false);
      return new PaneGoneError(e.message || `session ${id} does not exist`);
    }
    return e;
  }

  /** The session's attached terminal, attaching it (never resizing it) on first use. */
  private async terminal(id: string): Promise<MuxyTerminal> {
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    const conn = await this.requireConnection();
    const known = this.terminals.get(id);
    if (known) {
      known.lastUsed = Date.now();
      return known;
    }
    if (!this.sessions.has(id)) await this.refreshSessions();
    if (!this.sessions.has(id)) throw new PaneGoneError(`session ${id} does not exist`);
    let attaching = this.attaching.get(id);
    if (!attaching) {
      attaching = this.attach(conn, id).finally(() => this.attaching.delete(id));
      this.attaching.set(id, attaching);
    }
    try {
      const terminal = await attaching;
      terminal.lastUsed = Date.now();
      return terminal;
    } catch (e) {
      throw this.asGone(e, id);
    }
  }

  private async attach(conn: MuxyConnection, id: string): Promise<MuxyTerminal> {
    let terminal: MuxyTerminal | null = null;
    // Registered while the reply is dispatched: the first frame follows it immediately.
    await conn.request(
      (rid) => requests.attachWithoutResize(rid, id),
      (reply) => {
        if (reply.type !== "attached") return;
        terminal = new MuxyTerminal(id, reply.attached);
        this.terminals.set(id, terminal);
        this.byChannel.set(terminal.channel, terminal);
      },
    );
    const attached = terminal as MuxyTerminal | null;
    if (!attached) throw new Error("unexpected reply to Attach");
    this.meta.set(id, {
      title: attached.title,
      directory: attached.directory,
      process: attached.process,
    });
    this.sweeper ??= setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref();
    return attached;
  }

  private dropTerminal(id: string, detach: boolean): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    this.terminals.delete(id);
    this.byChannel.delete(terminal.channel);
    if (detach && this.conn?.isOpen) {
      this.conn.request((rid) => requests.detach(rid, terminal.channel)).catch(() => undefined);
    }
    if (this.terminals.size === 0) {
      clearInterval(this.sweeper ?? undefined);
      this.sweeper = null;
    }
  }

  /** Detaches terminals nobody uses: an attachment keeps a closed desktop tab's session alive. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, terminal] of this.terminals) {
      if (now - terminal.lastUsed > IDLE_DETACH_MS && !this.borrowed.has(id)) {
        this.dropTerminal(id, true);
      }
    }
  }

  async readVisible(id: string): Promise<ScreenRead> {
    return (await this.terminal(id)).read();
  }

  async readHistory(id: string, lines: number): Promise<string[]> {
    const terminal = await this.terminal(id);
    const screen = terminal.screenLines();
    const need = lines - screen.length;
    const source: PageSource = async (before, maxRows) => {
      const conn = await this.requireConnection();
      const reply = await conn.request((rid) =>
        requests.historyPage(rid, terminal.channel, before, maxRows),
      );
      if (reply.type !== "history") throw new Error("unexpected reply to HistoryPage");
      return reply.page;
    };
    try {
      const scrollback = need > 0 ? await terminal.scrollback(need, source) : [];
      const rows = [...scrollback, ...screen];
      return rows.length > lines ? rows.slice(rows.length - lines) : rows;
    } catch (e) {
      throw this.asGone(e, id);
    }
  }

  async geometry(id: string): Promise<GridSize | null> {
    try {
      const { size } = await this.terminal(id);
      return size.cols > 0 && size.rows > 0 ? { cols: size.cols, rows: size.rows } : null;
    } catch {
      return null; // geometry unavailable — callers keep what they have
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────

  async sendText(id: string, text: string): Promise<void> {
    if (text === "") return;
    const terminal = await this.terminal(id);
    const conn = await this.requireConnection();
    try {
      const chunks = pasteChunks(text);
      if (/[\r\n]/.test(text)) {
        // A paste: the server adds bracketed-paste markers only when the program asked for them.
        for (const chunk of chunks)
          conn.send(pasteFrame(terminal.channel, new TextEncoder().encode(chunk)));
      } else {
        for (const chunk of chunks) {
          const bytes = new TextEncoder().encode(chunk);
          for (let i = 0; i < bytes.length; i += MAX_INPUT) {
            await conn.request((rid) =>
              requests.writeInput(rid, terminal.channel, bytes.subarray(i, i + MAX_INPUT)),
            );
          }
        }
      }
    } catch (e) {
      throw this.asGone(e, id);
    }
  }

  async sendKeys(id: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const events = keys.map(muxyKeyEvent);
    const terminal = await this.terminal(id);
    const conn = await this.requireConnection();
    for (const event of events) conn.send(keyFrame(terminal.channel, event));
  }

  // ── Workspaces ──────────────────────────────────────────────────────────

  /** The one place a server may be started: the protocol cannot, the CLI can. */
  private async startServer(): Promise<void> {
    const proc = Bun.spawn([this.bin, "server", "start", "--json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: this.env,
      signal: AbortSignal.timeout(SERVER_START_TIMEOUT_MS),
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      throw new Error(
        `atur-term server start: ${stderr.trim().replace(/^(?:atur-term|muxy):\s*/, "") || "failed"}`,
      );
    }
  }

  private async createSession(project: string, directory: string): Promise<PaneSummary> {
    const conn = await this.requireConnection();
    const reply = await conn.request((id) =>
      requests.createSession(
        id,
        project,
        randomUuid(),
        directory,
        NEW_SESSION_SIZE.cols,
        NEW_SESSION_SIZE.rows,
      ),
    );
    if (reply.type !== "created") throw new Error("unexpected reply to CreateSession");
    this.sessions.set(reply.session.id, reply.session);
    // A window already running was opened before this session existed.
    await this.refreshMetadata();
    if (!this.meta.has(reply.session.id)) await this.refreshMetadata();
    return this.getPane(reply.session.id);
  }

  async createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedWorkspace> {
    const label = opts.label?.trim();
    if (opts.label !== undefined && !label)
      throw new InputError("an Atur Terminal project name cannot be blank");
    let directory: string;
    try {
      directory = realpathSync(opts.cwd);
      if (!statSync(directory).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new InputError("project directory must exist");
    }
    let conn = await this.connection();
    if (!conn) {
      await this.startServer();
      conn = await this.connection();
      if (!conn)
        throw new Error("atur-term: the server did not come up after `atur-term server start`");
    }
    await this.refreshCatalog();
    let project = this.projects.find(
      (p) => p.directory === directory || realpathOrNull(p.directory) === directory,
    );
    if (!project) {
      const taken = new Set(this.projects.map((p) => p.color.toLowerCase()));
      const free = PROJECT_COLORS.filter((c) => !taken.has(c));
      const colors = free.length > 0 ? free : PROJECT_COLORS;
      const created = {
        id: randomUuid(),
        directory,
        name: label ?? (basename(directory) || "Home"),
        color: colors[Math.floor(Math.random() * colors.length)] as string,
      };
      try {
        await conn.request((id) => requests.createProject(id, randomUuid(), created));
      } catch (e) {
        if (e instanceof MuxyServerError && e.code === ErrorCode.BadRequest) {
          throw new InputError(e.message || "Atur Terminal refused the project");
        }
        throw e;
      }
      await this.refreshCatalog();
      project = this.projects.find((p) => p.id === created.id);
      if (!project) throw new Error("atur-term: the new project did not appear in the catalog");
    }
    const pane = await this.createSession(project.id, opts.cwd);
    const siblings = [...this.sessions.values()].filter((s) => s.project === project.id);
    return {
      workspace: {
        id: project.id,
        label: project.name,
        cwd: pane.cwd ?? opts.cwd,
        paneCount: Math.max(siblings.length, 1),
      },
      pane,
    };
  }

  /**
   * Muxy has no server-side splits: the new session joins the source's project,
   * starting in the source's live directory unless `cwd` is given.
   */
  async splitPane(id: string, _direction: SplitDirection, cwd?: string): Promise<PaneSummary> {
    const source = await this.getPane(id);
    const start = cwd ?? source.cwd;
    if (!start) throw new Error(`atur-term: no directory for a session next to ${id}`);
    return this.createSession(source.workspaceId, start);
  }

  async closePane(id: string): Promise<void> {
    if (!SESSION_ID.test(id)) throw new PaneGoneError(`invalid session id: ${id}`);
    const conn = await this.requireConnection();
    try {
      await conn.request((rid) => requests.endSession(rid, id));
    } catch (e) {
      throw this.asGone(e, id);
    }
    this.dropSession(id);
  }

  // ── Phone-sized panes ───────────────────────────────────────────────────

  /**
   * A Muxy session has one PTY shared by every window showing it, so a phone
   * viewer sizes it for everyone: the PTY is resized to the phone grid while
   * a viewer holds it, and put back to the size it had (the desktop window's)
   * once the last holder has left.
   */
  async resize(holder: unknown, id: string, size: GridSize): Promise<void> {
    await this.terminal(id);
    const previous = this.holderSession.get(holder);
    if (previous !== undefined && previous !== id) this.sizers.get(previous)?.drop(holder);
    this.holderSession.set(holder, id);
    let holders = this.sizers.get(id);
    if (!holders) {
      holders = new SizeHolders(
        {
          apply: (s) => void this.applySize(id, s),
          restore: () => void this.restoreSize(id),
        },
        this.timing,
      );
      this.sizers.set(id, holders);
    }
    holders.request(holder, size);
  }

  release(holder: unknown): void {
    const id = this.holderSession.get(holder);
    this.holderSession.delete(holder);
    if (id !== undefined) this.sizers.get(id)?.drop(holder);
  }

  private async applySize(id: string, size: GridSize): Promise<void> {
    try {
      const terminal = await this.terminal(id);
      this.borrowed.set(id, {
        original: this.borrowed.get(id)?.original ?? { ...terminal.size },
        applied: size,
      });
      await this.setSize(terminal, size);
      console.log(`sizer: terminal session ${id} resized to ${size.cols}x${size.rows}`);
    } catch (e) {
      console.error(`sizer: could not resize terminal session ${id}:`, e);
    }
  }

  private restoreSize(id: string): Promise<void> {
    const borrowed = this.borrowed.get(id);
    this.borrowed.delete(id);
    if (this.sizers.get(id)?.isEmpty) this.sizers.delete(id);
    if (!borrowed) return Promise.resolve();
    const { original, applied } = borrowed;
    // Put the size back only while the session still has the one we gave it (or the one
    // it had, when its frame has not arrived yet): a desktop window resized meanwhile wins.
    const putBack = (terminal: MuxyTerminal): Promise<boolean> => {
      const ours = sameSize(terminal.size, applied) || sameSize(terminal.size, original);
      return ours ? this.setSize(terminal, original).then(() => true) : Promise.resolve(false);
    };
    // A borrowed session stays attached (the idle sweep skips it), so the request is
    // written before this returns, which stop() relies on.
    const attached = this.terminals.get(id);
    const resized = attached ? putBack(attached) : this.terminal(id).then(putBack);
    const done = resized.then(
      (restored) =>
        console.log(
          restored
            ? `sizer: terminal session ${id} restored to ${original.cols}x${original.rows}`
            : `sizer: terminal session ${id} was resized by someone else; left as it is`,
        ),
      (e: unknown) => {
        if (!(e instanceof PaneGoneError))
          console.error(`sizer: could not restore terminal session ${id}:`, e);
      },
    );
    this.restoring.add(done);
    void done.finally(() => this.restoring.delete(done));
    return done;
  }

  private setSize(terminal: MuxyTerminal, size: GridSize): Promise<unknown> {
    const conn = this.conn;
    if (!conn?.isOpen) return Promise.reject(new PaneGoneError("atur-term server is not running"));
    return conn.request((rid) => requests.resize(rid, terminal.channel, size.cols, size.rows));
  }

  /**
   * Gives every borrowed size back and closes the connection. The server reads a
   * request only while the connection is open, so the restores are awaited (a
   * few seconds at most) before it is closed.
   */
  async stop(): Promise<void> {
    for (const holders of this.sizers.values()) holders.stop();
    this.sizers.clear();
    this.holderSession.clear();
    clearInterval(this.sweeper ?? undefined);
    this.sweeper = null;
    if (this.restoring.size > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const timer = setTimeout(resolve, STOP_WAIT_MS);
      void Promise.allSettled(this.restoring).then(() => resolve());
      await promise;
      clearTimeout(timer);
    }
    this.stopping = true;
    this.conn?.close();
    this.stopping = false;
  }
}

function sameSize(a: GridSize, b: GridSize): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
