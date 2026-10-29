import type { DirectSnapshot, DirectState } from "@/lib/direct/manager";

// Which road a pane's frames take: straight to the computer (direct) or through the Cloudflare
// Worker and the bridge. The rules live here so they can be tested; `usePaneAttach` only runs them.

export type PaneTransport = "direct" | "bridge";

/** `direct:<session id>` panes exist on the direct road only (the Panes tab's Direct section). */
export const DIRECT_PANE_PREFIX = "direct:";
/** Direct has this long to attach before the bridge takes over. */
export const DIRECT_CONNECT_TIMEOUT_MS = 4000;
/** A dropped direct connection has this long to come back before the bridge takes over. */
export const DIRECT_LOST_TIMEOUT_MS = 6000;

export interface PaneTarget {
  directOnly: boolean;
  /** The decimal session id on the computer (the bridge's pane id on Atur Terminal). */
  sessionId: string;
}

export function parsePaneTarget(paneId: string): PaneTarget {
  return paneId.startsWith(DIRECT_PANE_PREFIX)
    ? { directOnly: true, sessionId: paneId.slice(DIRECT_PANE_PREFIX.length) }
    : { directOnly: false, sessionId: paneId };
}

export function directPaneId(sessionId: string): string {
  return `${DIRECT_PANE_PREFIX}${sessionId}`;
}

export interface DirectAvailability {
  preferDirect: boolean;
  state: DirectState;
  connectionId: string | null;
  /** Ids of the sessions the computer listed. */
  sessionIds: readonly string[];
  /** The connection on which attaching this pane already failed: not worth another try on it. */
  failedConnectionId: string | null;
}

export function availabilityOf(
  snapshot: Pick<DirectSnapshot, "preferDirect" | "state" | "connection" | "sessions">,
  failedConnectionId: string | null,
): DirectAvailability {
  return {
    preferDirect: snapshot.preferDirect,
    state: snapshot.state,
    connectionId: snapshot.connection?.id ?? null,
    sessionIds: snapshot.sessions.map((session) => session.id),
    failedConnectionId,
  };
}

/**
 * Whether to take (or return to) the direct road. A `direct:` pane has no other road. Any other
 * pane goes direct only when the user prefers it, the computer is connected (or connecting) and
 * lists this pane as one of its sessions.
 */
export function shouldUseDirect(target: PaneTarget, availability: DirectAvailability): boolean {
  if (target.directOnly) return true;
  if (!availability.preferDirect) return false;
  if (availability.state !== "connected" && availability.state !== "connecting") return false;
  if (!availability.sessionIds.includes(target.sessionId)) return false;
  return (
    availability.connectionId === null ||
    availability.connectionId !== availability.failedConnectionId
  );
}

/**
 * Whether a pane on the bridge should go back to direct. Stricter than the first choice: the
 * computer must be connected, not merely connecting, or a failing connect would bounce the pane
 * between the two roads.
 */
export function shouldReturnToDirect(
  target: PaneTarget,
  availability: DirectAvailability,
): boolean {
  return availability.state === "connected" && shouldUseDirect(target, availability);
}

/** Where the direct road stands for one open pane. */
export type DirectPhase = "waiting" | "attached" | "lost" | "failed" | "exited";

/**
 * How long to wait in `phase` before giving up on direct for the bridge; null = never (a
 * `direct:` pane has no bridge to fall back to).
 */
export function fallbackDelay(phase: DirectPhase, directOnly: boolean): number | null {
  if (directOnly) return null;
  switch (phase) {
    case "waiting":
      return DIRECT_CONNECT_TIMEOUT_MS;
    case "lost":
      return DIRECT_LOST_TIMEOUT_MS;
    case "failed":
      return 0;
    default:
      return null;
  }
}

export type DirectPaneStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unreachable"
  | "exited";

/** The pane status the screen shows while on the direct road. */
export function directPaneStatus(phase: DirectPhase, state: DirectState): DirectPaneStatus {
  switch (phase) {
    case "exited":
      return "exited";
    case "attached":
      return "connected";
    case "failed":
      return "unreachable";
    case "waiting":
    case "lost":
      if (
        state === "needs-pairing" ||
        state === "incompatible" ||
        state === "unsupported" ||
        state === "unpaired"
      ) {
        return "unreachable";
      }
      return phase === "lost" || state === "offline" ? "reconnecting" : "connecting";
  }
}
