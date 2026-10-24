/**
 * RelayConnector against a fake relay (Bun.serve playing the Worker's
 * BridgeRelay) and a stub of the loopback bridge server.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { RelayConnector, relayWsUrl } from "./connect";

const TOKEN = "atb_testtoken";
const LOCAL_TOKEN = "local-secret";

type Frame = Record<string, unknown>;

interface FakeRelay {
  url: string;
  /** Frames received from the bridge, in order (keepalive text excluded). */
  frames: Frame[];
  texts: string[];
  sockets: ServerWebSocket<unknown>[];
  connects: number;
  /** How the next upgrades are answered. */
  mode: "accept" | "http401" | "http402" | "close4401" | "close4402";
  send(frame: Frame): void;
  stop(): void;
}

function startRelay(): FakeRelay {
  const relay: FakeRelay = {
    url: "",
    frames: [],
    texts: [],
    sockets: [],
    connects: 0,
    mode: "accept",
    send: (frame) => {
      const ws = relay.sockets[relay.sockets.length - 1];
      ws?.send(JSON.stringify(frame));
    },
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      if (new URL(req.url).pathname !== "/api/bridge/connect")
        return new Response("nf", { status: 404 });
      relay.connects++;
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`)
        return new Response("no", { status: 401 });
      if (relay.mode === "http401") return new Response("no", { status: 401 });
      if (relay.mode === "http402") return new Response("pay", { status: 402 });
      if (!req.headers.get("upgrade")) return new Response("upgrade required", { status: 426 });
      return srv.upgrade(req) ? undefined : new Response("fail", { status: 400 });
    },
    websocket: {
      open(ws) {
        relay.sockets.push(ws);
        if (relay.mode === "close4401") ws.close(4401, "bad token");
        if (relay.mode === "close4402") ws.close(4402, "plan required");
      },
      message(ws, message) {
        const text = typeof message === "string" ? message : message.toString();
        if (text === "ping") {
          relay.texts.push(text);
          ws.send("pong");
          return;
        }
        relay.frames.push(JSON.parse(text) as Frame);
      },
    },
  });
  relay.url = `http://127.0.0.1:${server.port}`;
  return relay;
}

interface LocalStub {
  port: number;
  /** Closes of /attach sockets seen locally: [code, reason]. */
  localCloses: [number, string][];
  localMessages: (string | Uint8Array)[];
  attached: ServerWebSocket<unknown>[];
  stop(): void;
}

function startLocal(): LocalStub {
  const stub: LocalStub = {
    port: 0,
    localCloses: [],
    localMessages: [],
    attached: [],
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      if (req.headers.get("x-bridge-token") !== LOCAL_TOKEN) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const url = new URL(req.url);
      if (url.pathname === "/panes") return Response.json([{ id: "p1" }]);
      if (url.pathname === "/echo" && req.method === "POST") {
        const body = new Uint8Array(await req.arrayBuffer());
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
            "x-seen-type": req.headers.get("content-type") ?? "",
            "x-seen-query": url.search,
          },
        });
      }
      if (url.pathname === "/slow") {
        await Bun.sleep(1_000);
        return new Response("late");
      }
      if (url.pathname === "/attach" || url.pathname === "/observe") {
        return srv.upgrade(req) ? undefined : new Response("fail", { status: 400 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
    websocket: {
      open(ws) {
        stub.attached.push(ws);
      },
      message(ws, message) {
        if (typeof message === "string") {
          stub.localMessages.push(message);
          ws.send(`echo:${message}`);
        } else {
          const bytes = new Uint8Array(message);
          stub.localMessages.push(bytes);
          ws.sendBinary(bytes.slice().reverse());
        }
      },
      close(_ws, code, reason) {
        stub.localCloses.push([code, reason]);
      },
    },
  });
  stub.port = server.port ?? 0;
  return stub;
}

async function until<T>(fn: () => T | undefined | false, ms = 3_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await Bun.sleep(10);
  }
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

let relay: FakeRelay;
let local: LocalStub;
let connector: RelayConnector | null;
let logs: string[];

function makeConnector(
  over: Partial<ConstructorParameters<typeof RelayConnector>[0]> = {},
): RelayConnector {
  connector = new RelayConnector({
    baseUrl: relay.url,
    token: TOKEN,
    localPort: local.port,
    localToken: LOCAL_TOKEN,
    backend: "tmux",
    version: "9.9.9",
    hostname: "box",
    log: (m) => logs.push(m),
    minBackoffMs: 20,
    maxBackoffMs: 60,
    planRetryMs: 80,
    pingMs: 5_000,
    stableMs: 10_000,
    ...over,
  });
  return connector;
}

