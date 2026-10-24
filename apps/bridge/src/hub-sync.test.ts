/**
 * Screen sync between the bridge and its viewers: every viewer must end up
 * with exactly the pane's screen, whatever it missed (backed up, joined
 * between polls), and history replies must say where the visible grid starts.
 * Runs the real poll loop against a fake backend whose screen the test sets.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { ServerWebSocket } from "bun";

import type { PaneBackend, PaneSummary } from "./backend";
import { PaneHub } from "./hub";

let screen = "a\r\nb\r\nc";
let scrollback: string[] = [];

const pane: PaneSummary = {
  id: "p1",
  workspaceId: "w",
  workspaceLabel: "w",
  tabId: "t",
  cwd: "/tmp",
  title: null,
  agent: null,
  agentStatus: null,
  agentSessionPath: null,
  revision: 0,
};

const backend = {
  kind: "tmux",
  getPane: async () => pane,
  geometry: async () => ({ cols: 80, rows: 3 }),
  readVisible: async () => ({ text: screen, revision: 1 }),
  readHistory: async (_id: string, lines: number) =>
    [...scrollback, ...screen.split("\r\n")].slice(-lines),
  release: () => {},
  stop: () => {},
} as unknown as PaneBackend;

type TestWs = ServerWebSocket<{ paneId: string; joined: boolean }> & {
  sent: string[];
  buffered: number;
};

function fakeWs(): TestWs {
  const ws = {
    sent: [] as string[],
    buffered: 0,
    data: { paneId: "p1", joined: false },
    send(msg: string) {
      ws.sent.push(msg);
    },
    getBufferedAmount: () => ws.buffered,
  };
  return ws as unknown as TestWs;
}

/** Replays a viewer's frames the way the app does: snapshot replaces, diff patches rows. */
function viewerScreen(ws: TestWs): string[] {
  let lines: string[] = [];
  for (const raw of ws.sent) {
    const msg = JSON.parse(raw) as { type: string; ansi?: string; rows?: [number, string][] };
    if (msg.type === "snapshot") lines = msg.ansi!.split("\r\n");
    if (msg.type === "diff") {
      lines = [...lines];
      for (const [i, row] of msg.rows!) lines[i] = row;
    }
  }
  return lines;
}
/** Run the watcher's poll loop twice (idle cadence 400 ms) on the fake clock,
 *  letting each poll's backend reads settle. */
async function polls(): Promise<void> {
  for (let n = 0; n < 2; n++) {
    jest.advanceTimersByTime(450);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
}

let hub: PaneHub;
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  hub?.stop();
  jest.useRealTimers();
});

async function attach(): Promise<TestWs> {
  const ws = fakeWs();
  hub.register(ws);
  if (!(await hub.handleUpgrade(ws))) throw new Error("upgrade refused");
  return ws;
}

describe("screen sync", () => {
  test("a backed-up viewer gets every row it missed once it drains", async () => {
    screen = "a\r\nb\r\nc";
    hub = new PaneHub(backend);
    const slow = await attach();
    const fast = await attach();

    slow.buffered = 2_000_000;
    screen = "a\r\nB\r\nc"; // row 1 changes while slow is backed up...
    await polls();
    screen = "a\r\nB\r\nC"; // ...then row 2, while it still is
    await polls();
    expect(viewerScreen(fast)).toEqual(["a", "B", "C"]);
    expect(viewerScreen(slow)).toEqual(["a", "b", "c"]);

    slow.buffered = 0; // drained: no further screen change is needed to catch up
    await polls();
    expect(viewerScreen(slow)).toEqual(["a", "B", "C"]);
  });

  test("a viewer joining between polls does not cost the others a change", async () => {
    screen = "one\r\ntwo";
    hub = new PaneHub(backend);
    const first = await attach();
    await polls();
    screen = "one\r\nTWO"; // changes, and the newcomer's greet reads it before the poll does
    const second = await attach();
    await polls();
    expect(viewerScreen(first)).toEqual(["one", "TWO"]);
    expect(viewerScreen(second)).toEqual(["one", "TWO"]);
  });

  test("history says how many trailing rows are the visible grid", async () => {
    screen = "live1\r\nlive2"; // herdr trims trailing blank rows: 2 rows on a taller pane
    scrollback = ["old1", "old2", "old3"];
    hub = new PaneHub(backend);
    const ws = await attach();
    await hub.handleMessage(ws, JSON.stringify({ type: "history", lines: 100 }));
    const reply = ws.sent.map((m) => JSON.parse(m)).find((m) => m.type === "history");
    expect(reply).toEqual({
      type: "history",
      rows: ["old1", "old2", "old3", "live1", "live2"],
      visible: 2,
    });
  });
});
