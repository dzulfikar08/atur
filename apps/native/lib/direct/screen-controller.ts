import { describeDirectError } from "@/lib/direct/describe";
import {
  globalTimers,
  retryDelay,
  type DirectLink,
  type DirectManager,
  type DirectTimers,
} from "@/lib/direct/manager";
import { DirectError, type DirectEvent, type ScreenStats } from "@/modules/atur-direct/src/types";

// One open desktop screen on the direct road. It opens the screen channel on the manager's live
// connection, follows the core's `screen` events into a small state machine, and opens it again
// whenever the manager reconnects (a new connection object), so the screen never remounts.
// Pure: React reads it through `subscribe` / `getState` (see use-direct-screen.ts), tests drive it
// with fakes.

export type DirectScreenPhase =
  /** Opening the channel, or the RFB handshake is running. */
  | "connecting"
  /** The picture is flowing. */
  | "ready"
  /** The link dropped or the viewer was closed under us; waiting for the manager or the next try. */
  | "reconnecting"
  /** The computer does not let this phone view its screen (`reason` is the server's text). */
  | "refused"
  /** The computer could not capture its screen (`reason` is the server's text). */
  | "unavailable"
  /** The computer has no screen feature: an older server. */
  | "unsupported"
  /** The computer closed the viewer and it did not come back (`reason` says why). */
  | "ended"
  /** Opening kept failing for another reason. */
  | "failed"
  /** Closed by the app. */
  | "closed";

export interface DirectScreenState {
  phase: DirectScreenPhase;
  /** Desktop size in pixels; 0 until the first `ready`. */
  width: number;
  height: number;
  /** The desktop's name (as the RFB server calls it). */
  name: string;
  /** Why the screen is not live: the server's words for `refused`, `unavailable` and `ended`. */
  reason: string;
  stats: ScreenStats | null;
  /** The newest text copied on the computer, "" when none (or once taken). */
  clipboard: string;
  /** Whether H.264 is what the app asks the computer for (false after a decoder failure). */
  h264: boolean;
  viewOnly: boolean;
  /** Failed opens since the last stable `ready`. */
  attempt: number;
}

export interface DirectScreenOptions {
  /** The device has a hardware H.264 decoder (`AturDirect.screenH264`). */
  h264: boolean;
  viewOnly: boolean;
  timers?: DirectTimers;
}

export interface DirectScreenHandle {
  subscribe(listener: () => void): () => void;
  getState(): DirectScreenState;
  setViewOnly(viewOnly: boolean): void;
  /** The native view could not decode: close and open again without H.264 (plain pictures). */
  decoderFailed(): void;
  /** Opens again after a refusal or a failure (or right now, when a retry is waiting). */
  retry(): void;
  /** Framebuffer pixels; `buttons` 1 left, 2 middle, 4 right. False when nothing was sent. */
  pointer(x: number, y: number, buttons: number): boolean;
  /** Wheel notches; positive `dy` scrolls up, positive `dx` right. */
  scroll(x: number, y: number, dx: number, dy: number): boolean;
  key(keysym: number, down: boolean): boolean;
  type(text: string): boolean;
  /** Puts text on the computer's clipboard. */
  clipboard(text: string): boolean;
  releaseAll(): boolean;
  /** Asks the computer for a full picture (the view attached again, the decoder lost sync). */
  refresh(): boolean;
  /** Takes the remote clipboard text out of the state (the user copied it). */
  clearClipboard(): void;
  close(): void;
}

/** Failed opens in a row (nothing stable in between) before giving up. */
export const SCREEN_MAX_ATTEMPTS = 4;
/** A screen that stays up this long has earned a fresh retry budget. */
export const SCREEN_STABLE_MS = 10_000;
/** What an unsupported computer is called in the UI. */
export const SCREEN_OLDER_SERVER = "older server";

const noop = () => {};

