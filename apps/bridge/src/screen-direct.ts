/**
 * Direct (tailnet) path for the screen mirror.
 *
 * The Worker relay through the Cloudflare tunnel costs 70-230 ms RTT and caps
 * a stream near 5 Mbps. A client that can reach the bridge over the tailnet
 * skips it: the bridge opens an extra listener on a tailnet address that serves
 * only `GET /screen`, authenticated by a short-lived ticket the Worker mints.
 *
 * Why a ticket and not BRIDGE_TOKEN: the token would have to live in the page
 * or WebView that opens the socket (a WebSocket cannot send headers), where any
 * script could read it, and it opens every bridge endpoint (panes, input).
 * A ticket is HMAC-SHA256 over a small payload with the bridge token as key,
 * valid 60 s, single use here, scoped to the screen, and names the user and the
 * audit row the Worker wrote when minting it. A leaked ticket is worth one
 * viewer for under a minute and nothing else.
 *
 * Wire format (mirrored by apps/app/src/worker/lib/screenTicket.ts):
 *   base64url(JSON {v:1, aud:"screen", sub, audit, jti, exp}) "." base64url(HMAC)
 *   HMAC = HMAC-SHA256(key = bridge token, "atur-screen-ticket-v1\n" + payloadPart)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ScreenTicket {
  /** Atur user id the Worker authorised. */
  sub: string;
  /** pane_audit row the Worker wrote for this session. */
  audit: string;
  jti: string;
  /** Epoch ms. */
  exp: number;
}

const DOMAIN = "atur-screen-ticket-v1\n";

const b64u = (buf: Buffer): string => buf.toString("base64url");

/** Mint a ticket (the Worker does this in production; tests and tooling use it too). */
export function signScreenTicket(key: string, t: ScreenTicket): string {
  const payload = b64u(Buffer.from(JSON.stringify({ v: 1, aud: "screen", ...t })));
  const mac = createHmac("sha256", key)
    .update(DOMAIN + payload)
    .digest();
  return `${payload}.${b64u(mac)}`;
}

/** Remembers spent ticket ids until they would have expired anyway. */
export class TicketLedger {
  private readonly spent = new Map<string, number>();

  /** True the first time `jti` is claimed; false for a replay. */
  claim(jti: string, exp: number, now: number): boolean {
    for (const [id, until] of this.spent) if (until <= now) this.spent.delete(id);
    if (this.spent.has(jti)) return false;
    this.spent.set(jti, exp);
    return true;
  }
}

/** The ticket's claims when it is authentic, unexpired, screen-scoped and unspent. */
export function redeemScreenTicket(
  key: string,
  raw: string,
  ledger: TicketLedger,
  now = Date.now(),
): ScreenTicket | null {
  const [payload, mac, ...rest] = raw.split(".");
  if (!payload || !mac || rest.length > 0) return null;
  const want = createHmac("sha256", key)
    .update(DOMAIN + payload)
    .digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let claims: Partial<ScreenTicket> & { v?: unknown; aud?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.v !== 1 || claims.aud !== "screen") return null;
  const { sub, audit, jti, exp } = claims;
  if (typeof sub !== "string" || typeof audit !== "string" || typeof jti !== "string") return null;
  if (typeof exp !== "number" || exp <= now) return null;
  if (!ledger.claim(jti, exp, now)) return null;
  return { sub, audit, jti, exp };
}

export interface DirectListener {
  hostname: string;
  port: number;
}

/** Hosts that mean "every interface": never accepted for the direct listener. */
const WILDCARDS = new Set(["", "0.0.0.0", "::", "[::]", "*"]);

/**
 * Parse BRIDGE_LISTEN: comma-separated `host[:port]` entries (port defaults to
 * `defaultPort`); the word `tailscale` stands for this machine's tailnet IPv4
 * (`resolveTailscale`). Wildcard addresses and the loopback server's own
 * address are rejected so the extra listener cannot widen exposure by accident.
 */
export function parseListen(
  raw: string | undefined,
  defaultPort: number,
  resolveTailscale: () => string | null,
): DirectListener[] {
  const out: DirectListener[] = [];
  for (const entry of (raw ?? "").split(",").map((s) => s.trim())) {
    if (!entry) continue;
    let host = entry;
    let port = defaultPort;
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry);
    if (m) {
      host = m[1]!;
      port = Number(m[2]);
    }
    if (host === "tailscale") {
      const ip = resolveTailscale();
      if (!ip) throw new Error("BRIDGE_LISTEN=tailscale but `tailscale ip -4` gave no address");
      host = ip;
    }
    host = host.replace(/^\[|\]$/g, "");
    if (WILDCARDS.has(host)) {
      throw new Error(`BRIDGE_LISTEN: refusing wildcard address "${entry}"`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`BRIDGE_LISTEN: bad port in "${entry}"`);
    }
    out.push({ hostname: host, port });
  }
  return out;
}

/** Public URL clients dial for the first listener (override with BRIDGE_DIRECT_URL, e.g. a MagicDNS name for TLS). */
export function directUrl(
  override: string | undefined,
  listener: DirectListener | undefined,
  tls: boolean,
): string | null {
  if (!listener) return null;
  const base =
    override?.trim() ||
    `${tls ? "wss" : "ws"}://${listener.hostname.includes(":") ? `[${listener.hostname}]` : listener.hostname}:${listener.port}`;
  return `${base.replace(/\/+$/, "")}/screen`;
}

/** Tell the Worker a direct session ended so it can stamp the audit row. Best effort. */
export async function reportDirectStop(
  atur: { url: string; token: string } | null,
  audit: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!atur) return;
  try {
    await fetcher(`${atur.url}/api/bridge/screen-events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": atur.token },
      body: JSON.stringify({ audit_id: audit, event: "stop" }),
    });
  } catch (e) {
    console.error("screen: audit stop report failed:", e instanceof Error ? e.message : e);
  }
}

/** This machine's tailnet IPv4 from the tailscale CLI, or null when unavailable. */
export function tailscaleIPv4(): string | null {
  try {
    const out = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" });
    const ip = out.stdout.toString().split("\n")[0]?.trim();
    return out.exitCode === 0 && ip ? ip : null;
  } catch {
    return null;
  }
}
