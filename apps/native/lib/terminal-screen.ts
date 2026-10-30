// Visible-screen state for a pane, built from the bridge's `hello` / `snapshot`
// / `diff` frames. The live stream carries only the visible grid: a snapshot is
// the whole grid (rows joined by "\r\n"), a diff replaces individual rows by
// index. Scrollback arrives separately, on request (`history`), as a static
// block shown above the live grid. One instance per open pane, shared by the
// native renderer and the classic WebView renderer (which replays the same frames).

import { scrollCount, scrollTrace } from "./scroll-trace";

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
  /**
   * Absolute rows (the numbering of `historyBase`) where a user prompt starts, ascending: the
   * scrollback and the visible grid as of the last read. Empty when the computer reports none.
   */
  prompts: readonly number[];
  /** `history` replies taken so far: one that changes nothing else still moves this. */
  historyReplies: number;
  /**
   * The scrollback may hold rows the phone has not read: nothing was read yet, or output has come
   * since the last read.
   */
  behind: boolean;
}

/** How a scrollback request is meant: see `TerminalScreen.loadHistory`. */
export type HistoryMode = "top-up" | "older" | "full" | "replace";

/** Rows matched to place a fresh read after (or before) what is already loaded. */
const OVERLAP_ROWS = 24;
/**
 * Most rows a read can return, scrollback and visible grid together: the computer's own cap on one
 * `history` request, and what the phone keeps; past this the oldest rows go.
 */
export const HISTORY_MAX_LINES = 20_000;
/** A top-up read: far more than a refresh interval of output, with room to overlap. */
export const HISTORY_TOP_UP_LINES = 400;
/**
 * A full read: on connect, after a reflow, or when a top-up no longer overlaps. Small on purpose:
 * on a phone link every page of it is a round trip, and the first screenful of scrollback must
 * not wait for thousands of rows; `loadOlder` reads further back as the reader gets there.
 */
export const HISTORY_FULL_LINES = 1000;
/** The least a read for older rows adds beyond what is loaded (it doubles past that). */
export const HISTORY_OLDER_STEP = 3000;
/** At most one top-up per this long; a trailing one catches the last change. */
const TOP_UP_INTERVAL_MS = 1500;
/** A scrollback read that failed or never answered is asked again after this, doubling up to the cap. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 8000;
/** Less scrollback than this (and than a screenful) leaves the reader hardly anything to scroll. */
const THIN_ROWS = 40;
/** After a read at the bottom that added no scrollback, output asks again no sooner than this. */
const QUIET_MS = 5000;
/** A reply this late is presumed lost (the socket dropped): ask again. */
const REQUEST_TIMEOUT_MS = 8000;
/** Each row of a big read is a page share on the computer: a long read is allowed longer. */
const REQUEST_TIMEOUT_PER_LINE_MS = 4;

/**
 * The rows of `incoming` that come after the end of `loaded`, found by
 * matching `loaded`'s last rows inside `incoming` (latest match wins). Null
 * when they do not overlap: the scrollback moved on further than `incoming`
 * reaches, or was rewritten (cleared, reflowed). With `fromStart` (`incoming`
 * is the pane's whole scrollback and `loaded` is shorter than the rows matched,
 * so blank or repeated rows could match anywhere) the earliest match wins.
 */
export function rowsAfter(
  loaded: readonly string[],
  incoming: readonly string[],
  fromStart = false,
): readonly string[] | null {
  const m = Math.min(loaded.length, OVERLAP_ROWS);
  if (m === 0) return null;
  const tail = loaded.slice(loaded.length - m);
  const hitAt = (p: number): boolean => {
    for (let j = 0; j < m; j++) if (incoming[p + j] !== tail[j]) return false;
    return true;
  };
  if (fromStart) {
    for (let p = 0; p + m <= incoming.length; p++) if (hitAt(p)) return incoming.slice(p + m);
    return null;
  }
  for (let p = incoming.length - m; p >= 0; p--) if (hitAt(p)) return incoming.slice(p + m);
  return null;
}

/**
 * Where `loaded` sits inside `incoming`, a read of a longer window that ends later: the index in
 * `incoming` of `loaded[0]`, found by matching the first and the last rows of `loaded` (scrollback
 * rows do not change once written, so rows between are not compared). Null when `loaded` is not
 * inside `incoming`: the scrollback was rewritten (cleared, reflowed) or `incoming` does not reach
 * back to it.
 */
export function rowsBefore(loaded: readonly string[], incoming: readonly string[]): number | null {
  const n = loaded.length;
  if (n === 0) return null;
  const m = Math.min(n, OVERLAP_ROWS);
  for (let p = incoming.length - n; p >= 0; p--) {
    let hit = true;
    for (let j = 0; j < m && hit; j++) {
      hit = incoming[p + j] === loaded[j] && incoming[p + n - m + j] === loaded[n - m + j];
    }
    if (hit) return p;
  }
  return null;
}

