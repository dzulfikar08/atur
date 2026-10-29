// Unit tests for the atur-usage omp hook. Runs with `bun test` from the repo
// root — no omp host needed; the HookAPI is a mock, the HTTP endpoint is a
// local collector server.
import http, { type Server } from "node:http";
import { unlinkSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

type Entry = { id: string; type: string; message?: any };
type CapturedPost = { path: string; body: any };

// Dynamic import with a cache-buster (in importHook below) is intentional:
// the hook keeps module-scope state (cursor/window), so every test needs a
// fresh module instance — a static import would leak state across tests.

let server: Server;
let posts: CapturedPost[];
let respondStatus = 201;
let port = 0;

function makeEntries(): Entry[] {
  const entries: Entry[] = [];
  let n = 0;
  const add = (e: Omit<Entry, "id">) => entries.push({ id: `e${++n}`, ...e });
  return Object.assign(entries, { add });
}

function makeCtx(entries: Entry[], file = "20260904_abc12345.jsonl") {
  return {
    sessionManager: {
      getEntries: () => entries,
      getSessionFile: () => file,
    },
  };
}

async function importHook(_env: Record<string, string>) {
  const mod = await import("./atur-usage.ts?test=" + Math.random().toString(36).slice(2));
  const handlers = new Map<string, Array<(e: any, ctx: any) => Promise<unknown>>>();
  const pi = {
    logger: { errors: [] as string[], error: (m: string) => pi.logger.errors.push(m) },
    on: (event: string, handler: any) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
  mod.default(pi);
  const emit = (event: string, e: any, ctx: any) =>
    Promise.all((handlers.get(event) ?? []).map((h) => h(e, ctx)));
  return { emit, logger: pi.logger };
}

beforeAll(async () => {
  posts = [];
  server = http.createServer((req: any, res: any) => {
    let raw = "";
    req.on("data", (c: string) => (raw += c));
    req.on("end", () => {
      posts.push({ path: req.url, body: JSON.parse(raw || "{}") });
      res.statusCode = respondStatus;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as any).port;
  process.env.ATUR_API_KEY = "test-key";
  process.env.ATUR_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  if (savedPaneId === undefined) delete process.env.HERDR_PANE_ID;
  else process.env.HERDR_PANE_ID = savedPaneId;
  if (savedMuxyId === undefined) delete process.env.MUXY_SESSION_ID;
  else process.env.MUXY_SESSION_ID = savedMuxyId;
  if (savedTermId === undefined) delete process.env.ATUR_TERM_SESSION_ID;
  else process.env.ATUR_TERM_SESSION_ID = savedTermId;
});
// HERDR_PANE_ID / MUXY_SESSION_ID are set inside herdr panes and Muxy terminals
// and would win the agent_name fallback chain — isolate the session-file path
// for assertions.
const savedPaneId = process.env.HERDR_PANE_ID;
const savedMuxyId = process.env.MUXY_SESSION_ID;
const savedTermId = process.env.ATUR_TERM_SESSION_ID;
delete process.env.ATUR_TERM_SESSION_ID;
delete process.env.HERDR_PANE_ID;
delete process.env.MUXY_SESSION_ID;

beforeEach(() => {
  posts = [];
  respondStatus = 201;
});

const ISSUE_A = { workspace: "demo", project_id: "p1", issue_id: "iA" };
const ISSUE_B = { workspace: "demo", project_id: "p1", issue_id: "iB" };
const toolCall = (input: any) => ({ toolName: "atur_add_comment", input });
const assistantMsg = (input: number, output: number, model = "zai/glm-5.3-flash") => ({
  type: "message",
  message: { role: "assistant", model, usage: { input, output, cacheRead: 0, cacheWrite: 0 } },
});

describe("atur-usage hook", () => {
  it("files one entry per issue window: open → switch → shutdown", async () => {
    const entries = makeEntries();
    const ctx = makeCtx(entries);
    const hook = await importHook({});
    await hook.emit("session_start", {}, ctx);

    // Work happens BEFORE the first Atur tool call — must still land on iA.
    entries.add(assistantMsg(1000, 500));
    await hook.emit("tool_call", toolCall(ISSUE_A), ctx);
    expect(posts).toHaveLength(0); // window opened, nothing flushed yet

    entries.add(assistantMsg(2000, 800, "openai/gpt-5.2"));
    await hook.emit("tool_call", toolCall(ISSUE_B), ctx); // switch → flush iA
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/api/workspaces/demo/projects/p1/issues/iA/time-entries");
    expect(posts[0].body).toMatchObject({
      source: "agent",
      agent_name: "omp/abc12345",
      model: "openai/gpt-5.2", // last model seen in the window
      input_tokens: 3000,
      output_tokens: 1300,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    expect(posts[0].body.duration_seconds).toBeGreaterThanOrEqual(60);

    entries.add(assistantMsg(50, 25));
    await hook.emit("session_shutdown", {}, ctx); // flush iB
    expect(posts).toHaveLength(2);
    expect(posts[1].path).toContain("/issues/iB/");
    expect(posts[1].body).toMatchObject({ input_tokens: 50, output_tokens: 25 });
  });

  it("names the agent after the innermost multiplexer pane", async () => {
    const saved = { term: process.env.TERM_PROGRAM };
    const nameFor = async (env: Record<string, string>) => {
      Object.assign(process.env, env);
      try {
        posts = [];
        const entries = makeEntries();
        const ctx = makeCtx(entries);
        const hook = await importHook({});
        await hook.emit("session_start", {}, ctx);
        entries.add(assistantMsg(10, 5));
        await hook.emit("tool_call", toolCall(ISSUE_A), ctx);
        await hook.emit("session_shutdown", {}, ctx);
        return posts[0]?.body.agent_name;
      } finally {
        delete process.env.HERDR_PANE_ID;
        delete process.env.MUXY_SESSION_ID;
        delete process.env.ATUR_TERM_SESSION_ID;
        if (saved.term === undefined) delete process.env.TERM_PROGRAM;
        else process.env.TERM_PROGRAM = saved.term;
      }
    };
    expect(
      await nameFor({
        TERM_PROGRAM: "atur-terminal",
        ATUR_TERM_SESSION_ID: "804218",
        HERDR_PANE_ID: "w1:p2",
      }),
    ).toBe("omp/atur-term-804218");
    // A Muxy server started from a herdr pane leaks HERDR_PANE_ID into its terminals.
    expect(
      await nameFor({ TERM_PROGRAM: "muxy", MUXY_SESSION_ID: "804218", HERDR_PANE_ID: "w1:p2" }),
    ).toBe("omp/muxy-804218");
    // herdr running inside a Muxy terminal: herdr is the innermost pane.
    expect(
      await nameFor({ TERM_PROGRAM: "herdr", MUXY_SESSION_ID: "804218", HERDR_PANE_ID: "w1:p2" }),
    ).toBe("omp/pane-w1:p2");
  });

  it("never re-reports the same usage on retry after a failed POST", async () => {
    const entries = makeEntries();
    const ctx = makeCtx(entries);
    const hook = await importHook({});
    await hook.emit("session_start", {}, ctx);
    entries.add(assistantMsg(500, 100));
    await hook.emit("tool_call", toolCall(ISSUE_A), ctx);

    respondStatus = 500;
    entries.add(assistantMsg(700, 300));
    await hook.emit("tool_call", toolCall(ISSUE_B), ctx); // flush fails, cursor kept
    expect(posts).toHaveLength(1);
    expect(hook.logger.errors.length).toBeGreaterThan(0);
    respondStatus = 201;
    await hook.emit("session_shutdown", {}, ctx); // retry carries BOTH chunks
    // Failed switch keeps the window on the ORIGINAL issue; the retry
    // re-posts the full window there. The pending iB window opens only on
    // the next Atur tool call.
    expect(posts).toHaveLength(2);
    expect(posts[1].path).toContain("/issues/iA/");
    expect(posts[1].body.input_tokens).toBe(1200);
    expect(posts[1].body.output_tokens).toBe(400);
  });
  it("ignores pre-existing entries on a resumed session (no double report)", async () => {
    const entries = makeEntries();
    entries.add(assistantMsg(99999, 99999)); // pre-resume history
    const ctx = makeCtx(entries);
    const hook = await importHook({});
    await hook.emit("session_start", {}, ctx); // cursor jumps to last entry
    entries.add(assistantMsg(10, 5));
    await hook.emit("tool_call", toolCall(ISSUE_A), ctx);
    await hook.emit("session_shutdown", {}, ctx);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.input_tokens).toBe(10);
  });

  it("ignores non-Atur tools and calls missing issue context", async () => {
    const entries = makeEntries();
    const ctx = makeCtx(entries);
    const hook = await importHook({});
    await hook.emit("session_start", {}, ctx);
    await hook.emit("tool_call", { toolName: "bash", input: { command: "ls" } }, ctx);
    await hook.emit(
      "tool_call",
      { toolName: "atur_list_issues", input: { workspace: "demo" } },
      ctx,
    );
    await hook.emit("session_shutdown", {}, ctx);
    expect(posts).toHaveLength(0);
  });

  it("does nothing without any key (env and file both absent)", async () => {
    const entries = makeEntries();
    const ctx = makeCtx(entries);
    const saved = process.env.ATUR_API_KEY;
    const savedFile = process.env.ATUR_API_KEY_FILE;
    delete process.env.ATUR_API_KEY;
    // Point the file fallback at a path that does not exist, so the default
    // crew key file on this machine cannot satisfy the lookup either.
    process.env.ATUR_API_KEY_FILE = "/tmp/atur-hook-test-no-such-key";
    try {
      const hook = await importHook({});
      await hook.emit("session_start", {}, ctx);
      entries.add(assistantMsg(1000, 100));
      await hook.emit("tool_call", toolCall(ISSUE_A), ctx);
      await hook.emit("session_shutdown", {}, ctx);
      expect(posts).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.ATUR_API_KEY = saved;
      if (savedFile !== undefined) process.env.ATUR_API_KEY_FILE = savedFile;
    }
  });

  it("falls back to the crew key file when no env var is set", async () => {
    const keyFile = `/tmp/atur-hook-test-key-${Date.now()}.txt`;
    await Bun.write(keyFile, "pk_live_from_file\n"); // trailing newline must be trimmed
    const entries = makeEntries();
    const ctx = makeCtx(entries);
    delete process.env.ATUR_API_KEY;
    process.env.ATUR_API_KEY_FILE = keyFile;
    try {
      const hook = await importHook({});
      await hook.emit("session_start", {}, ctx);
      entries.add(assistantMsg(100, 50));
      await hook.emit("tool_call", toolCall(ISSUE_A), ctx);
      await hook.emit("session_shutdown", {}, ctx);
      expect(posts).toHaveLength(1);
    } finally {
      delete process.env.ATUR_API_KEY_FILE;
      unlinkSync(keyFile);
    }
  });
});
