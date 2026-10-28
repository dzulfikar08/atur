// Runs inside the Screen WebView (bundled into lib/webview/screen-html.generated.ts).
// noVNC decodes the desktop; everything a phone needs on top of it lives here:
//  - gestures (lib/screen-gestures.ts, Windows App's Mouse pointer and Direct
//    touch modes) replayed as synthetic mouse events on noVNC's canvas, so
//    noVNC's own pointer mapping stays exact at every zoom;
//  - a local pointer drawn at a fixed on-screen size (the cursor wayvnc paints
//    into the frame shrinks to a few pixels on a phone);
//  - zoom/pan of the desktop (lib/screen-view.ts), following the pointer;
//  - connection health: a text ping/pong beside the binary RFB stream measures
//    latency and detects a dead socket long before TCP would, and the last
//    frame stays on screen while the app reconnects.
import RFB, { type RawChannel } from "@novnc/novnc";

import { GestureRecognizer, type GestureAction, type MouseMode } from "../lib/screen-gestures";
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
} from "../lib/screen-view";

type Mods = { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean };
type Quality = "high" | "balanced" | "low";
type Inbound =
  | {
      t: "connect";
      url: string;
      viewOnly: boolean;
      mode: MouseMode;
      quality: Quality;
      /** Give up on an unanswered socket after this long (the direct path fails fast). */
      timeoutMs?: number;
    }
  | { t: "disconnect" }
  | { t: "viewOnly"; value: boolean }
  | { t: "mode"; value: MouseMode }
  | { t: "quality"; value: Quality }
  | { t: "fit" }
  | { t: "resume" }
  | { t: "tap"; keysym: number; mods?: Mods }
  | { t: "type"; syms: number[] }
  | { t: "paste"; text: string; pressPaste: boolean };

const post = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

const viewportEl = document.getElementById("viewport") as HTMLElement;
const host = document.getElementById("screen") as HTMLElement;
const ghost = document.getElementById("ghost") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const pointerEl = document.getElementById("pointer") as HTMLElement;

const PING_MS = 5000;
/** No bytes at all for this long on a socket that answers pings = dead. */
const DEAD_MS = 15_000;
const RESUME_GRACE_MS = 4000;
/** Covers a cold wayvnc start on the bridge (up to 8 s) plus the RFB handshake. */
const CONNECT_TIMEOUT_MS = 15_000;
const STATS_MS = 2000;
const FOLLOW_MARGIN = 48;
const WHEEL_GAIN = 1.6;
/** The arrow's tip inside the 26 px pointer graphic. */
const HOTSPOT = { x: 3, y: 2 };

const QUALITY: Record<Quality, { quality: number; compression: number }> = {
  high: { quality: 8, compression: 2 },
  balanced: { quality: 6, compression: 2 },
  low: { quality: 2, compression: 9 },
};

const MOD_KEYSYMS: [keyof Mods, number][] = [
  ["ctrl", 0xffe3],
  ["alt", 0xffe9],
  ["shift", 0xffe1],
  ["super", 0xffeb],
];

// --- connection --------------------------------------------------------------

/**
 * The WebSocket noVNC reads through. Binary frames are RFB and pass straight
 * through; text frames are our ping/pong (the bridge answers them, older
 * bridges ignore them). `kill` ends a session that went silent without
 * waiting for TCP to notice.
 */
class Channel implements RawChannel {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  /** Last close seen, for the status report. */
  closeInfo: { code: number; reason: string } | null = null;
  /** Runs just before noVNC hears of the close (it removes its canvas then). */
  beforeClose: (() => void) | null = null;
  lastRx = performance.now();
  rxBytes = 0;
  rtt: number | null = null;
  /** The bridge answered at least one ping, so silence means trouble. */
  pings = false;

