import { describe, expect, test } from "bun:test";

import {
  applyChatFrame,
  isPendingAsk,
  mergeEntries,
  newestFirst,
  parseEntry,
  toolIcon,
  toolTitle,
  type ChatState,
  type TranscriptEntry,
} from "./transcript";

function entry(id: string, seq: number, over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { id, seq, role: "assistant", text: id, at: null, ...over };
}

function tool(
  id: string,
  seq: number,
  status: "running" | "done" | "error",
  extra: { summary?: string; result?: string } = {},
): TranscriptEntry {
  return entry(id, seq, {
    role: "tool",
    text: "",
    tool: {
      name: "bash",
      summary: extra.summary ?? "",
      status,
      ...(extra.result ? { result: extra.result } : {}),
    },
  });
}

describe("parseEntry", () => {
  test("accepts a well-formed entry and a tool entry", () => {
    expect(parseEntry({ id: "1:0", seq: 1024, role: "user", text: "hi", at: 5 })).toEqual({
      id: "1:0",
      seq: 1024,
      role: "user",
      text: "hi",
      at: 5,
    });
    expect(
      parseEntry({
        id: "t1",
        seq: 2,
        role: "tool",
        text: "",
        at: null,
        tool: { name: "read", summary: "a.ts", status: "weird", result: "x" },
      })?.tool,
    ).toEqual({ name: "read", summary: "a.ts", status: "done", result: "x" });
  });

  test("drops malformed entries", () => {
    for (const bad of [
      null,
      3,
      {},
      { id: 1, seq: 1, role: "user", text: "" },
      { id: "a", seq: NaN, role: "user", text: "" },
      { id: "a", seq: 1, role: "system", text: "" },
      { id: "a", seq: 1, role: "user" },
    ]) {
      expect(parseEntry(bad)).toBeNull();
    }
  });
});

describe("mergeEntries", () => {
  test("orders by seq and de-duplicates by id", () => {
    const merged = mergeEntries([entry("b", 2), entry("c", 3)], [entry("a", 1), entry("b", 2)]);
    expect(merged.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  test("a result completes its running call and a later re-read of the call cannot undo it", () => {
    const running = tool("t", 5, "running", { summary: "make" });
    const done = mergeEntries([running], [tool("t", 90, "done", { result: "ok" })]);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      seq: 5,
      tool: { summary: "make", status: "done", result: "ok" },
    });
    const again = mergeEntries(done, [running]);
    expect(again[0]!.tool).toMatchObject({ status: "done", result: "ok", summary: "make" });
  });

  test("an orphan result is filled in by the call that arrives from an older page", () => {
    const orphan = tool("t", 90, "done", { result: "ok" });
    const merged = mergeEntries([orphan], [tool("t", 5, "running", { summary: "make" })]);
    expect(merged[0]).toMatchObject({
      seq: 5,
      tool: { summary: "make", status: "done", result: "ok" },
    });
  });

  test("untouched entries keep their identity", () => {
    const a = entry("a", 1);
    const merged = mergeEntries([a, entry("b", 2)], [entry("c", 3)]);
    expect(merged[0]).toBe(a);
    expect(mergeEntries([a], [])).toEqual([a]);
  });
});

describe("applyChatFrame", () => {
  const wire = (id: string, seq: number, text = id) => ({ id, seq, role: "user", text, at: null });

  test("transcript replaces the whole chat", () => {
    const old: ChatState = { entries: [entry("old", 1)], hasMore: false, cursor: 0 };
    const next = applyChatFrame(old, {
      type: "transcript",
      entries: [wire("n", 9)],
      hasMore: true,
      cursor: 4096,
    });
    expect(next).toEqual({
      entries: [expect.objectContaining({ id: "n" })],
      hasMore: true,
      cursor: 4096,
    });
  });

  test("append and older need a chat first", () => {
    expect(applyChatFrame(null, { type: "append", entries: [wire("a", 1)] })).toBeNull();
    expect(applyChatFrame(null, { type: "older", before: 0, entries: [] })).toBeNull();
  });

  test("append merges at the end", () => {
    const state: ChatState = { entries: [entry("a", 1)], hasMore: true, cursor: 10 };
    const next = applyChatFrame(state, { type: "append", entries: [wire("b", 2)] })!;
    expect(next.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect([next.hasMore, next.cursor]).toEqual([true, 10]);
  });

  test("older prepends and advances the cursor; a stale or busy reply changes nothing", () => {
    const state: ChatState = { entries: [entry("b", 100)], hasMore: true, cursor: 500 };
    const next = applyChatFrame(state, {
      type: "older",
      before: 500,
      entries: [wire("a", 1)],
      hasMore: false,
      cursor: 0,
    })!;
    expect(next.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect([next.hasMore, next.cursor]).toEqual([false, 0]);
    expect(
      applyChatFrame(state, {
        type: "older",
        before: 999,
        entries: [wire("z", 0)],
        hasMore: false,
        cursor: 0,
      }),
    ).toBe(state);
    expect(
      applyChatFrame(state, {
        type: "older",
        before: 500,
        busy: true,
        entries: [],
        hasMore: true,
        cursor: 500,
      }),
    ).toBe(state);
  });

  test("unrelated frames are ignored", () => {
    const state: ChatState = { entries: [], hasMore: false, cursor: 0 };
    expect(applyChatFrame(state, { type: "blocks" })).toBe(state);
  });
});

describe("display helpers", () => {
  test("newestFirst does not mutate", () => {
    const list = [entry("a", 1), entry("b", 2)];
    expect(newestFirst(list).map((e) => e.id)).toEqual(["b", "a"]);
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("toolTitle and toolIcon", () => {
    expect(toolTitle("web_search")).toBe("Web search");
    expect(toolTitle("Bash")).toBe("Bash");
    expect(toolTitle("mcp__atur__update_issue")).toBe("Update issue");
    expect(toolTitle("")).toBe("Tool");
    expect(toolIcon("Read")).toBe("document-text-outline");
    expect(toolIcon("nope")).toBe("construct-outline");
  });

  test("only the newest unanswered ask is pending", () => {
    const ask = entry("q", 5, {
      role: "ask",
      tool: { name: "ask", summary: "?", status: "running" },
    });
    const later = entry("x", 9);
    expect(isPendingAsk(ask, ask)).toBe(true);
    expect(isPendingAsk(ask, later)).toBe(false);
    expect(isPendingAsk({ ...ask, tool: { name: "ask", summary: "?", status: "done" } }, ask)).toBe(
      false,
    );
    expect(isPendingAsk(later, later)).toBe(false);
  });
});
