/**
 * Screen hub: relays raw RFB (VNC) bytes between WebSocket viewers and a
 * wayvnc instance that this daemon owns.
 *
 * Security model:
 *  - wayvnc is only ever spawned with an explicit 127.0.0.1 listen address and
 *    VNC auth is not used; the Atur Worker (superuser-only, audited) plus the
 *    bridge token gate every viewer, so nothing else can reach the desktop.
 *  - wayvnc is started when the first viewer connects and stopped
 *    `graceMs` after the last one leaves. If the port is already taken by a
 *    process we did not spawn we refuse to relay to it (unknown listener).
 *  - Each session start/stop is logged and surfaced on the desktop through a
 *    notification so the owner can see that someone is watching.
 */
import type { Socket, Subprocess } from "bun";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ScreenMeta {
  screen: true;
  id: number;
}

/** The slice of Bun's ServerWebSocket the hub needs (kept narrow for tests). */
export interface ScreenWs {
  data: ScreenMeta;
  send(data: Uint8Array | string): number;
  close(code?: number, reason?: string): void;
}

/**
 * Close codes the app acts on (apps/native/lib/screen-session.ts mirrors them):
 * a replaced viewer must not reconnect on its own, a timed-out one may.
 */
export const SCREEN_CLOSE = { replaced: 4001, timedOut: 4002 } as const;

export interface ScreenConfig {
  /** Loopback port wayvnc listens on. */
  port: number;
  wayvncBin: string;
  /** LD_LIBRARY_PATH for the user-level wayvnc extract (empty = system libs). */
  libDir: string;
  waylandDisplay: string;
  runtimeDir: string;
  /** Output to capture (empty = wayvnc default). */
  output: string;
  /** How long wayvnc lingers after the last viewer leaves. */
  graceMs: number;
  /** At the cap, the oldest viewer is replaced by the newcomer. */
  maxViewers: number;
  startTimeoutMs: number;
  /** A viewer that has pinged before and goes quiet this long is dropped. */
  viewerTimeoutMs: number;
}

export function screenConfigFromEnv(env: Record<string, string | undefined>): ScreenConfig {
  const home = homedir();
  const runtimeDir = env.XDG_RUNTIME_DIR || "/run/user/1000";
  return {
    port: Number(env.SCREEN_VNC_PORT ?? 5900),
    wayvncBin: env.SCREEN_WAYVNC_BIN || join(home, ".local/opt/wayvnc/usr/bin/wayvnc"),
    libDir: env.SCREEN_WAYVNC_LIBDIR ?? join(home, ".local/opt/wayvnc/usr/lib"),
    waylandDisplay: env.WAYLAND_DISPLAY || "wayland-1",
    runtimeDir,
    output: env.SCREEN_OUTPUT ?? "",
    graceMs: Number(env.SCREEN_GRACE_MS ?? 15_000),
    // At least one: the cap evicts to make room, so 0 would leave none.
    maxViewers: Math.max(1, Number(env.SCREEN_MAX_VIEWERS) || 4),
    startTimeoutMs: Number(env.SCREEN_START_TIMEOUT_MS ?? 8_000),
    viewerTimeoutMs: Number(env.SCREEN_VIEWER_TIMEOUT_MS ?? 30_000),
  };
}

export interface ScreenStatus {
  /** wayvnc binary and the Wayland socket both exist. */
  available: boolean;
  running: boolean;
  viewers: number;
}

interface Conn {
  ws: ScreenWs;
  tcp: Socket<Conn> | null;
  /** Client bytes received before the TCP leg was up / not yet flushed. */
  pending: Uint8Array[];
  closed: boolean;
  /** TCP reads paused because the WebSocket is backed up. */
  paused: boolean;
  /** When the viewer last pinged (0 = never: older clients don't, so no timeout). */
  lastPing: number;
}

type Notify = (title: string, body: string, urgency: "low" | "critical") => void;

export class ScreenHub {
  private readonly conns = new Map<ScreenWs, Conn>();
  private proc: Subprocess | null = null;
  private starting: Promise<void> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: Timer | null = null;
  private nextId = 1;

  constructor(
    private readonly cfg: ScreenConfig,
    private readonly notify: Notify = defaultNotify(cfg),
  ) {}

  newMeta(): ScreenMeta {
    return { screen: true, id: this.nextId++ };
  }

  status(): ScreenStatus {
    return {
      available:
        existsSync(this.cfg.wayvncBin) &&
        existsSync(join(this.cfg.runtimeDir, this.cfg.waylandDisplay)),
      running: this.proc !== null,
      viewers: this.conns.size,
    };
  }

