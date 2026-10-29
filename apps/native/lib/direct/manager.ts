import type { CredentialStore } from "@/lib/direct/credentials";
import type { DirectPrefs } from "@/lib/direct/prefs";
import type { DirectConnection } from "@/modules/atur-direct/src/connection";
import {
  DirectError,
  type DirectCredential,
  type DirectErrorCode,
  type DirectEvent,
  type DirectSession,
  type PairingTarget,
} from "@/modules/atur-direct/src/types";

// Keeps one connection to the paired computer alive for the app: connects when the app comes
// forward, retries with a backoff while it is in front, lets go after a grace period in the
// background, and mirrors the session list so screens never wait for it. Framework-free: React
// reads it through `subscribe` / `getSnapshot` (see use-direct.ts), tests drive it with fakes.

export type DirectState =
  | "unsupported"
  | "unpaired"
  | "idle"
  | "connecting"
  | "connected"
  | "offline"
  | "needs-pairing"
  | "incompatible";

/** What the rest of the app may use of a live connection. */
export type DirectLink = Pick<
  DirectConnection,
  | "id"
  | "serverId"
  | "serverName"
  | "serverVersion"
  | "isClosed"
  | "subscribe"
  | "sessions"
  | "endSession"
  | "ping"
  | "disconnect"
  | "attach"
  | "detach"
  | "input"
  | "paste"
  | "resize"
  | "history"
  | "setEchoMode"
  | "echoStats"
>;

/** The native module's API (`AturDirect`), as far as the manager uses it. */
export interface DirectNative {
  parsePairingLink(link: string): Promise<PairingTarget>;
  pair(link: string, deviceName: string): Promise<DirectCredential>;
  connect(credential: DirectCredential): Promise<DirectLink>;
}

export interface DirectAppState {
  isActive(): boolean;
  /** Calls back with true when the app comes to the foreground, false when it leaves it. */
  subscribe(listener: (active: boolean) => void): () => void;
}

export interface DirectTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DirectManagerDeps {
  /** Null where the native module is not in the binary (web, an old binary on a new bundle). */
  native: DirectNative | null;
  credentials: CredentialStore;
  prefs: DirectPrefs;
  appState: DirectAppState;
  timers?: DirectTimers;
}

export interface DirectFailure {
  code: DirectErrorCode;
  reason: string;
}

export interface DirectSnapshot {
  state: DirectState;
  serverId: string | null;
  serverName: string | null;
  /** The live connection; non-null only while `state` is `connected`. */
  connection: DirectLink | null;
  /** Sessions of the computer as last seen; kept across drops, cleared when the computer is forgotten. */
  sessions: readonly DirectSession[];
  /** Round trip to the computer in ms, measured at connect and every 30 s. */
  rttMs: number | null;
  /** Why the last attempt failed. */
  error: DirectFailure | null;
  preferDirect: boolean;
}

/** Waits before the 1st, 2nd and 3rd retry; every further one waits `RETRY_STEADY_MS`. */
export const RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
export const RETRY_STEADY_MS = 10_000;
/** After `restarting`: the server is coming back up. */
export const RESTART_DELAY_MS = 2000;
export const BACKGROUND_GRACE_MS = 30_000;
export const PING_INTERVAL_MS = 30_000;

/** Wait before retry number `failures` (1-based). */
export function retryDelay(failures: number): number {
  return RETRY_DELAYS_MS[failures - 1] ?? RETRY_STEADY_MS;
}

const globalTimers: DirectTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const SESSION_EVENTS: Record<string, true> = { sessions: true, catalog: true, activity: true };

function asDirectError(error: unknown): DirectError {
  if (error instanceof DirectError) return error;
  return new DirectError("Unreachable", error instanceof Error ? error.message : "");
}

const noop = () => {};

export class DirectManager {
  private readonly native: DirectNative | null;
  private readonly credentials: CredentialStore;
  private readonly prefs: DirectPrefs;
  private readonly appState: DirectAppState;
  private readonly timers: DirectTimers;

  private snapshot: DirectSnapshot;
  private readonly listeners = new Set<() => void>();

  private started: Promise<void> | null = null;
  private credential: DirectCredential | null = null;
  private foreground = true;

  private conn: DirectLink | null = null;
  private unsubscribeConn: (() => void) | null = null;
  /** Invalidates the attempt in flight: every `await` in an attempt compares against it. */
  private attemptSeq = 0;
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private retryTimer: unknown;
  private graceTimer: unknown;
  private pingTimer: unknown;
  private refresh: { conn: DirectLink; again: boolean } | null = null;

