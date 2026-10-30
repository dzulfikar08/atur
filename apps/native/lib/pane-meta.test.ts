import { describe, expect, test } from "bun:test";

import type { PaneListItem } from "./api";
import {
  acknowledge,
  attentionCount,
  cleanPaneTitle,
  paneAttention,
  paneIssueKey,
  paneSummary,
  paneTitle,
  pruneSeen,
  sortPanesByAttention,
  unseenAttentionPanes,
} from "./pane-meta";

function pane(id: string, agent_status: string | null, agent: string | null = "omp") {
  return {
    pane_id: id,
    workspace_id: "w",
    workspace_label: "w",
    tab_id: "t",
    cwd: null,
    agent,
    agent_status,
    title: null,
    revision: 1,
  } satisfies PaneListItem;
}

describe("paneAttention", () => {
  test("maps herdr agent statuses", () => {
    expect(paneAttention(pane("a", "blocked"))).toBe("needs-you");
    expect(paneAttention(pane("a", "done"))).toBe("done");
    expect(paneAttention(pane("a", "working"))).toBe("working");
    expect(paneAttention(pane("a", "running"))).toBe("working");
    expect(paneAttention(pane("a", "active"))).toBe("working");
    expect(paneAttention(pane("a", "idle"))).toBe("idle");
    expect(paneAttention(pane("a", "unknown"))).toBe("idle");
    expect(paneAttention(pane("a", null))).toBe("idle");
    expect(paneAttention(pane("a", "constructor"))).toBe("idle");
  });

  test("a pane without an agent is a shell whatever its status", () => {
    expect(paneAttention(pane("a", null, null))).toBe("shell");
    expect(paneAttention(pane("a", "done", null))).toBe("shell");
  });
});

describe("sortPanesByAttention", () => {
  test("needs-you > done > working > idle > shell, stable inside a state", () => {
    const list = [
      pane("s1", null, null),
      pane("i1", "idle"),
      pane("w1", "working"),
      pane("d1", "done"),
      pane("n1", "blocked"),
      pane("w2", "working"),
      pane("d2", "done"),
      pane("s2", null, null),
    ];
    expect(sortPanesByAttention(list).map((p) => p.pane_id)).toEqual([
      "n1",
      "d1",
      "d2",
      "w1",
      "w2",
      "i1",
      "s1",
      "s2",
    ]);
  });

  test("does not mutate its input", () => {
    const list = [pane("i", "idle"), pane("n", "blocked")];
    sortPanesByAttention(list);
    expect(list.map((p) => p.pane_id)).toEqual(["i", "n"]);
  });
});

describe("attentionCount", () => {
  const list = [
    pane("n", "blocked"),
    pane("d", "done"),
    pane("w", "working"),
    pane("i", "idle"),
    pane("s", null, null),
  ];

  test("counts needs-you and done panes", () => {
    expect(attentionCount(list, {})).toBe(2);
    expect(unseenAttentionPanes(list, {}).map((p) => p.pane_id)).toEqual(["n", "d"]);
  });

  test("skips panes acknowledged in their current state", () => {
    expect(attentionCount(list, { d: "done" })).toBe(1);
    expect(attentionCount(list, { d: "done", n: "needs-you" })).toBe(0);
  });

  test("an acknowledgement of another state does not hide the pane", () => {
    expect(attentionCount(list, { n: "done" })).toBe(2);
  });
});

describe("acknowledge", () => {
  test("records actionable states only", () => {
    expect(acknowledge({}, "a", "done")).toEqual({ a: "done" });
    expect(acknowledge({ a: "done" }, "a", "needs-you")).toEqual({ a: "needs-you" });
    const seen = {};
    expect(acknowledge(seen, "a", "working")).toBe(seen);
    expect(acknowledge(seen, "a", "idle")).toBe(seen);
    expect(acknowledge(seen, "a", "shell")).toBe(seen);
  });

  test("returns the same object when already acknowledged", () => {
    const seen = { a: "done" } as const;
    expect(acknowledge(seen, "a", "done")).toBe(seen);
  });
});

