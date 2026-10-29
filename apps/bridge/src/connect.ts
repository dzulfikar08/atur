/**
 * Relay connector: dials OUT to Atur Cloud (`/api/bridge/connect`) with a
 * per-machine token, so a customer machine needs no tunnel and no open port.
 *
 * The Worker's `BridgeRelay` Durable Object multiplexes everything over this
 * one socket as JSON text frames (binary payloads base64 in `b64`):
 *
 *   bridge -> cloud  hello {v,hostname,backend,version}
 *                    res   {id,status,headers,b64}            answer to a req
 *                    data  {sid,text|b64}  close {sid,code?,reason?}
 *                    event {event}                            agent push event
 *   cloud -> bridge  req   {id,method,path,headers,b64?}      HTTP over the socket
 *                    open  {sid,path}  data  close            WebSocket streams
 *
 * Every `req`/`open` is looped back to this process's own loopback HTTP/WS
 * server (127.0.0.1:BRIDGE_PORT, `x-bridge-token` attached), so the hubs stay
 * unaware of the relay.
 */

export const DEFAULT_ATUR_URL = "https://app.diatur.com";

const CONNECT_PATH = "/api/bridge/connect";
/** Cloud times a req out at 15 s; answer a little earlier with a clean 504. */
const REQ_TIMEOUT_MS = 14_000;
/** Skip observe/attach text frames while the outbound socket holds more than this (same cap as the hubs). */
const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_STREAMS = 64;
const MAX_INFLIGHT_REQS = 32;
/** Events produced while offline are kept this long / this many, then flushed on reconnect. */
const PENDING_EVENT_TTL_MS = 120_000;
const MAX_PENDING_EVENTS = 20;
/** The "connected" line is logged only after the socket has stayed up this long. */
const ANNOUNCE_AFTER_MS = 1_500;

/**
 * Whether a text frame may be dropped under backpressure. Attach frames are
 * full-state. On /observe only the screen-parser `blocks`/`raw` replacements
 * are: transcript frames (`append`, `older`, ...) are deltas and must arrive.
 */
function skippableFrame(pathname: string, text: string): boolean {
  if (pathname !== "/observe") return true;
  return text.startsWith('{"type":"blocks"') || text.startsWith('{"type":"raw"');
}

const STRIP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "upgrade",
  "content-length",
  "transfer-encoding",
  "x-bridge-token",
]);
const STRIP_RES_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

export interface RelayConfig {
  /** Atur server base URL (`https://app.diatur.com`). */
  baseUrl: string;
  /** Machine token (`atb_...`). */
  token: string;
  /** Loopback bridge server port. */
  localPort: number;
  /** Sent as `x-bridge-token` to the loopback server. */
  localToken: string;
  backend: "herdr" | "tmux" | "atur-terminal";
  version: string;
  hostname?: string;
  log?: (msg: string) => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Retry delay after close 4402 (plan required). */
  planRetryMs?: number;
  pingMs?: number;
  /** A connection that lasted this long resets the backoff. */
  stableMs?: number;
}

type Frame = Record<string, unknown> & { t?: unknown };

type RelayState = "idle" | "connecting" | "online" | "offline" | "auth-failed" | "plan-required";

interface Stream {
  local: WebSocket;
  open: boolean;
  queue: (string | Uint8Array)[];
  skippable: boolean;
}

/** `https://host` -> `wss://host/api/bridge/connect`. */
export function relayWsUrl(baseUrl: string): string {
  const u = new URL(CONNECT_PATH, baseUrl.replace(/\/+$/, "") + "/");
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  return u.toString();
}

function relayHttpUrl(baseUrl: string): string {
  return new URL(CONNECT_PATH, baseUrl.replace(/\/+$/, "") + "/").toString();
}