/** One past the last absolute row: the scrollback and the visible grid together. */
function endRow(state: Pick<ScreenState, "history" | "historyBase" | "lines">): number {
  return state.historyBase + state.history.length + state.lines.length;
}

/** The newest prompt that starts above `fromRow` (an absolute row), or null. */
export function previousPrompt(
  state: Pick<ScreenState, "history" | "historyBase" | "lines" | "prompts">,
  fromRow: number,
): number | null {
  const { prompts } = state;
  const end = endRow(state);
  let low = 0;
  let high = prompts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prompts[mid]! < fromRow) low = mid + 1;
    else high = mid;
  }
  for (let i = low - 1; i >= 0; i--) {
    const row = prompts[i]!;
    if (row < end && row >= state.historyBase) return row;
  }
  return null;
}

/** The oldest prompt that starts below `fromRow` (an absolute row), or null. */
export function nextPrompt(
  state: Pick<ScreenState, "history" | "historyBase" | "lines" | "prompts">,
  fromRow: number,
): number | null {
  const { prompts } = state;
  const end = endRow(state);
  let low = 0;
  let high = prompts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prompts[mid]! <= fromRow) low = mid + 1;
    else high = mid;
  }
  for (let i = low; i < prompts.length; i++) {
    const row = prompts[i]!;
    if (row >= state.historyBase && row < end) return row;
  }
  return null;
}

/**
 * The prompt rows of a `history` reply as absolute rows: `rows` holds `count` rows and its first is
 * absolute row `first`. Anything that is not an ascending index inside the reply is dropped (an
 * older computer sends none).
 */
function promptRows(
  prompts: readonly number[] | undefined,
  count: number,
  first: number,
): number[] {
  const found: number[] = [];
  let last = -1;
  for (const row of prompts ?? []) {
    if (!Number.isInteger(row) || row <= last || row >= count) continue;
    found.push(first + row);
    last = row;
  }
  return found;
}

/** The frames a renderer must be able to replay, in the WebView page's vocabulary. */
export type ScreenFrame =
  | { t: "hello"; cols: number; rows: number }
  | { t: "snapshot"; ansi: string }
  | { t: "diff"; rows: [number, string][] };

/** Sanity bound on a diff row index: a corrupt frame must not allocate unbounded rows. */
const MAX_ROWS = 1000;