  constructor(deps: DirectManagerDeps) {
    this.native = deps.native;
    this.credentials = deps.credentials;
    this.prefs = deps.prefs;
    this.appState = deps.appState;
    this.timers = deps.timers ?? globalTimers;
    this.snapshot = {
      state: deps.native ? "unpaired" : "unsupported",
      serverId: null,
      serverName: null,
      connection: null,
      sessions: [],
      rttMs: null,
      error: null,
      preferDirect: true,
    };
  }

  // --- external store -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A new object whenever something changed, the same one otherwise. */
  getSnapshot = (): DirectSnapshot => this.snapshot;

  private patch(next: Partial<DirectSnapshot>): void {
    const keys = Object.keys(next) as (keyof DirectSnapshot)[];
    if (keys.every((key) => Object.is(this.snapshot[key], next[key]))) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  // --- lifecycle ------------------------------------------------------------------------------

  /** Loads what was saved and connects when the app is in front. Idempotent. */
  start(): Promise<void> {
    this.started ??= this.init();
    return this.started;
  }

  private async init(): Promise<void> {
    if (!this.native) return;
    const [prefer, credentials] = await Promise.all([
      this.prefs.loadPreferDirect(),
      this.credentials.loadAll(),
    ]);
    this.foreground = this.appState.isActive();
    this.appState.subscribe((active) => this.onAppActive(active));
    this.credential = credentials[0] ?? null;
    this.patch({ preferDirect: prefer ?? true });
    if (this.credential) {
      this.patch({
        state: "idle",
        serverId: this.credential.serverId,
        serverName: this.credential.serverName,
      });
    }
    if (this.credential && this.foreground) await this.connect();
  }

  /** Connects now (also the "try again" of the UI); never throws, see `getSnapshot` for the outcome. */
  connect(): Promise<void> {
    if (!this.native || !this.credential || this.snapshot.state === "connected") {
      return Promise.resolve();
    }
    if (this.inFlight) return this.inFlight;
    this.timers.clearTimeout(this.retryTimer);
    const run = this.attempt(++this.attemptSeq, this.native, this.credential).finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async attempt(
    seq: number,
    native: DirectNative,
    credential: DirectCredential,
  ): Promise<void> {
    this.patch({ state: "connecting" });
    let conn: DirectLink;
    try {
      conn = await native.connect(credential);
    } catch (error) {
      if (seq === this.attemptSeq) this.failed(asDirectError(error));
      return;
    }
    if (seq !== this.attemptSeq) {
      // Forgotten, re-paired or sent to the background while connecting.
      void conn.disconnect().catch(noop);
      return;
    }
    this.adopt(conn);
  }

  private adopt(conn: DirectLink): void {
    this.conn = conn;
    this.failures = 0;
    this.unsubscribeConn = conn.subscribe((event) => this.onEvent(conn, event));
    // `createDirect` replays events that arrived while connecting; the last of them can be the end.
    if (conn.isClosed) {
      this.dropped(conn);
      return;
    }
    this.patch({
      state: "connected",
      connection: conn,
      serverId: conn.serverId,
      serverName: conn.serverName,
      rttMs: null,
      error: null,
    });
    void this.refreshSessions(conn);
    this.measure(conn);
  }

  private failed(error: DirectError): void {
    this.patch({ error: { code: error.code, reason: error.reason } });
    if (error.fatal) {
      // Retrying cannot help: the user has to pair again (or update the app / the computer).
      this.patch({
        state: error.code === "IncompatibleVersion" ? "incompatible" : "needs-pairing",
      });
      return;
    }
    this.patch({ state: "offline" });
    this.scheduleRetry();
  }

  private onEvent(conn: DirectLink, event: DirectEvent): void {
    if (conn !== this.conn) return;
    if (event.t === "disconnected") this.dropped(conn);
    else if (event.t === "restarting") this.dropped(conn, RESTART_DELAY_MS);
    else if (SESSION_EVENTS[event.t]) void this.refreshSessions(conn);
  }

  /** The connection is gone (or about to be): go offline and try again. */
  private dropped(conn: DirectLink, delay?: number): void {
    if (conn !== this.conn) return;
    this.releaseConnection();
    this.patch({ state: "offline", connection: null, rttMs: null });
    this.scheduleRetry(delay);
  }

  private scheduleRetry(delay?: number): void {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    // Only while the app is in front: coming back forward connects at once.
    if (!this.foreground) return;
    const wait = delay ?? retryDelay(++this.failures);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, wait);
  }

  /** Stops the connection and any attempt or retry; the state is left to the caller. */
  private teardown(): void {
    this.attemptSeq++;
    this.inFlight = null;
    this.failures = 0;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.releaseConnection();
  }

  private releaseConnection(): void {
    const conn = this.conn;
    this.conn = null;
    this.unsubscribeConn?.();
    this.unsubscribeConn = null;
    this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
    this.refresh = null;
    if (conn) void conn.disconnect().catch(noop);
  }

  // --- app state ------------------------------------------------------------------------------

  private onAppActive(active: boolean): void {
    this.foreground = active;
    if (active) {
      this.timers.clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
      const { state } = this.snapshot;
      if (this.credential && (state === "idle" || state === "offline")) {
        this.failures = 0;
        void this.connect();
      }
      return;
    }
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.timers.clearTimeout(this.graceTimer);
    this.graceTimer = this.timers.setTimeout(() => {
      this.graceTimer = undefined;
      this.suspend();
    }, BACKGROUND_GRACE_MS);
  }

  /** Long enough in the background: let go of the connection until the app is in front again. */
  private suspend(): void {
    const { state } = this.snapshot;
    if (state !== "connected" && state !== "connecting" && state !== "offline") return;
    this.teardown();
    this.patch({ state: "idle", connection: null, rttMs: null });
  }

  // --- sessions and latency -------------------------------------------------------------------

  private async refreshSessions(conn: DirectLink): Promise<void> {
    if (this.refresh?.conn === conn) {
      this.refresh.again = true;
      return;
    }
    const run = { conn, again: false };
    this.refresh = run;
    try {
      do {
        run.again = false;
        try {
          const sessions = await conn.sessions();
          if (conn === this.conn) this.patch({ sessions });
        } catch {
          // Keeps the list it had; the next event or reconnect refreshes it.
        }
      } while (run.again && conn === this.conn);
    } finally {
      if (this.refresh === run) this.refresh = null;
    }
  }

  private measure(conn: DirectLink): void {
    conn
      .ping()
      .then((ms) => {
        if (conn === this.conn) this.patch({ rttMs: Math.round(ms) });
      })
      .catch(noop);
    this.pingTimer = this.timers.setTimeout(() => {
      if (conn === this.conn) this.measure(conn);
    }, PING_INTERVAL_MS);
  }

  // --- user actions ---------------------------------------------------------------------------

  /** Checks a scanned or pasted link without touching the network. Throws `InvalidLink`. */
  parsePairingLink(link: string): Promise<PairingTarget> {
    if (!this.native)
      throw new DirectError("Unsupported", "Direct connection is not in this build");
    return this.native.parsePairingLink(link);
  }

  /**
   * Pairs with the computer that shows `link`, keeps the credential and connects. This phone
   * holds one computer: pairing replaces the previous one. A failed connect afterwards is not an
   * error here, it shows in the snapshot.
   */
  async pair(link: string, deviceName: string): Promise<{ serverName: string }> {
    if (!this.native)
      throw new DirectError("Unsupported", "Direct connection is not in this build");
    await this.start();
    await this.native.parsePairingLink(link);
    const credential = await this.native.pair(link, deviceName);
    await this.credentials.save(credential);
    for (const id of await this.credentials.serverIds()) {
      if (id !== credential.serverId) await this.credentials.clear(id);
    }
    this.teardown();
    this.credential = credential;
    this.patch({
      state: "idle",
      serverId: credential.serverId,
      serverName: credential.serverName,
      connection: null,
      sessions: this.snapshot.serverId === credential.serverId ? this.snapshot.sessions : [],
      rttMs: null,
      error: null,
    });
    await this.connect();
    return { serverName: credential.serverName };
  }

  /** Disconnects and deletes the stored credential. */
  async forget(): Promise<void> {
    this.teardown();
    this.credential = null;
    this.patch({
      state: this.native ? "unpaired" : "unsupported",
      serverId: null,
      serverName: null,
      connection: null,
      sessions: [],
      rttMs: null,
      error: null,
    });
    for (const id of await this.credentials.serverIds()) await this.credentials.clear(id);
  }

  async setPreferDirect(prefer: boolean): Promise<void> {
    this.patch({ preferDirect: prefer });
    await this.prefs.savePreferDirect(prefer);
  }
}
