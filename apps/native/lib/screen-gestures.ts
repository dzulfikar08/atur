// Touch gestures for the Screen view, modelled on Microsoft's Windows App
// (Remote Desktop) for iOS/Android. Pure: no DOM, no timers. The WebView feeds
// touches in and runs the returned actions; `deadline()` tells it when to call
// `tick()` so holds and deferred clicks fire without another touch.
//
// Mouse pointer mode (trackpad): one-finger drag moves the pointer, tap =
// left click, double-tap = double click, double-tap and hold then drag = left
// drag, tap and hold = right click, two-finger tap = right click, two-finger
// drag = wheel, pinch = local zoom, three-finger tap = middle click.
//
// Direct touch mode: the same, except the pointer jumps to the finger (tap
// clicks where you touch) and a plain one-finger drag pans the zoomed view.
//
// A single tap's click is held back for DOUBLE_TAP_MS: if the second tap of a
// "double-tap and hold, then drag" arrives, the remote must see one drag, not
// a click followed by a press (which GTK and friends read as a double click).

export type MouseMode = "pointer" | "touch";
/** DOM numbering: 0 left, 1 middle, 2 right. */
export type MouseButton = 0 | 1 | 2;

export type GestureAction =
  /** Pointer mode: move the pointer by finger travel (screen px) over `dt` ms. */
  | { k: "move"; dx: number; dy: number; dt: number }
  /** Direct touch: put the pointer under this screen point. */
  | { k: "moveTo"; x: number; y: number }
  | { k: "button"; button: MouseButton; down: boolean }
  /** Click(s) at the pointer; count 2 = double click. */
  | { k: "click"; button: MouseButton; count: 1 | 2 }
  /** Wheel by finger travel (screen px, natural direction applied by the caller). */
  | { k: "scroll"; dx: number; dy: number }
  /** Local zoom by `ratio` about (cx, cy), plus the centroid's travel. */
  | { k: "pinch"; ratio: number; cx: number; cy: number; dx: number; dy: number }
  /** Local pan of the zoomed view. */
  | { k: "pan"; dx: number; dy: number }
  /** Haptic cue: a hold armed the right click, or a drag picked up the button. */
  | { k: "feedback"; kind: "hold" | "drag" };

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export const TAP_SLOP = 12;
export const HOLD_MS = 500;
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_SLOP = 48;
export const PINCH_THRESHOLD = 0.12;

type Phase =
  | "idle"
  | "press"
  | "hold"
  | "move"
  | "pan"
  | "drag"
  | "multi"
  | "pinch"
  | "scroll"
  | "spent";

interface Finger {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

interface Point {
  x: number;
  y: number;
}

export class GestureRecognizer {
  private fingers = new Map<number, Finger>();
  private phase: Phase = "idle";
  private primary = -1;
  private pressAt = 0;
  private holdAt: number | null = null;
  /** This press began right after a tap, near it: a double-tap candidate. */
  private second = false;
  private maxFingers = 0;
  /** The previous tap's click, held back for DOUBLE_TAP_MS. */
  private pending: { at: number; x: number; y: number } | null = null;
  private last = { x: 0, y: 0, t: 0 };
  private multi = { cx: 0, cy: 0, spread: 1, lastCx: 0, lastCy: 0, lastSpread: 1, tap: false };

  constructor(public mode: MouseMode = "pointer") {}

  /** Switch modes, releasing anything held. */
  setMode(mode: MouseMode): GestureAction[] {
    const out = this.cancel();
    this.mode = mode;
    return out;
  }

  /** Earliest time `tick` has work to do, or null. */
  deadline(): number | null {
    const times: number[] = [];
    if (this.phase === "press" && this.holdAt !== null) times.push(this.holdAt);
    if (this.pending && this.fingers.size === 0) times.push(this.pending.at);
    return times.length > 0 ? Math.min(...times) : null;
  }

