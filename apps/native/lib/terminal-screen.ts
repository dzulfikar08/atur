// Visible-screen state for a pane, built from the bridge's `hello` / `snapshot`
// / `diff` frames. The live stream carries only the visible grid: a snapshot is
// the whole grid (rows joined by "\r\n"), a diff replaces individual rows by
// index. Scrollback arrives separately, on request (`history`), as a static
// block shown above the live grid. One instance per open pane, shared by the
// native renderer and the classic WebView renderer (which replays the same frames).

export interface ScreenState {
  cols: number;
  rows: number;
  /** One raw ANSI string per row; replaced (never mutated) on every change. */
  lines: readonly string[];
  /** Scrollback rows above the visible grid, oldest first; empty until requested. */
  history: readonly string[];
  /**
   * Absolute number of history[0]: a row keeps `historyBase + index` as its
   * identity while rows are appended below it or trimmed above it, so lists
   * key on it and the rows being read never shift.
   */
  historyBase: number;
}

/** How a scrollback request is meant: see `TerminalScreen.loadHistory`. */
export type HistoryMode = "top-up" | "full" | "replace";

/** Rows matched to place a fresh read after what is already loaded. */
const OVERLAP_ROWS = 24;
/** Scrollback kept on the phone; past this the oldest rows go. */
const MAX_HISTORY_ROWS = 5000;
/** A top-up read: far more than a refresh interval of output, with room to overlap. */
export const HISTORY_TOP_UP_LINES = 400;
/** A full read: on connect, after a reflow, or when a top-up no longer overlaps. */
export const HISTORY_FULL_LINES = 3000;
/** At most one top-up per this long; a trailing one catches the last change. */
const TOP_UP_INTERVAL_MS = 1500;
/** A reply this late is presumed lost (the socket dropped): ask again. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * The rows of `incoming` that come after the end of `loaded`, found by
 * matching `loaded`'s last rows inside `incoming` (latest match wins). Null
 * when they do not overlap: the scrollback moved on further than `incoming`
 * reaches, or was rewritten (cleared, reflowed).
 */
