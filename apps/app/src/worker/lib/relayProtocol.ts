// Wire protocol between the Worker's BridgeRelay Durable Object and a customer's
// atur-bridge daemon, which dials OUT to /api/bridge/connect (docs/bridge.md).
// Pure module (no Workers APIs besides atob/btoa/crypto) so the codec and the
// pane-id namespacing are unit-testable; the Durable Object stays a thin mux
// over these helpers.
//
// Every frame is a JSON text message. Binary payloads travel base64 in `b64`.
//   bridge → worker: hello | res | data | close | event
//   worker → bridge: req   | open | data | close
// Keepalive is the bare text `ping` (bridge → worker) answered `pong` by the
// Durable Object's auto-response, never parsed here.

export const RELAY_PROTOCOL_VERSION = 1;
export const RELAY_BACKENDS = ["herdr", "tmux"] as const;
export type RelayBackend = (typeof RELAY_BACKENDS)[number];

/** Worker gives up on a bridge `res` after this long (504). */
export const RELAY_REQUEST_TIMEOUT_MS = 15_000;

/** Close codes the bridge understands (see docs/bridge.md). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_BAD_TOKEN = 4401;
export const CLOSE_PLAN_REQUIRED = 4402;

const MAX_ID_LEN = 64;

export interface HelloFrame {
  t: "hello";
  v: number;
  hostname: string;
  backend: RelayBackend;
  version: string;
}
export interface ResFrame {
  t: "res";
  id: string;
  status: number;
  headers: Record<string, string>;
  b64: string;
}
export interface DataFrame {
  t: "data";
  sid: string;
  text?: string;
  b64?: string;
}
export interface CloseFrame {
  t: "close";
  sid: string;
  code?: number;
  reason?: string;
}
export interface EventFrame {
  t: "event";
  event: unknown;
}
export type BridgeFrame = HelloFrame | ResFrame | DataFrame | CloseFrame | EventFrame;

export interface ReqFrame {
  t: "req";
  id: string;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  b64?: string;
}
export interface OpenFrame {
  t: "open";
  sid: string;
  path: string;
}
export type WorkerFrame = ReqFrame | OpenFrame | DataFrame | CloseFrame;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN;

function stringRecord(v: unknown): Record<string, string> | null {
  if (v === undefined) return {};
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") return null;
    out[k] = val;
  }
  return out;
}

/** A frame from the bridge, or null when malformed (dropped, never fatal). */
export function parseBridgeFrame(raw: string): BridgeFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  switch (value.t) {
    case "hello": {
      const { hostname, backend, version, v } = value;
      if (typeof hostname !== "string" || typeof version !== "string") return null;
      if (!RELAY_BACKENDS.some((b) => b === backend)) return null;
      return {
        t: "hello",
        v: typeof v === "number" ? v : RELAY_PROTOCOL_VERSION,
        hostname: hostname.slice(0, 255),
        backend: backend as RelayBackend,
        version: version.slice(0, 64),
      };
    }
    case "res": {
      const headers = stringRecord(value.headers);
      if (!isId(value.id) || typeof value.status !== "number" || !headers) return null;
      if (value.b64 !== undefined && typeof value.b64 !== "string") return null;
      return {
        t: "res",
        id: value.id,
        status: value.status,
        headers,
        b64: (value.b64 as string | undefined) ?? "",
      };
    }
    case "data": {
      if (!isId(value.sid)) return null;
      const hasText = typeof value.text === "string";
      const hasB64 = typeof value.b64 === "string";
      if (hasText === hasB64) return null; // exactly one payload
      return hasText
        ? { t: "data", sid: value.sid, text: value.text as string }
        : { t: "data", sid: value.sid, b64: value.b64 as string };
    }
    case "close": {
      if (!isId(value.sid)) return null;
      const frame: CloseFrame = { t: "close", sid: value.sid };
      if (typeof value.code === "number") frame.code = value.code;
      if (typeof value.reason === "string") frame.reason = value.reason;
      return frame;
    }
    case "event":
      return value.event === undefined ? null : { t: "event", event: value.event };
    default:
      return null;
  }
}

export const encodeFrame = (frame: WorkerFrame): string => JSON.stringify(frame);

export function dataFrame(sid: string, payload: string | ArrayBuffer): DataFrame {
  return typeof payload === "string"
    ? { t: "data", sid, text: payload }
    : { t: "data", sid, b64: bytesToB64(new Uint8Array(payload)) };
}