  private readonly ws: WebSocket;
  private dead = false;
  private seq = 0;
  private timer: number;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = (e) => {
      this.lastRx = performance.now();
      this.ping();
      this.onopen?.(e);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastRx = performance.now();
      if (typeof e.data === "string") {
        this.control(e.data);
        return;
      }
      this.rxBytes += (e.data as ArrayBuffer).byteLength;
      this.onmessage?.(e);
    };
    this.ws.onerror = (e) => this.onerror?.(e);
    this.ws.onclose = (e) => this.finish(e.code, e.reason, e.wasClean);
    this.timer = window.setInterval(() => this.check(), PING_MS);
  }

  get binaryType(): BinaryType {
    return this.ws.binaryType;
  }

  set binaryType(value: BinaryType) {
    this.ws.binaryType = value;
  }

  get protocol(): string {
    return this.ws.protocol;
  }

  get readyState(): number {
    return this.dead ? WebSocket.CLOSED : this.ws.readyState;
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (!this.dead && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }

  ping(): void {
    if (this.dead || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: "ping", id: ++this.seq, ts: performance.now() }));
  }

  /** App came back to the foreground: prove the socket still works, quickly. */
  resume(): void {
    const sent = performance.now();
    this.ping();
    window.setTimeout(() => {
      if (this.pings && this.lastRx < sent) this.kill(4000, "no response after resume");
    }, RESUME_GRACE_MS);
  }

  /** Declare the socket dead now and report it closed. */
  kill(code: number, reason: string): void {
    if (this.dead) return;
    this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
    try {
      this.ws.close();
    } catch {
      /* already closing */
    }
    this.finish(code, reason, false);
  }

  private check(): void {
    if (this.dead) return;
    if (this.pings && performance.now() - this.lastRx > DEAD_MS) {
      this.kill(4000, "no response");
      return;
    }
    this.ping();
  }

  private control(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { t?: string; ts?: number };
      if (msg.t === "pong" && typeof msg.ts === "number") {
        this.pings = true;
        this.rtt = Math.round(performance.now() - msg.ts);
      }
    } catch {
      /* not ours */
    }
  }

  private finish(code: number, reason: string, wasClean: boolean): void {
    if (this.dead) return;
    this.dead = true;
    clearInterval(this.timer);
    this.closeInfo = { code, reason };
    this.beforeClose?.();
    this.onclose?.({ code, reason, wasClean });
  }
}

let rfb: RFB | null = null;
let channel: Channel | null = null;
/** Bumped per connect: events from a replaced session are ignored. */
let generation = 0;
let viewOnly = false;
let mode: MouseMode = "pointer";
let quality: Quality = "balanced";
let connectTimer: number | undefined;
let statsTimer: number | undefined;
let lastStatsBytes = 0;

