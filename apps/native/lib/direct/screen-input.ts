import type { GestureAction, MouseButton } from "@/lib/screen-gestures";
import {
  follow,
  panBy,
  place,
  pointerGain,
  settle,
  toDesktop,
  toScreen,
  zoomAbout,
  type Placement,
  type ViewState,
} from "@/lib/screen-view";

// What the gesture recognizer's actions do on the direct screen: the pointer in framebuffer
// pixels, the zoomed view, buttons held and wheel notches. The same model as the cloud page's
// (webview/screen.ts), minus the browser: it ends in `screenPointer` / `screenScroll` calls. Pure,
// so it is tested without a phone.

/** The zoomed view follows the pointer to keep it at least this far (px) inside the viewport. */
export const FOLLOW_MARGIN = 48;
/** Finger travel is scaled by this before it becomes wheel notches... */
export const WHEEL_GAIN = 1.6;
/** ...and this many scaled px make one notch (noVNC's wheel step, so both screens scroll alike). */
export const WHEEL_STEP_PX = 50;
/** The core clamps a scroll to this many notches. */
export const MAX_NOTCHES = 10;
/** RFB button masks by DOM button number: left 1, middle 2, right 4. */
const BUTTON_BITS: Record<MouseButton, number> = { 0: 1, 1: 2, 2: 4 };

export interface ScreenInputSink {
  pointer(x: number, y: number, buttons: number): void;
  /** Wheel notches: positive `dy` scrolls up, positive `dx` right. */
  scroll(x: number, y: number, dx: number, dy: number): void;
  /** A hold armed the right click, or a drag picked up the button. */
  feedback(kind: "hold" | "drag"): void;
  /** A touch cue at this viewport point. */
  ripple(x: number, y: number, kind: "left" | "right" | "view"): void;
  /** The view or the pointer moved. */
  changed(): void;
}

/** The native view's frame: laid out at the zoom 1 fit, scaled and moved by a transform. */
export interface ZoomFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  /** `transformOrigin` top left, then translate, then scale. */
  translateX: number;
  translateY: number;
  scale: number;
}