/** Close codes a WebSocket endpoint may send; anything else becomes 1000. */
function sendableCloseCode(code: unknown): number {
  if (typeof code !== "number") return 1000;
  if (code === 1000 || (code >= 1001 && code <= 1003) || (code >= 1007 && code <= 1014))
    return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1000;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class RelayConnector {
  private readonly cfg: Required<
    Pick<RelayConfig, "minBackoffMs" | "maxBackoffMs" | "planRetryMs" | "pingMs" | "stableMs">
  > &
    RelayConfig;
  private readonly wsUrl: string;
  private state: RelayState = "idle";
  private ws: WebSocket | null = null;
  private gen = 0;
  private attempt = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRx = 0;
  private openedAt = 0;
  private lastNote = "";
  private readonly streams = new Map<string, Stream>();
  private readonly reqs = new Map<string, AbortController>();
  private pending: { event: unknown; at: number }[] = [];

  constructor(cfg: RelayConfig) {
    this.cfg = {
      minBackoffMs: 1_000,
      maxBackoffMs: 30_000,
      planRetryMs: 10 * 60_000,
      pingMs: 25_000,
      stableMs: 10_000,
      ...cfg,
    };
    this.wsUrl = relayWsUrl(cfg.baseUrl);
  }

  get status(): RelayState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === "online";
  }

  start(): void {
    if (this.stopped || this.state !== "idle") return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    clearTimeout(this.retryTimer ?? undefined);
    this.retryTimer = null;
    this.stopTimers();
    const ws = this.ws;
    this.ws = null;
    this.teardown();
    try {
      ws?.close(1000, "shutdown");
    } catch {
      // already closing
    }
  }

  /**
   * Hands one agent event (the exact body the HTTP path would POST) to the
   * cloud. Offline events wait for the next connection (bounded, short-lived).
   * Returns true when the frame went out now.
   */
  sendEvent(event: unknown): boolean {
    if (this.sendFrame({ t: "event", event })) return true;
    const now = Date.now();
    this.pending = this.pending.filter((p) => now - p.at < PENDING_EVENT_TTL_MS);
    this.pending.push({ event, at: now });
    if (this.pending.length > MAX_PENDING_EVENTS) this.pending.shift();
    return false;
  }

  // -- connection lifecycle -------------------------------------------------

  private log(msg: string): void {
    (this.cfg.log ?? ((m: string) => console.log(m)))(msg);
  }

  /** Logs only when the message differs from the last one: state changes, not retry spam. */
  private note(msg: string): void {
    if (msg === this.lastNote) return;
    this.lastNote = msg;
    this.log(msg);
  }

  private connect(): void {
    if (this.stopped) return;
    const gen = ++this.gen;
    this.state = "connecting";
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl, { headers: { authorization: `Bearer ${this.cfg.token}` } });
    } catch (e) {
      this.onClosed(false, 1006, e instanceof Error ? e.message : String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.gen) return;
      opened = true;
      this.openedAt = Date.now();
      this.lastRx = this.openedAt;
      this.state = "online";
      this.sendFrame({
        t: "hello",
        v: 1,
        hostname: this.cfg.hostname ?? "unknown",
        backend: this.cfg.backend,
        version: this.cfg.version,
      });
      // Announced once the socket survives a moment: a server that accepts then
      // closes at once (4401/4402) must not log "connected" on every retry.
      this.announceTimer = setTimeout(() => {
        this.announceTimer = null;
        this.note(`relay: connected to ${new URL(this.wsUrl).host}`);
      }, ANNOUNCE_AFTER_MS);
      this.startPing();
      this.flushPending();
    };
    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      this.lastRx = Date.now();
      if (typeof ev.data !== "string") return;
      this.onText(ev.data);
    };
    ws.onerror = () => {
      // A `close` event always follows; handled there.
    };
    ws.onclose = (ev) => {
      if (gen !== this.gen) return;
      this.onClosed(opened, ev.code, ev.reason);
    };
  }

  private onClosed(opened: boolean, code: number, reason: string): void {
    this.gen++;
    this.ws = null;
    this.stopTimers();
    this.teardown();
    if (this.stopped) return;
    const lifetime = opened ? Date.now() - this.openedAt : 0;
    if (lifetime >= this.cfg.stableMs) this.attempt = 0;

    if (code === 4401) {
      this.failAuth(
        "relay: the machine token was rejected (revoked or wrong). Create a new one in app.diatur.com, then run: atur-bridge connect <token>",
      );
      return;
    }
    if (code === 4402) {
      this.planRequired();
      return;
    }
    if (!opened) {
      void this.classifyFailure(reason);
      return;
    }
    this.goOffline(
      code === 4000
        ? "replaced by another connection using this token"
        : `closed (${code}${reason ? ` ${reason}` : ""})`,
    );
  }

  /**
   * A refused upgrade (HTTP 401/402) is invisible to the WebSocket client, so a
   * never-opened failure is probed with a plain GET carrying the same header.
   */
  private async classifyFailure(reason: string): Promise<void> {
    const gen = this.gen;
    let status = 0;
    try {
      const res = await fetch(relayHttpUrl(this.cfg.baseUrl), {
        headers: { authorization: `Bearer ${this.cfg.token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      void res.body?.cancel();
    } catch {
      status = 0;
    }
    if (this.stopped || gen !== this.gen) return;
    if (status === 401) {
      this.failAuth(
        "relay: the machine token was rejected (revoked or wrong). Create a new one in app.diatur.com, then run: atur-bridge connect <token>",
      );
    } else if (status === 402) {
      this.planRequired();
    } else {
      this.goOffline(
        status === 0
          ? `cannot reach ${new URL(this.wsUrl).host}${reason ? ` (${reason})` : ""}`
          : `server answered ${status}`,
      );
    }
  }

  private failAuth(msg: string): void {
    this.state = "auth-failed";
    this.log(msg);
  }

  private planRequired(): void {
    this.state = "plan-required";
    this.note("relay: Atur Cloud needs an active plan for this account; retrying every 10 minutes");
    this.scheduleRetry(this.cfg.planRetryMs);
  }

  private goOffline(why: string): void {
    this.state = "offline";
    this.note(`relay: offline, ${why}; retrying`);
    const base = Math.min(this.cfg.maxBackoffMs, this.cfg.minBackoffMs * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 30);
    this.scheduleRetry(Math.round(base * (0.75 + Math.random() * 0.5)));
  }

  private scheduleRetry(ms: number): void {
    clearTimeout(this.retryTimer ?? undefined);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, ms);
  }

  private startPing(): void {
    clearInterval(this.pingTimer ?? undefined);
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastRx > this.cfg.pingMs * 2.5) {
        // Half-open TCP: no pong for ~2 pings. Drop and reconnect.
        const dead = ws;
        this.onClosed(true, 1006, "keepalive timeout");
        try {
          dead.close();
        } catch {
          // already gone
        }
        return;
      }
      try {
        ws.send("ping");
      } catch {
        // close event follows
      }
    }, this.cfg.pingMs);
  }

  private stopTimers(): void {
    clearInterval(this.pingTimer ?? undefined);
    this.pingTimer = null;
    clearTimeout(this.announceTimer ?? undefined);
    this.announceTimer = null;
  }

  private flushPending(): void {
    const now = Date.now();
    const batch = this.pending.filter((p) => now - p.at < PENDING_EVENT_TTL_MS);
    this.pending = [];
    for (const p of batch) this.sendFrame({ t: "event", event: p.event });
  }

  /** Drops per-connection state: local streams closed, in-flight requests aborted. */
  private teardown(): void {
    for (const [, s] of this.streams) {
      try {
        s.local.close(1001, "relay disconnected");
      } catch {
        // already closed
      }
    }
    this.streams.clear();
    for (const [, ac] of this.reqs) ac.abort();
    this.reqs.clear();
  }

  private sendFrame(frame: Frame): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state !== "online") return false;
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  // -- inbound frames -------------------------------------------------------

  private onText(text: string): void {
    if (text === "pong") return;
    let f: unknown;
    try {
      f = JSON.parse(text);
    } catch {
      return;
    }
    if (!isObj(f)) return;
    switch (f.t) {
      case "req":
        void this.handleReq(f);
        break;
      case "open":
        this.handleOpen(f);
        break;
      case "data":
        this.handleData(f);
        break;
      case "close":
        this.handleClose(f);
        break;
    }
  }

  private localUrl(scheme: "http" | "ws", path: string): string | null {
    // Authority is fixed; the path may not smuggle in another one.
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return `${scheme}://127.0.0.1:${this.cfg.localPort}${path}`;
  }

  private async handleReq(f: Record<string, unknown>): Promise<void> {
    const id = typeof f.id === "string" ? f.id : "";
    if (!id) return;
    const reply = (status: number, headers: Record<string, string>, body: Uint8Array): void => {
      this.sendFrame({
        t: "res",
        id,
        status,
        headers,
        b64: Buffer.from(body).toString("base64"),
      });
    };
    const fail = (status: number, error: string): void =>
      reply(
        status,
        { "content-type": "application/json" },
        new TextEncoder().encode(JSON.stringify({ error })),
      );

    const method = f.method === "POST" ? "POST" : f.method === "GET" ? "GET" : null;
    const url = typeof f.path === "string" ? this.localUrl("http", f.path) : null;
    if (!method || !url) return fail(400, "bad request");
    if (this.reqs.size >= MAX_INFLIGHT_REQS) return fail(503, "bridge busy");

    const headers = new Headers();
    if (isObj(f.headers)) {
      for (const [k, v] of Object.entries(f.headers)) {
        if (typeof v === "string" && !STRIP_REQ_HEADERS.has(k.toLowerCase())) headers.set(k, v);
      }
    }
    headers.set("x-bridge-token", this.cfg.localToken);
    const body =
      method === "POST" && typeof f.b64 === "string" ? Buffer.from(f.b64, "base64") : undefined;

    const ac = new AbortController();
    this.reqs.set(id, ac);
    const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: ac.signal,
      });
      const out = new Uint8Array(await res.arrayBuffer());
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (!STRIP_RES_HEADERS.has(k)) resHeaders[k] = v;
      });
      reply(res.status, resHeaders, out);
    } catch (e) {
      if (this.reqs.get(id) === ac && !ac.signal.aborted) {
        fail(502, e instanceof Error ? e.message : String(e));
      } else if (ac.signal.aborted && this.reqs.get(id) === ac) {
        fail(504, "local bridge timed out");
      }
    } finally {
      clearTimeout(timer);
      if (this.reqs.get(id) === ac) this.reqs.delete(id);
    }
  }

  private handleOpen(f: Record<string, unknown>): void {
    const sid = typeof f.sid === "string" ? f.sid : "";
    if (!sid) return;
    const url = typeof f.path === "string" ? this.localUrl("ws", f.path) : null;
    if (!url || this.streams.size >= MAX_STREAMS) {
      this.sendFrame({
        t: "close",
        sid,
        code: 1011,
        reason: url ? "too many streams" : "bad path",
      });
      return;
    }
    const stale = this.streams.get(sid);
    if (stale) {
      this.streams.delete(sid);
      try {
        stale.local.close(1000, "superseded");
      } catch {
        // already closed
      }
    }
    const pathname = new URL(url).pathname;
    let local: WebSocket;
    try {
      local = new WebSocket(url, { headers: { "x-bridge-token": this.cfg.localToken } });
    } catch (e) {
      this.sendFrame({
        t: "close",
        sid,
        code: 1011,
        reason: e instanceof Error ? e.message : "open failed",
      });
      return;
    }
    local.binaryType = "arraybuffer";
    const stream: Stream = {
      local,
      open: false,
      queue: [],
      skippable: pathname === "/observe" || pathname === "/attach",
    };
    this.streams.set(sid, stream);

    local.onopen = () => {
      if (this.streams.get(sid) !== stream) return;
      stream.open = true;
      for (const m of stream.queue) local.send(m);
      stream.queue = [];
    };
    local.onmessage = (ev) => {
      if (this.streams.get(sid) !== stream) return;
      const ws = this.ws;
      if (!ws) return;
      if (typeof ev.data === "string") {
        // Full-state frames: skipping while the cloud link is congested is what the hubs do for slow clients.
        if (
          stream.skippable &&
          ws.bufferedAmount > MAX_BUFFERED_BYTES &&
          skippableFrame(pathname, ev.data)
        )
          return;
        this.sendFrame({ t: "data", sid, text: ev.data });
      } else {
        this.sendFrame({
          t: "data",
          sid,
          b64: Buffer.from(ev.data as ArrayBuffer).toString("base64"),
        });
      }
    };
    local.onerror = () => {
      // `close` follows; a never-opened socket reports there.
    };
    local.onclose = (ev) => {
      if (this.streams.get(sid) !== stream) return;
      this.streams.delete(sid);
      // A socket that never opened got no close frame, so its code is synthetic
      // (1006 on older Bun, 1002 since 1.4): report the refusal as 1011.
      const code = stream.open ? sendableCloseCode(ev.code) : 1011;
      this.sendFrame({ t: "close", sid, code, reason: ev.reason || undefined });
    };
  }

  private handleData(f: Record<string, unknown>): void {
    const stream = typeof f.sid === "string" ? this.streams.get(f.sid) : undefined;
    if (!stream) return;
    const payload =
      typeof f.text === "string"
        ? f.text
        : typeof f.b64 === "string"
          ? new Uint8Array(Buffer.from(f.b64, "base64"))
          : null;
    if (payload === null) return;
    if (!stream.open) {
      stream.queue.push(payload);
      return;
    }
    try {
      stream.local.send(payload);
    } catch {
      // local close handler reports it
    }
  }

  private handleClose(f: Record<string, unknown>): void {
    const sid = typeof f.sid === "string" ? f.sid : "";
    const stream = this.streams.get(sid);
    if (!stream) return;
    this.streams.delete(sid);
    try {
      stream.local.close(
        sendableCloseCode(f.code),
        typeof f.reason === "string" ? f.reason.slice(0, 120) : undefined,
      );
    } catch {
      // already closed
    }
  }
}
