// Sample data for the landing-page hero demo (components/HeroDemo.astro).
// Shared by the server render and the client script so both agree on what
// the board, the issues and the usage tables hold. Labels follow the app's
// own screens (apps/app/src/client): board columns, issue properties,
// comment and activity wording, timesheet usage columns.

export type Tone = "started" | "needs" | "review" | "done";

export const STATES: { tone: Tone; name: string }[] = [
  { tone: "started", name: "In Progress" },
  { tone: "needs", name: "Needs You" },
  { tone: "review", name: "Need Review" },
  { tone: "done", name: "Done" },
];

export const stateName = (tone: Tone) => STATES.find((s) => s.tone === tone)?.name ?? tone;

// The board's agent chip (BoardView AgentChip): "working" while the issue is
// started, "done" once completed.
export const agentChipText = (tone: Tone) => (tone === "done" ? "done" : "working");

// Board cards show the sequence zero-padded: ATUR-44 reads "#0044".
export const cardSeq = (key: string) => `#${key.split("-")[1].padStart(4, "0")}`;

export type Priority = "Urgent" | "High" | "Medium" | "Low";

// Activity rows are state changes, worded "<who> changed State from X to Y".
export interface ThreadEntry {
  kind: "comment" | "event";
  who: string;
  agent?: boolean;
  ago: string;
  text?: string;
  // Comments that carry proof render as the app's amber evidence panel.
  evidence?: boolean;
  attach?: string;
  from?: string;
  to?: string;
}

export interface DemoIssue {
  key: string;
  title: string;
  tone: Tone;
  priority: Priority;
  agent: string;
  created: string;
  updated: string;
  body: string;
  thread: ThreadEntry[];
}

export const ISSUES: DemoIssue[] = [
  {
    key: "ATUR-44",
    title: "Rate-limit the public waitlist endpoint",
    tone: "started",
    priority: "High",
    agent: "firstmate",
    created: "10/26/2026",
    updated: "about 1 hour ago",
    body: "The waitlist form posts without a limit. Cap it per IP and answer 429 with a retry hint.",
    thread: [
      {
        kind: "comment",
        who: "firstmate",
        agent: true,
        ago: "about 1 hour ago",
        text: "Picked this up. Working on a branch in its own worktree, pane linked.",
      },
      { kind: "event", who: "firstmate", ago: "about 1 hour ago", from: "Todo", to: "In Progress" },
    ],
  },
  {
    key: "ATUR-42",
    title: "CSV export for the timesheet",
    tone: "started",
    priority: "Medium",
    agent: "codex",
    created: "10/26/2026",
    updated: "about 1 hour ago",
    body: "Export the visible week as CSV: one row per entry, with issue key, person, hours and note.",
    thread: [
      {
        kind: "comment",
        who: "codex",
        agent: true,
        ago: "about 1 hour ago",
        text: "Picked this up. Live pane is linked if you want to watch.",
      },
      { kind: "event", who: "codex", ago: "about 1 hour ago", from: "Todo", to: "In Progress" },
    ],
  },
  {
    key: "ATUR-41",
    title: "Webhook retries back off and give up",
    tone: "needs",
    priority: "High",
    agent: "firstmate",
    created: "10/25/2026",
    updated: "about 40 minutes ago",
    body: "Failed webhook deliveries retry forever. Back off, give up after a few tries, and let a person replay them.",
    thread: [
      {
        kind: "comment",
        who: "firstmate",
        agent: true,
        ago: "about 1 hour ago",
        text: "Retries now back off 2s, 4s, 8s, then give up. 6 tests passing.",
      },
      {
        kind: "comment",
        who: "firstmate",
        agent: true,
        ago: "about 40 minutes ago",
        text: "NEEDS YOU: which Stripe account should replays use, test or live?",
      },
      {
        kind: "event",
        who: "firstmate",
        ago: "about 40 minutes ago",
        from: "In Progress",
        to: "Needs You",
      },
    ],
  },
  {
    key: "ATUR-35",
    title: "Invite email returns 500 on verify",
    tone: "review",
    priority: "Urgent",
    agent: "firstmate",
    created: "10/24/2026",
    updated: "about 2 hours ago",
    body: "Invited users hit a 500 when they open the verify link. Reproduce, fix, and show the flow working.",
    thread: [
      {
        kind: "comment",
        who: "firstmate",
        agent: true,
        ago: "about 2 hours ago",
        evidence: true,
        text: "Token TTL was compared in seconds against milliseconds. Fixed in verify.ts, 3 tests added, all passing.",
        attach: "verify-flow.png",
      },
      {
        kind: "event",
        who: "firstmate",
        ago: "about 2 hours ago",
        from: "In Progress",
        to: "Need Review",
      },
    ],
  },
  {
    key: "ATUR-31",
    title: "Dark mode for the board",
    tone: "done",
    priority: "Low",
    agent: "codex",
    created: "10/22/2026",
    updated: "about 1 day ago",
    body: "The board ignores the system theme. Follow it, and keep state colours readable in both modes.",
    thread: [
      {
        kind: "comment",
        who: "codex",
        agent: true,
        ago: "about 1 day ago",
        evidence: true,
        text: "Board follows the system theme. Screenshots of both modes attached.",
        attach: "board-dark.png",
      },
      { kind: "event", who: "You", ago: "about 1 day ago", from: "Need Review", to: "Done" },
    ],
  },
  {
    key: "ATUR-29",
    title: "Paginate the activity feed",
    tone: "done",
    priority: "Medium",
    agent: "firstmate",
    created: "10/21/2026",
    updated: "about 2 days ago",
    body: "Long issues load every activity row at once. Page them 50 at a time.",
    thread: [
      {
        kind: "comment",
        who: "firstmate",
        agent: true,
        ago: "about 2 days ago",
        text: "Feed pages 50 rows at a time, newest first. 2 tests added.",
      },
      { kind: "event", who: "You", ago: "about 2 days ago", from: "Need Review", to: "Done" },
    ],
  },
];