  down(points: TouchPoint[], t: number): GestureAction[] {
    const out: GestureAction[] = [];
    const wasEmpty = this.fingers.size === 0;
    for (const p of points) this.fingers.set(p.id, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    this.maxFingers = Math.max(this.maxFingers, this.fingers.size);

    if (wasEmpty) {
      const p = points[0]!;
      const near =
        this.pending !== null &&
        points.length === 1 &&
        t <= this.pending.at &&
        Math.hypot(p.x - this.pending.x, p.y - this.pending.y) <= DOUBLE_TAP_SLOP;
      if (!near) this.flushPending(out);
      this.second = near;
      this.phase = "press";
      this.primary = p.id;
      this.pressAt = t;
      this.holdAt = t + HOLD_MS;
      this.maxFingers = this.fingers.size;
      this.last = { x: p.x, y: p.y, t };
      if (this.fingers.size < 2) return out;
    }

    if (
      this.phase === "press" ||
      this.phase === "hold" ||
      this.phase === "move" ||
      this.phase === "pan"
    ) {
      // A second finger turns any one-finger gesture into pinch/scroll/tap.
      this.flushPending(out);
      this.second = false;
      this.holdAt = null;
      this.startMulti(this.phase === "press" || this.phase === "hold");
    } else if (this.phase === "multi") {
      this.startMulti(this.multi.tap);
    }
    return out;
  }

  move(points: TouchPoint[], t: number): GestureAction[] {
    const out: GestureAction[] = [];
    for (const p of points) {
      const f = this.fingers.get(p.id);
      if (f) {
        f.x = p.x;
        f.y = p.y;
      }
    }
    const f = this.fingers.get(this.primary);

    switch (this.phase) {
      case "press":
      case "hold": {
        if (!f || Math.hypot(f.x - f.sx, f.y - f.sy) <= TAP_SLOP) break;
        this.holdAt = null;
        if (this.phase === "press" && this.second) {
          this.startDrag(out, f);
        } else {
          this.phase = this.mode === "pointer" ? "move" : "pan";
        }
        // Replay the travel since touch-down so the slop isn't swallowed.
        this.emitTravel(out, f, { x: f.sx, y: f.sy }, t - this.pressAt);
        this.last = { x: f.x, y: f.y, t };
        break;
      }
      case "move":
      case "pan":
      case "drag": {
        if (!f) break;
        this.emitTravel(out, f, this.last, t - this.last.t);
        this.last = { x: f.x, y: f.y, t };
        break;
      }
      case "multi":
      case "pinch":
      case "scroll": {
        if (this.fingers.size < 2) break;
        const c = this.centroid();
        const spread = this.spread();
        if (this.phase === "multi") {
          if (this.maxFingers >= 3) {
            if (Math.hypot(c.x - this.multi.cx, c.y - this.multi.cy) > TAP_SLOP)
              this.phase = "spent";
            break;
          }
          if (Math.abs(spread / this.multi.spread - 1) > PINCH_THRESHOLD) {
            this.phase = "pinch";
          } else if (Math.hypot(c.x - this.multi.cx, c.y - this.multi.cy) > TAP_SLOP) {
            this.phase = "scroll";
            if (this.mode === "touch")
              out.push({ k: "moveTo", x: this.multi.cx, y: this.multi.cy });
          } else {
            break;
          }
        }
        const dx = c.x - this.multi.lastCx;
        const dy = c.y - this.multi.lastCy;
        if (this.phase === "pinch") {
          out.push({ k: "pinch", ratio: spread / this.multi.lastSpread, cx: c.x, cy: c.y, dx, dy });
        } else {
          out.push({ k: "scroll", dx, dy });
        }
        this.multi.lastCx = c.x;
        this.multi.lastCy = c.y;
        this.multi.lastSpread = spread;
        break;
      }
      default:
        break;
    }
    return out;
  }

  up(ids: number[], t: number): GestureAction[] {
    const out: GestureAction[] = [];
    const start = this.fingers.get(this.primary);
    const startPoint = start ? { x: start.sx, y: start.sy } : { x: this.last.x, y: this.last.y };
    for (const id of ids) this.fingers.delete(id);

    if (this.fingers.size > 0) {
      // Fingers rarely lift together: a two-finger tap ends when the last one
      // lifts. A finished pinch/scroll must not turn into a pointer move. An
      // undecided multi-finger tap re-measures from the fingers still down,
      // or the centroid jump of one lifting would read as movement.
      if (this.phase === "pinch" || this.phase === "scroll") this.phase = "spent";
      if (this.phase === "multi") this.startMulti(this.multi.tap);
      if (this.phase === "drag" && ids.includes(this.primary)) {
        out.push({ k: "button", button: 0, down: false });
        this.phase = "spent";
      }
      return out;
    }

    switch (this.phase) {
      case "press": {
        if (t - this.pressAt >= HOLD_MS && !this.second) {
          this.rightClickAt(out, startPoint);
        } else if (this.second && this.pending) {
          if (this.mode === "touch")
            out.push({ k: "moveTo", x: this.pending.x, y: this.pending.y });
          out.push({ k: "click", button: 0, count: 2 });
          this.pending = null;
        } else {
          this.pending = { at: t + DOUBLE_TAP_MS, x: startPoint.x, y: startPoint.y };
        }
        break;
      }
      case "hold":
        this.rightClickAt(out, startPoint);
        break;
      case "drag":
        out.push({ k: "button", button: 0, down: false });
        break;
      case "multi": {
        if (this.multi.tap && t - this.pressAt < HOLD_MS) {
          if (this.mode === "touch") out.push({ k: "moveTo", x: this.multi.cx, y: this.multi.cy });
          out.push({ k: "click", button: this.maxFingers >= 3 ? 1 : 2, count: 1 });
        }
        break;
      }
      default:
        break;
    }
    this.reset();
    return out;
  }

  /** Touches were cancelled by the OS: release anything held, drop the gesture. */
  cancel(): GestureAction[] {
    const out: GestureAction[] = [];
    if (this.phase === "drag") out.push({ k: "button", button: 0, down: false });
    this.fingers.clear();
    this.pending = null;
    this.reset();
    return out;
  }

  tick(t: number): GestureAction[] {
    const out: GestureAction[] = [];
    if (this.phase === "press" && this.holdAt !== null && t >= this.holdAt) {
      this.holdAt = null;
      const f = this.fingers.get(this.primary);
      if (this.second && f) {
        // Double-tap and hold: the button goes down even before the finger moves.
        this.startDrag(out, f);
      } else {
        this.phase = "hold";
        out.push({ k: "feedback", kind: "hold" });
      }
    }
    if (this.pending && this.fingers.size === 0 && t >= this.pending.at) this.flushPending(out);
    return out;
  }

  private reset(): void {
    this.phase = "idle";
    this.primary = -1;
    this.holdAt = null;
    this.second = false;
    this.maxFingers = 0;
  }

  private flushPending(out: GestureAction[]): void {
    if (!this.pending) return;
    if (this.mode === "touch") out.push({ k: "moveTo", x: this.pending.x, y: this.pending.y });
    out.push({ k: "click", button: 0, count: 1 });
    this.pending = null;
  }

  private startDrag(out: GestureAction[], f: Finger): void {
    // The held-back first tap is the start of this drag, not a click.
    this.pending = null;
    if (this.mode === "touch") out.push({ k: "moveTo", x: f.sx, y: f.sy });
    out.push({ k: "button", button: 0, down: true }, { k: "feedback", kind: "drag" });
    this.phase = "drag";
  }

  private rightClickAt(out: GestureAction[], at: Point): void {
    if (this.mode === "touch") out.push({ k: "moveTo", x: at.x, y: at.y });
    out.push({ k: "click", button: 2, count: 1 });
  }

  private emitTravel(out: GestureAction[], f: Finger, from: Point, dt: number): void {
    const dx = f.x - from.x;
    const dy = f.y - from.y;
    if (this.phase === "pan") out.push({ k: "pan", dx, dy });
    else if (this.mode === "touch") out.push({ k: "moveTo", x: f.x, y: f.y });
    else out.push({ k: "move", dx, dy, dt: Math.max(1, dt) });
  }

  private startMulti(tap: boolean): void {
    const c = this.centroid();
    const spread = this.spread();
    this.phase = "multi";
    this.multi = { cx: c.x, cy: c.y, spread, lastCx: c.x, lastCy: c.y, lastSpread: spread, tap };
  }

  private centroid(): Point {
    let x = 0;
    let y = 0;
    for (const f of this.fingers.values()) {
      x += f.x;
      y += f.y;
    }
    return { x: x / this.fingers.size, y: y / this.fingers.size };
  }

  private spread(): number {
    const [a, b] = [...this.fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 1;
  }
}
