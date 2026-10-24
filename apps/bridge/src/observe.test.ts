/**
 * /observe (DEV-33): parser heuristics, session identity, hub lifecycle, and
 * the live websocket surface of server.ts (read-only close, unknown pane,
 * attach unchanged). herdr rpc is stubbed with a mutable pane map — no
 * socket; poll waits use `until`, so tests stay deterministic in wall time.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// herdr stub — installed before any ./observe or ./server import (bun hoists
// mock.module above static imports; same pattern as hub.test.ts).
// ---------------------------------------------------------------------------
const paneText = new Map<string, string>();
let readFailure: { code: string; message: string } | null = null;
let getFailure: { code: string; message: string } | null = null;
const readCalls: string[] = [];
/** pane.get reports this as the pane's agent session log (herdr `agent_session`). */
const paneSession = new Map<string, string>();
/** Fired inside the pane.read stub before resolving — lets a test mutate
 *  fixture state mid-subscribe (e.g. simulate a disconnect during the await). */
let readHook: (() => void) | null = null;

class StubHerdrError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
    message: string,
  ) {
    super(`herdr ${method}: ${code}: ${message}`);
  }
}

mock.module("./herdr", () => ({
  HerdrError: StubHerdrError,
  rpc: (method: string, params: Record<string, unknown> = {}) => {
    const p = params as { pane_id?: string };
    switch (method) {
      case "pane.get":
        if (getFailure) {
          return Promise.reject(
            new StubHerdrError("pane.get", getFailure.code, getFailure.message),
          );
        }
        return Promise.resolve({
          pane: {
            pane_id: p.pane_id,
            cwd: "/srv/acme",
            agent: "omp",
            ...(paneSession.has(p.pane_id ?? "")
              ? { agent_session: { kind: "path", value: paneSession.get(p.pane_id ?? "") } }
              : {}),
          },
        });
      case "pane.read": {
        readCalls.push(p.pane_id ?? "");
        readHook?.();
        if (readFailure) {
          return Promise.reject(
            new StubHerdrError("pane.read", readFailure.code, readFailure.message),
          );
        }
        return Promise.resolve({
          read: {
            pane_id: p.pane_id,
            text: paneText.get(p.pane_id ?? "") ?? "",
            revision: 1,
            truncated: false,
          },
        });
      }
      default:
        return Promise.resolve({});
    }
  },
}));

import { HerdrBackend } from "./backend-herdr";
import { ObserveHub, SessionParser } from "./observe";
import type { ObserveClient } from "./observe";

// ---------------------------------------------------------------------------
// Fixtures shaped after real omp pane screens (ANSI stripped here; the ANSI
// fixture below re-adds escapes to prove the parser strips them itself).
// ---------------------------------------------------------------------------
const TOOL_BOX = [
  "╭────────────────────────────────────╮",
  "│ $ jq -e '.keys' mcp.json           │",
  "├─── Output ─────────────────────────┤",
  "│ [                                  │",
  '│   "pencil"                        │',
  "│ ]                                  │",
  "│ ⟦Wall: 0.01s | Timeout: 300s⟧     │",
  "╰────────────────────────────────────╯",
].join("\r\n");

const MODEL_BADGE_LINE = "⠇ 7s · ◒ GLM-5.3-Flash · ▲ 1.2k tok";

/** Polls for a real condition instead of sleeping a guessed duration; the
 *  hub runs its own real timers, so fake clocks cannot advance it. */
function until<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 3000,
  stepMs = 20,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    const value = fn();
    if (value) {
      resolve(value);
      return;
    }
    if (Date.now() > deadline) {
      reject(new Error("condition not met within timeout"));
      return;
    }
    setTimeout(tick, stepMs);
  };
  tick();
  return promise;
}

function fakeObserveClient(): {
  client: ObserveClient;
  state: { open: boolean };
  sent: string[];
  closes: { code: number; reason?: string }[];
} {
  const sent: string[] = [];
  const closes: { code: number; reason?: string }[] = [];
  const state = { open: true };
  const client: ObserveClient = {
    get readyState() {
      return state.open ? 1 : 3;
    },
    send: (data: string) => {
      sent.push(data);
    },
    close: (code: number, reason?: string) => {
      closes.push({ code, reason });
    },
    getBufferedAmount: () => 0,
  };
  return { client, state, sent, closes };
}

function frames(sent: string[]): Record<string, unknown>[] {
  return sent.map((m) => JSON.parse(m) as Record<string, unknown>);
}

