import type { DirectFailure, DirectState, RerouteOutcome } from "@/lib/direct/manager";
import {
  DirectError,
  type DirectErrorCode,
  type DirectRoute,
  type DirectTransport,
  type RouteKind,
} from "@/modules/atur-direct/src/types";

// Words for the direct connection's states and failures, for the settings screen and the
// profile row. Never includes the pairing link or the credential: a core `reason` is shown only
// for the codes where it is all there is to say.

const ERROR_TEXT: Record<DirectErrorCode, string> = {
  InvalidLink: "This is not an Atur pairing code. Run atur-term mobile pair on your computer.",
  InvalidCredential: "The saved pairing is damaged. Pair this computer again.",
  Unreachable:
    "Can't reach the computer. Check that it is on, and that this phone is on the same network or Tailscale.",
  IdentityMismatch: "This is not the computer you paired with. Pair again to trust it.",
  Unauthorized: "The computer no longer accepts this phone. Pair again.",
  IncompatibleVersion: "Atur and Atur Terminal need an update before they can talk directly.",
  Unsupported: "Direct connection is not available in this build of Atur.",
  Timeout: "The computer did not answer in time.",
  Disconnected: "The connection to the computer dropped.",
  Server: "The computer reported a problem.",
  ScreenNotAllowed: "The computer does not let this phone view its screen.",
  ScreenUnavailable: "The computer could not share its screen.",
  Internal: "Something went wrong inside Atur.",
};

const REASON_SHOWN: Record<string, true> = { Server: true, Internal: true };

/** One sentence for a failure the manager kept (`snapshot.error`). */
export function describeFailure(failure: DirectFailure): string {
  const text = ERROR_TEXT[failure.code];
  return REASON_SHOWN[failure.code] && failure.reason ? `${text} ${failure.reason}` : text;
}

export function describeDirectError(error: unknown): string {
  if (error instanceof DirectError) return describeFailure(error);
  return error instanceof Error ? error.message : "Something went wrong.";
}

export const DIRECT_STATE_LABEL: Record<DirectState, string> = {
  unsupported: "Not in this build",
  unpaired: "Not paired",
  idle: "Paused",
  connecting: "Connecting…",
  connected: "Connected",
  offline: "Offline, retrying",
  "needs-pairing": "Pair again",
  incompatible: "Needs an update",
};

/** "Direct UDP · 38 ms": the pane header's badge for a direct pane. */
export function directBadgeLabel(
  transport: DirectTransport | null | undefined,
  rttMs: number | null,
): string {
  const base = transport ? `Direct ${transport.toUpperCase()}` : "Direct";
  return rttMs === null ? base : `${base} · ${rttMs} ms`;
}

/** The settings line for the transport in use: "UDP", or "TLS (older server)" after a fallback. */
export function describeTransport(transport: DirectTransport, udpNote: string): string {
  const name = transport.toUpperCase();
  return transport === "tls" && udpNote ? `${name} (${udpNote})` : name;
}

const ROUTE_LABEL: Record<RouteKind, string> = {
  local: "Local",
  tailscale: "Tailscale",
  other: "Other",
};

/**
 * "Local · 3 ms", "Tailscale · 120 ms": which way the connection goes and how long a round trip
 * takes. `liveMs` (the latest ping) replaces the time the connection took to set up once there is
 * one. Null for a core that reports no route.
 */
export function describeRoute(
  route: DirectRoute | null | undefined,
  liveMs: number | null,
): string | null {
  if (!route) return null;
  const ms = liveMs ?? route.ms;
  return `${ROUTE_LABEL[route.kind]} · ${ms < 1 ? "<1" : Math.round(ms)} ms`;
}

/** The known addresses, one per line, with the one in use marked; hosts only, nothing secret. */
export function describeAddresses(hosts: readonly string[], inUse: string | null): string {
  return hosts.map((host) => (host === inUse ? `${host} (in use)` : host)).join("\n");
}

/** What the "Re-check route" button tells after it ran. */
export function describeReroute(outcome: RerouteOutcome, route: DirectRoute | null): string {
  switch (outcome) {
    case "swapped":
      return route ? `Switched to a faster route (${ROUTE_LABEL[route.kind]}).` : "Switched route.";
    case "kept":
      return "Already on the best route this phone can find.";
    case "failed":
      return "Could not open a second connection to compare. Staying on this one.";
    case "skipped":
      return "Not connected.";
  }
}
