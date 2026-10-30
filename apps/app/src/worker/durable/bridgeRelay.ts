import { DurableObject } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "../lib/env";
import {
  CLOSE_BAD_TOKEN,
  CLOSE_REPLACED,
  RELAY_HEADER,
  RELAY_REQUEST_TIMEOUT_MS,
  RELAY_STREAM_PATH,
  b64ToBytes,
  bytesToB64,
  dataFrame,
  encodeFrame,
  parseBridgeFrame,
  prefixPaneId,
  safeCloseCode,
  safeCloseReason,
  type BridgeFrame,
  type RelayOnlineMachine,
  type RelayPaneList,
  type RelayRequest,
  type RelayResponse,
} from "../lib/relayProtocol";
import { agentEventSchema, pushAgentEvent } from "../services/agentPush";
import { recordSessionEvent } from "../services/agentSessions";
import * as machines from "../services/bridgeMachines";

// One BridgeRelay per user (`user:<userId>`). It holds the WebSocket of each of
// that user's connected machines (the bridge dials out to /api/bridge/connect)
// and of every phone/web client attached to a pane, and muxes them by stream id.
//
// All sockets use the Hibernation API, so the DO can be evicted while idle
// sockets stay open. Everything needed after a wake-up lives in socket
// attachments and tags; only `pending` (an in-flight request/response pair) is
// in memory, and a request being awaited keeps the DO awake.
//
//   bridge socket  tags: b:<machineId>, bg:<gen>        attachment: BridgeAttachment
//   client socket  tags: s:<sid>,       cg:<gen>        attachment: ClientAttachment
//
// `gen` identifies one bridge connection: clients are bound to the connection
// whose streams they ride on, so a reconnecting machine never leaves a client
// attached to a stream that no longer exists.

interface BridgeAttachment {
  kind: "bridge";
  machineId: string;
  machineName: string;
  userId: string;
  gen: string;
  connectedAt: number;
  hello: { hostname: string; backend: string; version: string } | null;
}

interface ClientAttachment {
  kind: "client";
  sid: string;
  machineId: string;
  gen: string;
  /** pane_audit row to stamp when the stream ends (attach only). */
  audit: string | null;
}

type Attachment = BridgeAttachment | ClientAttachment;

interface Pending {
  gen: string;
  resolve: (res: RelayResponse) => void;
}

const LAST_SEEN_THROTTLE_MS = 60_000;
const OPEN = 1; // WebSocket.OPEN

const bridgeTag = (machineId: string) => `b:${machineId}`;
const bridgeGenTag = (gen: string) => `bg:${gen}`;
const streamTag = (sid: string) => `s:${sid}`;
const clientGenTag = (gen: string) => `cg:${gen}`;

const jsonResponse = (status: number, body: unknown): RelayResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode(JSON.stringify(body)),
});

function safeClose(ws: WebSocket, code?: number, reason?: string): void {
  try {
    ws.close(safeCloseCode(code), safeCloseReason(reason));
  } catch {
    /* already closed */
  }
}