describe("pruneSeen", () => {
  test("keeps acknowledgements that still match", () => {
    const seen = { d: "done", n: "needs-you" } as const;
    expect(pruneSeen(seen, [pane("d", "done"), pane("n", "blocked")])).toBe(seen);
  });

  test("drops a pane that changed state so its next done counts again", () => {
    let seen = acknowledge({}, "d", "done");
    expect(attentionCount([pane("d", "done")], seen)).toBe(0);

    seen = pruneSeen(seen, [pane("d", "working")]);
    expect(seen).toEqual({});
    expect(attentionCount([pane("d", "done")], seen)).toBe(1);
  });

  test("drops panes that are gone", () => {
    expect(pruneSeen({ gone: "done", d: "done" }, [pane("d", "done")])).toEqual({ d: "done" });
  });

  test("does not mutate the previous snapshot", () => {
    const seen = { d: "done" } as const;
    pruneSeen(seen, []);
    expect(seen).toEqual({ d: "done" });
  });
});

describe("paneSummary", () => {
  test("lists the non-empty states in attention order", () => {
    const list = [
      pane("n1", "blocked"),
      pane("n2", "blocked"),
      pane("w1", "working"),
      pane("w2", "working"),
      pane("w3", "working"),
      pane("d", "done"),
      ...Array.from({ length: 12 }, (_, i) => pane(`s${i}`, null, null)),
    ];
    expect(paneSummary(list)).toBe("2 need you · 1 done · 3 working · 12 shells");
  });

  test("singular forms and empty input", () => {
    expect(paneSummary([pane("n", "blocked"), pane("s", null, null)])).toBe(
      "1 needs you · 1 shell",
    );
    expect(paneSummary([])).toBe("");
  });
});

describe("cleanPaneTitle", () => {
  test("strips the omp spinner and idle prefixes", () => {
    expect(cleanPaneTitle("π ⠋ 🔔 PANE: Native app agent pane notifications")).toBe(
      "🔔 PANE: Native app agent pane notifications",
    );
    expect(cleanPaneTitle("π > 🏪 STORE: Register Play...")).toBe("🏪 STORE: Register Play...");
    expect(cleanPaneTitle("π ⣾ ATUR-33 fix")).toBe("ATUR-33 fix");
  });

  test("leaves other titles alone", () => {
    expect(cleanPaneTitle("ATUR-33 fix")).toBe("ATUR-33 fix");
    expect(cleanPaneTitle("vim notes.md")).toBe("vim notes.md");
    expect(cleanPaneTitle("π is a number")).toBe("π is a number");
  });

  test("nothing left is null", () => {
    expect(cleanPaneTitle(null)).toBeNull();
    expect(cleanPaneTitle("π ⠋")).toBeNull();
    expect(cleanPaneTitle("π >")).toBeNull();
  });
});

describe("paneTitle", () => {
  test("falls back to the agent or shell name", () => {
    expect(paneTitle({ ...pane("a", "idle"), title: "π > hello" })).toBe("hello");
    expect(paneTitle({ ...pane("a", "idle"), title: "π ⠋" })).toBe("omp session");
    expect(paneTitle({ ...pane("a", "idle", "Oh My Pi"), title: "π ⠋" })).toBe("omp session");
    expect(paneTitle({ ...pane("a", "idle", "claude"), title: null })).toBe("claude session");
    expect(paneTitle(pane("a", null, null))).toBe("shell");
  });
});

describe("paneIssueKey with a linked session", () => {
  const linked = {
    pane_id: "p1",
    state: "working",
    issue: { key: "ATUR-12", name: "Link panes", workspace_slug: "diatur" },
  } as const;

  test("the link wins over the pane title", () => {
    const p = { ...pane("p1", "working"), title: "ATUR-99 something" };
    expect(paneIssueKey(p, linked)).toBe("ATUR-12");
    expect(paneIssueKey(p)).toBe("ATUR-99");
    expect(paneIssueKey(pane("p1", null, null))).toBeNull();
  });
});
