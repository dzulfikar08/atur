/**
 * Phone-sized panes. herdr lays panes out for the most recently active
 * attached client ("attached clients always use their own terminal size"),
 * which is why attaching from Termius makes agents redraw at phone width. The
 * app streams over the socket API instead, so this keeps an invisible herdr
 * client attached in a PTY at the phone's grid size while a phone viewer asks
 * for it. Every request re-attaches (attaching counts as activity, so it wins
 * the size back). When the last phone leaves, the client detaches after a
 * grace period; the size then follows whichever client is active next (typing
 * on the desktop snaps it back), exactly as after a Termius session.
 */
import type { Subprocess } from "bun";

/** Keep the phone size this long after the last phone viewer leaves (reconnects, app switches). */
const RELEASE_GRACE_MS = 15_000;
/** Coalesce bursts (rotation, keyboard open/close, pinch) into one re-attach. */
const DEBOUNCE_MS = 300;
/** The herdr client keeps one row for its own bar; the pane gets the rest. */
const CLIENT_CHROME_ROWS = 1;

export interface GridSize {
  cols: number;
  rows: number;
}

/** Clamp a client-supplied grid to something a terminal can be; null when unusable. */
export function clampGrid(cols: unknown, rows: unknown): GridSize | null {
  const c = Math.trunc(Number(cols));
  const r = Math.trunc(Number(rows));
  if (!Number.isFinite(c) || !Number.isFinite(r) || c < 20 || r < 5) return null;
  return { cols: Math.min(c, 400), rows: Math.min(r, 200) };
}

/** The herdr client must not think it is nested inside another herdr pane. */
function clientEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("HERDR")) env[key] = value;
  }
  env.TERM = "xterm-256color";
  return env;
}

export interface SizeActions {
  /** Lay out at `size` (called after the debounce; repeated per request). */
  apply(size: GridSize): void;
  /** Give the size back (called once nobody holds one for the grace period, and on stop). */
  restore(): void;
}

export interface SizeTiming {
  debounceMs: number;
  graceMs: number;
}

/**
 * Holder bookkeeping shared by every backend: phone viewers (keyed by socket)
 * ask for a size, requests are debounced into one `apply`, and the size is
 * given back `graceMs` after the last holder leaves.
 */
export class SizeHolders {
  private holders = new Map<unknown, GridSize>();
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private release: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly actions: SizeActions,
    private readonly timing: SizeTiming = { debounceMs: DEBOUNCE_MS, graceMs: RELEASE_GRACE_MS },
  ) {}

  /** A phone viewer (keyed by its socket) wants panes laid out at `size`. */
  request(holder: unknown, size: GridSize): void {
    this.holders.set(holder, size);
    clearTimeout(this.release);
    this.release = undefined;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.actions.apply(size), this.timing.debounceMs);
  }

  /** The viewer left or stopped asking; restore once nobody holds a size. */
  drop(holder: unknown): void {
    if (!this.holders.delete(holder) || this.holders.size > 0) return;
    clearTimeout(this.debounce);
    clearTimeout(this.release);
    this.release = setTimeout(() => this.actions.restore(), this.timing.graceMs);
  }

  has(holder: unknown): boolean {
    return this.holders.has(holder);
  }

  get isEmpty(): boolean {
    return this.holders.size === 0;
  }

  stop(): void {
    clearTimeout(this.debounce);
    clearTimeout(this.release);
    this.holders.clear();
    this.actions.restore();
  }
}

export class PaneSizer {
  private proc: Subprocess | null = null;
  private readonly holders = new SizeHolders({
    apply: (size) => this.attach(size),
    restore: () => this.detach(),
  });

  constructor(private readonly command: string[] = ["herdr"]) {}

  /** A phone viewer (keyed by its socket) wants panes laid out at `size`. */
  request(holder: unknown, size: GridSize): void {
    this.holders.request(holder, size);
  }

  /** The viewer left or stopped asking; detach once nobody holds a size. */
  drop(holder: unknown): void {
    this.holders.drop(holder);
  }

  stop(): void {
    this.holders.stop();
  }

  private attach(size: GridSize): void {
    this.detach();
    try {
      this.proc = Bun.spawn(this.command, {
        env: clientEnv(),
        // Output is the herdr TUI drawn for nobody: read and discard so the PTY never blocks.
        terminal: { cols: size.cols, rows: size.rows + CLIENT_CHROME_ROWS, data() {} },
      } as Parameters<typeof Bun.spawn>[1]);
      console.log(`sizer: herdr client attached at ${size.cols}x${size.rows}`);
    } catch (e) {
      this.proc = null;
      console.error("sizer: could not attach a herdr client:", e);
    }
  }

  private detach(): void {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
    console.log("sizer: herdr client detached");
  }
}