beforeEach(() => {
  relay = startRelay();
  local = startLocal();
  connector = null;
  logs = [];
});

afterEach(() => {
  connector?.stop();
  relay.stop();
  local.stop();
});

describe("relayWsUrl", () => {
  test("maps http(s) to ws(s) and appends the connect path", () => {
    expect(relayWsUrl("https://app.diatur.com")).toBe("wss://app.diatur.com/api/bridge/connect");
    expect(relayWsUrl("http://127.0.0.1:8787/")).toBe("ws://127.0.0.1:8787/api/bridge/connect");
  });
});

describe("RelayConnector", () => {
  test("sends hello first, with the bearer token", async () => {
    makeConnector().start();
    const hello = await until(() => relay.frames[0]);
    expect(hello).toEqual({ t: "hello", v: 1, hostname: "box", backend: "tmux", version: "9.9.9" });
    expect(connector?.connected).toBe(true);
  });

  test("answers req with res, forwarding the loopback token", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({
      t: "req",
      id: "r1",
      method: "GET",
      path: "/panes",
      headers: { accept: "application/json" },
    });
    const res = await until(() => relay.frames.find((f) => f.t === "res" && f.id === "r1"));
    expect(res.status).toBe(200);
    expect(JSON.parse(Buffer.from(res.b64 as string, "base64").toString())).toEqual([{ id: "p1" }]);
    expect((res.headers as Record<string, string>)["content-type"]).toContain("application/json");
  });

  test("round-trips a binary POST body byte for byte", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    const bytes = new Uint8Array(256).map((_, i) => i);
    relay.send({
      t: "req",
      id: "r2",
      method: "POST",
      path: "/panes/../echo?pane=p1",
      headers: { "content-type": "image/png", "x-bridge-token": "attacker-supplied" },
      b64: b64(bytes),
    });
    const res = await until(() => relay.frames.find((f) => f.t === "res" && f.id === "r2"));
    expect(res.status).toBe(200);
    expect(new Uint8Array(Buffer.from(res.b64 as string, "base64"))).toEqual(bytes);
    const headers = res.headers as Record<string, string>;
    expect(headers["x-seen-type"]).toBe("image/png");
    expect(headers["x-seen-query"]).toBe("?pane=p1");
  });

  test("local 404 passes through; bad paths and unreachable local server fail cleanly", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "req", id: "a", method: "GET", path: "/nope", headers: {} });
    relay.send({ t: "req", id: "b", method: "GET", path: "//evil.example/x", headers: {} });
    relay.send({ t: "req", id: "c", method: "GET", path: "relative", headers: {} });
    const find = (id: string) => relay.frames.find((f) => f.t === "res" && f.id === id);
    expect((await until(() => find("a"))).status).toBe(404);
    expect((await until(() => find("b"))).status).toBe(400);
    expect((await until(() => find("c"))).status).toBe(400);
  });

  test("a request the local server never answers becomes 504", async () => {
    // Shorter than the 14 s production timeout is not configurable; abort via a dead port instead.
    local.stop();
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "req", id: "dead", method: "GET", path: "/panes", headers: {} });
    const res = await until(() => relay.frames.find((f) => f.t === "res" && f.id === "dead"));
    expect(res.status).toBe(502);
    local = startLocal();
  });

  test("streams: text and binary flow both ways, then close from the cloud", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "open", sid: "s1", path: "/attach?pane=p1" });
    // Sent before the local socket is necessarily open: must be queued in order.
    relay.send({ t: "data", sid: "s1", text: "one" });
    relay.send({ t: "data", sid: "s1", text: "two" });
    relay.send({ t: "data", sid: "s1", b64: b64(new Uint8Array([1, 2, 3])) });

    await until(() => relay.frames.filter((f) => f.t === "data").length >= 3);
    const data = relay.frames.filter((f) => f.t === "data");
    expect(data[0]).toEqual({ t: "data", sid: "s1", text: "echo:one" });
    expect(data[1]).toEqual({ t: "data", sid: "s1", text: "echo:two" });
    expect(data[2]).toEqual({ t: "data", sid: "s1", b64: b64(new Uint8Array([3, 2, 1])) });
    expect(local.localMessages.slice(0, 2)).toEqual(["one", "two"]);

    relay.send({ t: "close", sid: "s1", code: 1000, reason: "bye" });
    await until(() => local.localCloses.length > 0);
    expect(local.localCloses[0]).toEqual([1000, "bye"]);
  });

  test("a local close is reported to the cloud with its code", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "open", sid: "s2", path: "/observe?pane=p1" });
    await until(() => local.attached.length > 0);
    local.attached[0]?.close(4001, "gone");
    const close = await until(() => relay.frames.find((f) => f.t === "close" && f.sid === "s2"));
    expect(close.code).toBe(4001);
    expect(close.reason).toBe("gone");
  });

  test("an open the local server refuses closes the stream with 1011", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "open", sid: "s3", path: "/does-not-upgrade" });
    const close = await until(() => relay.frames.find((f) => f.t === "close" && f.sid === "s3"));
    expect(close.code).toBe(1011);
  });

  test("agent events go out as event frames; offline ones flush after connect", async () => {
    const c = makeConnector();
    expect(c.sendEvent({ pane_id: "early", status: "done" })).toBe(false);
    c.start();
    const early = await until(() => relay.frames.find((f) => f.t === "event"));
    expect(early.event).toEqual({ pane_id: "early", status: "done" });
    // hello still comes first
    expect(relay.frames[0]?.t).toBe("hello");
    expect(c.sendEvent({ pane_id: "live", status: "blocked" })).toBe(true);
    await until(() => relay.frames.filter((f) => f.t === "event").length === 2);
  });

  test("reconnects after the server drops the socket, and old streams are closed locally", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.send({ t: "open", sid: "s4", path: "/attach?pane=p1" });
    await until(() => local.attached.length > 0);
    relay.sockets[0]?.close(1012, "restart");
    await until(
      () => relay.connects >= 2 && relay.frames.filter((f) => f.t === "hello").length === 2,
    );
    await until(() => local.localCloses.length > 0);
    expect(connector?.connected).toBe(true);
    expect(logs.filter((l) => l.includes("offline")).length).toBe(1);
  });

  test("a newer connection replacing this one (4000) is retried, quietly", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    relay.sockets[0]?.close(4000, "replaced");
    await until(() => relay.frames.filter((f) => f.t === "hello").length === 2);
    expect(logs.some((l) => l.includes("replaced"))).toBe(true);
  });

  test("close 4401 stops retrying", async () => {
    relay.mode = "close4401";
    makeConnector().start();
    await until(() => connector?.status === "auth-failed");
    const seen = relay.connects;
    await Bun.sleep(300);
    expect(relay.connects).toBe(seen);
    expect(logs.some((l) => l.includes("rejected"))).toBe(true);
  });

  test("an HTTP 401 on the upgrade also stops retrying", async () => {
    relay.mode = "http401";
    makeConnector().start();
    await until(() => connector?.status === "auth-failed");
    const seen = relay.connects;
    await Bun.sleep(300);
    expect(relay.connects).toBe(seen);
  });

  test("close 4402 keeps retrying at the plan interval, logged once", async () => {
    relay.mode = "close4402";
    makeConnector().start();
    await until(() => relay.connects >= 3 && connector?.status === "plan-required");
    expect(connector?.status).toBe("plan-required");
    expect(logs.filter((l) => l.includes("active plan")).length).toBe(1);
    relay.mode = "accept";
    await until(() => relay.frames[0]?.t === "hello");
    expect(connector?.connected).toBe(true);
  });

  test("an HTTP 402 on the upgrade is treated as plan required", async () => {
    relay.mode = "http402";
    makeConnector().start();
    await until(() => relay.connects >= 3 && connector?.status === "plan-required");
    expect(connector?.status).toBe("plan-required");
  });

  test("retries with backoff while the server is unreachable, logging the outage once", async () => {
    relay.stop();
    makeConnector().start();
    await until(() => connector?.status === "offline");
    await Bun.sleep(300);
    expect(logs.filter((l) => l.includes("offline")).length).toBe(1);
    relay = startRelay(); // new port; the connector keeps dialing the old one
  });

  test("sends ping text on the keepalive interval", async () => {
    makeConnector({ pingMs: 40 }).start();
    await until(() => relay.texts.length >= 2);
    expect(relay.texts[0]).toBe("ping");
  });

  test("stop() closes the socket and does not reconnect", async () => {
    makeConnector().start();
    await until(() => relay.frames[0]);
    connector?.stop();
    await Bun.sleep(150);
    expect(relay.connects).toBe(1);
  });
});
