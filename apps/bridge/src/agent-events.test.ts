/**
 * Agent event rules: settle windows, cancellations and session-file detail.
 * The tracker is pure and driven by explicit timestamps; no timers, no herdr.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentStateTracker,
  agentEventsConfigFromEnv,
  cleanAgentTitle,
  readSessionDetail,
  sessionIdFromPath,
  type AgentStatus,
  type TrackedPane,
} from "./agent-events";

function pane(status: AgentStatus, id = "w:p1", agent: string | null = "omp"): TrackedPane {
  return {
    pane_id: id,
    agent,
    agent_status: status,
    cwd: "/srv/acme",
    title: "T",
    session_path: null,
  };
}

describe("AgentStateTracker", () => {
  test("first sighting records status without an event", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    expect(t.observe([pane("done")], 0)).toEqual([]);
    expect(t.observe([pane("done")], 5000)).toEqual([]);
  });

  test("working -> done emits once after the settle window", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    expect(t.observe([pane("done")], 100)).toEqual([]);
    expect(t.observe([pane("done")], 600)).toEqual([]);
    const out = t.observe([pane("done")], 1100);
    expect(out.map((e) => [e.pane_id, e.status, e.agent, e.cwd])).toEqual([
      ["w:p1", "done", "omp", "/srv/acme"],
    ]);
    expect(t.observe([pane("done")], 9000)).toEqual([]);
    expect(t.observe([pane("idle")], 9500)).toEqual([]);
  });

  test("working -> idle -> working inside the window emits nothing", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    t.observe([pane("idle")], 100);
    t.observe([pane("working")], 400);
    expect(t.observe([pane("working")], 5000)).toEqual([]);
  });

  test("blocked emits after settle", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    t.observe([pane("blocked")], 100);
    expect(t.observe([pane("blocked")], 600)).toEqual([]);
    const out = t.observe([pane("blocked")], 1100);
    expect(out.map((e) => e.status)).toEqual(["blocked"]);
    expect(t.observe([pane("blocked")], 9000)).toEqual([]);
  });

  test("blocked -> working inside the window cancels", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    t.observe([pane("blocked")], 100);
    t.observe([pane("working")], 500);
    expect(t.observe([pane("working")], 5000)).toEqual([]);
  });

  test("done -> idle inside the window cancels (seen at the desk)", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    t.observe([pane("done")], 100);
    t.observe([pane("idle")], 500);
    expect(t.observe([pane("idle")], 5000)).toEqual([]);
  });

  test("a pane that disappears is forgotten and re-baselined", () => {
    const t = new AgentStateTracker({ settleMs: 1000 });
    t.observe([pane("working")], 0);
    t.observe([pane("done")], 100);
    t.observe([], 200);
    expect(t.observe([pane("done")], 5000)).toEqual([]);
    expect(t.observe([pane("done")], 9000)).toEqual([]);
  });

  test("panes without an agent are ignored", () => {
    const t = new AgentStateTracker({ settleMs: 0 });
    t.observe([pane("working", "w:p2", null)], 0);
    t.observe([pane("done", "w:p2", null)], 10);
    expect(t.observe([pane("done", "w:p2", null)], 20)).toEqual([]);
  });
});

describe("sessionIdFromPath", () => {
  test("takes the part after the timestamp, without the extension", () => {
    expect(sessionIdFromPath("/s/2026-09-01T14-13-16-934Z_01a05d51-3006.jsonl")).toBe(
      "01a05d51-3006",
    );
    expect(sessionIdFromPath("/s/plain.jsonl")).toBe("plain");
    expect(sessionIdFromPath(null)).toBeNull();
  });
});

describe("cleanAgentTitle", () => {
  test("strips the omp prefix with spinner or >", () => {
    expect(cleanAgentTitle("π ⠋ 🔔 PANE: Native app")).toBe("🔔 PANE: Native app");
    expect(cleanAgentTitle("π > 🏪 STORE: Register")).toBe("🏪 STORE: Register");
  });

  test("leaves other titles trimmed, empty becomes null", () => {
    expect(cleanAgentTitle("  zsh  ")).toBe("zsh");
    expect(cleanAgentTitle("π")).toBeNull();
    expect(cleanAgentTitle("   ")).toBeNull();
    expect(cleanAgentTitle(null)).toBeNull();
  });
});

describe("agentEventsConfigFromEnv", () => {
  test("disabled without a token; url defaults and loses trailing slashes", () => {
    expect(agentEventsConfigFromEnv({})).toBeNull();
    expect(agentEventsConfigFromEnv({ BRIDGE_TOKEN: "t" })).toEqual({
      url: "https://app.diatur.com",
      token: "t",
    });
    expect(agentEventsConfigFromEnv({ BRIDGE_TOKEN: "t", ATUR_URL: "http://x.test//" })?.url).toBe(
      "http://x.test",
    );
  });
});

describe("readSessionDetail", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  async function session(lines: unknown[] | string): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "agent-events-"));
    const path = join(dir, "s.jsonl");
    const body =
      typeof lines === "string" ? lines : lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    await writeFile(path, body);
    return path;
  }

  const assistant = (content: unknown[]) => ({
    type: "message",
    message: { role: "assistant", content },
  });

  test("blocked returns the newest ask question", async () => {
    const path = await session([
      assistant([
        {
          type: "toolCall",
          id: "1",
          name: "ask",
          arguments: { questions: [{ question: "Old?" }] },
        },
      ]),
      { type: "message", message: { role: "toolResult", content: [] } },
      assistant([
        { type: "thinking", thinking: "hm" },
        {
          type: "toolCall",
          id: "2",
          name: "ask",
          arguments: { questions: [{ question: "Which\n  branch   to use?" }] },
        },
      ]),
    ]);
    expect(await readSessionDetail(path, "blocked")).toBe("Which branch to use?");
  });

  test("done returns the last assistant text, truncated to 180 chars", async () => {
    const path = await session([
      assistant([{ type: "text", text: "earlier" }]),
      assistant([{ type: "text", text: "x".repeat(400) }]),
    ]);
    const detail = await readSessionDetail(path, "done");
    expect(detail).toBe(`${"x".repeat(179)}…`);
  });

  test("garbage or missing file yields null", async () => {
    expect(await readSessionDetail(await session("not json\n{broken"), "done")).toBeNull();
    expect(await readSessionDetail("/nonexistent/agent-events.jsonl", "blocked")).toBeNull();
  });
});

describe("AgentEventWatcher delivery", () => {
  test("with a relay, events go to it and nothing is POSTed", async () => {
    const { AgentEventWatcher } = await import("./agent-events");
    const sent: unknown[] = [];
    let fetched = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched++;
      return Promise.reject(new Error("no HTTP expected"));
    }) as unknown as typeof fetch;
    let status: "working" | "done" = "working";
    const backend = {
      pollPanes: async () => [
        {
          id: "p1",
          workspaceId: "w",
          workspaceLabel: "w",
          tabId: "t",
          cwd: "/repo",
          title: "t",
          agent: "claude",
          agentStatus: status,
          agentSessionPath: null,
          revision: 0,
        },
      ],
    } as unknown as import("./backend").PaneBackend;
    const watcher = new AgentEventWatcher(null, backend, {
      pollMs: 10,
      settleMs: 0,
      relay: { sendEvent: (e) => (sent.push(e), true) },
    });
    try {
      watcher.start();
      await Bun.sleep(60);
      status = "done";
      const end = Date.now() + 2_000;
      while (sent.length === 0 && Date.now() < end) await Bun.sleep(10);
    } finally {
      watcher.stop();
      globalThis.fetch = realFetch;
    }
    expect(fetched).toBe(0);
    expect(sent[0]).toMatchObject({ pane_id: "p1", status: "done", agent: "claude", cwd: "/repo" });
  });
});
