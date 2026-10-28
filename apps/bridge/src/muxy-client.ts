/**
 * One connection to a Muxy server socket: handshake, request/reply
 * correlation and a callback for everything the server pushes. The wire
 * format is in muxy-wire.ts. Never starts a server: a missing or stale socket
 * is a connect error.
 */
import type { Socket } from "bun";
import {
  CONTROL,
  FEATURE_TERMINAL_INPUT,
  FrameParser,
  Kind,
  PROTOCOL_VERSION,
  WireError,
  hello,
  parseError,
  parseHelloReply,
  parseReply,
  type Cbor,
  type Message,
  type Reply,
  type ServerHello,
} from "./muxy-wire";

const HANDSHAKE_TIMEOUT_MS = 3000;
export const REQUEST_TIMEOUT_MS = 8000;

/** The server answered a request with an error reply. */
export class MuxyServerError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "MuxyServerError";
  }
}

/** The server cannot talk to this bridge (protocol version, missing feature). Not retryable. */
export class MuxyUnsupportedError extends Error {}

/** A reply that is not an error reply (those reject with MuxyServerError). */
export type OkReply = Exclude<Reply, { type: "error" }>;

interface Pending {
  resolve(reply: OkReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  /** Runs in the dispatch loop, before the next message is handled. */
  sync: ((reply: OkReply) => void) | undefined;
}

export interface ConnectionHandlers {
  /** Anything that is not a reply: pushed invalidations, metadata, frames. */
  onMessage(message: Message): void;
  /** The connection is gone (once). */
  onClose(reason: Error): void;
}

export class MuxyConnection {
  readonly server: ServerHello;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private outbound: Uint8Array[] = [];

