/**
 * Keyboard ownership arbitration (DEV-32): claim/grant/steal/release and the
 * read-only input gate. herdr rpc is stubbed — no socket; handleUpgrade
 * awaits greet, so every test is deterministic (no timers).
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";

const rpcCalls: { method: string; params: Record<string, unknown> }[] = [];

// Stub the herdr socket layer before importing the hub: pane.get/layout/read
// answer immediately; send_input is recorded so tests can count deliveries.
mock.module("./herdr", () => ({
  HerdrError: class HerdrError extends Error {},
  rpc: (method: string, params: Record<string, unknown> = {}) => {
    rpcCalls.push({ method, params });
    switch (method) {
      case "pane.get": {
        // Test stub: params is the exact object this module's caller built.
        const p = params as { pane_id?: string };
        return Promise.resolve({ pane: { pane_id: p.pane_id, cwd: "/srv/acme" } });
      }
      case "pane.layout":
        return Promise.resolve({ layout: { panes: [] } });
      case "pane.read":
        return Promise.resolve({
          read: { pane_id: "p1", text: "row0\r\nrow1", revision: 1, truncated: false },
        });
      default:
        return Promise.resolve({});
    }
  },
}));

import { PaneHub } from "./hub";

interface FakeWs {
  sent: string[];
}

// Single unchecked cast point: Bun's ServerWebSocket carries private event
// emitter internals no test can construct; the hub only calls data/send.
type TestWs = ServerWebSocket<{ paneId: string; joined: boolean }> & FakeWs;

function fakeWs(paneId: string): TestWs {
  const sent: string[] = [];
  const ws = {
    sent,
    data: { paneId, joined: false },
    send: (msg: string) => {
      sent.push(msg);
    },
    getBufferedAmount: () => 0,
  };
  return ws as TestWs;
}

function frames(sent: string[], type: string): Record<string, unknown>[] {
  return sent
    .map((m) => JSON.parse(m) as Record<string, unknown>)
    .filter((m) => m.type === type);
}

async function attach(paneId: string): Promise<TestWs> {
  const ws = fakeWs(paneId);
  const ok = await hub.handleUpgrade(ws);
  if (!ok) throw new Error("upgrade refused");
  return ws;
}

const hub = new PaneHub();

afterEach(() => {
  rpcCalls.length = 0;
  hub.stop();
});

describe("keyboard ownership", () => {
  test("solo viewer claims and is told it owns the keyboard", async () => {
    const a = await attach("p1");
    hub.handleMessage(a, JSON.stringify({ type: "claim" }));
    expect(frames(a.sent, "keyboard")).toEqual([{ type: "keyboard", you: true }]);
  });

  test("latecomer is read-only until it steals; the owner is demoted", async () => {
    const a = await attach("p1");
    const b = await attach("p1");

    hub.handleMessage(a, JSON.stringify({ type: "claim" }));
    hub.handleMessage(b, JSON.stringify({ type: "claim" })); // steal

    // b's steal broadcasts to both: a loses, b gains.
    expect(frames(a.sent, "keyboard").at(-1)).toEqual({ type: "keyboard", you: false });
    expect(frames(b.sent, "keyboard").at(-1)).toEqual({ type: "keyboard", you: true });
  });

  test("non-owner input is rejected before reaching herdr", async () => {
    const a = await attach("p1");
    const b = await attach("p1");
    hub.handleMessage(a, JSON.stringify({ type: "claim" }));

    const sendInputCalls = () => rpcCalls.filter((c) => c.method === "pane.send_input").length;
    const before = sendInputCalls();

    await hub.handleMessage(b, JSON.stringify({ type: "input", data: "ls\r" }));
    const lastError = frames(b.sent, "error").at(-1);
    expect(typeof lastError?.message).toBe("string");
    expect(String(lastError?.message)).toMatch(/read-only/);
    expect(sendInputCalls()).toBe(before);

    await hub.handleMessage(a, JSON.stringify({ type: "input", data: "ls\r" }));
    expect(sendInputCalls()).toBeGreaterThan(before);
  });

  test("owner disconnect frees the keyboard for the rest", async () => {
    const a = await attach("p1");
    const b = await attach("p1");
    hub.handleMessage(a, JSON.stringify({ type: "claim" }));
    frames(a.sent, "keyboard").length = 0;
    frames(b.sent, "keyboard").length = 0;

    hub.detach(a); // owner leaves

    expect(frames(b.sent, "keyboard").at(-1)).toEqual({ type: "keyboard", you: false });

    // And b can now take it.
    hub.handleMessage(b, JSON.stringify({ type: "claim" }));
    expect(frames(b.sent, "keyboard").at(-1)).toEqual({ type: "keyboard", you: true });
  });

  test("hello carries the connection's ownership state", async () => {
    const a = await attach("p1");
    hub.handleMessage(a, JSON.stringify({ type: "claim" }));

    const c = await attach("p1"); // joins while a owns the keyboard
    const hello = frames(c.sent, "hello").at(-1);
    expect(hello?.keyboard).toBe(false);
  });
});