// btoa takes a binary string; build it in slices so a multi-MB image never
// blows the argument limit of String.fromCharCode.
const SLICE = 0x8000;

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    bin += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebSocket close codes a Worker may send; anything else is mapped to 1000. */
export function safeCloseCode(code: number | undefined): number {
  if (code === undefined || !Number.isInteger(code)) return 1000;
  if (code >= 1000 && code <= 1003) return code;
  if (code >= 1007 && code <= 1014) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1000;
}

/** Close reasons are limited to 123 bytes on the wire; stay well under. */
export const safeCloseReason = (reason: string | undefined): string => (reason ?? "").slice(0, 100);

// Worker ↔ BridgeRelay Durable Object -----------------------------------------

/** Internal headers the Worker sets on the upgrade it forwards to the DO. */
export const RELAY_HEADER = {
  machineId: "x-relay-machine-id",
  machineName: "x-relay-machine-name",
  userId: "x-relay-user-id",
} as const;

/** Name of the per-user relay Durable Object instance. */
export const relayObjectName = (userId: string): string => `user:${userId}`;

/** Client streams the relay may open on the bridge (the only WS routes it has). */
export const RELAY_STREAM_PATH = /^\/(attach|observe)\?pane=[^&\s]+$/;

/** An HTTP request relayed to a machine's local bridge server. */
export interface RelayRequest {
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
}
export interface RelayResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
/** One machine's `GET /panes` reply (`body` is the JSON text, null when it failed). */
export interface RelayPaneList {
  machineId: string;
  body: string | null;
}
export interface RelayOnlineMachine {
  hostname: string | null;
  backend: string | null;
  version: string | null;
  connected_at: number;
}

// Pane ids -----------------------------------------------------------------

const PANE_ID_SEP = "~";
const RELAY_PANE_ID = /^([a-z0-9]+)~(.+)$/;

/** `<machineId>~<paneId>`: how relay panes are exposed to clients. */
export const prefixPaneId = (machineId: string, paneId: string): string =>
  `${machineId}${PANE_ID_SEP}${paneId}`;

/**
 * Split a client-facing pane id into machine + bridge-local id. Null for a
 * legacy (env-configured bridge) pane id, which never carries the separator
 * after a lowercase-alphanumeric prefix.
 */
export function splitPaneId(id: string): { machineId: string; paneId: string } | null {
  const m = RELAY_PANE_ID.exec(id);
  return m ? { machineId: m[1]!, paneId: m[2]! } : null;
}

export interface RelayPaneMachine {
  id: string;
  name: string;
}

/** A machine's pane as shown to clients: bridge row, namespaced id, owning machine. */
export type RelayPane = Record<string, unknown> & { pane_id: string; machine: RelayPaneMachine };

/** Namespace a machine's pane list for clients and tag each row with its machine. */
export function prefixPanes(machine: RelayPaneMachine, panes: unknown): RelayPane[] {
  if (!Array.isArray(panes)) return [];
  const seen = new Set<string>();
  const out: RelayPane[] = [];
  for (const pane of panes) {
    // herdr's pane.list ignores its workspace filter, so the bridge repeats panes.
    if (!isRecord(pane) || typeof pane.pane_id !== "string" || seen.has(pane.pane_id)) continue;
    seen.add(pane.pane_id);
    out.push({ ...pane, pane_id: prefixPaneId(machine.id, pane.pane_id), machine });
  }
  return out;
}

// Machine credentials -------------------------------------------------------

const MACHINE_TOKEN = /^atb_[0-9a-f]{64}$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** `atb_` + 32 random bytes hex; shown to the user exactly once. */
export const newMachineToken = (): string =>
  `atb_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;

export const isMachineToken = (s: string): boolean => MACHINE_TOKEN.test(s);

/** Short public id (`m7k2q`): lowercase alphanumerics so it is URL- and pane-id-safe. */
export function newMachineId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `m${Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("")}`;
}

/** The bearer token of a connect request, or null when absent / not a machine token. */
export function machineTokenFromHeader(authorization: string | null | undefined): string | null {
  const m = /^Bearer (\S+)$/.exec(authorization ?? "");
  return m && isMachineToken(m[1]!) ? m[1]! : null;
}
