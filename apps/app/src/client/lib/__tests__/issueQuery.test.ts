import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUERY,
  MY_ISSUES_QUERY,
  applyIssueQuery,
  countFacets,
  dueBucket,
  dueRef,
  groupIssues,
  normalizeIssueQuery,
  parseIssueQuery,
  productOf,
  serializeIssueQuery,
  stripProduct,
  type QueryIssue,
  type QueryState,
} from "../issueQuery";

const TODAY = new Date("2026-10-14T12:00:00"); // Wednesday; week ends Sun 2026-10-18

const states: QueryState[] = [
  { id: "s-todo", name: "Todo", group: "backlog", key: "todo", sequence: 65535 },
  { id: "s-prog", name: "In Progress", group: "started", key: "in_progress", sequence: 65535 },
  { id: "s-you", name: "Needs You", group: "started", key: "needs_you", sequence: 65535 },
  { id: "s-done", name: "Done", group: "completed", key: "done", sequence: 65535 },
];

let seq = 0;
const issue = (over: Partial<QueryIssue> & { name: string }): QueryIssue => ({
  id: `i${++seq}`,
  sequence_id: seq,
  state_id: "s-todo",
  priority: "none",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  start_date: null,
  target_date: null,
  ...over,
});

const ME = "u-me";
const OTHER = "u-other";

describe("product prefix", () => {
  it("derives the product from `Name:` and `[Name]` prefixes", () => {
    expect(productOf("JoyoFit: Ship it")).toBe("JoyoFit");
    expect(productOf("[Threads] Fix hook")).toBe("Threads");
    expect(productOf("Plain title")).toBeNull();
    expect(stripProduct("JoyoFit: Ship it")).toBe("Ship it");
    expect(stripProduct("[Threads] Fix hook")).toBe("Fix hook");
    expect(stripProduct("Plain title")).toBe("Plain title");
  });
});

describe("URL round trip", () => {
  it("restores every filter, sort and group from the query string", () => {
    const params = new URLSearchParams(
      "view=list&product=JoyoFit,Both&due=overdue&sort=target_date:asc&group=state&priority=urgent,high&state=needs_you&q=hello&assignee=me,none&decision=1&target_from=2026-10-01",
    );
    const q = parseIssueQuery(params);
    expect(q).toMatchObject({
      view: "list",
      product: ["JoyoFit", "Both"],
      due: "overdue",
      sort: { field: "target_date", dir: "asc" },
      group: "state",
      priority: ["urgent", "high"],
      state: ["needs_you"],
      q: "hello",
      assignee: ["me", "none"],
      decision: true,
      target_from: "2026-10-01",
    });
    const again = parseIssueQuery(serializeIssueQuery(q));
    expect(again).toEqual(q);
  });

  it("omits defaults from the URL", () => {
    expect(serializeIssueQuery(DEFAULT_QUERY).toString()).toBe("");
  });

  it("ignores invalid values", () => {
    const q = parseIssueQuery(
      new URLSearchParams("view=bogus&group=nope&sort=wat:asc&due=later&target_from=oops"),
    );
    expect(q).toEqual(DEFAULT_QUERY);
  });

  it("lets an empty param override a non-empty default (My Issues → everyone)", () => {
    expect(parseIssueQuery(new URLSearchParams(""), MY_ISSUES_QUERY).assignee).toEqual(["me"]);
    const cleared = { ...MY_ISSUES_QUERY, assignee: [] };
    const params = serializeIssueQuery(cleared, MY_ISSUES_QUERY);
    expect(params.toString()).toBe("assignee=");
    expect(parseIssueQuery(params, MY_ISSUES_QUERY).assignee).toEqual([]);
  });

  it("normalizes stored saved-view payloads", () => {
    const q = normalizeIssueQuery({ view: "gantt", product: ["JoyoRogo"], junk: 1, group: "x" });
    expect(q.view).toBe("gantt");
    expect(q.product).toEqual(["JoyoRogo"]);
    expect(q.group).toBe("none");
    expect(normalizeIssueQuery(null)).toEqual(DEFAULT_QUERY);
  });
});