  /** A viewer socket opened: bring wayvnc up (if needed) and bridge to it. */
  async open(ws: ScreenWs): Promise<void> {
    // The desktop has one owner: a new session (often the same phone after a
    // network change, its old socket not yet noticed dead) replaces the oldest.
    for (const oldest of this.conns.values()) {
      if (this.conns.size < this.cfg.maxViewers) break;
      this.drop(oldest, SCREEN_CLOSE.replaced, "replaced by a newer viewer");
    }
    const conn: Conn = { ws, tcp: null, pending: [], closed: false, paused: false, lastPing: 0 };
    this.conns.set(ws, conn);
    this.cancelStop();
    this.startSweep();
    console.log(`screen: viewer #${ws.data.id} connecting (viewers=${this.conns.size})`);

    try {
      await this.ensureServer();
    } catch (e) {
      console.error("screen: wayvnc start failed:", e instanceof Error ? e.message : e);
      this.drop(conn, 1011, "screen server unavailable");
      return;
    }
    if (conn.closed) return;

    try {
      conn.tcp = await Bun.connect<Conn>({
        hostname: "127.0.0.1",
        port: this.cfg.port,
        data: conn,
        socket: {
          data: (_s, chunk) => this.onTcpData(conn, chunk),
          drain: () => this.flush(conn),
          close: () => this.drop(conn, 1011, "screen server closed"),
          error: (_s, err) => {
            console.error("screen: tcp error:", err.message);
            this.drop(conn, 1011, "screen server error");
          },
          connectError: () => this.drop(conn, 1011, "screen server unreachable"),
        },
      });
    } catch (e) {
      console.error("screen: connect failed:", e instanceof Error ? e.message : e);
      this.drop(conn, 1011, "screen server unreachable");
      return;
    }
    if (conn.closed) {
      conn.tcp.end();
      return;
    }
    this.flush(conn);
    console.log(`screen: viewer #${ws.data.id} attached (viewers=${this.conns.size})`);
    this.notify(
      "Atur Screen",
      `Remote viewer connected (${this.conns.size} watching this desktop)`,
      "critical",
    );
  }

  /** Client → wayvnc bytes; text frames are the app's ping/pong, never RFB. */
  message(ws: ScreenWs, data: string | Uint8Array): void {
    const conn = this.conns.get(ws);
    if (!conn || conn.closed) return;
    if (typeof data === "string") {
      this.control(conn, data);
      return;
    }
    conn.pending.push(data);
    this.flush(conn);
  }

  /** The WebSocket's send buffer drained: resume reading from wayvnc. */
  drain(ws: ScreenWs): void {
    const conn = this.conns.get(ws);
    if (conn?.paused) {
      conn.paused = false;
      conn.tcp?.resume();
    }
  }

