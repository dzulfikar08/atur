/**
 * Session transcript: line parsing (omp + Claude Code shapes), backwards
 * paging over real files, merge semantics, and the follow/page hub against a
 * fake socket. Fixtures are minimal real-shaped log lines with scrubbed text.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaneGoneError, type PaneBackend, type PaneSummary } from "./backend";
import {
  SEQ_STRIDE,
  TranscriptHub,
  TranscriptParser,
  mergeEntries,
  readTranscriptPage,
  summarizeTool,
  type TranscriptEntry,
} from "./session-transcript";

// --- fixtures ----------------------------------------------------------------

let n = 0;
const ts = () => new Date(Date.UTC(2026, 9, 24, 10, 0, n++)).toISOString();

const ompUser = (text: string) => ({
  type: "message",
  id: `u${n}`,
  timestamp: ts(),
  message: { role: "user", content: [{ type: "text", text }], attribution: "user" },
});
const ompAssistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "message",
  id: `a${n}`,
  timestamp: ts(),
  message: { role: "assistant", content, stopReason: "toolUse", ...extra },
});
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});
const ompResult = (id: string, name: string, text: string, isError = false) => ({
  type: "message",
  id: `r${n}`,
  timestamp: ts(),
  message: {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
  },
});

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

function parseAll(lines: unknown[]): TranscriptEntry[] {
  const parser = new TranscriptParser();
  const out: TranscriptEntry[] = [];
  let pos = 0;
  for (const l of lines) {
    const text = JSON.stringify(l);
    out.push(...parser.feed(text, pos));
    pos += Buffer.byteLength(text) + 1;
  }
  return mergeEntries([], out);
}

// --- parser ------------------------------------------------------------------

describe("TranscriptParser (omp)", () => {
  test("user and assistant text become entries; thinking, bookkeeping and system noise are dropped", () => {
    const entries = parseAll([
      { type: "session", version: 3, id: "s1" },
      { type: "thinking_level_change", thinkingLevel: "low" },
      ompUser("fix the build"),
      ompAssistant([
        { type: "thinking", thinking: "hm", thinkingSignature: "x" },
        { type: "text", text: "On it." },
      ]),
      {
        type: "message",
        message: { role: "developer", content: [{ type: "text", text: "<system-reminder>x" }] },
      },
      ompUser("<task-notification>bg job done</task-notification>"),
      { type: "custom_message", customType: "async-result", content: "notice", display: true },
    ]);
    expect(entries.map((e) => [e.role, e.text])).toEqual([
      ["user", "fix the build"],
      ["assistant", "On it."],
    ]);
    expect(typeof entries[0]!.at).toBe("number");
  });

  test("a tool call and its result are one entry, updated in place", () => {
    const entries = parseAll([
      ompAssistant([
        { type: "text", text: "Reading." },
        call("t1", "read", { path: "src/x.ts", i: "Read x" }),
        call("t2", "bash", { command: "bun test\n--bail", i: "Run tests" }),
      ]),
      ompResult("t1", "read", "line1\nline2"),
      ompResult("t2", "bash", "1 fail", true),
    ]);
    expect(entries.map((e) => e.role)).toEqual(["assistant", "tool", "tool"]);
    expect(entries[1]!.tool).toEqual({
      name: "read",
      summary: "src/x.ts",
      status: "done",
      result: "line1\nline2",
    });
    expect(entries[2]!.tool).toMatchObject({ name: "bash", summary: "bun test", status: "error" });
    // seq follows the call's line, not the result's.
    expect(entries[1]!.seq).toBeLessThan(SEQ_STRIDE * 10);
  });

  test("a call without a result stays running", () => {
    const entries = parseAll([ompAssistant([call("t1", "bash", { command: "sleep 9" })])]);
    expect(entries[0]!.tool?.status).toBe("running");
    expect(entries[0]!.tool?.result).toBeUndefined();
  });

  test("results are clipped to 40 lines", () => {
    const body = Array.from({ length: 100 }, (_, i) => `row ${i}`).join("\n");
    const entries = parseAll([
      ompAssistant([call("t1", "bash", { command: "ls" })]),
      ompResult("t1", "bash", body),
    ]);
    const lines = entries[0]!.tool!.result!.split("\n");
    expect(lines).toHaveLength(41);
    expect(lines[40]).toBe("… 60 more lines");
  });

  test("ask calls become ask entries carrying question and options; the answer is the result", () => {
    const entries = parseAll([
      ompAssistant([
        call("q1", "ask", {
          questions: [
            { id: "a", question: "Which branch?", options: [{ label: "main" }, { label: "dev" }] },
          ],
        }),
      ]),
      ompResult("q1", "ask", "User answers:\na: main"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      role: "ask",
      text: "Which branch?\n- main\n- dev",
      tool: { name: "ask", summary: "Which branch?", status: "done" },
    });
    expect(entries[0]!.tool!.result).toContain("a: main");
  });

  test("aborted or failed turns surface their error message", () => {
    const entries = parseAll([
      ompAssistant([], { stopReason: "aborted", errorMessage: "Interrupted by user" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      role: "assistant",
      error: true,
      text: "Interrupted by user",
    });
  });

  test("a result whose call was never seen becomes a result-only entry that a later merge completes", () => {
    const orphan = parseAll([ompResult("t9", "grep", "hit")]);
    expect(orphan[0]!.tool).toEqual({ name: "grep", summary: "", status: "done", result: "hit" });
    const head = parseAll([ompAssistant([call("t9", "grep", { pattern: "foo", path: "src" })])]);
    const merged = mergeEntries(head, orphan);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.tool).toEqual({
      name: "grep",
      summary: "foo in src",
      status: "done",
      result: "hit",
    });
    // The merge keeps the call's (earlier) position, in either order.
    expect(mergeEntries(orphan, head)[0]!.tool?.status).toBe("done");
  });

  test("garbage lines are skipped", () => {
    const parser = new TranscriptParser();
    expect(parser.feed("{broken", 0)).toEqual([]);
    expect(parser.feed("[1,2]", 0)).toEqual([]);
    expect(parser.feed('{"type":"message","message":null}', 0)).toEqual([]);
  });
});

describe("TranscriptParser (Claude Code)", () => {
  const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
    type: "user",
    timestamp: "2026-10-11T10:00:00.000Z",
    message: { role: "user", content },
    ...extra,
  });
  const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
    type: "assistant",
    timestamp: "2026-10-11T10:00:01.000Z",
    message: { role: "assistant", content },
    ...extra,
  });

  test("text, tool_use and tool_result map to the same entries", () => {
    const entries = parseAll([
      { type: "mode", mode: "normal" },
      user("deploy it"),
      assistant([
        { type: "thinking", thinking: "" },
        { type: "text", text: "Deploying." },
        { type: "tool_use", id: "tu1", name: "Bash", input: { command: "bun run deploy" } },
        { type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "a/b.ts" } },
      ]),
      user([{ type: "tool_result", tool_use_id: "tu1", content: "ok", is_error: false }]),
      user([
        {
          type: "tool_result",
          tool_use_id: "tu2",
          content: [{ type: "text", text: "nope" }],
          is_error: true,
        },
      ]),
      assistant([
        {
          type: "tool_use",
          id: "tu3",
          name: "AskUserQuestion",
          input: { questions: [{ question: "Ship?", options: [{ label: "yes" }] }] },
        },
      ]),
    ]);
    expect(entries.map((e) => e.role)).toEqual(["user", "assistant", "tool", "tool", "ask"]);
    expect(entries[2]!.tool).toEqual({
      name: "Bash",
      summary: "bun run deploy",
      status: "done",
      result: "ok",
    });
    expect(entries[3]!.tool).toMatchObject({
      name: "Edit",
      summary: "a/b.ts",
      status: "error",
      result: "nope",
    });
    expect(entries[4]!.tool?.status).toBe("running");
    expect(entries[0]!.at).toBe(Date.parse("2026-10-11T10:00:00.000Z"));
  });

  test("sidechain, meta and command-wrapper user lines are skipped", () => {
    const entries = parseAll([
      user("sub-agent chatter", { isSidechain: true }),
      user("meta", { isMeta: true }),
      user("<command-name>/clear</command-name>"),
      user("real prompt"),
    ]);
    expect(entries.map((e) => e.text)).toEqual(["real prompt"]);
  });
});

describe("summarizeTool", () => {
  test("picks the identifying argument per tool", () => {
    expect(summarizeTool("read", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(summarizeTool("Write", { file_path: "/x/y.md" })).toBe("/x/y.md");
    expect(summarizeTool("edit", { input: "[apps/a.ts#1A2B]\nPUT 1.=1:\n+x" })).toBe("apps/a.ts");
    expect(summarizeTool("bash", { command: "git status\ngit diff" })).toBe("git status");
    expect(summarizeTool("grep", { pattern: "foo", path: "src" })).toBe("foo in src");
    expect(summarizeTool("task", { i: "Map the repo", tasks: [] })).toBe("Map the repo");
    expect(summarizeTool("mystery", {})).toBe("");
  });
});

// --- files --------------------------------------------------------------------

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

async function sessionFile(body: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "session-transcript-"));
  const path = join(dir, "s.jsonl");
  await writeFile(path, body);
  return path;
}

/** `count` user lines "m0".."m<count-1>", each padded to make the file span many chunks. */
function numbered(count: number, pad = 0): string {
  return jsonl(Array.from({ length: count }, (_, i) => ompUser(`m${i}${"x".repeat(pad)}`)));
}

