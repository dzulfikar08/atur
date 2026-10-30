import type { CredentialStore } from "@/lib/direct/credentials";
import { DEFAULT_ECHO_MODE, DEFAULT_TRANSPORT, type DirectPrefs } from "@/lib/direct/prefs";
import type { DirectConnection } from "@/modules/atur-direct/src/connection";
import {
  DirectError,
  type DirectCredential,
  type DirectErrorCode,
  type DirectEvent,
  type DirectSession,
  type EchoMode,
  type PairingTarget,
  type TransportPreference,
} from "@/modules/atur-direct/src/types";

// Keeps one connection to the paired computer alive for the app: connects when the app comes
// forward, retries with a backoff while it is in front, lets go after a grace period in the
// background, and mirrors the session list so screens never wait for it. It also keeps the route
// good: the core races the computer's addresses on every connect, and `reroute` races them again
// in the background (network change, app back in front, a slow route) and moves to the new
// connection when it is clearly faster. Framework-free: React reads it through `subscribe` /
// `getSnapshot` (see use-direct.ts), tests drive it with fakes.

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
  | "transport"
  | "udpNote"
  | "route"
  | "addresses"
  | "isClosed"
  | "subscribe"
  | "sessions"
  | "activity"
  | "acknowledgeActivity"
  | "endSession"
  | "ping"
  | "disconnect"
  | "attach"
  | "detach"
  | "input"
  | "paste"
  | "pasteImage"
  | "resize"
  | "history"
  | "setEchoMode"
  | "echoStats"
>;

/** The native module's API (`AturDirect`), as far as the manager uses it. */
export interface DirectNative {
  parsePairingLink(link: string): Promise<PairingTarget>;
  pair(link: string, deviceName: string): Promise<DirectCredential>;
  connect(
    credential: DirectCredential,
    options?: { transport?: TransportPreference },
  ): Promise<DirectLink>;
}

export interface DirectAppState {
  isActive(): boolean;
  /** Calls back with true when the app comes to the foreground, false when it leaves it. */
  subscribe(listener: (active: boolean) => void): () => void;
}

export interface DirectNetwork {
  /** Calls back when the phone's network changed (Wi-Fi, cellular, a hotspot, a VPN); returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
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
  /** Null (or left out) where network changes cannot be observed. */
  network?: DirectNetwork | null;
  timers?: DirectTimers;
}

export interface DirectFailure {
  code: DirectErrorCode;
  reason: string;
}

export interface DirectSnapshot {
  /** The saved pairing has been read, so `state` says whether a computer is paired. */
  loaded: boolean;
  state: DirectState;
  serverId: string | null;
  serverName: string | null;
  /** The live connection; non-null only while `state` is `connected`. */
  connection: DirectLink | null;
  /** Sessions of the computer as last seen; kept across drops, cleared when the computer is forgotten. */
  sessions: readonly DirectSession[];
  /** Round trip to the computer in ms, measured at connect and every 30 s. */
  rttMs: number | null;
  /** The addresses kept for the computer, newest knowledge first; hosts only, nothing secret. */
  hosts: readonly string[];
  /** A second connection is being raced and measured against the live one. */
  rerouting: boolean;
  /** Why the last attempt failed. */
  error: DirectFailure | null;
  preferDirect: boolean;
  /** Local echo mode, applied to every connection right after it is made. */
  echoMode: EchoMode;
  /** The transport the phone asks for; the connection says what it got. */
  transportPreference: TransportPreference;
}

/** Waits before the 1st, 2nd and 3rd retry; every further one waits `RETRY_STEADY_MS`. */
export const RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
export const RETRY_STEADY_MS = 10_000;
/** After `restarting`: the server is coming back up. */
export const RESTART_DELAY_MS = 2000;
export const BACKGROUND_GRACE_MS = 30_000;
export const PING_INTERVAL_MS = 30_000;
/** How often a route that is not local, or slow, is raced again while connected. */
export const ROUTE_CHECK_MS = 60_000;
/** A live round trip above this makes the route worth racing again. */
export const SLOW_ROUTE_MS = 80;
/** After a network change: the wait for the network to settle before racing again. */
export const NETWORK_SETTLE_MS = 1500;
/** Pings of each connection when a second one is measured against the live one. */
export const REROUTE_PINGS = 3;
/** The new connection must be this much faster (a share of the live round trip)... */
export const REROUTE_MIN_GAIN = 0.3;
/** ...and by at least this many ms. */
export const REROUTE_MIN_GAIN_MS = 20;

