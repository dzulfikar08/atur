// Runs inside the Screen WebView (bundled into lib/webview/screen-html.generated.ts).
// noVNC renders the desktop; this file owns every touch gesture:
//   tap = left click · two-finger tap = right click · long-press + drag = mouse
//   drag · one-finger drag = pan · pinch = zoom · two-finger drag = wheel scroll.
// Clicks are replayed as synthetic mouse events on noVNC's canvas, and zoom is
// done by resizing noVNC's container (scaleViewport refits the canvas), so
// noVNC's own pointer mapping stays exact at every zoom level.
import RFB from "@novnc/novnc";

type Mods = { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean };
type Inbound =
  | { t: "connect"; url: string; viewOnly: boolean }
  | { t: "disconnect" }
  | { t: "viewOnly"; value: boolean }
  | { t: "resetZoom" }
  | { t: "tap"; keysym: number; mods?: Mods }
  | { t: "type"; syms: number[] }
  | { t: "paste"; text: string; pressPaste: boolean }
  | { t: "ctrlAltDel" };

const post = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

const viewport = document.getElementById("viewport") as HTMLElement;
const host = document.getElementById("screen") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

const MAX_ZOOM = 6;
const TAP_SLOP = 10;
const LONG_PRESS_MS = 450;
const TAP_MAX_MS = 350;
const WHEEL_PX_PER_PX = 1.4;

const MOD_KEYSYMS: [keyof Mods, number][] = [
  ["ctrl", 0xffe3],
  ["alt", 0xffe9],
  ["shift", 0xffe1],
  ["super", 0xffeb],
];

let rfb: RFB | null = null;
let viewOnly = true;
let zoom = 1;
let panX = 0;
let panY = 0;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function layout() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  panX = clamp(panX, w - w * zoom, 0);
  panY = clamp(panY, h - h * zoom, 0);
  host.style.width = `${w * zoom}px`;
  host.style.height = `${h * zoom}px`;
  host.style.left = `${panX}px`;
  host.style.top = `${panY}px`;
}

function resetZoom() {
  zoom = 1;
  panX = 0;
  panY = 0;
  layout();
}

window.addEventListener("resize", resetZoom);
layout();

function disconnect() {
  const current = rfb;
  rfb = null;
  if (!current) return;
  try {
    current.disconnect();
  } catch {
    /* already disconnected */
  }
  host.replaceChildren();
}

function connect(url: string) {
  disconnect();
  resetZoom();
  post({ t: "status", state: "connecting" });
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const session = new RFB(host, socket, { shared: true });
  rfb = session;
  session.viewOnly = viewOnly;
  session.scaleViewport = true;
  session.clipViewport = false;
  session.resizeSession = false;
  // Focus belongs to the app's own soft keyboard, never the canvas.
  session.focusOnClick = false;
  session.showDotCursor = true;
  session.qualityLevel = 6;
  session.compressionLevel = 2;
  session.addEventListener("connect", () => post({ t: "status", state: "connected" }));
  session.addEventListener("disconnect", (e) => {
    if (rfb === session) rfb = null;
    post({
      t: "status",
      state: "disconnected",
      dropped: !(e as CustomEvent<{ clean: boolean }>).detail.clean,
    });
  });
  session.addEventListener("clipboard", (e) =>
    post({ t: "clipboard", text: (e as CustomEvent<{ text: string }>).detail.text }),
  );
}

function sendKey(keysym: number, mods: Mods = {}) {
  if (!rfb || viewOnly) return;
  const held = MOD_KEYSYMS.filter(([name]) => mods[name]);
  for (const [, sym] of held) rfb.sendKey(sym, null, true);
  rfb.sendKey(keysym, null, true);
  rfb.sendKey(keysym, null, false);
  for (const [, sym] of [...held].reverse()) rfb.sendKey(sym, null, false);
}

async function typeSyms(syms: number[]) {
  for (const sym of syms) {
    if (!rfb || viewOnly) return;
    rfb.sendKey(sym, null, true);
    rfb.sendKey(sym, null, false);
    // Yield so a long paste does not flood the socket in one frame.
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 3);
    await promise;
  }
}

window.__atur = {
  recv(raw) {
    const msg = raw as Inbound;
    switch (msg.t) {
      case "connect":
        viewOnly = msg.viewOnly;
        connect(msg.url);
        break;
      case "disconnect":
        disconnect();
        break;
      case "viewOnly":
        viewOnly = msg.value;
        if (rfb) rfb.viewOnly = viewOnly;
        break;
      case "resetZoom":
        resetZoom();
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
      case "ctrlAltDel":
        if (rfb && !viewOnly) rfb.sendCtrlAltDel();
        break;
    }
  },
};

// --- pointer replay ---------------------------------------------------------

function canvas(): HTMLCanvasElement | null {
  return host.querySelector("canvas");
}

function fireMouse(type: string, x: number, y: number, button: number, buttons: number) {
  canvas()?.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button,
      buttons,
    }),
  );
}

function click(x: number, y: number, button: number) {
  const mask = 1 << button;
  fireMouse("mousemove", x, y, 0, 0);
  fireMouse("mousedown", x, y, button, mask);
  fireMouse("mouseup", x, y, button, 0);
}

function ripple(x: number, y: number, color: string) {
  const dot = document.createElement("div");
  dot.className = "ripple";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.style.borderColor = color;
  overlay.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove());
}

// --- gestures ---------------------------------------------------------------

