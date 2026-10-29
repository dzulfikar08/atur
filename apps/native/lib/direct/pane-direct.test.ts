import { expect, test } from "bun:test";

import type { DirectLink, DirectSnapshot } from "@/lib/direct/manager";
import { openDirectPane, type DirectPaneHandlers } from "@/lib/direct/pane-direct";
import { FakeLink, flush } from "@/lib/direct/test-support";
import { DirectError } from "@/modules/atur-direct/src/types";

function fakeManager(initial: DirectLink | null = null) {
  let connection = initial;
  const listeners = new Set<() => void>();
  const snapshot = (): DirectSnapshot => ({
    loaded: true,
    state: connection ? "connected" : "offline",
    serverId: "srv-1",
    serverName: "Desk",
    connection,
    sessions: [],
    rttMs: null,
    error: null,
    preferDirect: true,
  });
  let current = snapshot();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    /** The manager's connection changed (a drop, a reconnect). */
    set(next: DirectLink | null) {
      connection = next;
      current = snapshot();
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function recorder() {
  const calls: unknown[][] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const handlers: DirectPaneHandlers = {
    onHello: log("hello"),
    onSnapshot: log("snapshot"),
    onDiff: log("diff"),
    onHistory: log("history"),
    onGeometry: log("geometry"),
    onError: log("error"),
    onAttached: log("attached"),
    onLost: log("lost"),
    onFailed: log("failed"),
    onExit: log("exit"),
  };
  return { calls, handlers, names: () => calls.map((c) => c[0]) };
}

const SIZE = { cols: 80, rows: 24 };

test("attaches on the live connection at the given size", async () => {
  const link = new FakeLink();
  const { handlers, calls } = recorder();
  openDirectPane(fakeManager(link), "12", handlers, SIZE);
  await flush();
  expect(link.attaches).toEqual([{ session: "12", cols: 80, rows: 24 }]);
  expect(calls).toEqual([["attached"]]);
});

test("translates the core's events into the pane callbacks", async () => {
  const link = new FakeLink();
  const { handlers, calls } = recorder();
  openDirectPane(fakeManager(link), "12", handlers, SIZE);
  await flush();
  calls.length = 0;

  link.emit({ t: "hello", session: "12", cols: 100, rows: 30 });
  link.emit({ t: "snapshot", session: "12", ansi: "a\r\nb" });
  link.emit({ t: "diff", session: "12", rows: [[1, "row"]] });
  link.emit({ t: "diff", session: "12", rows: [] });
  link.emit({ t: "geometry", session: "12", cols: 90, rows: 20 });
  link.emit({ t: "ended", session: "12" });
  expect(calls).toEqual([
    ["hello", { cols: 100, rows: 30, keyboard: true }],
    ["snapshot", "a\r\nb"],
    ["diff", [[1, "row"]]],
    ["geometry", { cols: 90, rows: 20 }],
    ["exit"],
  ]);
});

test("events of other sessions and other kinds are ignored", async () => {
  const link = new FakeLink();
  const { handlers, calls } = recorder();
  openDirectPane(fakeManager(link), "12", handlers, SIZE);
  await flush();
  calls.length = 0;

  link.emit({ t: "snapshot", session: "99", ansi: "x" });
  link.emit({ t: "ended", session: "99" });
  link.emit({ t: "title", session: "12", title: "t", directory: "/" });
  link.emit({ t: "sessions" });
  link.emit({ t: "git", projectId: "p" });
  expect(calls).toEqual([]);
});

test("a refused attach is reported, a dropped link is left to the manager", async () => {
  const refused = new FakeLink();
  refused.attachResult = new DirectError("Server", "no such session");
  const first = recorder();
  openDirectPane(fakeManager(refused), "12", first.handlers, SIZE);
  await flush();
  expect(first.calls).toEqual([["failed", "no such session"]]);

  const dropped = new FakeLink();
  dropped.attachResult = new DirectError("Disconnected", "");
  const second = recorder();
  openDirectPane(fakeManager(dropped), "12", second.handlers, SIZE);
  await flush();
  expect(second.calls).toEqual([]);
});

test("input, paste and resize go to the session; false without a connection", async () => {
  const link = new FakeLink();
  const manager = fakeManager(link);
  const { handlers } = recorder();
  const pane = openDirectPane(manager, "12", handlers, SIZE);
  await flush();

  expect(pane.sendInput("ls\r")).toBe(true);
  expect(pane.sendPaste("a\nb", true)).toBe(true);
  pane.requestResize(60, 40);
  expect(link.inputs).toEqual([{ session: "12", data: "ls\r" }]);
  expect(link.pastes).toEqual([{ session: "12", text: "a\nb", submit: true }]);
  expect(link.resizes).toEqual([{ session: "12", cols: 60, rows: 40 }]);

  manager.set(null);
  expect(pane.sendInput("x")).toBe(false);
  expect(pane.sendPaste("x", false)).toBe(false);
});

test("claiming the keyboard does nothing", async () => {
  const link = new FakeLink();
  const { handlers, calls } = recorder();
  const pane = openDirectPane(fakeManager(link), "12", handlers, SIZE);
  await flush();
  calls.length = 0;
  pane.claimKeyboard();
  expect(calls).toEqual([]);
  expect(link.inputs).toEqual([]);
});

test("history comes from the connection and reaches onHistory", async () => {
  const link = new FakeLink();
  link.historyRows = { rows: ["one", "two", "three"], visible: 2 };
  const { handlers, calls } = recorder();
  const pane = openDirectPane(fakeManager(link), "12", handlers, SIZE);
  await flush();
  calls.length = 0;

  pane.requestHistory(500);
  await flush();
  expect(calls).toEqual([["history", ["one", "two", "three"], 2]]);
});

test("reattaches on the next connection without a new pane", async () => {
  const first = new FakeLink();
  const second = new FakeLink();
  const manager = fakeManager(first);
  const { handlers, calls, names } = recorder();
  const pane = openDirectPane(manager, "12", handlers, SIZE);
  await flush();
  pane.requestResize(70, 33);

  manager.set(null);
  expect(names()).toEqual(["attached", "lost"]);
  expect(first.listenerCount).toBe(0);

  manager.set(second);
  await flush();
  // The size the screen last asked for, not the one the pane opened with.
  expect(second.attaches).toEqual([{ session: "12", cols: 70, rows: 33 }]);
  expect(names()).toEqual(["attached", "lost", "attached"]);

  // Frames of the old connection no longer reach the screen, the new one's do.
  calls.length = 0;
  first.emit({ t: "snapshot", session: "12", ansi: "stale" });
  second.emit({ t: "snapshot", session: "12", ansi: "fresh" });
  expect(calls).toEqual([["snapshot", "fresh"]]);
  expect(pane.sendInput("a")).toBe(true);
  expect(second.inputs).toHaveLength(1);
  expect(first.inputs).toHaveLength(0);
});

test("opened before connecting: no loss reported, attaches on arrival", async () => {
  const manager = fakeManager(null);
  const { handlers, names } = recorder();
  openDirectPane(manager, "12", handlers, SIZE);
  expect(names()).toEqual([]);

  const link = new FakeLink();
  manager.set(link);
  await flush();
  expect(link.attaches).toHaveLength(1);
  expect(names()).toEqual(["attached"]);
});

test("close detaches, stops listening and silences the pane", async () => {
  const link = new FakeLink();
  const manager = fakeManager(link);
  const { handlers, calls } = recorder();
  const pane = openDirectPane(manager, "12", handlers, SIZE);
  await flush();
  calls.length = 0;

  pane.close();
  await flush();
  expect(link.detaches).toEqual(["12"]);
  expect(link.listenerCount).toBe(0);
  expect(manager.listenerCount).toBe(0);
  expect(pane.sendInput("x")).toBe(false);

  link.emit({ t: "snapshot", session: "12", ansi: "late" });
  manager.set(new FakeLink());
  expect(calls).toEqual([]);

  pane.close();
  expect(link.detaches).toEqual(["12"]);
});

test("a late attach answer after close does not report", async () => {
  const link = new FakeLink();
  const { handlers, calls } = recorder();
  const pane = openDirectPane(fakeManager(link), "12", handlers, SIZE);
  pane.close();
  await flush();
  expect(calls).toEqual([]);
});
