import type { DirectScreenPhase, DirectScreenState } from "@/lib/direct/screen-controller";
import type { ScreenStats } from "@/modules/atur-direct/src/types";

// Words for the direct screen's states, for the overlay and the connection bar.

export interface ScreenNotice {
  title: string;
  /** The server's own words for a refusal; plain advice otherwise. */
  body: string;
  /** Opening again may work (a refusal can be lifted on the computer, a capture can come back). */
  canRetry: boolean;
  /** Whether Atur Cloud's screen is worth offering instead. */
  offerCloud: boolean;
}

/** What to show over the picture while the screen is not live; null when it is (or was closed). */
export function describeScreenState(
  state: Pick<DirectScreenState, "phase" | "reason" | "attempt">,
): ScreenNotice | null {
  switch (state.phase) {
    case "connecting":
      return { title: "Opening the screen…", body: "", canRetry: false, offerCloud: false };
    case "reconnecting":
      return {
        title: "Reconnecting…",
        body: state.attempt > 0 ? `Attempt ${state.attempt}` : "",
        canRetry: false,
        offerCloud: false,
      };
    case "refused":
      return {
        title: "Screen sharing is off for this phone",
        body: state.reason,
        canRetry: true,
        offerCloud: true,
      };
    case "unavailable":
      return {
        title: "The computer can't share its screen",
        body: state.reason,
        canRetry: true,
        offerCloud: true,
      };
    case "unsupported":
      return {
        title: "Needs a newer Atur Terminal",
        body: "This computer runs an older server that has no screen sharing. Update Atur Terminal on it.",
        canRetry: false,
        offerCloud: true,
      };
    case "ended":
      return {
        title: "The computer ended the screen",
        body: state.reason,
        canRetry: true,
        offerCloud: true,
      };
    case "failed":
      return {
        title: "Couldn't open the screen",
        body: state.reason,
        canRetry: true,
        offerCloud: true,
      };
    case "ready":
    case "closed":
      return null;
  }
}

/** The short label of the connection bar for a phase. */
export const SCREEN_PHASE_LABEL: Record<DirectScreenPhase, string> = {
  connecting: "Connecting",
  ready: "Live",
  reconnecting: "Reconnecting",
  refused: "Not allowed",
  unavailable: "Unavailable",
  unsupported: "Not supported",
  ended: "Ended",
  failed: "Failed",
  closed: "Closed",
};

const CODEC_NAME: Record<string, string> = { h264: "H.264", zrle: "ZRLE", raw: "Raw" };

/** "H.264 · 30 fps · 1.2 Mbit/s": the codec and what is arriving. */
export function describeScreenStats(stats: ScreenStats): string {
  // The core names the decoder after the codec: "h264 (mediacodec)".
  const [name = "", ...decoder] = stats.codec.trim().split(/\s+/);
  const base = CODEC_NAME[name.toLowerCase()] ?? name.toUpperCase();
  const codec = decoder.length > 0 ? `${base} ${decoder.join(" ")}` : base;
  const rate =
    stats.kbps >= 1000
      ? `${(stats.kbps / 1000).toFixed(1)} Mbit/s`
      : `${Math.round(stats.kbps)} kbit/s`;
  return `${codec} · ${Math.round(stats.fps)} fps · ${rate}`;
}