function disconnect() {
  releaseButtons();
  generation++;
  clearTimeout(connectTimer);
  clearInterval(statsTimer);
  const current = rfb;
  rfb = null;
  channel = null;
  if (current) {
    try {
      current.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  host.replaceChildren();
}

function connect(url: string, timeoutMs = CONNECT_TIMEOUT_MS) {
  // Keep the last frame up while the new session paints its first one.
  snapshotGhost();
  disconnect();
  const gen = generation;
  post({ t: "status", state: "connecting" });

  const ch = new Channel(url);
  ch.beforeClose = () => {
    if (gen === generation) snapshotGhost();
  };
  const session = new RFB(host, ch, { shared: true });
  rfb = session;
  channel = ch;
  session.viewOnly = viewOnly;
  session.scaleViewport = true;
  session.clipViewport = false;
  session.resizeSession = false;
  session.focusOnClick = false;
  // The local pointer replaces noVNC's dot; wayvnc still paints the real cursor.
  session.showDotCursor = false;
  session.background = "transparent";
  session.qualityLevel = QUALITY[quality].quality;
  session.compressionLevel = QUALITY[quality].compression;

  connectTimer = window.setTimeout(() => {
    if (gen === generation) ch.kill(4000, "connect timeout");
  }, timeoutMs);

  session.addEventListener("connect", () => {
    if (gen !== generation) return;
    clearTimeout(connectTimer);
    post({ t: "status", state: "connected" });
    watchCanvas();
    lastStatsBytes = ch.rxBytes;
    statsTimer = window.setInterval(() => {
      const kbps = Math.round(((ch.rxBytes - lastStatsBytes) * 8) / STATS_MS);
      lastStatsBytes = ch.rxBytes;
      post({ t: "stats", rtt: ch.rtt, kbps });
    }, STATS_MS);
    // The first full frame lands within a few hundred ms of connecting.
    window.setTimeout(() => {
      if (gen === generation) clearGhost();
    }, 1500);
  });
  // Only the live session reports: disconnect() bumps `generation` first, so
  // a disconnect seen here was never asked for (noVNC calls a server-side
  // close "clean" too). The close code tells the app whether to retry.
  session.addEventListener("disconnect", () => {
    if (gen !== generation) return;
    // RFB already let go of the socket; nothing left to release remotely.
    held = 0;
    clearTimeout(connectTimer);
    clearInterval(statsTimer);
    rfb = null;
    channel = null;
    post({
      t: "status",
      state: "disconnected",
      code: ch.closeInfo?.code,
      reason: ch.closeInfo?.reason,
    });
    render();
  });
  session.addEventListener("clipboard", (e) => {
    if (gen === generation)
      post({ t: "clipboard", text: (e as CustomEvent<{ text: string }>).detail.text });
  });
}

// --- last frame while reconnecting -------------------------------------------

function snapshotGhost() {
  const canvas = host.querySelector("canvas");
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;
  ghost.width = canvas.width;
  ghost.height = canvas.height;
  ghost.getContext("2d")?.drawImage(canvas, 0, 0);
  ghost.style.display = "block";
}

function clearGhost() {
  ghost.style.display = "none";
  ghost.width = 0;
  ghost.height = 0;
}

// --- view: zoom, pan, pointer --------------------------------------------------

let view: ViewState = {
  vw: viewportEl.clientWidth,
  vh: viewportEl.clientHeight,
  fbW: 0,
  fbH: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
};
/** Pointer position in desktop px. */
let pointer = { x: 0, y: 0 };
let placement: Placement = place(view);

function render() {
  placement = place(view);
  for (const el of [host, ghost]) {
    el.style.left = `${placement.left}px`;
    el.style.top = `${placement.top}px`;
    el.style.width = `${placement.width}px`;
    el.style.height = `${placement.height}px`;
  }
  const visible = rfb !== null && view.fbW > 0 && mode === "pointer" && !viewOnly;
  pointerEl.style.display = visible ? "block" : "none";
  if (visible) {
    const s = toScreen(placement, pointer.x, pointer.y);
    pointerEl.style.transform = `translate(${s.x - HOTSPOT.x}px, ${s.y - HOTSPOT.y}px)`;
  }
}

/** Track the framebuffer size: wayvnc can resize right after connecting. */
let canvasObserver: MutationObserver | null = null;
function watchCanvas() {
  canvasObserver?.disconnect();
  const canvas = host.querySelector("canvas");
  if (!canvas) return;
  const sync = () => {
    const { width, height } = canvas;
    if (width === 0 || height === 0 || (width === view.fbW && height === view.fbH)) return;
    if (view.fbW === 0) {
      pointer = { x: width / 2, y: height / 2 };
    } else {
      pointer = { x: (pointer.x * width) / view.fbW, y: (pointer.y * height) / view.fbH };
    }
    view = settle({ ...view, fbW: width, fbH: height });
    render();
  };
  canvasObserver = new MutationObserver(sync);
  canvasObserver.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
  sync();
}

new ResizeObserver(() => {
  view = settle({ ...view, vw: viewportEl.clientWidth, vh: viewportEl.clientHeight });
  render();
}).observe(viewportEl);

function fit() {
  view = settle({ ...view, zoom: 1 });
  render();
}

// --- input: synthetic mouse on noVNC's canvas ---------------------------------

// noVNC emulates Element.setCapture on mousedown with a full-screen z-index
// 10000 div that only a mouseup reaching `window` removes. Our synthetic
// mouseup is stopped at the canvas, so that div would stay up and swallow
// every touch after the first click. All our events already target the
// canvas, so capture is pointless here: give noVNC native no-op versions and
// it never builds the div.
Object.defineProperty(HTMLCanvasElement.prototype, "setCapture", {
  value() {},
  configurable: true,
});
Object.defineProperty(document, "releaseCapture", { value() {}, configurable: true });

/** DOM `buttons` bits currently held: 1 left, 2 right, 4 middle. */
let held = 0;
const BUTTON_BIT = [1, 4, 2] as const;

function clientPoint(): { x: number; y: number } | null {
  const canvas = host.querySelector("canvas");
  if (!canvas || canvas.width === 0) return null;
  // The canvas's own box is what noVNC inverts, so aim through it. Mouse
  // events carry whole CSS px; rounding keeps the error under half a pixel.
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round(r.left + ((pointer.x + 0.5) * r.width) / canvas.width),
    y: Math.round(r.top + ((pointer.y + 0.5) * r.height) / canvas.height),
  };
}

function fire(type: "mousemove" | "mousedown" | "mouseup", button = 0) {
  const at = clientPoint();
  if (!at || !rfb || viewOnly) return;
  host.querySelector("canvas")?.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      button,
      buttons: held,
    }),
  );
}