describe("readTranscriptPage", () => {
  test("returns everything for a small file, oldest first, nothing more to page", async () => {
    const path = await sessionFile(numbered(5));
    const page = await readTranscriptPage(path);
    expect(page.entries.map((e) => e.text)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(page).toMatchObject({ hasMore: false, cursor: 0 });
  });

  test("pages back over the whole file with no gaps or duplicates", async () => {
    // ~3000 lines of ~600 bytes: several 256 KB chunks.
    const total = 3000;
    const path = await sessionFile(numbered(total, 500));
    const seen: string[] = [];
    let page = await readTranscriptPage(path, { limit: 300 });
    expect(page.entries.length).toBeGreaterThanOrEqual(300);
    expect(page.hasMore).toBe(true);
    seen.unshift(...page.entries.map((e) => e.text.slice(0, e.text.indexOf("x"))));
    expect(seen.at(-1)).toBe(`m${total - 1}`);
    let pages = 1;
    while (page.hasMore) {
      page = await readTranscriptPage(path, { before: page.cursor, limit: 300 });
      seen.unshift(...page.entries.map((e) => e.text.slice(0, e.text.indexOf("x"))));
      pages++;
    }
    expect(pages).toBeGreaterThan(5);
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => `m${i}`));
    expect(page.cursor).toBe(0);
  });

  test("a line longer than the read chunk still pages correctly", async () => {
    const huge = jsonl([ompUser(`big${"y".repeat(700_000)}`)]);
    const path = await sessionFile(numbered(2) + huge + numbered(2));
    const newest = await readTranscriptPage(path, { limit: 3 });
    let page = newest;
    const texts = newest.entries.map((e) => e.text.slice(0, 3));
    while (page.hasMore) {
      page = await readTranscriptPage(path, { before: page.cursor, limit: 3 });
      texts.unshift(...page.entries.map((e) => e.text.slice(0, 3)));
    }
    expect(texts).toEqual(["m0", "m1", "big", "m0", "m1"]);
  });

  test("an unterminated trailing line is left for the writer to finish", async () => {
    const path = await sessionFile(numbered(2) + '{"type":"message","message":{"role":"user","con');
    const page = await readTranscriptPage(path);
    expect(page.entries.map((e) => e.text)).toEqual(["m0", "m1"]);
    expect(page.end).toBeLessThan(await Bun.file(path).size);
  });

  test("tool results arriving in a newer chunk complete calls from an older one", async () => {
    const filler = numbered(900, 400);
    const path = await sessionFile(
      jsonl([ompAssistant([call("c1", "bash", { command: "make" })])]) +
        filler +
        jsonl([ompResult("c1", "bash", "done!")]),
    );
    // Walk back to the call's page and check the merged entry is complete and
    // that the result-only entry in the newest page was positioned by the call.
    let page = await readTranscriptPage(path, { limit: 300 });
    const all = [...page.entries];
    while (page.hasMore) {
      page = await readTranscriptPage(path, { before: page.cursor, limit: 300 });
      all.unshift(...page.entries);
    }
    const merged = mergeEntries([], all);
    const tool = merged.filter((e) => e.id === "c1");
    expect(tool).toHaveLength(1);
    expect(tool[0]!.tool).toMatchObject({ summary: "make", status: "done", result: "done!" });
    expect(merged[0]!.id).toBe("c1");
  });

  test("an empty file yields an empty page", async () => {
    const path = await sessionFile("");
    expect(await readTranscriptPage(path)).toMatchObject({
      entries: [],
      hasMore: false,
      cursor: 0,
    });
  });
});

