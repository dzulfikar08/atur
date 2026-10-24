import type { PaneListItem, PaneTargets } from "@/lib/api";
import { shortCwd } from "@/lib/pane-meta";

/**
 * herdr workspace ids repeat across machines (`w1` exists on every bridge), so
 * a workspace is keyed by its machine too; the env-configured bridge has none.
 */
export function workspaceKey(machineId: string | undefined, workspaceId: string): string {
  return `${machineId ?? ""}|${workspaceId}`;
}

export function paneWorkspaceKey(pane: PaneListItem): string {
  return workspaceKey(pane.machine?.id, pane.workspace_id);
}

export interface WorkspaceChip {
  key: string;
  label: string;
}

/** One chip per workspace in the order the panes list them; clashing labels get the machine appended. */
export function workspaceChips(panes: readonly PaneListItem[]): WorkspaceChip[] {
  const seen = new Map<string, PaneListItem>();
  for (const pane of panes) {
    const key = paneWorkspaceKey(pane);
    if (!seen.has(key)) seen.set(key, pane);
  }
  const labelOf = (pane: PaneListItem) => pane.workspace_label || pane.workspace_id;
  const uses = new Map<string, number>();
  for (const pane of seen.values()) uses.set(labelOf(pane), (uses.get(labelOf(pane)) ?? 0) + 1);
  return [...seen].map(([key, pane]) => ({
    key,
    label:
      (uses.get(labelOf(pane)) ?? 0) > 1 && pane.machine
        ? `${labelOf(pane)} · ${pane.machine.name}`
        : labelOf(pane),
  }));
}

/** The saved selection when that workspace still has panes, else null (All). */
export function activeWorkspace(
  chips: readonly WorkspaceChip[],
  saved: string | null,
): string | null {
  return saved !== null && chips.some((chip) => chip.key === saved) ? saved : null;
}

export function filterByWorkspace(
  panes: readonly PaneListItem[],
  key: string | null,
): PaneListItem[] {
  return key === null ? [...panes] : panes.filter((pane) => paneWorkspaceKey(pane) === key);
}

/** The workspace's most recently active pane (highest revision; the later listed one on a tie). */
export function newestPane(panes: readonly PaneListItem[], key: string): PaneListItem | null {
  let best: PaneListItem | null = null;
  for (const pane of panes) {
    if (paneWorkspaceKey(pane) === key && (!best || pane.revision >= best.revision)) best = pane;
  }
  return best;
}

export interface NewWorkspaceTarget {
  /** Relay machine id; null is the env-configured dev box bridge. */
  machineId: string | null;
  name: string;
  /** Folders to pick from; free text is always offered on top. */
  paths: { path: string; label: string }[];
}

/**
 * Where a new workspace can go: the dev box when the caller may open workspaces
 * in at least one bound repo, plus each machine they own. A machine's folders
 * are the ones its workspaces already sit in.
 */
export function newWorkspaceTargets(targets: PaneTargets): NewWorkspaceTarget[] {
  const out: NewWorkspaceTarget[] = [];
  if (targets.roots.length > 0) {
    out.push({
      machineId: null,
      name: "Dev box",
      paths: targets.roots.map((root) => ({ path: root.path, label: root.label })),
    });
  }
  for (const machine of targets.machines) {
    const cwds = new Set<string>();
    for (const workspace of targets.workspaces) {
      if (workspace.machine?.id === machine.id && workspace.cwd) cwds.add(workspace.cwd);
    }
    out.push({
      machineId: machine.id,
      name: machine.name,
      paths: [...cwds].map((path) => ({ path, label: shortCwd(path) ?? path })),
    });
  }
  return out;
}

/** A typed folder: trimmed and absolute, else null. The server and bridge check the rest. */
export function customPath(input: string): string | null {
  const path = input.trim();
  return path.startsWith("/") ? path : null;
}