function press(button: 0 | 1 | 2, down: boolean) {
  const bit = BUTTON_BIT[button];
  held = down ? held | bit : held & ~bit;
  fire(down ? "mousedown" : "mouseup", button);
}

function releaseButtons() {
  for (const button of [0, 1, 2] as const) {
    if (held & BUTTON_BIT[button]) press(button, false);
  }
  held = 0;
}

function wheel(dx: number, dy: number) {
  const at = clientPoint();
  if (!at || !rfb || viewOnly) return;
  // Natural scrolling: the content follows the fingers.
  host.querySelector("canvas")?.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      deltaX: -dx * WHEEL_GAIN,
      deltaY: -dy * WHEEL_GAIN,
      deltaMode: 0,
    }),
  );
}

function ripple(color: string) {
  const s = toScreen(placement, pointer.x, pointer.y);
  const dot = document.createElement("div");
  dot.className = "ripple";
  dot.style.left = `${s.x}px`;
  dot.style.top = `${s.y}px`;
  dot.style.borderColor = color;
  overlay.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove());
}

function apply(action: GestureAction) {
  const live = rfb !== null && view.fbW > 0;
  switch (action.k) {
    case "move": {
      if (!live) break;
      const gain = pointerGain(action.dx, action.dy, action.dt);
      pointer = {
        x: Math.min(view.fbW - 1, Math.max(0, pointer.x + (action.dx * gain) / placement.scale)),
        y: Math.min(view.fbH - 1, Math.max(0, pointer.y + (action.dy * gain) / placement.scale)),
      };
      view = follow(view, pointer.x, pointer.y, FOLLOW_MARGIN);
      render();
      fire("mousemove");
      break;
    }
    case "moveTo": {
      if (!live) break;
      pointer = toDesktop(placement, view.fbW, view.fbH, action.x, action.y);
      render();
      fire("mousemove");
      break;
    }
    case "button":
      if (!live) break;
      if (action.down) ripple("#60a5fa");
      press(action.button, action.down);
      break;
    case "click":
      if (!live) break;
      ripple(viewOnly ? "#a3a3a3" : action.button === 2 ? "#f59e0b" : "#fafafa");
      for (let i = 0; i < action.count; i++) {
        press(action.button, true);
        press(action.button, false);
      }
      break;
    case "scroll":
      wheel(action.dx, action.dy);
      break;
    case "pinch":
      view = panBy(zoomAbout(view, action.ratio, action.cx, action.cy), action.dx, action.dy);
      render();
      break;
    case "pan":
      view = panBy(view, action.dx, action.dy);
      render();
      break;
    case "feedback":
      post({ t: "feedback", kind: action.kind });
      break;
  }
}