// --- hub -----------------------------------------------------------------------

class FakeSocket {
  readyState = 1;
  frames: Record<string, unknown>[] = [];
  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
  of(type: string): Record<string, unknown>[] {
    return this.frames.filter((f) => f.type === type);
  }
}

function backendFor(paths: Map<string, string | null>, agent = "omp"): PaneBackend {
  return {
    getPane: async (id: string) => {
      if (!paths.has(id)) throw new PaneGoneError(id);
      return { id, agent, agentSessionPath: paths.get(id) ?? null } as PaneSummary;
    },
  } as unknown as PaneBackend;
}

function hubFor(paths: Map<string, string | null>): TranscriptHub {
  // Short intervals: these tests follow real files, and polling is the thing under test.
  return new TranscriptHub(backendFor(paths), { pollMs: 15, sessionCheckMs: 40 });
}
async function until<T>(fn: () => T | undefined | false, ms = 4000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("until: timed out");
    await Bun.sleep(10);
  }
}

describe("TranscriptHub", () => {
  test("first page, then appended lines, including a result completing a running call", async () => {
    const path = await sessionFile(
      jsonl([ompUser("hello"), ompAssistant([call("c1", "bash", { command: "ls" })])]),
    );
    const hub = hubFor(new Map([["p1", path]]));
    const ws = new FakeSocket();
    expect(await hub.subscribe(ws, "p1")).toBe(true);
    const first = ws.of("transcript")[0]!;
    expect(first).toMatchObject({ agent: "omp", hasMore: false, cursor: 0 });
    expect((first.entries as TranscriptEntry[]).map((e) => e.role)).toEqual(["user", "tool"]);

    await appendFile(
      path,
      jsonl([ompResult("c1", "bash", "a b"), ompAssistant([{ type: "text", text: "Done." }])]),
    );
    const appended = await until(() => ws.of("append")[0]);
    const entries = appended.entries as TranscriptEntry[];
    expect(entries.map((e) => [e.id === "c1" ? "result" : e.role, e.tool?.status])).toEqual([
      ["result", "done"],
      ["assistant", undefined],
    ]);
    hub.stop();
  });

  test("a client joining mid-write misses nothing and sees nothing twice", async () => {
    const path = await sessionFile(numbered(3));
    const hub = hubFor(new Map([["p1", path]]));
    const a = new FakeSocket();
    await hub.subscribe(a, "p1");
    await appendFile(path, jsonl([ompUser("late1")]));
    const b = new FakeSocket();
    const joined = hub.subscribe(b, "p1");
    await appendFile(path, jsonl([ompUser("late2")]));
    await joined;
    const texts = () =>
      [
        ...((b.of("transcript")[0]?.entries as TranscriptEntry[]) ?? []),
        ...b.of("append").flatMap((f) => f.entries as TranscriptEntry[]),
      ].map((e) => e.text);
    await until(() => texts().includes("late2"));
    expect(texts()).toEqual(["m0", "m1", "m2", "late1", "late2"]);
    hub.stop();
  });

  test("older pages the history on request and rejects bad cursors", async () => {
    const path = await sessionFile(numbered(1200, 300));
    const hub = hubFor(new Map([["p1", path]]));
    const ws = new FakeSocket();
    await hub.subscribe(ws, "p1");
    const first = ws.of("transcript")[0]!;
    expect(first.hasMore).toBe(true);
    const cursor = first.cursor as number;
    await hub.older(ws, cursor);
    const older = ws.of("older")[0]!;
    expect(older.before).toBe(cursor);
    const entries = older.entries as TranscriptEntry[];
    expect(entries.length).toBeGreaterThan(0);
    const newestOlder = entries.at(-1)!;
    expect(newestOlder.seq).toBeLessThan(cursor * SEQ_STRIDE);
    const firstIds = new Set((first.entries as TranscriptEntry[]).map((e) => e.id));
    expect(entries.every((e) => !firstIds.has(e.id))).toBe(true);

    const before = ws.frames.length;
    await hub.older(ws, -5);
    await hub.older(ws, "7");
    await hub.older(ws, 1.5);
    expect(ws.frames.length).toBe(before);
    hub.stop();
  });

  test("unavailable when the pane has no session log, is gone, or the file is missing", async () => {
    const hub = hubFor(
      new Map<string, string | null>([
        ["none", null],
        ["bad", "/nonexistent/x.jsonl"],
        ["odd", "relative.jsonl"],
      ]),
    );
    for (const id of ["none", "ghost", "bad", "odd"]) {
      const ws = new FakeSocket();
      expect(await hub.subscribe(ws, id)).toBe(false);
      expect(ws.of("transcript-unavailable")).toHaveLength(1);
      expect(ws.of("transcript")).toHaveLength(0);
    }
    hub.stop();
  });

  test("a truncated file resets every client with a fresh first page", async () => {
    const path = await sessionFile(numbered(5));
    const hub = hubFor(new Map([["p1", path]]));
    const ws = new FakeSocket();
    await hub.subscribe(ws, "p1");
    await truncate(path, 0);
    await appendFile(path, numbered(2));
    // The reset page may land before or after the rewrite finishes; either way
    // the client ends up with exactly the new content.
    const texts = () => {
      const reset = ws.of("transcript")[1];
      if (!reset) return undefined;
      const after = ws.of("append").flatMap((f) => f.entries as TranscriptEntry[]);
      return [...(reset.entries as TranscriptEntry[]), ...after].map((e) => e.text);
    };
    await until(() => texts()?.length === 2);
    expect(texts()).toEqual(["m0", "m1"]);
    hub.stop();
  });

  test("detach stops following the file", async () => {
    const path = await sessionFile(numbered(1));
    const hub = hubFor(new Map([["p1", path]]));
    const ws = new FakeSocket();
    await hub.subscribe(ws, "p1");
    expect(hub.following).toBe(1);
    hub.detach(ws);
    expect(hub.has(ws)).toBe(false);
    expect(hub.following).toBe(0);
    hub.stop();
  });

  test("a pane that starts a new session switches the client to the new file", async () => {
    const first = await sessionFile(numbered(2));
    const second = join(dir!, "next.jsonl");
    await writeFile(second, jsonl([ompUser("fresh session")]));
    const paths = new Map<string, string | null>([["p1", first]]);
    const hub = hubFor(paths);
    const ws = new FakeSocket();
    await hub.subscribe(ws, "p1");
    paths.set("p1", second);
    const next = await until(() =>
      ws.of("transcript").length > 1 ? ws.of("transcript")[1] : undefined,
    );
    expect((next.entries as TranscriptEntry[]).map((e) => e.text)).toEqual(["fresh session"]);
    expect(hub.following).toBe(1);
    hub.stop();
  });
});