export function openDirectScreen(
  manager: Pick<DirectManager, "subscribe" | "getSnapshot">,
  options: DirectScreenOptions,
): DirectScreenHandle {
  const timers = options.timers ?? globalTimers;
  let state: DirectScreenState = {
    phase: "connecting",
    width: 0,
    height: 0,
    name: "",
    reason: "",
    stats: null,
    clipboard: "",
    h264: options.h264,
    viewOnly: options.viewOnly,
    attempt: 0,
  };
  const listeners = new Set<() => void>();
  let closed = false;
  let link: DirectLink | null = null;
  let unsubscribeEvents: (() => void) | null = null;
  /** Bumped by every open and every teardown: an older open's answer is dropped. */
  let ticket = 0;
  let retryTimer: unknown = null;
  let stableTimer: unknown = null;
  /** The screen has been live once: later opens are reconnects. */
  let everReady = false;

  const patch = (next: Partial<DirectScreenState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };

  const clearTimers = () => {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    if (stableTimer !== null) timers.clearTimeout(stableTimer);
    retryTimer = null;
    stableTimer = null;
  };

  const waitingPhase = (): DirectScreenPhase => (everReady ? "reconnecting" : "connecting");

  const finish = (phase: DirectScreenPhase, reason: string) => {
    clearTimers();
    patch({ phase, reason, stats: null });
  };

  const stale = (mine: number, target: DirectLink) => closed || mine !== ticket || target !== link;

  const retryLater = (reason: string, terminal: DirectScreenPhase) => {
    const attempt = state.attempt + 1;
    if (attempt > SCREEN_MAX_ATTEMPTS) {
      finish(terminal, reason);
      return;
    }
    patch({ phase: waitingPhase(), attempt, reason: "", stats: null });
    if (stableTimer !== null) timers.clearTimeout(stableTimer);
    stableTimer = null;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      open();
    }, retryDelay(attempt));
  };

  const open = () => {
    const target = link;
    if (!target || closed) return;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
    if (!target.screen) {
      finish("unsupported", SCREEN_OLDER_SERVER);
      return;
    }
    const mine = ++ticket;
    patch({ phase: waitingPhase(), reason: "" });
    // The `ready` event moves the phase; the answer only says the channel is open.
    target.screenOpen({ viewOnly: state.viewOnly, h264: state.h264 }).catch((error: unknown) => {
      if (stale(mine, target)) return;
      if (!(error instanceof DirectError)) {
        retryLater(describeDirectError(error), "failed");
        return;
      }
      const reason = error.reason || describeDirectError(error);
      switch (error.code) {
        case "ScreenNotAllowed":
          finish("refused", reason);
          break;
        case "ScreenUnavailable":
          finish("unavailable", reason);
          break;
        case "Unsupported":
          finish("unsupported", SCREEN_OLDER_SERVER);
          break;
        case "Disconnected":
          // The manager reports the drop (its snapshot loses the connection); wait for it.
          patch({ phase: waitingPhase(), stats: null });
          break;
        default:
          retryLater(reason, "failed");
      }
    });
  };

  const onEvent = (from: DirectLink, event: DirectEvent) => {
    if (closed || from !== link) return;
    switch (event.t) {
      case "screen":
        if (event.state === "ready") {
          everReady = true;
          if (stableTimer !== null) timers.clearTimeout(stableTimer);
          stableTimer = timers.setTimeout(() => {
            stableTimer = null;
            if (state.attempt !== 0) patch({ attempt: 0 });
          }, SCREEN_STABLE_MS);
          patch({
            phase: "ready",
            width: event.width,
            height: event.height,
            name: event.name,
            reason: "",
          });
        } else if (event.state === "connecting") {
          if (state.phase !== "ready") patch({ phase: waitingPhase() });
        } else if (event.reason) {
          // The computer closed the viewer (no reason = we closed it, nothing to report).
          retryLater(event.reason, "ended");
        }
        break;
      case "screenStats":
        patch({
          stats: {
            codec: event.codec,
            fps: event.fps,
            kbps: event.kbps,
            dropped: event.dropped,
            decodeMs: event.decodeMs,
          },
        });
        break;
      case "screenClipboard":
        patch({ clipboard: event.text });
        break;
    }
  };

  const detach = () => {
    ticket++;
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    link = null;
  };

  const attach = (next: DirectLink) => {
    link = next;
    // Before opening: the first `screen` events can beat the answer.
    unsubscribeEvents = next.subscribe((event) => onEvent(next, event));
    clearTimers();
    patch({ attempt: 0 });
    open();
  };

  const sync = () => {
    if (closed) return;
    const next = manager.getSnapshot().connection;
    if (next === link) return;
    const hadLink = link !== null;
    detach();
    clearTimers();
    if (next) attach(next);
    else if (hadLink && (state.phase === "connecting" || state.phase === "ready")) {
      patch({ phase: "reconnecting", stats: null });
    } else if (hadLink && state.phase === "reconnecting") patch({ stats: null });
  };

  const unsubscribeManager = manager.subscribe(sync);
  sync();

  const input = (send: (target: DirectLink) => boolean): boolean => {
    if (closed || state.viewOnly || !link) return false;
    return send(link);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    setViewOnly(viewOnly) {
      if (closed || state.viewOnly === viewOnly) return;
      patch({ viewOnly });
      link?.screenViewOnly(viewOnly);
      if (viewOnly) link?.screenReleaseAll();
    },
    decoderFailed() {
      const target = link;
      if (closed || !state.h264) return;
      patch({ h264: false, stats: null });
      if (!target) return;
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = null;
      const mine = ++ticket;
      target
        .screenClose()
        .catch(noop)
        .then(() => {
          if (!stale(mine, target)) open();
        });
    },
    retry() {
      if (closed) return;
      clearTimers();
      patch({ attempt: 0 });
      if (link) open();
      else patch({ phase: waitingPhase(), reason: "" });
    },
    pointer: (x, y, buttons) => input((target) => target.screenPointer(x, y, buttons)),
    scroll: (x, y, dx, dy) => input((target) => target.screenScroll(x, y, dx, dy)),
    key: (keysym, down) => input((target) => target.screenKey(keysym, down)),
    type: (text) => input((target) => target.screenType(text)),
    clipboard: (text) => input((target) => target.screenClipboard(text)),
    releaseAll: () => (closed || !link ? false : link.screenReleaseAll()),
    refresh: () => (closed || !link ? false : link.screenRefresh()),
    clearClipboard() {
      if (!closed && state.clipboard !== "") patch({ clipboard: "" });
    },
    close() {
      if (closed) return;
      unsubscribeManager();
      const target = link;
      detach();
      clearTimers();
      closed = true;
      if (target && !target.isClosed) {
        target.screenReleaseAll();
        void target.screenClose().catch(noop);
      }
      patch({ phase: "closed", stats: null });
    },
  };
}
