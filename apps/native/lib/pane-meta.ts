import type { PaneListItem } from "@/lib/api";
import { agentDisplayName } from "@/lib/direct/session-meta";

// herdr agent statuses that mean the agent is mid-turn (same set as the web's
// PanesPage).
const WORKING_STATUS: Record<string, true> = { running: true, working: true, active: true };

/**
 * What a pane asks of the human. `blocked` is herdr recognising an approval or
 * question UI; `done` is a finished turn nobody has looked at yet.
 */
export type PaneAttention = "needs-you" | "done" | "working" | "idle" | "shell";

export const ATTENTION_LABEL: Record<Exclude<PaneAttention, "shell">, string> = {
  "needs-you": "Needs you",
  done: "Done",
  working: "Working",
  idle: "Idle",
};

const ATTENTION_ORDER: Record<PaneAttention, number> = {
  "needs-you": 0,
  done: 1,
  working: 2,
  idle: 3,
  shell: 4,
};

export function paneAttention(pane: PaneListItem): PaneAttention {
  if (pane.agent === null) return "shell";
  const status = pane.agent_status;
  if (status === "blocked") return "needs-you";
  if (status === "done") return "done";
  if (status !== null && WORKING_STATUS[status] === true) return "working";
  return "idle";
}

/** Stable: panes in the same state keep the order the bridge listed them in. */
export function sortPanesByAttention(list: readonly PaneListItem[]): PaneListItem[] {
  return list
    .map((pane, index) => ({ pane, index, rank: ATTENTION_ORDER[paneAttention(pane)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.pane);
}

/** Caption for the Panes tab: "2 need you · 3 working · 12 shells" (empty states omitted). */
export function paneSummary(list: readonly PaneListItem[]): string {
  const counts: Record<PaneAttention, number> = {
    "needs-you": 0,
    done: 0,
    working: 0,
    idle: 0,
    shell: 0,
  };
  for (const pane of list) counts[paneAttention(pane)]++;
  const parts: [number, string][] = [
    [counts["needs-you"], counts["needs-you"] === 1 ? "needs you" : "need you"],
    [counts.done, "done"],
    [counts.working, "working"],
    [counts.idle, "idle"],
    [counts.shell, counts.shell === 1 ? "shell" : "shells"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(" · ");
}

/** Attention states the user acknowledges by opening the pane. */
export function isActionable(attention: PaneAttention): boolean {
  return attention === "needs-you" || attention === "done";
}

/** pane_id -> the attention state the user has already seen for that pane. */
export type PaneSeen = Readonly<Record<string, PaneAttention>>;

/** Panes that need a look: needs-you or done, and not yet acknowledged in that state. */
export function unseenAttentionPanes(
  list: readonly PaneListItem[],
  seen: PaneSeen,
): PaneListItem[] {
  return sortPanesByAttention(list).filter((pane) => {
    const attention = paneAttention(pane);
    return isActionable(attention) && seen[pane.pane_id] !== attention;
  });
}

export function attentionCount(list: readonly PaneListItem[], seen: PaneSeen): number {
  return unseenAttentionPanes(list, seen).length;
}

/** Record that the user has seen `pane` in its current state (no-op for non-actionable states). */
export function acknowledge(seen: PaneSeen, paneId: string, attention: PaneAttention): PaneSeen {
  if (!isActionable(attention) || seen[paneId] === attention) return seen;
  return { ...seen, [paneId]: attention };
}

/**
 * Forget acknowledgements that no longer match the pane: it moved to another
 * state (so its next done / needs-you counts again) or it is gone. Returns the
 * same object when nothing changed.
 */
export function pruneSeen(seen: PaneSeen, list: readonly PaneListItem[]): PaneSeen {
  const current = new Map(list.map((pane) => [pane.pane_id, paneAttention(pane)]));
  let next: Record<string, PaneAttention> | null = null;
  for (const [paneId, attention] of Object.entries(seen)) {
    if (current.get(paneId) === attention) continue;
    next ??= { ...seen };
    delete next[paneId];
  }
  return next ?? seen;
}

// omp prefixes its terminal title with "π" plus a braille spinner frame while
// working or ">" while idle ("π ⠋ 🔔 PANE: …", "π > 🏪 STORE: …"). Both marker
// forms are required so a title that merely starts with the letter survives.
const OMP_TITLE_PREFIX = /^π\s+(?:[\u2800-\u28FF]|>)(?:\s+|$)/u;

/** The pane title without the omp state prefix; null when nothing is left. */
export function cleanPaneTitle(title: string | null): string | null {
  if (title === null) return null;
  return title.replace(OMP_TITLE_PREFIX, "").trim() || null;
}

export function paneTitle(pane: PaneListItem): string {
  return (
    cleanPaneTitle(pane.title) ?? (pane.agent ? `${agentDisplayName(pane.agent)} session` : "shell")
  );
}

/**
 * The tracker issue an agent pane is working on, when its title names one
 * (agents title their pane "ATUR-33 …"). The bridge list carries no explicit
 * claim field, so this is best-effort and null for plain shells.
 */
export function paneIssueKey(pane: PaneListItem): string | null {
  return pane.title?.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/)?.[0] ?? null;
}

/** Last two path segments: enough to tell checkouts apart in a narrow row. */
export function shortCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  return cwd.split("/").filter(Boolean).slice(-2).join("/") || cwd;
}
