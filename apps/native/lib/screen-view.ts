// Geometry for the Screen view: where the remote desktop sits inside the
// phone's viewport at a given zoom, and how the trackpad pointer moves. Pure,
// shared by the WebView page and its tests.
//
// Zoom 1 fits the whole desktop (letterboxed, centered). Above 1 the desktop
// is larger than the viewport on at least one axis and `panX/panY` (the
// desktop's top-left corner in viewport px) are clamped so no empty band
// opens up beside it.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export interface ViewState {
  /** Viewport size (CSS px). */
  vw: number;
  vh: number;
  /** Remote framebuffer size (desktop px). */
  fbW: number;
  fbH: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
  /** CSS px per desktop px. */
  scale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function place(v: ViewState): Placement {
  // Desktop size unknown (still connecting): fill the viewport.
  if (v.fbW <= 0 || v.fbH <= 0) return { left: 0, top: 0, width: v.vw, height: v.vh, scale: 1 };
  const fit = Math.min(v.vw / v.fbW, v.vh / v.fbH);
  const scale = fit * v.zoom;
  const width = v.fbW * scale;
  const height = v.fbH * scale;
  const left = width <= v.vw ? (v.vw - width) / 2 : clamp(v.panX, v.vw - width, 0);
  const top = height <= v.vh ? (v.vh - height) / 2 : clamp(v.panY, v.vh - height, 0);
  return { left, top, width, height, scale };
}

/** The same view with its pan clamped to what `place` would show. */
export function settle(v: ViewState): ViewState {
  const p = place(v);
  return { ...v, panX: p.left, panY: p.top };
}

/** Zoom by `ratio`, keeping the desktop point under (cx, cy) where it is. */
export function zoomAbout(v: ViewState, ratio: number, cx: number, cy: number): ViewState {
  const before = place(v);
  const fx = (cx - before.left) / before.scale;
  const fy = (cy - before.top) / before.scale;
  const zoom = clamp(v.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
  const scale = (before.scale / v.zoom) * zoom;
  return settle({ ...v, zoom, panX: cx - fx * scale, panY: cy - fy * scale });
}

export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return settle({ ...v, panX: v.panX + dx, panY: v.panY + dy });
}

/**
 * Pan just enough that desktop point (fx, fy) is at least `margin` px inside
 * the viewport: the zoomed view follows the pointer, as Windows App does.
 */
export function follow(v: ViewState, fx: number, fy: number, margin: number): ViewState {
  const p = place(v);
  const sx = p.left + fx * p.scale;
  const sy = p.top + fy * p.scale;
  const mx = Math.min(margin, v.vw / 2);
  const my = Math.min(margin, v.vh / 2);
  let panX = p.left;
  let panY = p.top;
  if (sx < mx) panX += mx - sx;
  else if (sx > v.vw - mx) panX -= sx - (v.vw - mx);
  if (sy < my) panY += my - sy;
  else if (sy > v.vh - my) panY -= sy - (v.vh - my);
  return settle({ ...v, panX, panY });
}

/** Viewport point of a desktop point. */
export function toScreen(p: Placement, fx: number, fy: number): { x: number; y: number } {
  return { x: p.left + fx * p.scale, y: p.top + fy * p.scale };
}

/** Desktop point under a viewport point, clamped to the desktop. */
export function toDesktop(
  p: Placement,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: clamp((x - p.left) / p.scale, 0, Math.max(0, fbW - 1)),
    y: clamp((y - p.top) / p.scale, 0, Math.max(0, fbH - 1)),
  };
}

/**
 * Trackpad acceleration: slow strokes move the pointer 1:1 for precision,
 * fast flicks cover up to 3.5x the finger's travel. `dt` in ms.
 */
export function pointerGain(dx: number, dy: number, dt: number): number {
  const speed = Math.hypot(dx, dy) / Math.max(1, dt);
  return clamp(1 + (speed - 0.25) * 2.2, 1, 3.5);
}