/** What `reroute` did: moved to the new connection, kept the live one, did not run, or could not connect. */
export type RerouteOutcome = "swapped" | "kept" | "skipped" | "failed";

/** Whether a connection measured at `candidateMs` should replace the live one at `liveMs`. */
export function shouldSwap(liveMs: number | null, candidateMs: number | null): boolean {
  if (candidateMs === null) return false;
  if (liveMs === null) return true;
  return (
    candidateMs <= liveMs * (1 - REROUTE_MIN_GAIN) && liveMs - candidateMs >= REROUTE_MIN_GAIN_MS
  );
}

/** The median of `samples` pings; failed pings are left out, null when none was answered. */
export async function measureRtt(link: DirectLink, samples: number): Promise<number | null> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      times.push(await link.ping());
    } catch {
      // A lost ping is a missing sample.
    }
  }
  if (times.length === 0) return null;
  times.sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  return times.length % 2 === 1
    ? (times[middle] ?? null)
    : ((times[middle - 1] ?? 0) + (times[middle] ?? 0)) / 2;
}

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

function sameHosts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((host, i) => host === b[i]);
}

export class DirectManager {
  private readonly native: DirectNative | null;
  private readonly credentials: CredentialStore;
  private readonly prefs: DirectPrefs;
  private readonly appState: DirectAppState;
  private readonly network: DirectNetwork | null;
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
  private routeTimer: unknown;
  private networkTimer: unknown;
  /** The reroute in flight; a second request shares it. */
  private rerouting: Promise<RerouteOutcome> | null = null;
  private refresh: { conn: DirectLink; again: boolean } | null = null;