export class BridgeRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();
  private readonly lastSeenWritten = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The bridge's 25 s keepalive is answered without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // --- Worker-facing API -------------------------------------------------

  /** Internal upgrades: `/bridge` (a machine connecting) and `/client` (a pane stream). */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("websocket upgrade required", { status: 426 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/bridge") return this.acceptBridge(request);
    if (url.pathname === "/client") return this.acceptClient(url);
    return new Response("not found", { status: 404 });
  }

  /** Machines with a live bridge socket, keyed by machine id. */
  onlineMachines(): Record<string, RelayOnlineMachine> {
    const out: Record<string, RelayOnlineMachine> = {};
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att?.kind !== "bridge" || ws.readyState !== OPEN) continue;
      const known = out[att.machineId];
      if (known && known.connected_at >= att.connectedAt) continue;
      out[att.machineId] = {
        hostname: att.hello?.hostname ?? null,
        backend: att.hello?.backend ?? null,
        version: att.hello?.version ?? null,
        connected_at: att.connectedAt,
      };
    }
    return out;
  }

  /** `GET /panes` on every connected machine; one machine failing never fails the rest. */
  async listPanes(): Promise<RelayPaneList[]> {
    const ids = Object.keys(this.onlineMachines());
    return Promise.all(
      ids.map(async (machineId) => {
        try {
          const res = await this.request(machineId, { method: "GET", path: "/panes" });
          return {
            machineId,
            body: res.status === 200 ? new TextDecoder().decode(res.body) : null,
          };
        } catch {
          return { machineId, body: null };
        }
      }),
    );
  }

  /** Relay one HTTP request to the machine's local bridge; 502 offline, 504 after 15 s. */
  async request(machineId: string, req: RelayRequest): Promise<RelayResponse> {
    const bridge = this.bridgeSocket(machineId);
    const att = bridge && this.attachment(bridge);
    if (!bridge || att?.kind !== "bridge") return jsonResponse(502, { error: "machine offline" });

    const id = crypto.randomUUID();
    const { promise, resolve } = Promise.withResolvers<RelayResponse>();
    const timer = setTimeout(
      () => this.settlePending(id, jsonResponse(504, { error: "machine did not answer in time" })),
      RELAY_REQUEST_TIMEOUT_MS,
    );
    this.pending.set(id, {
      gen: att.gen,
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
    });
    try {
      bridge.send(
        encodeFrame({
          t: "req",
          id,
          method: req.method,
          path: req.path,
          headers: req.headers ?? {},
          ...(req.body ? { b64: bytesToB64(req.body) } : {}),
        }),
      );
    } catch {
      this.settlePending(id, jsonResponse(502, { error: "machine offline" }));
    }
    return promise;
  }

  /** Close a machine's bridge socket(s) (revoked) and every stream riding on them. */
  closeMachine(machineId: string, code: number = CLOSE_BAD_TOKEN, reason = "revoked"): void {
    for (const ws of this.ctx.getWebSockets(bridgeTag(machineId)))
      this.dropBridge(ws, code, reason);
  }

  // --- Upgrades -----------------------------------------------------------

  private acceptBridge(request: Request): Response {
    const machineId = request.headers.get(RELAY_HEADER.machineId);
    const machineName = request.headers.get(RELAY_HEADER.machineName);
    const userId = request.headers.get(RELAY_HEADER.userId);
    if (!machineId || !machineName || !userId) {
      return new Response("missing machine identity", { status: 400 });
    }

    // A newer socket for the same machine replaces the older one.
    for (const old of this.ctx.getWebSockets(bridgeTag(machineId))) {
      this.dropBridge(old, CLOSE_REPLACED, "replaced");
    }

    const gen = crypto.randomUUID();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [bridgeTag(machineId), bridgeGenTag(gen)]);
    const attachment: BridgeAttachment = {
      kind: "bridge",
      machineId,
      machineName,
      userId,
      gen,
      connectedAt: Date.now(),
      hello: null,
    };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptClient(url: URL): Response {
    const machineId = url.searchParams.get("machine") ?? "";
    const path = url.searchParams.get("path") ?? "";
    if (!RELAY_STREAM_PATH.test(path)) return new Response("bad stream path", { status: 400 });

    const bridge = this.bridgeSocket(machineId);
    const att = bridge && this.attachment(bridge);
    if (!bridge || att?.kind !== "bridge") {
      return Response.json({ error: "machine offline" }, { status: 502 });
    }

    const sid = crypto.randomUUID();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [streamTag(sid), clientGenTag(att.gen)]);
    const attachment: ClientAttachment = {
      kind: "client",
      sid,
      machineId,
      gen: att.gen,
      audit: url.searchParams.get("audit"),
    };
    server.serializeAttachment(attachment);

    bridge.send(encodeFrame({ t: "open", sid, path }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Hibernation handlers -----------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = this.attachment(ws);
    if (!att) return;
    if (att.kind === "client") {
      this.clientToBridge(ws, att, message);
      return;
    }
    if (typeof message !== "string") return;
    const frame = parseBridgeFrame(message);
    if (frame) this.fromBridge(ws, att, frame);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.socketGone(ws, code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.socketGone(ws, 1011, "socket error");
  }

  private socketGone(ws: WebSocket, code: number, reason: string): void {
    const att = this.attachment(ws);
    if (att?.kind === "bridge") {
      this.touchLastSeen(att.machineId, true);
      this.dropBridge(ws, code, reason);
    } else if (att?.kind === "client") {
      this.stampDetached(att.audit);
      const bridge = this.bridgeSocketByGen(att.machineId, att.gen);
      if (bridge) this.sendToBridge(bridge, { t: "close", sid: att.sid, code, reason });
      safeClose(ws, code, reason);
    } else {
      safeClose(ws, code, reason);
    }
  }

  // --- Mux ----------------------------------------------------------------

  private fromBridge(ws: WebSocket, att: BridgeAttachment, frame: BridgeFrame): void {
    switch (frame.t) {
      case "hello":
        att.hello = { hostname: frame.hostname, backend: frame.backend, version: frame.version };
        ws.serializeAttachment(att);
        this.touchLastSeen(att.machineId, false);
        return;
      case "res": {
        const pending = this.pending.get(frame.id);
        // A response is only honoured from the connection the request went to.
        if (!pending || pending.gen !== att.gen) return;
        let body: Uint8Array;
        try {
          body = b64ToBytes(frame.b64);
        } catch {
          this.settlePending(frame.id, jsonResponse(502, { error: "malformed machine response" }));
          return;
        }
        this.settlePending(frame.id, { status: frame.status, headers: frame.headers, body });
        return;
      }
      case "data": {
        const client = this.streamSocket(att, frame.sid);
        if (!client) return;
        try {
          client.send(frame.text ?? b64ToBytes(frame.b64 ?? ""));
        } catch {
          /* client went away; its close handler tells the bridge */
        }
        return;
      }
      case "close": {
        const client = this.streamSocket(att, frame.sid);
        if (!client) return;
        const clientAtt = this.attachment(client);
        if (clientAtt?.kind === "client") this.stampDetached(clientAtt.audit);
        safeClose(client, frame.code, frame.reason);
        return;
      }
      case "event":
        this.ctx.waitUntil(this.notify(att, frame.event));
        return;
    }
  }

  private clientToBridge(
    ws: WebSocket,
    att: ClientAttachment,
    message: string | ArrayBuffer,
  ): void {
    const bridge = this.bridgeSocketByGen(att.machineId, att.gen);
    if (!bridge) {
      this.stampDetached(att.audit);
      safeClose(ws, 1011, "machine disconnected");
      return;
    }
    this.sendToBridge(bridge, dataFrame(att.sid, message));
  }

  private sendToBridge(bridge: WebSocket, frame: Parameters<typeof encodeFrame>[0]): void {
    try {
      bridge.send(encodeFrame(frame));
    } catch {
      /* bridge socket closing; dropBridge cleans up */
    }
  }

  /** Tear a bridge connection down: fail its requests, close its client streams. */
  private dropBridge(ws: WebSocket, code: number, reason: string): void {
    const att = this.attachment(ws);
    if (att?.kind === "bridge") {
      for (const [id, pending] of this.pending) {
        if (pending.gen === att.gen) {
          this.settlePending(id, jsonResponse(502, { error: "machine disconnected" }));
        }
      }
      for (const client of this.ctx.getWebSockets(clientGenTag(att.gen))) {
        const clientAtt = this.attachment(client);
        if (clientAtt?.kind === "client") this.stampDetached(clientAtt.audit);
        safeClose(client, 1011, "machine disconnected");
      }
    }
    safeClose(ws, code, reason);
  }

  private settlePending(id: string, res: RelayResponse): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.resolve(res);
  }

  // --- Lookups ------------------------------------------------------------

  private attachment(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }

  /** The newest open bridge socket of a machine. */
  private bridgeSocket(machineId: string): WebSocket | null {
    let best: { ws: WebSocket; at: number } | null = null;
    for (const ws of this.ctx.getWebSockets(bridgeTag(machineId))) {
      const att = this.attachment(ws);
      if (att?.kind !== "bridge" || ws.readyState !== OPEN) continue;
      if (!best || att.connectedAt > best.at) best = { ws, at: att.connectedAt };
    }
    return best?.ws ?? null;
  }

  private bridgeSocketByGen(machineId: string, gen: string): WebSocket | null {
    for (const ws of this.ctx.getWebSockets(bridgeTag(machineId))) {
      const att = this.attachment(ws);
      if (att?.kind === "bridge" && att.gen === gen && ws.readyState === OPEN) return ws;
    }
    return null;
  }

  /** The client socket of stream `sid`, only if it belongs to this bridge connection. */
  private streamSocket(bridge: BridgeAttachment, sid: string): WebSocket | null {
    for (const ws of this.ctx.getWebSockets(streamTag(sid))) {
      const att = this.attachment(ws);
      if (att?.kind === "client" && att.gen === bridge.gen) return ws;
    }
    return null;
  }

  // --- Side effects (D1, push) --------------------------------------------

  private touchLastSeen(machineId: string, force: boolean): void {
    const now = Date.now();
    if (!force && now - (this.lastSeenWritten.get(machineId) ?? 0) < LAST_SEEN_THROTTLE_MS) return;
    this.lastSeenWritten.set(machineId, now);
    this.ctx.waitUntil(
      machines.touchLastSeen(getDb(this.env.DB), machineId).catch((err: unknown) => {
        console.error("bridge machine last_seen update failed:", err);
      }),
    );
  }

  private stampDetached(auditId: string | null): void {
    if (!auditId) return;
    this.ctx.waitUntil(
      getDb(this.env.DB)
        .update(schema.paneAudit)
        .set({ detachedAt: Date.now() })
        .where(and(eq(schema.paneAudit.id, auditId), isNull(schema.paneAudit.detachedAt)))
        .then(
          () => undefined,
          (err: unknown) => console.error("pane_audit detach stamp failed:", err),
        ),
    );
  }

  /** Agent event from a machine: push to the machine owner's devices only. */
  private async notify(att: BridgeAttachment, raw: unknown): Promise<void> {
    const parsed = agentEventSchema.safeParse(raw);
    if (!parsed.success) return;
    // The pane id the app opens is the namespaced one, not the bridge-local id.
    const event = { ...parsed.data, pane_id: prefixPaneId(att.machineId, parsed.data.pane_id) };
    await recordSessionEvent(getDb(this.env.DB), att.machineId, parsed.data);
    try {
      await pushAgentEvent(getDb(this.env.DB), this.env, [att.userId], event, att.machineName);
    } catch (err) {
      console.error(`relay agent-event failed (${att.machineId}):`, err);
    }
  }
}
