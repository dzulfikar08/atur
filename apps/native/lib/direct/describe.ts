import type { DirectFailure, DirectState } from "@/lib/direct/manager";
import { DirectError, type DirectErrorCode } from "@/modules/atur-direct/src/types";

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