export function rowsAfter(
  loaded: readonly string[],
  incoming: readonly string[],
): readonly string[] | null {
  const m = Math.min(loaded.length, OVERLAP_ROWS);
  if (m === 0) return null;
  const tail = loaded.slice(loaded.length - m);
  for (let p = incoming.length - m; p >= 0; p--) {
    let hit = true;
    for (let j = 0; j < m; j++) {
      if (incoming[p + j] !== tail[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return incoming.slice(p + m);
  }
  return null;
}

/** The frames a renderer must be able to replay, in the WebView page's vocabulary. */
export type ScreenFrame =
  | { t: "hello"; cols: number; rows: number }
  | { t: "snapshot"; ansi: string }
  | { t: "diff"; rows: [number, string][] };

/** Sanity bound on a diff row index: a corrupt frame must not allocate unbounded rows. */
const MAX_ROWS = 1000;

export class TerminalScreen {
  private state: ScreenState = { cols: 80, rows: 24, lines: [], history: [], historyBase: 0 };
  private readonly stateListeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: ScreenFrame) => void>();
  private helloSeen = false;

  // Scrollback requests: one in flight at a time; what else was asked for meanwhile waits.
  private historySource: ((lines: number) => void) | null = null;
  private inFlight: { lines: number; mode: HistoryMode; at: number } | null = null;
  private queued: HistoryMode | null = null;
  private historyLoaded = false;
  private lastTopUp = 0;
  private topUpTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stable between changes: safe as a `useSyncExternalStore` snapshot. */
  getState = (): ScreenState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /**
   * Receive every future frame. The returned unsubscribe is paired with
   * `replay()` by a renderer that mounts mid-stream.
   */
  subscribeFrames(listener: (frame: ScreenFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Frames that rebuild the current screen from nothing (hello + snapshot). */
  replay(): ScreenFrame[] {
    if (!this.helloSeen && this.state.lines.length === 0) return [];
    const frames: ScreenFrame[] = [{ t: "hello", cols: this.state.cols, rows: this.state.rows }];
    if (this.state.lines.length > 0)
      frames.push({ t: "snapshot", ansi: this.state.lines.join("\r\n") });
    return frames;
  }

  hello(cols: number, rows: number): void {
    this.helloSeen = true;
    this.set({ ...this.state, cols, rows });
    this.emit({ t: "hello", cols, rows });
  }

  snapshot(ansi: string): void {
    const lines = ansi.split("\r\n");
    this.set({ ...this.state, rows: Math.max(this.state.rows, lines.length), lines });
    this.emit({ t: "snapshot", ansi });
  }

  diff(rows: [number, string][]): void {
    const lines = [...this.state.lines];
    let changed = false;
    for (const [index, line] of rows) {
      if (!Number.isInteger(index) || index < 0 || index >= MAX_ROWS) continue;
      while (lines.length <= index) lines.push("");
      if (lines[index] !== line) {
        lines[index] = line;
        changed = true;
      }
    }
    if (!changed) return;
    this.set({ ...this.state, lines });
    this.emit({ t: "diff", rows });
  }

  /**
   * Where scrollback requests go (the bridge socket), or null to stop. Also
   * forgets a request in flight: after a reconnect its reply is never coming.
   */
  setHistorySource(fetch: ((lines: number) => void) | null): void {
    this.historySource = fetch;
    this.inFlight = null;
    clearTimeout(this.topUpTimer ?? undefined);
    this.topUpTimer = null;
  }

  /**
   * Ask for scrollback. `top-up` (scrolling back, output while reading) reads
   * a short window and appends only the rows that are new, throttled with a
   * trailing call; `full` reads the whole window and still appends when it
   * overlaps (a reconnect must not move the rows being read); `replace`
   * discards what is loaded (the pane reflowed to a new width).
   */
  loadHistory(mode: HistoryMode = "top-up"): void {
    if (!this.historySource) return;
    const now = Date.now();
    if (this.inFlight && now - this.inFlight.at < REQUEST_TIMEOUT_MS) {
      this.queued = strongest(this.queued, mode);
      return;
    }
    const effective = this.historyLoaded ? strongest(this.queued, mode) : strongest(mode, "full");
    this.queued = null;
    if (effective === "top-up") {
      const wait = TOP_UP_INTERVAL_MS - (now - this.lastTopUp);
      if (wait > 0) {
        this.topUpTimer ??= setTimeout(() => {
          this.topUpTimer = null;
          this.loadHistory("top-up");
        }, wait);
        return;
      }
      this.lastTopUp = now;
    }
    const lines = effective === "top-up" ? HISTORY_TOP_UP_LINES : HISTORY_FULL_LINES;
    this.inFlight = { lines, mode: effective, at: now };
    this.historySource(lines);
  }

  /**
   * Bridge `history` reply: the pane's last rows, ending with the visible
   * grid. `visible` is how many trailing rows that grid is (herdr trims its
   * trailing blank rows, so the grid height would cut real scrollback); older
   * bridges omit it and the live row count stands in.
   */
  setHistory(rows: readonly string[], visible?: number): void {
    const request = this.inFlight ?? { lines: HISTORY_FULL_LINES, mode: "full" as const, at: 0 };
    this.inFlight = null;
    const cut = Math.min(rows.length, Math.max(0, visible ?? this.state.lines.length));
    const scrollback = rows.slice(0, rows.length - cut);
    // Fewer rows than asked for: this is all the scrollback the pane has.
    const complete = request.mode !== "top-up" || rows.length < request.lines;
    const added =
      request.mode === "replace" || !this.historyLoaded
        ? null
        : rowsAfter(this.state.history, scrollback);

    if (added) {
      if (added.length > 0) this.append(added);
    } else if (complete) {
      const { history, historyBase } = this.state;
      // Fresh identities: these rows are not the ones on screen before.
      this.set({
        ...this.state,
        history: scrollback,
        historyBase: historyBase + history.length + 1,
      });
      this.historyLoaded = true;
    } else {
      // A top-up that no longer reaches what is loaded: read the whole window.
      this.queued = strongest(this.queued, "full");
    }
    if (this.queued) this.loadHistory(this.queued);
  }

  private append(rows: readonly string[]): void {
    let history = [...this.state.history, ...rows];
    let historyBase = this.state.historyBase;
    const over = history.length - MAX_HISTORY_ROWS;
    if (over > 0) {
      history = history.slice(over);
      historyBase += over;
    }
    this.set({ ...this.state, history, historyBase });
  }

  private set(next: ScreenState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener();
  }

  private emit(frame: ScreenFrame): void {
    for (const listener of this.frameListeners) listener(frame);
  }
}

const RANK: Record<HistoryMode, number> = { "top-up": 0, full: 1, replace: 2 };

function strongest(a: HistoryMode | null, b: HistoryMode): HistoryMode {
  return a && RANK[a] > RANK[b] ? a : b;
}
