import {
  DirectError,
  type ActivitySnapshot,
  type AttachInfo,
  type DirectCredential,
  type DirectErrorCode,
  type DirectEvent,
  type DirectFileEntry,
  type DirectGitSummary,
  type DirectProject,
  type DirectRoute,
  type DirectSession,
  type DirectTransport,
  type EchoMode,
  type EchoStats,
  type HistoryReply,
  type PairingTarget,
  type RouteKind,
  type TransportPreference,
} from "./types";

/**
 * The native module's surface (Swift and Kotlin implement the same). Every value that crosses is a
 * string: the core answers with `{"ok": value}` or `{"error": {"code", "reason"}}`, and pushes
 * events as JSON text through `message`.
 */
export interface NativeAturDirect {
  parseLink(link: string): Promise<string>;
  pair(link: string, deviceName: string): Promise<string>;
  connect(connectionId: string, credentialJson: string): Promise<string>;
  /** Blocking requests; the native side runs them off the main thread, one at a time per module. */
  call(connectionId: string, method: string, argsJson: string): Promise<string>;
  /**
   * Non-blocking requests that must keep their order (typing, paste, resize): queued inside the
   * core and answered at once. Called synchronously from JS.
   */
  fire(connectionId: string, method: string, argsJson: string): string;
  /** Whether this device has a hardware H.264 decoder for the screen view (a module constant). */
  readonly screenH264?: boolean;
  disconnect(connectionId: string): Promise<void>;
  addListener(
    event: "message",
    listener: (payload: { connection: string; json: string }) => void,
  ): { remove(): void };
}

interface Envelope {
  ok?: unknown;
  error?: { code?: string; reason?: string };
}

const ERROR_CODES: ReadonlySet<string> = new Set<DirectErrorCode>([
  "InvalidLink",
  "InvalidCredential",
  "Unreachable",
  "IdentityMismatch",
  "Unauthorized",
  "IncompatibleVersion",
  "Unsupported",
  "Timeout",
  "Disconnected",
  "Server",
  "ScreenNotAllowed",
  "ScreenUnavailable",
  "Internal",
]);

/** Parses the core's answer; throws `DirectError` for an error envelope. */
export function unwrap<T>(text: string): T {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(text) as Envelope;
  } catch {
    throw new DirectError("Internal", "unreadable answer from the core");
  }
  if (envelope.error) {
    const code = envelope.error.code ?? "";
    throw new DirectError(
      ERROR_CODES.has(code) ? (code as DirectErrorCode) : "Internal",
      envelope.error.reason ?? "",
    );
  }
  return envelope.ok as T;
}

let nextId = 0;
const newConnectionId = () => `c${Date.now().toString(36)}${(nextId++).toString(36)}`;

export class DirectConnection {
  private closed = false;
  private readonly listeners = new Set<(event: DirectEvent) => void>();

  /** @internal */
  constructor(
    private readonly native: NativeAturDirect,
    readonly id: string,
    readonly serverId: string,
    readonly serverName: string,
    readonly serverVersion: string,
    /** What the connection runs on: the UDP stream, or TLS (the fallback, or what was asked for). */
    readonly transport: DirectTransport = "tls",
    /** Why UDP was not used ("older server", "no answer in 3 s", ...); "" when it was. */
    readonly udpNote: string = "",
    /** The address the connection went through; null on a core that does not report it. */
    readonly route: DirectRoute | null = null,
    /**
     * The computer's addresses to keep for next time: what it reported just now, then the stored
     * ones, at most eight. Empty on a core that does not report them.
     */
    readonly addresses: readonly string[] = [],
    /** The computer's server offers the screen channel (the handshake lists the feature). */
    readonly screen: boolean = false,
  ) {}