  private constructor(
    private readonly socket: Socket,
    server: ServerHello,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.server = server;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /**
   * Connects and negotiates. Rejects with MuxyUnsupportedError when the server
   * does not speak this protocol version or lacks terminal input, and with the
   * socket's own error when nothing answers.
   */
  static async open(path: string, handlers: ConnectionHandlers): Promise<MuxyConnection> {
    const parser = new FrameParser();
    const handshake = Promise.withResolvers<ServerHello>();
    let connection: MuxyConnection | null = null;
    const failHandshake = (error: Error) => handshake.reject(error);

    const dispatch = (messages: Message[]) => {
      for (const message of messages) {
        if (connection) connection.dispatch(message);
        else if (message.kind === Kind.HelloReply) {
          try {
            handshake.resolve(parseHelloReply(message.fields as Cbor[]));
          } catch (e) {
            failHandshake(e as Error);
          }
        } else if (message.kind === Kind.VersionUnsupported) {
          failHandshake(new MuxyUnsupportedError(versionMessage(null)));
        } else if (message.kind === Kind.Fatal) {
          failHandshake(
            new MuxyUnsupportedError(
              `Muxy refused the connection: ${parseError(message.fields as Cbor[]).message}`,
            ),
          );
        }
      }
    };

    const socket = await Bun.connect({
      unix: path,
      socket: {
        data(socket, data) {
          try {
            dispatch(parser.push(new Uint8Array(data)));
          } catch (e) {
            // A frame this bridge cannot read: the stream cannot be resynchronised.
            const error = e instanceof Error ? e : new Error(String(e));
            if (connection) connection.shutdown(new WireError(`muxy: ${error.message}`));
            else failHandshake(new MuxyUnsupportedError(versionMessage(null)));
            socket.end();
          }
        },
        drain() {
          connection?.flush();
        },
        close() {
          if (connection) connection.shutdown(new Error("muxy connection closed"));
          else failHandshake(new Error("muxy connection closed during the handshake"));
        },
        error(_socket, error) {
          if (connection) connection.shutdown(error);
          else failHandshake(error);
        },
      },
    });

    const timer = setTimeout(
      () => failHandshake(new Error("muxy handshake timed out")),
      HANDSHAKE_TIMEOUT_MS,
    );
    try {
      socket.write(hello());
      const server = await handshake.promise;
      if (!server.versions.includes(PROTOCOL_VERSION)) {
        throw new MuxyUnsupportedError(versionMessage(server));
      }
      if (!server.features.includes(FEATURE_TERMINAL_INPUT)) {
        throw new MuxyUnsupportedError(
          `Muxy ${server.version} cannot encode terminal input on the server. Update Muxy to 2.2 or newer.`,
        );
      }
      connection = new MuxyConnection(socket, server, handlers);
      return connection;
    } catch (e) {
      socket.end();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private dispatch(message: Message): void {
    if (this.closed) return;
    if (message.channel === CONTROL && message.kind === Kind.Reply) {
      this.reply(message.fields as Cbor[]);
      return;
    }
    if (message.channel === CONTROL && message.kind === Kind.Fatal) {
      this.shutdown(new Error(`muxy: ${parseError(message.fields as Cbor[]).message}`));
      this.socket.end();
      return;
    }
    if (message.kind === Kind.ServerRestarting) {
      this.shutdown(new Error("muxy server is restarting"));
      this.socket.end();
      return;
    }
    try {
      this.handlers.onMessage(message);
    } catch (e) {
      console.error("muxy: handling a pushed message failed:", e);
    }
  }

  private reply(fields: Cbor[]): void {
    const id = fields[0];
    const entry = typeof id === "number" ? this.pending.get(id) : undefined;
    if (!entry) return; // a late reply to a request that already timed out
    this.pending.delete(id as number);
    clearTimeout(entry.timer);
    try {
      const reply = parseReply(fields[1] as Cbor);
      if (reply.type === "error") {
        entry.reject(new MuxyServerError(reply.error.code, reply.error.message));
        return;
      }
      entry.sync?.(reply);
      entry.resolve(reply);
    } catch (e) {
      entry.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Sends a request and resolves with its reply. `sync` runs as soon as the
   * reply is parsed, before any message behind it is dispatched: an attach
   * reply must register its channel before the first frame for it is handled.
   */
  request(
    build: (id: number) => Uint8Array,
    sync?: (reply: OkReply) => void,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<OkReply> {
    if (this.closed) return Promise.reject(new Error("muxy connection closed"));
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<OkReply>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error("muxy request timed out"));
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timer, sync });
    try {
      this.write(build(id));
    } catch (e) {
      this.pending.delete(id);
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
    return promise;
  }

  /** Fire and forget (acks, input frames). */
  send(bytes: Uint8Array): void {
    if (this.closed) throw new Error("muxy connection closed");
    this.write(bytes);
  }

  private write(bytes: Uint8Array): void {
    if (this.outbound.length > 0) {
      this.outbound.push(bytes);
      return;
    }
    const written = this.socket.write(bytes);
    if (written < bytes.length) this.outbound.push(bytes.subarray(Math.max(written, 0)));
  }

  private flush(): void {
    while (this.outbound.length > 0) {
      const head = this.outbound[0] as Uint8Array;
      const written = this.socket.write(head);
      if (written < head.length) {
        this.outbound[0] = head.subarray(Math.max(written, 0));
        return;
      }
      this.outbound.shift();
    }
  }

  close(): void {
    if (this.closed) return;
    this.shutdown(new Error("muxy connection closed"));
    this.socket.end();
  }

  private shutdown(reason: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.outbound = [];
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
    this.handlers.onClose(reason);
  }
}

function versionMessage(server: ServerHello | null): string {
  const theirs = server
    ? `Muxy ${server.version} speaks protocol ${server.versions.join(", ")}`
    : "this Muxy server is older than protocol 2 or speaks another framing";
  return `unsupported Muxy protocol: ${theirs}; this bridge speaks protocol ${PROTOCOL_VERSION} (Muxy 2.2). Update the bridge or Muxy.`;
}