  /** The WebSocket closed. */
  close(ws: ScreenWs, code?: number, reason?: string): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    console.log(
      `screen: viewer #${ws.data.id} socket closed code=${code ?? "-"} ${reason ?? ""}`.trimEnd(),
    );
    this.drop(conn);
  }

  /** Tear everything down (daemon shutdown / tests). */
  async shutdown(): Promise<void> {
    for (const conn of [...this.conns.values()]) this.drop(conn, 1001, "bridge shutting down");
    this.cancelStop();
    clearInterval(this.sweepTimer ?? undefined);
    this.sweepTimer = null;
    await this.stopServer();
  }

  private control(conn: Conn, raw: string): void {
    let msg: { t?: unknown; id?: unknown; ts?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.t !== "ping") return;
    conn.lastPing = Date.now();
    conn.ws.send(JSON.stringify({ t: "pong", id: msg.id, ts: msg.ts }));
  }

  /** Drop viewers whose pings stopped: their phone is gone, the socket just doesn't know. */
  private startSweep(): void {
    if (this.sweepTimer) return;
    const every = Math.max(50, Math.min(5_000, this.cfg.viewerTimeoutMs / 3));
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const conn of [...this.conns.values()]) {
        if (conn.lastPing > 0 && now - conn.lastPing > this.cfg.viewerTimeoutMs) {
          this.drop(conn, SCREEN_CLOSE.timedOut, "viewer timed out");
        }
      }
      if (this.conns.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
    }, every);
  }

  private onTcpData(conn: Conn, chunk: Uint8Array): void {
    if (conn.closed) return;
    // ws.send copies/queues; -1 means queued under backpressure, 0 dropped.
    const r = conn.ws.send(chunk);
    if (r === 0) {
      this.drop(conn, 1011, "viewer connection stalled");
    } else if (r === -1 && !conn.paused) {
      conn.paused = true;
      conn.tcp?.pause();
    }
  }

  /** Write queued client bytes to wayvnc, honoring partial writes. */
  private flush(conn: Conn): void {
    const tcp = conn.tcp;
    if (!tcp || conn.closed) return;
    while (conn.pending.length > 0) {
      const head = conn.pending[0]!;
      const n = tcp.write(head);
      if (n < head.length) {
        conn.pending[0] = head.subarray(n);
        return; // socket `drain` resumes the flush
      }
      conn.pending.shift();
    }
  }

  private drop(conn: Conn, code?: number, reason?: string): void {
    if (conn.closed) return;
    conn.closed = true;
    this.conns.delete(conn.ws);
    try {
      conn.tcp?.end();
    } catch {
      /* already closed */
    }
    if (code !== undefined) {
      try {
        conn.ws.close(code, reason);
      } catch {
        /* already closed */
      }
    }
    console.log(`screen: viewer #${conn.ws.data.id} closed (viewers=${this.conns.size})`);
    if (this.conns.size === 0) {
      this.notify("Atur Screen", "Remote viewer disconnected", "low");
      this.scheduleStop();
    }
  }

  private scheduleStop(): void {
    this.cancelStop();
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (this.conns.size === 0) void this.stopServer();
    }, this.cfg.graceMs);
  }

  private cancelStop(): void {
    clearTimeout(this.stopTimer ?? undefined);
    this.stopTimer = null;
  }

  private ensureServer(): Promise<void> {
    if (this.proc) return Promise.resolve();
    this.starting ??= this.startServer().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startServer(): Promise<void> {
    if (await portOpen(this.cfg.port)) {
      throw new Error(
        `127.0.0.1:${this.cfg.port} is already in use by a process the bridge did not start`,
      );
    }
    const args = [
      this.cfg.wayvncBin,
      "-r", // render the cursor into the frame (browsers don't get one otherwise)
      "-L",
      "warning",
    ];
    if (this.cfg.output) args.push("-o", this.cfg.output);
    // Explicit loopback address: wayvnc must never listen on a routable interface.
    args.push("127.0.0.1", String(this.cfg.port));

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      WAYLAND_DISPLAY: this.cfg.waylandDisplay,
      XDG_RUNTIME_DIR: this.cfg.runtimeDir,
    };
    if (this.cfg.libDir) {
      env.LD_LIBRARY_PATH = [this.cfg.libDir, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":");
    }
    const proc = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.proc = proc;
    const log = collectTail(proc.stderr as ReadableStream<Uint8Array>);
    void collectTail(proc.stdout as ReadableStream<Uint8Array>);
    console.log(`screen: wayvnc started pid=${proc.pid} 127.0.0.1:${this.cfg.port}`);

    void proc.exited.then((code) => {
      if (this.proc === proc) this.proc = null;
      console.log(`screen: wayvnc exited code=${code}`);
      for (const conn of [...this.conns.values()]) this.drop(conn, 1011, "screen server exited");
    });

    const deadline = Date.now() + this.cfg.startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.proc !== proc) {
        throw new Error(`wayvnc exited during start: ${(await log).trim() || "no output"}`);
      }
      if (await portOpen(this.cfg.port)) return;
      await Bun.sleep(50);
    }
    await this.stopServer();
    throw new Error(`wayvnc did not open 127.0.0.1:${this.cfg.port} in time`);
  }

  private async stopServer(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    console.log(`screen: stopping wayvnc pid=${proc.pid}`);
    proc.kill("SIGTERM");
    const killer = setTimeout(() => proc.kill("SIGKILL"), 3000);
    await proc.exited;
    clearTimeout(killer);
  }
}

function defaultNotify(cfg: ScreenConfig): Notify {
  return (title, body, urgency) => {
    try {
      Bun.spawn(["notify-send", "-a", "Atur", "-u", urgency, "-i", "video-display", title, body], {
        env: {
          ...(process.env as Record<string, string>),
          WAYLAND_DISPLAY: cfg.waylandDisplay,
          XDG_RUNTIME_DIR: cfg.runtimeDir,
          DBUS_SESSION_BUS_ADDRESS:
            process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${cfg.runtimeDir}/bus`,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      /* notifications are best-effort */
    }
  };
}

async function portOpen(port: number): Promise<boolean> {
  try {
    const s = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data() {}, open() {}, close() {}, error() {}, connectError() {} },
    });
    s.end();
    return true;
  } catch {
    return false;
  }
}

/** Drain a stream, keeping only the last 2 KiB as text. */
async function collectTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  let tail = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of stream) {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-2048);
    }
  } catch {
    /* stream closed */
  }
  return tail;
}