// --- gestures ------------------------------------------------------------------

// View-only sends nothing, so one finger should pan rather than steer a pointer.
const recognizer = new GestureRecognizer("pointer");
const effectiveMode = (): MouseMode => (viewOnly ? "touch" : mode);

let tickTimer: number | undefined;
function run(actions: GestureAction[]) {
  for (const action of actions) apply(action);
  clearTimeout(tickTimer);
  const due = recognizer.deadline();
  if (due !== null) {
    tickTimer = window.setTimeout(
      () => run(recognizer.tick(performance.now())),
      Math.max(0, due - performance.now()),
    );
  }
}

const points = (list: TouchList) =>
  Array.from(list, (t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));

overlay.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    run(recognizer.down(points(e.changedTouches), performance.now()));
  },
  { passive: false },
);
overlay.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    run(recognizer.move(points(e.changedTouches), performance.now()));
  },
  { passive: false },
);
overlay.addEventListener(
  "touchend",
  (e) => {
    e.preventDefault();
    run(
      recognizer.up(
        points(e.changedTouches).map((p) => p.id),
        performance.now(),
      ),
    );
  },
  { passive: false },
);
overlay.addEventListener(
  "touchcancel",
  (e) => {
    e.preventDefault();
    run(recognizer.cancel());
  },
  { passive: false },
);
overlay.addEventListener("contextmenu", (e) => e.preventDefault());

// --- keyboard ------------------------------------------------------------------

function sendKey(keysym: number, mods: Mods = {}) {
  if (!rfb || viewOnly) return;
  const down = MOD_KEYSYMS.filter(([name]) => mods[name]);
  for (const [, sym] of down) rfb.sendKey(sym, null, true);
  rfb.sendKey(keysym, null, true);
  rfb.sendKey(keysym, null, false);
  for (const [, sym] of [...down].reverse()) rfb.sendKey(sym, null, false);
}

async function typeSyms(syms: number[]) {
  const gen = generation;
  for (const sym of syms) {
    if (!rfb || viewOnly || gen !== generation) return;
    rfb.sendKey(sym, null, true);
    rfb.sendKey(sym, null, false);
    // Yield so a long paste does not flood the socket in one frame.
    await new Promise<void>((resolve) => setTimeout(resolve, 3));
  }
}

// --- app → page ----------------------------------------------------------------

window.__atur = {
  recv(raw) {
    const msg = raw as Inbound;
    switch (msg.t) {
      case "connect":
        viewOnly = msg.viewOnly;
        mode = msg.mode;
        quality = msg.quality;
        run(recognizer.setMode(effectiveMode()));
        connect(msg.url, msg.timeoutMs);
        render();
        break;
      case "disconnect":
        disconnect();
        clearGhost();
        render();
        break;
      case "viewOnly":
        // Let go of anything held while input still flows.
        run(recognizer.cancel());
        releaseButtons();
        viewOnly = msg.value;
        if (rfb) rfb.viewOnly = viewOnly;
        run(recognizer.setMode(effectiveMode()));
        render();
        break;
      case "mode":
        mode = msg.value;
        run(recognizer.setMode(effectiveMode()));
        render();
        break;
      case "quality":
        quality = msg.value;
        if (rfb) {
          rfb.qualityLevel = QUALITY[quality].quality;
          rfb.compressionLevel = QUALITY[quality].compression;
        }
        break;
      case "fit":
        fit();
        break;
      case "resume":
        channel?.resume();
        break;
      case "tap":
        sendKey(msg.keysym, msg.mods);
        break;
      case "type":
        void typeSyms(msg.syms);
        break;
      case "paste":
        if (!rfb || viewOnly) break;
        rfb.clipboardPasteFrom(msg.text);
        // Give wayvnc a moment to publish the selection before Ctrl+V.
        if (msg.pressPaste) setTimeout(() => sendKey(0x76, { ctrl: true }), 80);
        break;
    }
  },
};

render();
post({ t: "ready" });