describe("applyIssueQuery", () => {
  const issues = [
    issue({
      name: "JoyoFit: a",
      priority: "urgent",
      target_date: "2026-10-10",
      assignees: [{ id: ME }],
    }),
    issue({ name: "JoyoFit: b", target_date: "2026-10-14", assignees: [{ id: ME }] }),
    issue({
      name: "JoyoRogo: c",
      target_date: "2026-10-16",
      state_id: "s-you",
      assignees: [{ id: OTHER }],
    }),
    issue({ name: "JoyoRogo: d", target_date: "2026-11-30", is_decision: 1 }),
    issue({
      name: "Threads thing",
      state_id: "s-done",
      target_date: "2026-10-01",
      assignees: [{ id: ME }],
    }),
    issue({ name: "[Threads] e", state_id: "s-prog", labels: [{ id: "l1", name: "bug" }] }),
  ];
  const run = (patch: Partial<typeof DEFAULT_QUERY>) =>
    applyIssueQuery(issues, { ...DEFAULT_QUERY, ...patch }, ME, { states, today: TODAY }).map(
      (i) => i.name,
    );

  it("hides completed issues by default and shows them on request", () => {
    expect(run({})).not.toContain("Threads thing");
    expect(run({ done: "show" })).toContain("Threads thing");
  });

  it("an explicit state filter beats the done toggle", () => {
    expect(run({ state: ["done"] })).toEqual(["Threads thing"]);
  });

  it("filters by multiple products", () => {
    expect(run({ product: ["JoyoFit", "Threads"] }).sort()).toEqual(
      ["JoyoFit: a", "JoyoFit: b", "[Threads] e"].sort(),
    );
  });

  it("overdue excludes closed issues and today", () => {
    expect(run({ due: "overdue", done: "show" })).toEqual(["JoyoFit: a"]);
    expect(run({ due: "today" })).toEqual(["JoyoFit: b"]);
  });

  it("this week includes today through Sunday", () => {
    expect(run({ due: "week" }).sort()).toEqual(["JoyoFit: b", "JoyoRogo: c"]);
  });

  it("no date", () => {
    expect(run({ due: "none" })).toEqual(["[Threads] e"]);
  });

  it("assignee me / none / uuid", () => {
    expect(run({ assignee: ["me"] }).sort()).toEqual(["JoyoFit: a", "JoyoFit: b"]);
    expect(run({ assignee: ["none"] }).sort()).toEqual(["JoyoRogo: d", "[Threads] e"]);
    expect(run({ assignee: [OTHER] })).toEqual(["JoyoRogo: c"]);
    expect(run({ assignee: ["me", OTHER] })).toHaveLength(3);
  });

  it("filters by state key, priority, label, decision, text and date range", () => {
    expect(run({ state: ["needs_you"] })).toEqual(["JoyoRogo: c"]);
    expect(run({ priority: ["urgent"] })).toEqual(["JoyoFit: a"]);
    expect(run({ label: ["l1"] })).toEqual(["[Threads] e"]);
    expect(run({ decision: true })).toEqual(["JoyoRogo: d"]);
    expect(run({ q: "ROGO: C" })).toEqual(["JoyoRogo: c"]);
    expect(run({ target_from: "2026-10-12", target_to: "2026-10-20" }).sort()).toEqual([
      "JoyoFit: b",
      "JoyoRogo: c",
    ]);
  });

  it("sorts undated issues last whichever direction", () => {
    const asc = run({ sort: { field: "target_date", dir: "asc" } });
    const desc = run({ sort: { field: "target_date", dir: "desc" } });
    expect(asc[0]).toBe("JoyoFit: a");
    expect(asc.at(-1)).toBe("[Threads] e");
    expect(desc[0]).toBe("JoyoRogo: d");
    expect(desc.at(-1)).toBe("[Threads] e");
  });

  it("sorts by state in workflow order", () => {
    const names = run({ sort: { field: "state", dir: "asc" }, done: "show" });
    expect(names.slice(0, 3).sort()).toEqual(["JoyoFit: a", "JoyoFit: b", "JoyoRogo: d"]);
    expect(run({ sort: { field: "state", dir: "asc" }, done: "show" }).at(-1)).toBe(
      "Threads thing",
    );
  });
});

describe("dueBucket", () => {
  const ref = dueRef(TODAY);
  it("buckets by target date", () => {
    const b = (d: string | null) =>
      dueBucket(issue({ name: "x", target_date: d }), ref, new Map(states.map((s) => [s.id, s])));
    expect(b("2026-10-13")).toBe("overdue");
    expect(b("2026-10-14")).toBe("today");
    expect(b("2026-10-18")).toBe("week");
    expect(b("2026-10-19")).toBe("later");
    expect(b(null)).toBe("none");
  });
});

describe("groupIssues", () => {
  const a = issue({
    name: "JoyoFit: a",
    priority: "high",
    state_id: "s-prog",
    assignees: [{ id: ME, display_name: "Me" }],
  });
  const b = issue({ name: "JoyoRogo: b", priority: "urgent", state_id: "s-todo" });
  const c = issue({
    name: "plain",
    priority: "none",
    state_id: "s-you",
    assignees: [{ id: OTHER, display_name: "Zed" }],
  });

  it("groups by state in workflow order", () => {
    const g = groupIssues([a, b, c], "state", { states });
    expect(g.map((x) => x.label)).toEqual(["Todo", "In Progress", "Needs You"]);
  });

  it("groups by priority urgent→none, product with 'No product' last", () => {
    expect(groupIssues([a, b, c], "priority").map((x) => x.key)).toEqual([
      "urgent",
      "high",
      "none",
    ]);
    const p = groupIssues([c, a, b], "product");
    expect(p.map((x) => x.label)).toEqual(["JoyoFit", "JoyoRogo", "No product"]);
  });

  it("groups by assignee with me first and Unassigned last", () => {
    const g = groupIssues([b, c, a], "assignee", { me: ME });
    expect(g.map((x) => x.label)).toEqual(["Me", "Zed", "Unassigned"]);
  });

  it("groups by due bucket in order", () => {
    const x = issue({ name: "x", target_date: "2026-10-01" });
    const y = issue({ name: "y", target_date: "2026-10-14" });
    const z = issue({ name: "z" });
    const g = groupIssues([z, y, x], "due", { states, today: TODAY });
    expect(g.map((q) => q.label)).toEqual(["Overdue", "Today", "No date"]);
  });

  it("returns a single group for none", () => {
    expect(groupIssues([a, b], "none")).toHaveLength(1);
  });
});

describe("countFacets", () => {
  it("counts state keys, priorities and products", () => {
    const f = countFacets(
      [
        issue({ name: "JoyoFit: a", priority: "high" }),
        issue({ name: "JoyoFit: b", state_id: "s-you" }),
      ],
      states,
    );
    expect(f.state).toEqual({ todo: 1, needs_you: 1 });
    expect(f.priority).toEqual({ high: 1, none: 1 });
    expect(f.product).toEqual({ JoyoFit: 2 });
  });
});
