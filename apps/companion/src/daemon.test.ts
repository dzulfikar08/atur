import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { configFromEnv, startDaemon, type StartedDaemon } from "./daemon";
import type { Json } from "./herdr";

// Integration test: a fake herdr socket server plays the session backend so
// the daemon's HTTP + WS surface (auth, snapshot fan-out, input ownership,
// dead detection) is exercised end-to-end over real sockets. Waits await the
// real signal (a WS message, a send_text arrival) — no wall-clock guesses.

const SECRET = "test-secret";
const PORT = 4071;
const PANE = "wT:p1";

interface FakePane {
  pane_id: string;
  workspace_id: string;
  title: string;
  text: string;
  agent: string | null;
  agent_status: string | null;
}

const panes = new Map<string, FakePane>([
  [
    PANE,
    {
      pane_id: PANE,
      workspace_id: "wT",
      title: "π > fake pane",
      text: "initial output\r\n",
      agent: "omp",
      agent_status: "idle",
    },
  ],
]);

const workspaces = [{ workspace_id: "wT", label: "testws" }];

// Test hook: invoked when the fake herdr receives a send_text — input tests
// await this signal instead of sleeping.
let onSendText: (() => void) | null = null;

/** herdr serves one request per connection (see herdr.ts) — mirror that. */
function startFakeHerdr(socketPath: string) {
  return Bun.listen({
    unix: socketPath,
    socket: {
      data(sock, chunk) {
        const decoded = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        let rest = decoded;
        let nl: number;
        while ((nl = rest.indexOf("\n")) !== -1) {
          const line = rest.slice(0, nl);
          rest = rest.slice(nl + 1);
          if (!line.trim()) continue;
          const req = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
          const pane = typeof req.params.pane_id === "string" ? panes.get(req.params.pane_id) : undefined;
          switch (req.method) {
            case "pane.list":
              reply(sock, req.id, { type: "pane_list", panes: [...panes.values()] });
              break;
            case "pane.get":
              if (!pane) {
                sock.write(
                  JSON.stringify({
                    id: req.id,
                    error: { code: "pane_not_found", message: `pane ${req.params.pane_id} not found` },
                  }) + "\n",
                );
              } else {
                reply(sock, req.id, {
                  type: "pane_info",
                  pane: {
                    pane_id: pane.pane_id,
                    workspace_id: pane.workspace_id,
                    tab_id: `${pane.workspace_id}:t1`,
                    terminal_title: pane.title,
                    agent: pane.agent,
                    agent_status: pane.agent_status,
                  },
                });
              }
              break;
            case "pane.read":
              if (!pane) {
                sock.write(JSON.stringify({ id: req.id, error: { code: "pane_not_found", message: "pane not found" } }) + "\n");
              } else {
                reply(sock, req.id, {
                  type: "pane_read",
                  read: { pane_id: pane.pane_id, text: pane.text, revision: 0, truncated: false },
                });
              }
              break;
            case "pane.send_text":
              if (pane) pane.text += String(req.params.text);
              onSendText?.();
              reply(sock, req.id, { type: "ok" });
              break;
            case "workspace.list":
              reply(sock, req.id, { type: "workspace_list", workspaces });
              break;
            default:
              sock.write(JSON.stringify({ id: req.id, error: { code: "unknown_method", message: req.method } }) + "\n");
          }
        }
      },
    },
  });
}

function reply(sock: { write(s: string): unknown }, id: string, result: Json) {
  sock.write(JSON.stringify({ id, result }) + "\n");
}

let daemon: StartedDaemon;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "companion-test-"));
  const socketPath = join(tmpDir, "herdr.sock");
  startFakeHerdr(socketPath);
  const cfg = configFromEnv({
    COMPANION_SECRET: SECRET,
    COMPANION_PORT: String(PORT),
    HERDR_SOCKET_PATH: socketPath,
    COMPANION_POLL_MS: "25",
  });
  if ("error" in cfg) throw new Error(cfg.error);
  daemon = await startDaemon(cfg);
});

afterAll(async () => {
  await daemon?.stop();
  rmSync(tmpDir, { recursive: true, force: true });
});

const attachUrl = (pane = PANE) => `ws://127.0.0.1:${daemon.port}/attach?pane=${encodeURIComponent(pane)}`;

