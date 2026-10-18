import type { PaneListItem } from "@/lib/api";

// Agent statuses that count as an attached, working session (same set as the
// web's PanesPage).
const LIVE_STATUS: Record<string, true> = { running: true, working: true, active: true };

export function isPaneLive(pane: PaneListItem): boolean {
  return pane.agent_status !== null && pane.agent_status in LIVE_STATUS;
}

export function paneTitle(pane: PaneListItem): string {
  return pane.title ?? (pane.agent ? `${pane.agent} session` : "shell");
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
