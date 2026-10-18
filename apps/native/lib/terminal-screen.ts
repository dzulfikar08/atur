// Visible-screen state for a pane, built from the bridge's `hello` / `snapshot`
// / `diff` frames. The bridge keeps no scrollback: a snapshot is the whole
// visible grid (rows joined by "\r\n"), a diff replaces individual rows by
// index. One instance per open pane, shared by the native renderer and the
// classic WebView renderer (which replays the same frames).

export interface ScreenState {
  cols: number;
  rows: number;
  /** One raw ANSI string per row; replaced (never mutated) on every change. */
  lines: readonly string[];
}

/** The frames a renderer must be able to replay, in the WebView page's vocabulary. */
export type ScreenFrame =
  | { t: "hello"; cols: number; rows: number }
  | { t: "snapshot"; ansi: string }
  | { t: "diff"; rows: [number, string][] };

/** Sanity bound on a diff row index: a corrupt frame must not allocate unbounded rows. */
const MAX_ROWS = 1000;

export class TerminalScreen {
  private state: ScreenState = { cols: 80, rows: 24, lines: [] };
  private readonly stateListeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: ScreenFrame) => void>();
  private helloSeen = false;

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

  private set(next: ScreenState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener();
  }

  private emit(frame: ScreenFrame): void {
    for (const listener of this.frameListeners) listener(frame);
  }
}