const parser = new SessionParser();
const observeHub = new ObserveHub(new HerdrBackend());

afterEach(() => {
  paneText.clear();
  readFailure = null;
  getFailure = null;
  readHook = null;
  readCalls.length = 0;
  observeHub.stop();
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
describe("pane parser", () => {
  test("splits a bash tool box into tool call + output blocks", () => {
    const { mode, blocks } = parser.parse(TOOL_BOX);
    expect(mode).toBe("structured");
    expect(blocks).toHaveLength(2);
    const tool = blocks[0]!;
    expect(tool.kind).toBe("tool");
    expect(tool.title).toBe("$ jq -e '.keys' mcp.json");
    expect(tool.text).toBe("$ jq -e '.keys' mcp.json");
    expect(tool.lineCount).toBe(1);
    expect(tool.model).toBeNull();
    const out = blocks[1]!;
    expect(out.kind).toBe("output");
    expect(out.title).toBeNull();
    expect(out.text).toContain('"pencil"');
    expect(out.text).toContain("⟦Wall: 0.01s | Timeout: 300s⟧");
    expect(out.lineCount).toBe(4);
  });

  test("uses the box border title for named tools", () => {
    const screen = [
      "╭─── ✎ Edit: src/App.tsx ⟦+1⟧ ──╮",
      "│ +++ b/src/App.tsx             │",
      "╰───────────────────────────────╯",
    ].join("\r\n");
    const { blocks } = parser.parse(screen);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("tool");
    expect(blocks[0]!.title).toBe("✎ Edit: src/App.tsx ⟦+1⟧");
  });

  test("detects model badges", () => {
    const screen = [
      "╭──╮",
      "│ $ ls │",
      "├─── Output ──┤",
      "│ files │",
      "╰──╯",
      MODEL_BADGE_LINE,
    ].join("\r\n");
    const { mode, blocks } = parser.parse(screen);
    expect(mode).toBe("structured");
    const model = blocks.find((b) => b.kind === "model");
    expect(model).toBeDefined();
    expect(model!.model).toBe("GLM-5.3-Flash");
    expect(model!.title).toBeNull();
    expect(model!.text).toBe(MODEL_BADGE_LINE);
    expect(model!.lineCount).toBe(1);
  });

  test("error banners outside boxes form error blocks with continuations", () => {
    const screen = [
      "ToolError: Failed to attach to browser on",
      "http://127.0.0.1:33611: timed out",
      "    at R9i (omp-linux-x64:691039:18)",
      "",
      "All good otherwise.",
    ].join("\r\n");
    const { blocks } = parser.parse(screen);
    const err = blocks.find((b) => b.kind === "error");
    expect(err).toBeDefined();
    expect(err!.text).toContain("ToolError: Failed to attach");
    expect(err!.text).toContain("at R9i (omp-linux-x64");
    expect(err!.text).not.toContain("All good otherwise.");
    expect(err!.lineCount).toBe(3);
  });

  test("ToolError inside a box marks the output part as error", () => {
    const screen = [
      "╭──────────╮",
      "│ $ curl localhost:9 │",
      "├─── Output ──────┤",
      "│ ToolError: connection refused │",
      "╰──────────╯",
    ].join("\r\n");
    const { blocks } = parser.parse(screen);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "error"]);
    expect(blocks[0]!.title).toBe("$ curl localhost:9");
    expect(blocks[1]!.text).toBe("ToolError: connection refused");
  });

  test("prose-only screens degrade to raw with empty blocks", () => {
    const screen = "$ ls\r\nnotes.txt\r\n$ echo hi\r\nhi\r\n\r\nDone, everything works.";
    const { mode, blocks, text } = parser.parse(screen);
    expect(mode).toBe("raw");
    expect(blocks).toEqual([]);
    expect(text).toContain("notes.txt");
    expect(text).toContain("Done, everything works.");
  });

  test("strips ANSI escapes before parsing", () => {
    const raw = [
      "\x1b[38;2;95;133;255m╭─── ✎ Edit: a.ts ──╮\x1b[0m",
      "│ \x1b[32m$ ls\x1b[0m │",
      "├─── Output ──┤",
      "│ \x1b]0;title\x07files │",
      "╰─────────────╯",
      "\x1b[38;2;238;69;136m◒ GLM-5.3-Flash\x1b[0m",
    ].join("\r\n");
    const { mode, blocks } = parser.parse(raw);
    expect(mode).toBe("structured");
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "output", "model"]);
    expect(blocks[0]!.title).toBe("✎ Edit: a.ts");
    expect(blocks[1]!.text).toBe("files");
    expect(blocks[2]!.model).toBe("GLM-5.3-Flash");
    expect(JSON.stringify(blocks)).not.toContain("\x1b");
  });

  test("boxes cut by the screen bottom still parse", () => {
    const screen = ["╭──────╮", "│ $ npm test │", "├─── Output ──┤", "│ running…"].join("\r\n");
    const { mode, blocks } = parser.parse(screen);
    expect(mode).toBe("structured");
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "output"]);
    expect(blocks[1]!.text).toBe("running…");
  });

  test("surviving blocks keep id and startedAt; changed text gets a new id", () => {
    const first = parser.parse(TOOL_BOX);
    const again = parser.parse(TOOL_BOX);
    expect(again.blocks[0]!.id).toBe(first.blocks[0]!.id);
    expect(again.blocks[1]!.id).toBe(first.blocks[1]!.id);
    expect(again.blocks[0]!.startedAt).toBe(first.blocks[0]!.startedAt);
    const changed = parser.parse(TOOL_BOX.replace('"pencil"', '"paint"'));
    expect(changed.blocks[0]!.id).toBe(first.blocks[0]!.id);
    expect(changed.blocks[1]!.id).not.toBe(first.blocks[1]!.id);
  });

  test("bottom block is still open (endedAt null); earlier blocks get ISO ends", () => {
    const fresh = new SessionParser();
    const first = fresh.parse(TOOL_BOX);
    expect(first.blocks[0]!.endedAt).not.toBeNull();
    expect(first.blocks[1]!.endedAt).toBeNull();
    const second = fresh.parse(`${TOOL_BOX}\r\n\r\nSummary of changes.`);
    expect(second.blocks[1]!.endedAt).not.toBeNull();
    expect(second.blocks[1]!.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(second.blocks[2]!.endedAt).toBeNull();
  });

  test("duplicate identical blocks keep distinct stable ids across parses", () => {
    const box = ["╭──╮", "│ $ echo hi │", "├─── Output ──┤", "│ hi │", "╰──╯"].join("\r\n");
    const screen = `${box}\r\n${box}`;
    const p = new SessionParser();
    const first = p.parse(screen);
    const ids = first.blocks.map((b) => b.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(p.parse(screen).blocks.map((b) => b.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// ObserveHub lifecycle (direct, fake sockets)
// ---------------------------------------------------------------------------
describe("observe hub", () => {
  test("snapshot arrives first, then blocks replace on change", async () => {
    paneText.set("p1", TOOL_BOX);
    const { client, sent } = fakeObserveClient();
    const ok = await observeHub.subscribe(client, "p1");
    expect(ok).toBe(true);
    const snap = frames(sent)[0]!;
    expect(snap.type).toBe("snapshot");
    expect(snap.paneId).toBe("p1");
    expect(snap.mode).toBe("structured");
    expect((snap.blocks as Record<string, unknown>[]).map((b) => b.kind)).toEqual([
      "tool",
      "output",
    ]);

    paneText.set("p1", `${TOOL_BOX}\r\n\r\nExtra line.`);
    const update = await until(() => frames(sent).find((f) => f.type === "blocks"));
    expect(update!.mode).toBe("structured");
    const blocks = update!.blocks as Record<string, unknown>[];
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "output", "output"]);
  });

  test("raw panes get snapshot mode raw plus a raw text frame", async () => {
    paneText.set("sh", "$ ls\r\nnotes.txt");
    const { client, sent } = fakeObserveClient();
    await observeHub.subscribe(client, "sh");
    const sentFrames = frames(sent);
    expect(sentFrames[0]).toMatchObject({ type: "snapshot", mode: "raw", blocks: [] });
    expect(sentFrames[1]).toMatchObject({ type: "raw", mode: "raw", paneId: "sh" });
    expect(sentFrames[1]!.text as string).toContain("notes.txt");

    paneText.set("sh", "$ ls\r\nnotes.txt\r\nsrc");
    const update = await until(() =>
      frames(sent)
        .filter((f) => f.type === "raw")
        .at(1),
    );
    expect(update!.text).toContain("src");
  });

  test("multiple observers each get replacement frames", async () => {
    paneText.set("p2", TOOL_BOX);
    const a = fakeObserveClient();
    const b = fakeObserveClient();
    await observeHub.subscribe(a.client, "p2");
    await observeHub.subscribe(b.client, "p2");
    paneText.set("p2", `${TOOL_BOX}\r\n\r\nMore.`);
    await until(() => frames(a.sent).some((f) => f.type === "blocks"));
    await until(() => frames(b.sent).some((f) => f.type === "blocks"));
  });

  test("unknown pane refuses the subscription", async () => {
    getFailure = { code: "not_found", message: "no such pane" };
    const { client } = fakeObserveClient();
    const ok = await observeHub.subscribe(client, "ghost");
    expect(ok).toBe(false);
  });

  test("pane death sends an error frame and closes observers 1001", async () => {
    paneText.set("p3", TOOL_BOX);
    const { client, sent, closes } = fakeObserveClient();
    await observeHub.subscribe(client, "p3");
    readFailure = { code: "not_found", message: "no such pane" };
    const err = await until(() => frames(sent).find((f) => f.type === "error"));
    expect(typeof err!.error).toBe("string");
    expect(closes[0]).toMatchObject({ code: 1001 });
  });

  test("detaching the last observer stops the pane polls", async () => {
    paneText.set("p4", TOOL_BOX);
    const { client } = fakeObserveClient();
    await observeHub.subscribe(client, "p4");
    const readsBefore = readCalls.length;
    observeHub.detach(client);
    // Negative condition (polls must STOP): nothing signals timer absence,
    // so proving it needs real wall time; fake timers cannot show this.
    await new Promise((r) => setTimeout(r, 700));
    expect(readCalls.length).toBe(readsBefore);
  });

  test("client disconnecting during subscribe is never adopted", async () => {
    paneText.set("p5", TOOL_BOX);
    const { client, state, sent } = fakeObserveClient();
    // The socket dies while subscribe is awaiting pane.get/readScreen; the
    // close handler's detach is a no-op (not yet an observer).
    readHook = () => {
      state.open = false;
    };
    const ok = await observeHub.subscribe(client, "p5");
    expect(ok).toBe(true);
    expect(sent).toHaveLength(0);
    // The session must be disposed, not left polling a dead socket forever.
    const readsBefore = readCalls.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(readCalls.length).toBe(readsBefore);
  });
});

// ---------------------------------------------------------------------------
// Live surface: the real Bun.serve from server.ts on an ephemeral port
// ---------------------------------------------------------------------------
const TOKEN = "e2e-observe-token";
let port = 0;
const sockets: WebSocket[] = [];

interface WsHandle {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  closeInfo: Promise<{ code: number; reason: string }>;
}

function connect(path: string, token: string | null = TOKEN): Promise<WsHandle> {
  const { promise, resolve, reject } = Promise.withResolvers<WsHandle>();
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    // Bun's WebSocket honors upgrade headers; the ambient DOM types don't.
    headers: token === null ? undefined : { "x-bridge-token": token },
  } as unknown as string[]);
  const messages: Record<string, unknown>[] = [];
  const { promise: closeInfo, resolve: resolveClose } = Promise.withResolvers<{
    code: number;
    reason: string;
  }>();
  ws.addEventListener("close", (ev) => resolveClose({ code: ev.code, reason: ev.reason }));
  ws.addEventListener("message", (ev) => {
    try {
      messages.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
    } catch {
      // non-JSON frame — ignore
    }
  });
  ws.addEventListener("open", () => {
    sockets.push(ws);
    resolve({ ws, messages, closeInfo });
  });
  ws.addEventListener("error", () => reject(new Error(`ws connect failed: ${path}`)));
  return promise;
}

describe("observe websocket surface", () => {
  beforeAll(async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    port = probe.port ?? 0;
    probe.stop(true);
    process.env.BRIDGE_PORT = String(port);
    process.env.BRIDGE_TOKEN = TOKEN;
    // herdr is stubbed above; auto-detection would otherwise pick tmux here.
    process.env.BRIDGE_BACKEND = "herdr";
    // The live surface test never dials the cloud, whatever the developer's shell has set.
    delete process.env.ATUR_CONNECT_TOKEN;
    // Dynamic import on purpose: server.ts reads BRIDGE_PORT/TOKEN at module
    // evaluation and binds the server there — a static import would evaluate
    // it before the test picked the port and token.
    await import("./server");
  });

  beforeEach(() => {
    // afterEach clears the shared pane map; reseed the fixture each test.
    paneText.set("live", `${TOOL_BOX}\r\n${MODEL_BADGE_LINE}`);
  });
  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      try {
        ws.close(1000, "test done");
      } catch {
        // already closed
      }
    }
  });

  test("token gate still guards every route", async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/health`);
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-bridge-token": TOKEN },
    });
    expect(await allowed.json()).toEqual({ ok: true });
    const noPane = await fetch(`http://127.0.0.1:${port}/observe`, {
      headers: { "x-bridge-token": TOKEN },
    });
    expect(noPane.status).toBe(400);
  });

  test("unknown pane yields an error frame then close 1008", async () => {
    getFailure = { code: "not_found", message: "no such pane" };
    const h = await connect("/observe?pane=ghost");
    const first = await until(() => h.messages[0]);
    expect(first).toMatchObject({ type: "error" });
    const closed = await h.closeInfo;
    expect(closed.code).toBe(1008);
  });

  test("observe delivers a structured snapshot; any other client frame closes 1008", async () => {
    const h = await connect("/observe?pane=live");
    const snap = await until(() => h.messages.find((m) => m.type === "snapshot"));
    expect(snap).toMatchObject({ type: "snapshot", paneId: "live", mode: "structured" });
    const blocks = snap!.blocks as Record<string, unknown>[];
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "output", "model"]);

    h.ws.send("let me in");
    const closed = await h.closeInfo;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe("observe channel is read-only");
  });

  test("input-shaped frames are still refused", async () => {
    for (const frame of [
      JSON.stringify({ type: "input", data: "rm -rf /" }),
      JSON.stringify({ type: "paste", text: "x" }),
      JSON.stringify([1]),
      "null",
    ]) {
      const h = await connect("/observe?pane=live");
      await until(() => h.messages.find((m) => m.type === "snapshot"));
      h.ws.send(frame);
      expect((await h.closeInfo).code).toBe(1008);
    }
  });

  test("transcript opt-in without a session log answers unavailable and keeps the screen feed", async () => {
    const h = await connect("/observe?pane=live");
    await until(() => h.messages.find((m) => m.type === "snapshot"));
    h.ws.send(JSON.stringify({ type: "transcript" }));
    await until(() => h.messages.find((m) => m.type === "transcript-unavailable"));
    paneText.set("live", `${TOOL_BOX}\r\n${MODEL_BADGE_LINE}\r\nmore`);
    await until(() => h.messages.find((m) => m.type === "blocks" || m.type === "raw"));
    h.ws.close(1000, "bye");
  });

  test("transcript opt-in with a session log streams the conversation, pages and follows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observe-transcript-"));
    const file = join(dir, "s.jsonl");
    const line = (text: string) =>
      JSON.stringify({
        type: "message",
        timestamp: "2026-10-24T10:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text }], attribution: "user" },
      });
    const body =
      Array.from({ length: 900 }, (_, i) => line(`m${i} ${"x".repeat(400)}`)).join("\n") + "\n";
    await writeFile(file, body);
    paneSession.set("live", file);
    try {
      const h = await connect("/observe?pane=live");
      await until(() => h.messages.find((m) => m.type === "snapshot"));
      h.ws.send(JSON.stringify({ type: "transcript" }));
      const first = await until(() => h.messages.find((m) => m.type === "transcript"));
      const entries = first.entries as { text: string }[];
      expect(entries.length).toBeGreaterThanOrEqual(300);
      expect(entries.at(-1)!.text.startsWith("m899 ")).toBe(true);
      expect(first.hasMore).toBe(true);

      h.ws.send(JSON.stringify({ type: "older", before: first.cursor }));
      const older = await until(() => h.messages.find((m) => m.type === "older"));
      expect(older.before).toBe(first.cursor);
      expect((older.entries as unknown[]).length).toBeGreaterThan(0);

      await appendFile(file, line("live one") + "\n");
      const appended = await until(() => h.messages.find((m) => m.type === "append"), 4000);
      expect((appended.entries as { text: string }[])[0]!.text).toBe("live one");

      // Fed from the log now: the screen poller has no observer left to serve.
      // Real wait on purpose: it must outlast one idle poll tick (400 ms).
      const reads = readCalls.length;
      await Bun.sleep(600);
      expect(readCalls.length).toBe(reads);
      h.ws.close(1000, "bye");
    } finally {
      paneSession.delete("live");
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/attach protocol is unchanged", async () => {
    const h = await connect("/attach?pane=live");
    await until(() => h.messages.find((m) => m.type === "hello"));
    const snap = await until(() => h.messages.find((m) => m.type === "snapshot"));
    expect(typeof snap!.ansi).toBe("string");
    expect(h.messages[0]!.type).toBe("hello");
    h.ws.close(1000, "bye");
  });
});
