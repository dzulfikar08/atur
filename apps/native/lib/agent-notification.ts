export type AgentNotification = { paneId: string; status: "done" | "blocked" };

/** Parses a push `data` payload; null when it isn't an agent alert. */
export function parseAgentNotification(data: unknown): AgentNotification | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, pane_id: paneId, status } = data as Record<string, unknown>;
  if (type !== "agent" || typeof paneId !== "string" || paneId === "") return null;
  if (status !== "done" && status !== "blocked") return null;
  return { paneId, status };
}

/** True when `pathname` is the screen for `paneId` (ids like "wR:p2" may arrive URL-encoded). */
export function isViewingPane(pathname: string, paneId: string): boolean {
  const prefix = "/pane/";
  if (!pathname.startsWith(prefix)) return false;
  const segment = pathname.slice(prefix.length).split(/[/?#]/)[0] ?? "";
  if (segment === paneId) return true;
  try {
    return decodeURIComponent(segment) === paneId;
  } catch {
    return false;
  }
}