export function zoomFrame(view: ViewState): ZoomFrame {
  const fit = place({ ...view, zoom: 1 });
  const now = place(view);
  return {
    left: fit.left,
    top: fit.top,
    width: fit.width,
    height: fit.height,
    translateX: now.left - fit.left,
    translateY: now.top - fit.top,
    scale: view.zoom,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export class ScreenInput {
  view: ViewState = { vw: 0, vh: 0, fbW: 0, fbH: 0, zoom: 1, panX: 0, panY: 0 };
  /** Pointer position in framebuffer pixels. */
  pointer = { x: 0, y: 0 };
  viewOnly = false;
  private held = 0;
  private wheelX = 0;
  private wheelY = 0;

  constructor(private readonly sink: ScreenInputSink) {}

  /** The desktop size is known, and a new one (the computer resized) keeps the pointer in place. */
  get live(): boolean {
    return this.view.fbW > 0 && this.view.fbH > 0 && this.view.vw > 0 && this.view.vh > 0;
  }

  placement(): Placement {
    return place(this.view);
  }

  setViewport(vw: number, vh: number): void {
    if (vw === this.view.vw && vh === this.view.vh) return;
    this.view = settle({ ...this.view, vw, vh });
    this.sink.changed();
  }

  setPicture(width: number, height: number): void {
    const { fbW, fbH } = this.view;
    if (width <= 0 || height <= 0 || (width === fbW && height === fbH)) return;
    this.pointer =
      fbW === 0
        ? { x: width / 2, y: height / 2 }
        : { x: (this.pointer.x * width) / fbW, y: (this.pointer.y * height) / fbH };
    this.view = settle({ ...this.view, fbW: width, fbH: height });
    this.sink.changed();
  }

  /** Zoom 1: the whole desktop. */
  fit(): void {
    this.view = settle({ ...this.view, zoom: 1 });
    this.sink.changed();
  }

  /** Lets go of every button held (a mode change, a view-only switch, closing). */
  releaseButtons(): void {
    if (this.held === 0) return;
    this.held = 0;
    this.send();
  }

  setViewOnly(viewOnly: boolean): void {
    if (viewOnly) this.releaseButtons();
    this.viewOnly = viewOnly;
    this.sink.changed();
  }

  apply(action: GestureAction): void {
    switch (action.k) {
      case "move": {
        if (!this.live) break;
        const scale = this.placement().scale;
        const gain = pointerGain(action.dx, action.dy, action.dt);
        this.pointer = {
          x: clamp(this.pointer.x + (action.dx * gain) / scale, 0, this.view.fbW - 1),
          y: clamp(this.pointer.y + (action.dy * gain) / scale, 0, this.view.fbH - 1),
        };
        this.view = follow(this.view, this.pointer.x, this.pointer.y, FOLLOW_MARGIN);
        this.sink.changed();
        this.send();
        break;
      }
      case "moveTo":
        if (!this.live) break;
        this.pointer = toDesktop(
          this.placement(),
          this.view.fbW,
          this.view.fbH,
          action.x,
          action.y,
        );
        this.sink.changed();
        this.send();
        break;
      case "button":
        if (!this.live) break;
        if (action.down) this.ripple("left");
        this.press(action.button, action.down);
        break;
      case "click":
        if (!this.live) break;
        this.ripple(this.viewOnly ? "view" : action.button === 2 ? "right" : "left");
        for (let i = 0; i < action.count; i++) {
          this.press(action.button, true);
          this.press(action.button, false);
        }
        break;
      case "scroll":
        this.wheel(action.dx, action.dy);
        break;
      case "pinch":
        this.view = panBy(
          zoomAbout(this.view, action.ratio, action.cx, action.cy),
          action.dx,
          action.dy,
        );
        this.sink.changed();
        break;
      case "pan":
        this.view = panBy(this.view, action.dx, action.dy);
        this.sink.changed();
        break;
      case "feedback":
        this.sink.feedback(action.kind);
        break;
    }
  }

  private send(): void {
    if (this.viewOnly || !this.live) return;
    this.sink.pointer(Math.round(this.pointer.x), Math.round(this.pointer.y), this.held);
  }

  private press(button: MouseButton, down: boolean): void {
    if (this.viewOnly) return;
    const bit = BUTTON_BITS[button];
    this.held = down ? this.held | bit : this.held & ~bit;
    this.send();
  }

  /** Natural scrolling: the content follows the fingers, so a drag down scrolls up. */
  private wheel(dx: number, dy: number): void {
    if (this.viewOnly || !this.live) return;
    this.wheelX += (-dx * WHEEL_GAIN) / WHEEL_STEP_PX;
    this.wheelY += (dy * WHEEL_GAIN) / WHEEL_STEP_PX;
    const notchesX = clamp(Math.trunc(this.wheelX), -MAX_NOTCHES, MAX_NOTCHES) || 0;
    const notchesY = clamp(Math.trunc(this.wheelY), -MAX_NOTCHES, MAX_NOTCHES) || 0;
    if (notchesX === 0 && notchesY === 0) return;
    // Keep the fraction that did not make a notch; drop what the clamp refused.
    this.wheelX = notchesX === 0 ? this.wheelX : this.wheelX - Math.trunc(this.wheelX);
    this.wheelY = notchesY === 0 ? this.wheelY : this.wheelY - Math.trunc(this.wheelY);
    this.sink.scroll(Math.round(this.pointer.x), Math.round(this.pointer.y), notchesX, notchesY);
  }

  private ripple(kind: "left" | "right" | "view"): void {
    const at = toScreen(this.placement(), this.pointer.x, this.pointer.y);
    this.sink.ripple(at.x, at.y, kind);
  }
}