  constructor(deps: DirectManagerDeps) {
    this.native = deps.native;
    this.credentials = deps.credentials;
    this.prefs = deps.prefs;
    this.appState = deps.appState;
    this.network = deps.network ?? null;
    this.timers = deps.timers ?? globalTimers;
    this.snapshot = {
      loaded: !deps.native,
      state: deps.native ? "unpaired" : "unsupported",
      serverId: null,
      serverName: null,
      connection: null,
      sessions: [],
      rttMs: null,
      hosts: [],
      rerouting: false,
      error: null,
      preferDirect: true,
      echoMode: DEFAULT_ECHO_MODE,
      transportPreference: DEFAULT_TRANSPORT,
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
    this.started ??= this.init().catch((error: unknown) => {
      // Never leave the app waiting on the saved pairing: it opens as if nothing was saved.
      console.warn(
        "direct: reading the saved pairing failed",
        error instanceof Error ? error.message : "",
      );
      this.patch({ loaded: true });
    });
    return this.started;
  }

  private async init(): Promise<void> {
    if (!this.native) {
      this.patch({ loaded: true });
      return;
    }
    const [prefer, credentials, echoMode, transportPreference] = await Promise.all([
      this.prefs.loadPreferDirect(),
      this.credentials.loadAll(),
      this.prefs.loadEchoMode(),
      this.prefs.loadTransport(),
    ]);
    this.foreground = this.appState.isActive();
    this.appState.subscribe((active) => this.onAppActive(active));
    this.network?.subscribe(() => this.onNetworkChange());
    this.credential = credentials[0] ?? null;
    this.patch({
      preferDirect: prefer ?? true,
      echoMode,
      transportPreference,
      loaded: true,
      ...(this.credential
        ? {
            state: "idle",
            serverId: this.credential.serverId,
            serverName: this.credential.serverName,
            hosts: this.credential.hosts,
          }
        : {}),
    });
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
      conn = await native.connect(credential, { transport: this.snapshot.transportPreference });
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

  /** Makes `conn` the live connection; `rttMs` is a round trip already measured on it. */
  private adopt(conn: DirectLink, rttMs: number | null = null): void {
    this.conn = conn;
    this.failures = 0;
    this.unsubscribeConn = conn.subscribe((event) => this.onEvent(conn, event));
    // `createDirect` replays events that arrived while connecting; the last of them can be the end.
    if (conn.isClosed) {
      this.dropped(conn);
      return;
    }
    // Queued in the core ahead of anything the app types: the saved mode, not the core's default.
    void conn.setEchoMode(this.snapshot.echoMode).catch(noop);
    this.patch({
      state: "connected",
      connection: conn,
      serverId: conn.serverId,
      serverName: conn.serverName,
      rttMs,
      error: null,
    });
    this.persistHosts(conn);
    void this.refreshSessions(conn);
    this.measure(conn);
    this.scheduleRouteCheck();
  }

  /**
   * Keeps the addresses the computer reported (merged with the stored ones by the core) for next
   * time. The addresses are never logged.
   */
  private persistHosts(link: DirectLink): void {
    const credential = this.credential;
    if (!credential || link.serverId !== credential.serverId) return;
    const hosts = [...link.addresses];
    if (hosts.length === 0 || sameHosts(hosts, credential.hosts)) return;
    this.credential = { ...credential, hosts };
    this.patch({ hosts });
    void this.credentials.updateHosts(credential.serverId, hosts).catch(noop);
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
    this.timers.clearTimeout(this.networkTimer);
    this.networkTimer = undefined;
    this.releaseConnection();
  }

  private releaseConnection(): void {
    const conn = this.conn;
    this.conn = null;
    this.unsubscribeConn?.();
    this.unsubscribeConn = null;
    this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
    this.timers.clearTimeout(this.routeTimer);
    this.routeTimer = undefined;
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
      } else if (state === "connected" && this.routeIsPoor()) {
        // The network may have changed while the app was away and the connection survived.
        void this.reroute();
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

  /**
   * The user looked at `sessionId`: the computer drops the session's unread completion, which turns
   * its agent from Done to Idle on every client (the desktop app and the other phones too).
   */
  async acknowledge(sessionId: string): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    try {
      const { events } = await conn.activity();
      const ids = events
        .filter((event) => event.session === sessionId && event.kind === "completed")
        .map((event) => event.id);
      if (ids.length > 0) await conn.acknowledgeActivity(ids);
    } catch {
      // The next view tries again; a stale Done is harmless.
    }
  }

  private measure(conn: DirectLink): void {
    conn
      .ping()
      .then((ms) => {
        if (conn !== this.conn) return;
        this.patch({ rttMs: Math.round(ms) });
        if (this.routeTimer === undefined) this.scheduleRouteCheck();
      })
      .catch(noop);
    this.pingTimer = this.timers.setTimeout(() => {
      if (conn === this.conn) this.measure(conn);
    }, PING_INTERVAL_MS);
  }

  // --- route ----------------------------------------------------------------------------------

  /**
   * Whether the live route is worth racing again: not on the local network (the best a phone can
   * have), or slow. A core that reports no route is judged by its round trip alone.
   */
  private routeIsPoor(): boolean {
    const { connection, rttMs } = this.snapshot;
    if (!connection) return false;
    const route = connection.route;
    if (route && route.kind !== "local") return true;
    const rtt = rttMs ?? route?.ms ?? null;
    return rtt !== null && rtt > SLOW_ROUTE_MS;
  }

  /**
   * Looks at the route again in a minute, if it is worth it. A route that is local and fast stops
   * the timer; a new connection, a network change or a slow ping start it again.
   */
  private scheduleRouteCheck(): void {
    this.timers.clearTimeout(this.routeTimer);
    this.routeTimer = undefined;
    if (!this.conn || !this.routeIsPoor()) return;
    const conn = this.conn;
    this.routeTimer = this.timers.setTimeout(() => {
      this.routeTimer = undefined;
      if (conn !== this.conn) return;
      if (this.routeIsPoor()) void this.reroute();
      this.scheduleRouteCheck();
    }, ROUTE_CHECK_MS);
  }

  /**
   * The phone's network changed: wait for it to settle, then race the addresses again, unless the
   * live route is already local and fast.
   */
  private onNetworkChange(): void {
    this.timers.clearTimeout(this.networkTimer);
    this.networkTimer = undefined;
    if (this.snapshot.state !== "connected" || !this.foreground) return;
    this.networkTimer = this.timers.setTimeout(() => {
      this.networkTimer = undefined;
      if (this.routeIsPoor()) void this.reroute();
      this.scheduleRouteCheck();
    }, NETWORK_SETTLE_MS);
  }

  /**
   * Races the computer's addresses again through a second connection and moves to it when its
   * round trip (the median of three pings) beats the live one by 30% and 20 ms. Open terminals
   * attach again on the new connection by themselves (`openDirectPane` follows the snapshot) and
   * the old connection is closed. One at a time: a request while one runs shares its outcome.
   * Never throws.
   */
  reroute(): Promise<RerouteOutcome> {
    if (this.rerouting) return this.rerouting;
    const { native, credential } = this;
    const live = this.conn;
    if (!native || !credential || !live || this.snapshot.state !== "connected") {
      return Promise.resolve("skipped");
    }
    const run = this.raceAgain(native, credential, live)
      .catch((): RerouteOutcome => "failed")
      .finally(() => {
        if (this.rerouting === run) this.rerouting = null;
        this.patch({ rerouting: false });
      });
    this.rerouting = run;
    this.patch({ rerouting: true });
    return run;
  }

  private async raceAgain(
    native: DirectNative,
    credential: DirectCredential,
    live: DirectLink,
  ): Promise<RerouteOutcome> {
    const seq = this.attemptSeq;
    let candidate: DirectLink;
    try {
      candidate = await native.connect(credential, {
        transport: this.snapshot.transportPreference,
      });
    } catch {
      return "failed";
    }
    // What the second connection learned about the computer's addresses is worth keeping either way.
    this.persistHosts(candidate);
    const stale = () => seq !== this.attemptSeq || this.conn !== live;
    const discard = (outcome: RerouteOutcome): RerouteOutcome => {
      void candidate.disconnect().catch(noop);
      return outcome;
    };
    if (stale()) return discard("skipped");
    const liveMs = await measureRtt(live, REROUTE_PINGS);
    const candidateMs = await measureRtt(candidate, REROUTE_PINGS);
    if (stale()) return discard("skipped");
    if (candidate.isClosed || candidateMs === null || !shouldSwap(liveMs, candidateMs)) {
      return discard("kept");
    }
    this.releaseConnection();
    this.adopt(candidate, Math.round(candidateMs));
    return "swapped";
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
      hosts: credential.hosts,
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
      hosts: [],
      error: null,
    });
    for (const id of await this.credentials.serverIds()) await this.credentials.clear(id);
  }

  async setPreferDirect(prefer: boolean): Promise<void> {
    this.patch({ preferDirect: prefer });
    await this.prefs.savePreferDirect(prefer);
  }

  /** Saves the local echo mode and applies it to the live connection. */
  async setEchoMode(mode: EchoMode): Promise<void> {
    this.patch({ echoMode: mode });
    await this.prefs.saveEchoMode(mode);
    const conn = this.conn;
    if (conn) await conn.setEchoMode(mode);
  }

  /** Saves the transport preference and, when connected or trying, reconnects with it. */
  async setTransport(transport: TransportPreference): Promise<void> {
    if (transport === this.snapshot.transportPreference) return;
    this.patch({ transportPreference: transport });
    await this.prefs.saveTransport(transport);
    const { state } = this.snapshot;
    if (!this.native || !this.credential) return;
    if (state !== "connected" && state !== "connecting" && state !== "offline") return;
    this.teardown();
    this.patch({ state: "idle", connection: null, rttMs: null });
    if (this.foreground) await this.connect();
  }
}