export class TerminalScreen {
  private state: ScreenState = {
    cols: 80,
    rows: 24,
    lines: [],
    history: [],
    historyBase: 0,
    prompts: [],
    historyReplies: 0,
    behind: true,
  };
  private readonly stateListeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: ScreenFrame) => void>();
  private helloSeen = false;

  // Scrollback requests: one in flight at a time; what else was asked for meanwhile waits.
  private historySource: ((lines: number) => void) | null = null;
  private inFlight: { lines: number; mode: HistoryMode; at: number } | null = null;
  private queued: HistoryMode | null = null;
  private historyLoaded = false;
  /** The loaded scrollback begins at the pane's first row: there is nothing older to read. */
  private reachedStart = false;
  private lastTopUp = 0;
  private topUpTimer: ReturnType<typeof setTimeout> | null = null;
  /** Asks again after a failed or lost read (`retryLater`), and gives up on a lost one (`watchdog`). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  /** No top-up for the bottom of the pane before this time (`keepScrollable`). */
  private quietUntil = 0;

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
    this.set({
      ...this.state,
      rows: Math.max(this.state.rows, lines.length),
      lines,
      behind: true,
    });
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
    scrollCount("diff_frame");
    this.set({ ...this.state, lines, behind: true });
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
    clearTimeout(this.watchdog ?? undefined);
    this.watchdog = null;
    clearTimeout(this.retryTimer ?? undefined);
    this.retryTimer = null;
  }

  /**
   * Ask for scrollback. `top-up` (scrolling back, output while reading) reads
   * a short window and appends only the rows that are new, throttled with a
   * trailing call; `older` reads a window longer than what is loaded and puts
   * the rows before it above (see `loadOlder`); `full` reads the first window
   * (or one reaching back past what is loaded) and still appends when it
   * overlaps (a reconnect must not move the rows being read); `replace`
   * discards what is loaded (the pane reflowed to a new width).
   */
  loadHistory(mode: HistoryMode = "top-up"): void {
    if (!this.historySource) return;
    const now = Date.now();
    if (this.inFlight && now - this.inFlight.at < requestTimeout(this.inFlight.lines)) {
      this.queued = strongest(this.queued, mode);
      return;
    }
    let effective = this.historyLoaded ? strongest(this.queued, mode) : strongest(mode, "full");
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
      // Rows are appended to rows that are loaded: with none, a top-up would only be followed by
      // a full read.
      if (this.historyLoaded && this.state.history.length === 0) effective = "full";
    }
    const lines = this.windowFor(effective);
    scrollTrace("history_ask", { mode: effective, lines });
    const request = { lines, mode: effective, at: now };
    this.inFlight = request;
    // The reply may never come (the link dropped it without an error): ask again then.
    clearTimeout(this.watchdog ?? undefined);
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.inFlight !== request) return;
      this.inFlight = null;
      this.retryLater();
    }, requestTimeout(lines));
    this.historySource(lines);
  }

  /**
   * The reader is near the oldest loaded row: read further back. Each read is a longer window
   * than the last (the computer answers with its newest `lines` rows, pages of them), so it
   * grows past what is loaded by a step that doubles, up to `HISTORY_MAX_LINES`; the rows before
   * the loaded ones are put above them without moving anything on screen. Cheap to call on every
   * scroll event: nothing is asked once the pane's first row is loaded or the cap reached.
   */
  loadOlder(): void {
    if (!this.historyLoaded) {
      this.loadHistory("full");
      return;
    }
    if (!this.hasOlder()) return;
    this.loadHistory("older");
  }

  /** Scrollback is loaded and a read for older rows would bring some. */
  hasOlder(): boolean {
    if (!this.historyLoaded || this.reachedStart) return false;
    const { history, lines } = this.state;
    return this.olderWindow() > history.length + lines.length;
  }

  /**
   * No scrollback read is out or queued. A read that follows another one re-bases the loaded rows,
   * so a jump computed before it lands would aim at rows that move.
   */
  isIdle(): boolean {
    return this.inFlight === null && this.queued === null;
  }

  /**
   * A read failed (not a slow one: it is never coming): free the slot, and ask again a little
   * later while nothing is loaded.
   */
  historyFailed(): void {
    this.inFlight = null;
    clearTimeout(this.watchdog ?? undefined);
    this.watchdog = null;
    this.retryLater();
  }

  /** Scrollback has been read at least once since the pane was opened (or last reflowed). */
  isLoaded(): boolean {
    return this.historyLoaded;
  }

  /** Under a screenful of scrollback is loaded: the reader has little to scroll through. */
  isThin(): boolean {
    const { history, lines } = this.state;
    return history.length < Math.max(lines.length, THIN_ROWS);
  }

  /**
   * The reader is at the bottom, where scrollback is left alone (nobody sees it) unless there is
   * hardly any: a pane opened before its output began, or whose first read failed, is one screen
   * of rows that nothing can scroll, and a view with nothing to scroll never sends the scroll
   * event that asks for more. So while less than a screenful is loaded, output tops it up (throttled
   * like any top-up), and goes quiet for a while after a read that found nothing to add.
   */
  keepScrollable(): void {
    if (!this.historySource || !this.isIdle() || this.retryTimer) return;
    if (!this.historyLoaded) {
      this.loadHistory("full");
      return;
    }
    if (this.isThin() && Date.now() >= this.quietUntil) this.loadHistory("top-up");
  }

  /**
   * A read that failed or never answered, while nothing is loaded (or another one waits): asked
   * again, a little later each time. Scrollback must not wait for a scroll event: a pane with
   * nothing to scroll never sends one.
   */
  private retryLater(): void {
    if (!this.historySource || this.retryTimer) return;
    if (this.historyLoaded && !this.queued) return;
    const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** this.failures);
    this.failures += 1;
    scrollTrace("history_retry", { in: wait, failures: this.failures });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.loadHistory(this.queued ?? "full");
    }, wait);
  }

  private olderWindow(): number {
    const { history, lines } = this.state;
    const loaded = history.length + lines.length;
    return Math.min(HISTORY_MAX_LINES, loaded + Math.max(HISTORY_OLDER_STEP, history.length));
  }

  private windowFor(mode: HistoryMode): number {
    const { history, lines } = this.state;
    switch (mode) {
      case "top-up":
        return HISTORY_TOP_UP_LINES;
      case "older":
        return this.olderWindow();
      case "full":
        // Once something is loaded the window must reach back over it, or it cannot be appended.
        return this.historyLoaded
          ? Math.min(
              HISTORY_MAX_LINES,
              Math.max(HISTORY_FULL_LINES, history.length + lines.length + HISTORY_TOP_UP_LINES),
            )
          : HISTORY_FULL_LINES;
      case "replace":
        return HISTORY_FULL_LINES;
    }
  }

  /**
   * Bridge `history` reply: the pane's last rows, ending with the visible
   * grid. `visible` is how many trailing rows that grid is (herdr trims its
   * trailing blank rows, so the grid height would cut real scrollback); older
   * bridges omit it and the live row count stands in. `prompts` are the indices in `rows` where a
   * user prompt starts (absent from older computers).
   */
  setHistory(rows: readonly string[], visible?: number, prompts?: readonly number[]): void {
    const request = this.inFlight ?? { lines: HISTORY_FULL_LINES, mode: "full" as const, at: 0 };
    scrollTrace("history_reply", {
      mode: request.mode,
      asked: request.lines,
      rows: rows.length,
      took: request.at ? Date.now() - request.at : -1,
    });
    this.inFlight = null;
    this.failures = 0;
    clearTimeout(this.watchdog ?? undefined);
    this.watchdog = null;
    clearTimeout(this.retryTimer ?? undefined);
    this.retryTimer = null;
    const before = this.state.history.length;
    const historyReplies = this.state.historyReplies + 1;
    const cut = Math.min(rows.length, Math.max(0, visible ?? this.state.lines.length));
    const scrollback = rows.slice(0, rows.length - cut);
    // Fewer rows than asked for: this is all the scrollback the pane has.
    if (rows.length < request.lines) this.reachedStart = true;
    else if (request.mode !== "top-up") this.reachedStart = false;
    const complete = request.mode !== "top-up" || rows.length < request.lines;
    const loaded = this.historyLoaded && request.mode !== "replace";
    // A longer window that ends later than the loaded rows: it holds them, with older ones before.
    const reach =
      loaded && request.mode === "older" ? rowsBefore(this.state.history, scrollback) : null;
    const added =
      loaded && request.mode !== "older"
        ? rowsAfter(
            this.state.history,
            scrollback,
            this.state.history.length < OVERLAP_ROWS && rows.length < request.lines,
          )
        : null;

    if (reach !== null) {
      // Same rows keep the same identity: the base moves down by what was put before them. The
      // window holds everything loaded, so its prompts replace the ones kept.
      const historyBase = this.state.historyBase - reach;
      this.set({
        ...this.state,
        history: scrollback,
        historyBase,
        prompts: promptRows(prompts, rows.length, historyBase),
        historyReplies,
        behind: false,
      });
    } else if (added) {
      // The window's first row sits where the loaded rows' end, less what overlaps, puts it.
      const { history, historyBase } = this.state;
      const first = historyBase + history.length - (scrollback.length - added.length);
      this.append(added, promptRows(prompts, rows.length, first), first, historyReplies);
    } else if (complete) {
      const { history, historyBase } = this.state;
      // Fresh identities: these rows are not the ones on screen before.
      const fresh = historyBase + history.length + 1;
      // Before the state changes: a listener asks whether scrollback is loaded.
      this.historyLoaded = true;
      this.set({
        ...this.state,
        history: scrollback,
        historyBase: fresh,
        prompts: promptRows(prompts, rows.length, fresh),
        historyReplies,
        behind: false,
      });
    } else {
      // A top-up that no longer reaches what is loaded: read the whole window.
      this.queued = strongest(this.queued, "full");
      this.set({ ...this.state, historyReplies });
      this.loadHistory(this.queued);
      return;
    }
    // A read that left the scrollback no longer than it was found brought nothing: output does not
    // ask again at the bottom for a while.
    this.quietUntil = this.state.history.length > before ? 0 : Date.now() + QUIET_MS;
    if (this.queued) this.loadHistory(this.queued);
  }

  /**
   * Put `rows` after the loaded scrollback. `fresh` are the prompts of the window the read
   * covered, which starts at absolute row `from`: they replace the ones kept from there on.
   */
  private append(
    rows: readonly string[],
    fresh: readonly number[],
    from: number,
    historyReplies: number,
  ): void {
    let history = rows.length > 0 ? [...this.state.history, ...rows] : this.state.history;
    let historyBase = this.state.historyBase;
    const over = history.length - HISTORY_MAX_LINES;
    if (over > 0) {
      history = history.slice(over);
      historyBase += over;
    }
    const prompts = [...this.state.prompts.filter((row) => row < from), ...fresh].filter(
      (row) => row >= historyBase,
    );
    this.set({ ...this.state, history, historyBase, prompts, historyReplies, behind: false });
  }

  private set(next: ScreenState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener();
  }

  private emit(frame: ScreenFrame): void {
    for (const listener of this.frameListeners) listener(frame);
  }
}

const RANK: Record<HistoryMode, number> = { "top-up": 0, older: 1, full: 2, replace: 3 };

function requestTimeout(lines: number): number {
  return REQUEST_TIMEOUT_MS + lines * REQUEST_TIMEOUT_PER_LINE_MS;
}

function strongest(a: HistoryMode | null, b: HistoryMode): HistoryMode {
  return a && RANK[a] > RANK[b] ? a : b;
}
