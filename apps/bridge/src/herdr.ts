/**
 * Minimal typed client for the herdr socket API (protocol 20).
 *
 * Wire format: newline-delimited JSON over a unix socket.
 * Request:  {"method":"pane.read","params":{...},"id":"1"}
 * Response: {"id":"1","result":{...}} | {"id":"1","error":{"code","message"}}
 *
 * Observed server behavior (v0.8.2): unary connections are closed by the
 * server after one response — one request per connection. `events.subscribe`
 * exists but publishes no output events for plain shell panes, and
 * `pane.output_matched` fires only once at subscribe time with an empty-regex
 * match — neither is usable as an output feed. Live pane mirroring therefore
 * polls `pane.read` (see Watcher in hub.ts).
 */
import net from "node:net";
import { herdrSocketPath } from "./backend";

const SOCKET_PATH = herdrSocketPath();

let nextId = 0;

export class HerdrError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
    message: string,
  ) {
    super(`herdr ${method}: ${code}: ${message}`);
  }
}

export function rpc<T = unknown>(
  method: string,
  params: unknown = {},
  timeoutMs = 8000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH);
    let buf = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error(`herdr rpc timeout: ${method}`))),
      timeoutMs,
    );
    sock.on("connect", () => {
      sock.write(JSON.stringify({ method, params, id: String(++nextId) }) + "\n");
    });
    sock.on("data", (d: Buffer) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      done(() => {
        try {
          const msg = JSON.parse(buf.slice(0, nl)) as {
            result?: T;
            error?: { code: string; message: string };
          };
          if (msg.error) reject(new HerdrError(method, msg.error.code, msg.error.message));
          else if (msg.result !== undefined) resolve(msg.result);
          else reject(new Error(`herdr ${method}: empty response`));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
    sock.on("error", (e: Error) => done(() => reject(e)));
  });
}
