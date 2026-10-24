import { describe, expect, it } from "vitest";
import {
  RELAY_STREAM_PATH,
  b64ToBytes,
  bytesToB64,
  dataFrame,
  encodeFrame,
  isMachineToken,
  machineTokenFromHeader,
  newMachineId,
  newMachineToken,
  parseBridgeFrame,
  prefixPaneId,
  prefixPanes,
  safeCloseCode,
  splitPaneId,
} from "../relayProtocol";

const parse = (frame: unknown) => parseBridgeFrame(JSON.stringify(frame));

describe("parseBridgeFrame", () => {
  it("accepts every frame type the bridge sends", () => {
    expect(
      parse({ t: "hello", v: 1, hostname: "laptop", backend: "tmux", version: "0.3.0" }),
    ).toEqual({ t: "hello", v: 1, hostname: "laptop", backend: "tmux", version: "0.3.0" });
    expect(parse({ t: "res", id: "r1", status: 200, headers: { a: "b" }, b64: "e30=" })).toEqual({
      t: "res",
      id: "r1",
      status: 200,
      headers: { a: "b" },
      b64: "e30=",
    });
    expect(parse({ t: "data", sid: "s1", text: "hi" })).toEqual({
      t: "data",
      sid: "s1",
      text: "hi",
    });
    expect(parse({ t: "data", sid: "s1", b64: "AAE=" })).toEqual({
      t: "data",
      sid: "s1",
      b64: "AAE=",
    });
    expect(parse({ t: "close", sid: "s1", code: 1011, reason: "boom" })).toEqual({
      t: "close",
      sid: "s1",
      code: 1011,
      reason: "boom",
    });
    expect(parse({ t: "close", sid: "s1" })).toEqual({ t: "close", sid: "s1" });
    expect(parse({ t: "event", event: { pane_id: "p", status: "done" } })).toEqual({
      t: "event",
      event: { pane_id: "p", status: "done" },
    });
  });

  it("defaults a res body to empty", () => {
    expect(parse({ t: "res", id: "r1", status: 204, headers: {} })).toMatchObject({ b64: "" });
  });

  it("drops malformed frames instead of throwing", () => {
    expect(parseBridgeFrame("ping")).toBeNull();
    expect(parseBridgeFrame("[]")).toBeNull();
    expect(parseBridgeFrame("null")).toBeNull();
    expect(parse({ t: "nope" })).toBeNull();
    expect(parse({ t: "hello", hostname: "h", backend: "zellij", version: "1" })).toBeNull();
    expect(parse({ t: "hello", hostname: 1, backend: "tmux", version: "1" })).toBeNull();
    expect(parse({ t: "res", id: "r", status: "200", headers: {} })).toBeNull();
    expect(parse({ t: "res", id: "r", status: 200, headers: { a: 1 } })).toBeNull();
    expect(parse({ t: "data", sid: "s" })).toBeNull();
    expect(parse({ t: "data", sid: "s", text: "a", b64: "b" })).toBeNull();
    expect(parse({ t: "data", sid: "", text: "a" })).toBeNull();
    expect(parse({ t: "data", sid: "x".repeat(65), text: "a" })).toBeNull();
    expect(parse({ t: "close" })).toBeNull();
    expect(parse({ t: "event" })).toBeNull();
  });

  it("bounds hostname and version length", () => {
    const hello = parse({
      t: "hello",
      hostname: "h".repeat(1000),
      backend: "herdr",
      version: "v".repeat(1000),
    });
    expect(hello).toMatchObject({ t: "hello" });
    if (hello?.t !== "hello") throw new Error("expected hello");
    expect(hello.hostname).toHaveLength(255);
    expect(hello.version).toHaveLength(64);
  });
});

describe("worker frames", () => {
  it("encodes req/open/data/close as the JSON the bridge expects", () => {
    expect(
      JSON.parse(
        encodeFrame({ t: "req", id: "1", method: "GET", path: "/panes", headers: { a: "b" } }),
      ),
    ).toEqual({ t: "req", id: "1", method: "GET", path: "/panes", headers: { a: "b" } });
    expect(JSON.parse(encodeFrame({ t: "open", sid: "s", path: "/attach?pane=p" }))).toEqual({
      t: "open",
      sid: "s",
      path: "/attach?pane=p",
    });
    expect(JSON.parse(encodeFrame({ t: "close", sid: "s" }))).toEqual({ t: "close", sid: "s" });
  });

  it("sends text as text and binary as base64", () => {
    expect(dataFrame("s", "ls\r")).toEqual({ t: "data", sid: "s", text: "ls\r" });
    expect(dataFrame("s", new Uint8Array([0, 1, 255]).buffer)).toEqual({
      t: "data",
      sid: "s",
      b64: "AAH/",
    });
  });
});