type Point = { x: number; y: number };
type Mode = "pending" | "pending2" | "pan" | "drag" | "pinch" | "scroll" | "spent";

const live = new Map<number, Point>();
const start = new Map<number, Point>();
let mode: Mode = "spent";
let maxFingers = 0;
let startedAt = 0;
let longPress: number | undefined;
let last: Point = { x: 0, y: 0 };
let pinch = { dist: 1, cx: 0, cy: 0, zoom: 1, panX: 0, panY: 0 };

function centroid(): Point {
  let x = 0;
  let y = 0;
  for (const p of live.values()) {
    x += p.x;
    y += p.y;
  }
  return { x: x / live.size, y: y / live.size };
}

function spread(): number {
  const [a, b] = [...live.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

function onStart(e: TouchEvent) {
  e.preventDefault();
  if (live.size === 0) startedAt = Date.now();
  for (const t of Array.from(e.changedTouches)) {
    const p = { x: t.clientX, y: t.clientY };
    live.set(t.identifier, p);
    start.set(t.identifier, p);
  }
  maxFingers = Math.max(maxFingers, live.size);
  if (live.size === 1) {
    mode = "pending";
    last = centroid();
    clearTimeout(longPress);
    longPress = window.setTimeout(() => {
      if (mode !== "pending") return;
      mode = "drag";
      fireMouse("mousemove", last.x, last.y, 0, 0);
      fireMouse("mousedown", last.x, last.y, 0, 1);
      ripple(last.x, last.y, "#60a5fa");
    }, LONG_PRESS_MS);
  } else if (live.size === 2) {
    clearTimeout(longPress);
    if (mode === "drag") fireMouse("mouseup", last.x, last.y, 0, 0);
    const c = centroid();
    pinch = { dist: spread(), cx: c.x, cy: c.y, zoom, panX, panY };
    mode = "pending2";
  } else {
    clearTimeout(longPress);
    mode = "spent";
  }
}

function onMove(e: TouchEvent) {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    if (live.has(t.identifier)) live.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
  const c = centroid();

  if (live.size === 1) {
    const [id] = [...live.keys()];
    const s = start.get(id) as Point;
    if (mode === "pending" && Math.hypot(c.x - s.x, c.y - s.y) > TAP_SLOP) {
      clearTimeout(longPress);
      mode = "pan";
    }
    if (mode === "pan") {
      panX += c.x - last.x;
      panY += c.y - last.y;
      layout();
    } else if (mode === "drag") {
      fireMouse("mousemove", c.x, c.y, 0, 1);
    }
    last = c;
    return;
  }

  if (live.size === 2 && (mode === "pending2" || mode === "pinch" || mode === "scroll")) {
    const ratio = spread() / pinch.dist;
    const dx = c.x - pinch.cx;
    const dy = c.y - pinch.cy;
    if (mode === "pending2") {
      if (Math.abs(ratio - 1) > 0.1) mode = "pinch";
      else if (Math.hypot(dx, dy) > TAP_SLOP) {
        mode = "scroll";
        last = c;
      }
    }
    if (mode === "pinch") {
      const next = clamp(pinch.zoom * ratio, 1, MAX_ZOOM);
      // Keep the desktop point under the fingers fixed while zooming.
      const px = (pinch.cx - pinch.panX) / pinch.zoom;
      const py = (pinch.cy - pinch.panY) / pinch.zoom;
      zoom = next;
      panX = c.x - px * next;
      panY = c.y - py * next;
      layout();
    } else if (mode === "scroll") {
      canvas()?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: c.x,
          clientY: c.y,
          deltaY: -(c.y - last.y) * WHEEL_PX_PER_PX,
          deltaX: -(c.x - last.x) * WHEEL_PX_PER_PX,
          deltaMode: 0,
        }),
      );
      last = c;
    }
  }
}

function onEnd(e: TouchEvent) {
  e.preventDefault();
  const before = live.size;
  const lifted = Array.from(e.changedTouches);
  const wasPending2 = mode === "pending2";
  const c = centroid();
  for (const t of lifted) {
    live.delete(t.identifier);
    start.delete(t.identifier);
  }
  if (live.size > 0) {
    // Two fingers → one: finish the gesture only once everything is lifted,
    // otherwise the remaining finger would jump the pan.
    if (before === 2) mode = "spent";
    return;
  }
  clearTimeout(longPress);
  const quick = Date.now() - startedAt < TAP_MAX_MS;
  if (mode === "drag") {
    fireMouse("mouseup", last.x, last.y, 0, 0);
  } else if (mode === "pending" && quick && maxFingers === 1) {
    ripple(last.x, last.y, viewOnly ? "#a3a3a3" : "#4ade80");
    click(last.x, last.y, 0);
  } else if (wasPending2 && quick && maxFingers === 2) {
    ripple(c.x, c.y, viewOnly ? "#a3a3a3" : "#f59e0b");
    click(c.x, c.y, 2);
  }
  mode = "spent";
  maxFingers = 0;
}

overlay.addEventListener("touchstart", onStart, { passive: false });
overlay.addEventListener("touchmove", onMove, { passive: false });
overlay.addEventListener("touchend", onEnd, { passive: false });
overlay.addEventListener("touchcancel", onEnd, { passive: false });
// A stray mouse (emulators, desktop browsers) keeps working as a plain tap.
overlay.addEventListener("contextmenu", (e) => e.preventDefault());

post({ t: "ready" });