  /** Every event of this connection. `disconnected` is always the last one. */
  subscribe(listener: (event: DirectEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @internal */
  dispatch(event: DirectEvent): void {
    if (event.t === "disconnected") this.closed = true;
    for (const listener of [...this.listeners]) listener(event);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private async call<T>(method: string, args: object = {}): Promise<T> {
    return unwrap<T>(await this.native.call(this.id, method, JSON.stringify(args)));
  }

  private fire(method: string, args: object): boolean {
    if (this.closed) return false;
    try {
      unwrap<unknown>(this.native.fire(this.id, method, JSON.stringify(args)));
      return true;
    } catch {
      return false;
    }
  }

  projects(): Promise<DirectProject[]> {
    return this.call("projects");
  }

  /** Sessions of every project, with the agent working in each. */
  sessions(): Promise<DirectSession[]> {
    return this.call("sessions");
  }

  createSession(projectId: string, cols: number, rows: number): Promise<DirectSession> {
    return this.call("createSession", { projectId, cols, rows });
  }

  endSession(session: string): Promise<void> {
    return this.call("endSession", { session });
  }

  /**
   * Attaches and starts the frame stream: a `hello` and a `snapshot` event follow, then `diff`s.
   * The phone only watches until its user types: attaching keeps the size the session has, and the
   * grid given here is what the session takes once the phone starts typing.
   */
  attach(session: string, cols: number, rows: number): Promise<AttachInfo> {
    return this.call("attach", { session, cols, rows });
  }

  detach(session: string): Promise<void> {
    return this.call("detach", { session });
  }

  /** Raw terminal input (what xterm's onData gives); false once the connection is gone. */
  input(session: string, data: string): boolean {
    return this.fire("input", { session, data });
  }

  /** Text as one paste, optionally submitted with Enter. */
  paste(session: string, text: string, submit: boolean): boolean {
    return this.fire("paste", { session, text, submit });
  }

  /**
   * Tells the computer the grid of the phone's view (rotation, font size). The session takes it
   * only while this phone is the one typing; telling the same grid again does nothing.
   */
  resize(session: string, cols: number, rows: number): boolean {
    return this.fire("resize", { session, cols, rows });
  }

  /** The last `lines` rows including scrollback, as ANSI. */
  history(session: string, lines: number): Promise<HistoryReply> {
    return this.call<Omit<HistoryReply, "prompts"> & { prompts?: unknown }>("history", {
      session,
      lines,
    }).then((reply) => ({ ...reply, prompts: parsePrompts(reply.prompts, reply.rows.length) }));
  }

  /**
   * Saves an image on the computer (its Home project, `.cache/atur/pastes/<name>`) and returns the
   * absolute path there, for the prompt. `name` is a plain file name; the image is at most 5 MiB.
   */
  pasteImage(session: string, name: string, base64: string): Promise<{ path: string }> {
    return this.call("pasteImage", { session, name, base64 });
  }

  activity(): Promise<ActivitySnapshot> {
    return this.call("activity");
  }

  acknowledgeActivity(eventIds: string[]): Promise<void> {
    return this.call("ackActivity", { eventIds });
  }

  setEchoMode(mode: EchoMode): Promise<void> {
    return this.call("echoMode", { mode });
  }

  echoStats(session: string): Promise<EchoStats> {
    return this.call("echoStats", { session });
  }

  /** Round trip to the server in ms. */
  ping(): Promise<number> {
    return this.call("ping");
  }

  files(projectId: string, path: string): Promise<DirectFileEntry[]> {
    return this.call("filesList", { projectId, path });
  }

  gitSummary(projectId: string): Promise<DirectGitSummary | null> {
    return this.call("gitSummary", { projectId });
  }

  /**
   * Opens the computer's screen on this connection (one per connection; opening again replaces
   * it). Resolves once the channel is open; `screen` events report the rest. `h264` only when the
   * device can decode it: false makes the computer send plain pictures. Throws `ScreenNotAllowed`
   * (reason = the server's text), `ScreenUnavailable` or `Unsupported` (no screen feature).
   */
  screenOpen(options: { viewOnly: boolean; h264: boolean }): Promise<void> {
    return this.call("screenOpen", options);
  }

  screenClose(): Promise<void> {
    return this.call("screenClose");
  }

  /** Pointer at framebuffer pixel (x, y); `buttons` is a mask: 1 left, 2 middle, 4 right. */
  screenPointer(x: number, y: number, buttons: number): boolean {
    return this.fire("screenPointer", { x: Math.round(x), y: Math.round(y), buttons });
  }

  /** Wheel notches at (x, y): positive `dy` scrolls up, positive `dx` right. */
  screenScroll(x: number, y: number, dx: number, dy: number): boolean {
    return this.fire("screenScroll", { x: Math.round(x), y: Math.round(y), dx, dy });
  }

  /** One X11 keysym going down or up. */
  screenKey(keysym: number, down: boolean): boolean {
    return this.fire("screenKey", { keysym, down });
  }

  /** Types text: each character is pressed and released. */
  screenType(text: string): boolean {
    return this.fire("screenType", { text });
  }

  screenViewOnly(viewOnly: boolean): boolean {
    return this.fire("screenViewOnly", { viewOnly });
  }

  /** Puts text on the computer's clipboard. */
  screenClipboard(text: string): boolean {
    return this.fire("screenClipboard", { text });
  }

  /** Lets go of every key and button held. */
  screenReleaseAll(): boolean {
    return this.fire("screenReleaseAll", {});
  }

  /** Asks for a full update (a key frame) when the picture lost sync. */
  screenRefresh(): boolean {
    return this.fire("screenRefresh", {});
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.native.disconnect(this.id);
  }
}

/** The module API over a native implementation (the real one, or a fake in tests). */
export function createDirect(native: NativeAturDirect) {
  const connections = new Map<string, DirectConnection>();
  // Events can arrive before `connect` returns (the first frames of a fast server): park them.
  const early = new Map<string, DirectEvent[]>();
  native.addListener("message", ({ connection, json }) => {
    let event: DirectEvent;
    try {
      event = JSON.parse(json) as DirectEvent;
    } catch {
      return;
    }
    const target = connections.get(connection);
    if (target) {
      target.dispatch(event);
      if (event.t === "disconnected") connections.delete(connection);
    } else {
      const list = early.get(connection) ?? [];
      if (list.length < 256) list.push(event);
      early.set(connection, list);
    }
  });

  const screenH264 = native.screenH264 === true;

  return {
    /** The device can decode the computer's H.264 screen picture in hardware. */
    screenH264,

    /** Checks a scanned or pasted link; no network. Throws `InvalidLink`. */
    async parsePairingLink(link: string): Promise<PairingTarget> {
      return unwrap<PairingTarget>(await native.parseLink(link));
    },

    /** Pairs with the computer that showed the link and returns the credential to store. */
    async pair(link: string, deviceName: string): Promise<DirectCredential> {
      return unwrap<DirectCredential>(await native.pair(link, deviceName));
    },

    /**
     * Connects with a stored credential, racing its addresses (local ones first, the next one a
     * moment later if the one before has not signed in; the first to finish wins). `transport` is
     * `auto` (default: TLS first, then UDP when the server offers it) or `tls` (never UDP).
     */
    async connect(
      credential: DirectCredential,
      options: { transport?: TransportPreference } = {},
    ): Promise<DirectConnection> {
      const id = newConnectionId();
      const info = unwrap<{
        serverId: string;
        serverName: string;
        serverVersion: string;
        transport?: DirectTransport;
        udpNote?: string;
        route?: unknown;
        addresses?: unknown;
        screen?: unknown;
      }>(await native.connect(id, connectJson(credential, options.transport)));
      const connection = new DirectConnection(
        native,
        id,
        info.serverId,
        info.serverName,
        info.serverVersion,
        info.transport === "udp" ? "udp" : "tls",
        info.udpNote ?? "",
        parseRoute(info.route),
        parseAddresses(info.addresses),
        info.screen === true,
      );
      connections.set(id, connection);
      for (const event of early.get(id) ?? []) connection.dispatch(event);
      early.delete(id);
      return connection;
    },
  };
}

const ROUTE_KINDS: ReadonlySet<string> = new Set<RouteKind>(["local", "tailscale", "other"]);

/** The core's `route`, or null for anything else (an older core sends none). */
export function parseRoute(value: unknown): DirectRoute | null {
  if (typeof value !== "object" || value === null) return null;
  const route = value as Record<string, unknown>;
  if (
    typeof route.host !== "string" ||
    route.host === "" ||
    typeof route.kind !== "string" ||
    !ROUTE_KINDS.has(route.kind) ||
    typeof route.ms !== "number" ||
    !Number.isFinite(route.ms)
  ) {
    return null;
  }
  return { host: route.host, kind: route.kind as RouteKind, ms: route.ms };
}

/** The core's `addresses`: plain non-empty strings only; anything else means none. */
export function parseAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((host): host is string => typeof host === "string" && host !== "");
}

/**
 * The core's `prompts` of a `history` reply of `rowCount` rows: ascending row indices inside the
 * reply, anything else dropped. An older core sends none.
 */
export function parsePrompts(value: unknown, rowCount: number): number[] {
  if (!Array.isArray(value)) return [];
  const found: number[] = [];
  let last = -1;
  for (const row of value) {
    if (typeof row !== "number" || !Number.isInteger(row) || row <= last || row >= rowCount) {
      continue;
    }
    found.push(row);
    last = row;
  }
  return found;
}

/** The credential with the transport preference merged in; the core ignores what it does not know. */
export function connectJson(
  credential: DirectCredential,
  transport: TransportPreference = "auto",
): string {
  return JSON.stringify({ ...credential, transport });
}