// The live-pane tab replays this session once. Its last line hands ATUR-42
// to review, and the board follows.
export const PANE_ISSUE = "ATUR-42";
export const PANE_TITLE = "ATUR-42 CSV export for the timesheet";
export const PANE_CONTEXT = "atur · codex · ~/code/atur-web";
export const PANE_SCRIPT: [kind: "" | "dim" | "ok", text: string][] = [
  ["dim", "› add a CSV export to the timesheet (ATUR-42)"],
  ["", "Reading src/client/pages/timesheet/TimesheetPage.tsx"],
  ["", "Adding exportCsv() next to the weekly totals"],
  ["", "Quoting commas and quotes in issue titles"],
  ["ok", "✓ 4 tests added, all passing"],
  ["", "Posting evidence to ATUR-42…"],
  ["dim", "  Moved ATUR-42 to Need Review"],
];
export const PANE_EVIDENCE =
  "Evidence: CSV export added to the timesheet toolbar. Commas and quotes in titles are escaped; 4 tests cover it.";

// Agent usage: token counts and tracked time are sample sessions. Model ids
// and per-million (input, output) rates are the app's own rate card, seeded
// in apps/app/drizzle/0015_redundant_lady_vermin.sql (model_prices), so the
// totals add up the way the real timesheet computes them.
export const MODEL_PRICES: Record<string, [input: number, output: number]> = {
  "claude-sonnet-4-5": [3, 15],
  "gpt-5.2-codex": [1.25, 10],
};

export interface UsageEntry {
  agent: string;
  model: string;
  issue: string;
  seconds: number;
  input: number;
  output: number;
}

export const USAGE: UsageEntry[] = [
  {
    agent: "firstmate",
    model: "claude-sonnet-4-5",
    issue: "ATUR-35",
    seconds: 2880,
    input: 412_000,
    output: 38_400,
  },
  {
    agent: "firstmate",
    model: "claude-sonnet-4-5",
    issue: "ATUR-41",
    seconds: 1860,
    input: 268_500,
    output: 22_100,
  },
  {
    agent: "firstmate",
    model: "claude-sonnet-4-5",
    issue: "ATUR-44",
    seconds: 1020,
    input: 154_200,
    output: 12_800,
  },
  {
    agent: "codex",
    model: "gpt-5.2-codex",
    issue: "ATUR-42",
    seconds: 2280,
    input: 327_800,
    output: 29_600,
  },
  {
    agent: "codex",
    model: "gpt-5.2-codex",
    issue: "ATUR-31",
    seconds: 3540,
    input: 506_300,
    output: 41_200,
  },
];

export type UsageGroup = "agent" | "model" | "issue";

interface UsageTotals {
  entries: number;
  seconds: number;
  input: number;
  output: number;
  cost: number;
}

export interface UsageRow extends UsageTotals {
  // Issue sequence number when the row is an issue, else empty.
  seq: string;
  label: string;
}

// One table per group: its head names the group (and, in mono, the other
// dimension), its rows are issues, or agents when grouped by issue.
export interface UsageSection extends UsageTotals {
  name: string;
  note: string;
  rows: UsageRow[];
}

const entryCost = (e: UsageEntry) => {
  const [inRate, outRate] = MODEL_PRICES[e.model];
  return (e.input * inRate + e.output * outRate) / 1_000_000;
};

const issueTitle = (key: string) => ISSUES.find((i) => i.key === key)?.title ?? key;

const addTo = (row: UsageTotals, e: UsageEntry) => {
  row.entries += 1;
  row.seconds += e.seconds;
  row.input += e.input;
  row.output += e.output;
  row.cost += entryCost(e);
};

export function groupUsage(by: UsageGroup): UsageSection[] {
  const sections = new Map<string, UsageSection>();
  for (const e of USAGE) {
    const name = by === "issue" ? `${e.issue.split("-")[1]} ${issueTitle(e.issue)}` : e[by];
    const note = by === "agent" ? e.model : by === "model" ? e.agent : e.model;
    const section = sections.get(name) ?? {
      name,
      note,
      rows: [],
      entries: 0,
      seconds: 0,
      input: 0,
      output: 0,
      cost: 0,
    };
    const rowName = by === "issue" ? e.agent : issueTitle(e.issue);
    const seq = by === "issue" ? "" : e.issue.split("-")[1];
    let row = section.rows.find((r) => r.label === rowName);
    if (!row) {
      row = { seq, label: rowName, entries: 0, seconds: 0, input: 0, output: 0, cost: 0 };
      section.rows.push(row);
    }
    addTo(row, e);
    addTo(section, e);
    sections.set(name, section);
  }
  const out = [...sections.values()];
  for (const s of out) s.rows.sort((a, b) => b.cost - a.cost);
  return out.sort((a, b) => b.cost - a.cost);
}

export function usageTotals() {
  let tokens = 0;
  let seconds = 0;
  let cost = 0;
  for (const e of USAGE) {
    tokens += e.input + e.output;
    seconds += e.seconds;
    cost += entryCost(e);
  }
  return { tokens, seconds, cost };
}

// Same formats as the timesheet: "12.0k" / "1.2M" tokens, "0:48" tracked
// time, "3h 13m" in the header.
export const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`;
export const formatCost = (n: number) => `$${n.toFixed(2)}`;
export const formatHm = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
export const formatDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