describe("base64", () => {
  it("round-trips arbitrary bytes, including payloads larger than one slice", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const back = b64ToBytes(bytesToB64(bytes));
    expect(back).toHaveLength(bytes.length);
    expect(back.every((b, i) => b === bytes[i])).toBe(true);
  });

  it("rejects invalid base64", () => {
    expect(() => b64ToBytes("***")).toThrow();
  });
});

describe("safeCloseCode", () => {
  it("keeps codes a Worker may send and maps the rest to 1000", () => {
    expect(safeCloseCode(1000)).toBe(1000);
    expect(safeCloseCode(1011)).toBe(1011);
    expect(safeCloseCode(4000)).toBe(4000);
    expect(safeCloseCode(4401)).toBe(4401);
    expect(safeCloseCode(1005)).toBe(1000);
    expect(safeCloseCode(1006)).toBe(1000);
    expect(safeCloseCode(5000)).toBe(1000);
    expect(safeCloseCode(undefined)).toBe(1000);
    expect(safeCloseCode(1000.5)).toBe(1000);
  });
});

describe("pane id namespacing", () => {
  it("prefixes and strips", () => {
    expect(prefixPaneId("m7k2q", "wR:p2")).toBe("m7k2q~wR:p2");
    expect(splitPaneId("m7k2q~wR:p2")).toEqual({ machineId: "m7k2q", paneId: "wR:p2" });
  });

  it("only strips at the first separator and keeps the rest verbatim", () => {
    expect(splitPaneId("m7k2q~a~b")).toEqual({ machineId: "m7k2q", paneId: "a~b" });
  });

  it("leaves legacy pane ids alone", () => {
    expect(splitPaneId("wR:p2")).toBeNull();
    expect(splitPaneId("p_1")).toBeNull();
    expect(splitPaneId("~p1")).toBeNull();
    expect(splitPaneId("m7k2q~")).toBeNull();
  });

  it("round-trips through URL encoding (deep links, query strings)", () => {
    const id = prefixPaneId("m7k2q", "w1:p2");
    expect(encodeURIComponent(id)).toBe("m7k2q~w1%3Ap2");
    expect(splitPaneId(decodeURIComponent(encodeURIComponent(id)))).toEqual({
      machineId: "m7k2q",
      paneId: "w1:p2",
    });
  });

  it("namespaces a pane list, adds the machine, and dedupes repeated panes", () => {
    const machine = { id: "m7k2q", name: "Laptop" };
    expect(
      prefixPanes(machine, [
        { pane_id: "p1", cwd: "/a", agent: "omp" },
        { pane_id: "p1", cwd: "/a", agent: "omp" },
        { pane_id: "p2", cwd: null },
        { cwd: "/no-id" },
        "garbage",
        null,
      ]),
    ).toEqual([
      { pane_id: "m7k2q~p1", cwd: "/a", agent: "omp", machine },
      { pane_id: "m7k2q~p2", cwd: null, machine },
    ]);
    expect(prefixPanes(machine, undefined)).toEqual([]);
    expect(prefixPanes(machine, { not: "an array" })).toEqual([]);
  });
});

describe("stream path guard", () => {
  it("allows only attach/observe with a single pane query", () => {
    expect(RELAY_STREAM_PATH.test("/attach?pane=w1%3Ap2")).toBe(true);
    expect(RELAY_STREAM_PATH.test("/observe?pane=p1")).toBe(true);
    expect(RELAY_STREAM_PATH.test("/panes?pane=p1")).toBe(false);
    expect(RELAY_STREAM_PATH.test("/attach?pane=p1&x=y")).toBe(false);
    expect(RELAY_STREAM_PATH.test("/attach")).toBe(false);
    expect(RELAY_STREAM_PATH.test("//evil/attach?pane=p1")).toBe(false);
  });
});

describe("machine credentials", () => {
  it("mints atb_ + 64 hex tokens, unique each time", () => {
    const a = newMachineToken();
    expect(a).toMatch(/^atb_[0-9a-f]{64}$/);
    expect(isMachineToken(a)).toBe(true);
    expect(newMachineToken()).not.toBe(a);
  });

  it("mints short lowercase ids that survive pane-id splitting", () => {
    for (let i = 0; i < 50; i++) {
      const id = newMachineId();
      expect(id).toMatch(/^m[a-z0-9]{5}$/);
      expect(splitPaneId(prefixPaneId(id, "p1"))?.machineId).toBe(id);
    }
  });

  it("extracts only well-formed machine tokens from the Authorization header", () => {
    const token = newMachineToken();
    expect(machineTokenFromHeader(`Bearer ${token}`)).toBe(token);
    expect(machineTokenFromHeader(token)).toBeNull();
    expect(machineTokenFromHeader("Bearer pk_live_abc")).toBeNull();
    expect(machineTokenFromHeader("Bearer atb_short")).toBeNull();
    expect(machineTokenFromHeader(undefined)).toBeNull();
    expect(machineTokenFromHeader(null)).toBeNull();
  });
});