/** Opens a viewer WS with daemon-auth headers and collects ordered messages. */
function connectViewer(user = "alice"): Promise<{ ws: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  // Bun's WS client accepts a headers options object the DOM typings omit.
  const opts = { headers: { "x-companion-auth": SECRET, "x-atur-user-id": user, "x-atur-user-name": user } };
  const ws = new WebSocket(attachUrl(), opts as unknown as string[]);
  const queue: Record<string, unknown>[] = [];
  const waiters: ((v: Record<string, unknown>) => void)[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string);
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  };
  const next = () => {
    const existing = queue.shift();
    if (existing) return Promise.resolve(existing);
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    waiters.push(resolve);
    return promise;
  };
  const opened = Promise.withResolvers<void>();
  ws.onopen = () => opened.resolve();
  return opened.promise.then(() => ({ ws, next }));
}

// Resolves on the next send_text the fake herdr receives.
function nextSendText(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  onSendText = resolve;
  return promise;
}

const send = (ws: WebSocket, msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));

describe("companion daemon HTTP surface", () => {
  it("exposes /health", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/health`);
    expect(res.status).toBe(200);
  });

  it("GET /panes requires the shared secret", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/panes`);
    expect(res.status).toBe(401);
  });

  it("GET /panes lists panes with workspace labels", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/panes`, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { panes: { pane_id: string; workspace_label: string }[] };
    const pane = body.panes.find((p) => p.pane_id === PANE);
    expect(pane?.workspace_label).toBe("testws");
  });

  it("GET /attach without the secret → 401", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/attach?pane=${PANE}`);
    expect(res.status).toBe(401);
  });

  it("GET /attach with a browser Origin → 403", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/attach?pane=${PANE}`, {
      headers: { "x-companion-auth": SECRET, origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("GET /attach without pane param → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/attach`, {
      headers: { "x-companion-auth": SECRET },
    });
    expect(res.status).toBe(400);
  });

  it("GET /attach unknown pane → 404", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/attach?pane=NO:p9`, {
      headers: { "x-companion-auth": SECRET },
    });
    expect(res.status).toBe(404);
  });

  it("GET /attach (no upgrade) returns the authz verdict for curl", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/attach?pane=${PANE}`, {
      headers: { "x-companion-auth": SECRET },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; pane: string };
    expect(body).toEqual({ ok: true, pane: PANE });
  });
});

describe("companion daemon WS attach", () => {
  it("sends hello + snapshot, fans out changes, serializes input to one owner", async () => {
    const a = await connectViewer("alice");
    const hello = await a.next();
    expect(hello.t).toBe("hello");
    expect((hello.pane as Record<string, unknown>).title).toBe("π > fake pane");
    const snap = await a.next();
    expect(snap.t).toBe("out");
    expect(snap.data).toBe("initial output\r\n");

    // A second viewer sees the same output…
    const b = await connectViewer("bob");
    expect((await b.next()).t).toBe("hello"); // hello
    expect((await b.next()).t).toBe("out"); // snapshot

    // …but cannot inject input while alice owns the keyboard.
    send(a.ws, { t: "claim" });
    const aClaim = await a.next();
    expect(aClaim).toEqual({ t: "claimed", ok: true, owner: { id: "alice", name: "alice" } });
    await b.next(); // owner broadcast reaches bob too

    const delivered = nextSendText();
    send(b.ws, { t: "input", data: "evil\r" });
    send(a.ws, { t: "input", data: "typed-by-owner" });
    await delivered;
    const pane = panes.get(PANE)!;
    expect(pane.text).toContain("typed-by-owner");
    expect(pane.text).not.toContain("evil");

    // Ownership transfer: alice releases, bob claims.
    send(a.ws, { t: "release" });
    await b.next(); // owner → null broadcast
    send(b.ws, { t: "claim" });
    const bClaim = await b.next();
    expect(bClaim.ok).toBe(true);

    // Output changes fan out to both viewers.
    pane.text = "updated output\r\n";
    const aOut = await a.next();
    expect(aOut.t).toBe("out");
    expect(aOut.data).toBe("updated output\r\n");
    const bOut = await b.next();
    expect(bOut.data).toBe("updated output\r\n");

    a.ws.close(1000, "done");
    b.ws.close(1000, "done");
  });

  it("reports a dead pane when herdr loses it", async () => {
    const v = await connectViewer("carol");
    await v.next(); // hello
    await v.next(); // out
    panes.delete(PANE);
    const dead = await v.next();
    expect(dead.t).toBe("dead");
    v.ws.close(1000, "done");
  });
});
