import { describe, expect, test } from "bun:test";

import {
  follow,
  MAX_ZOOM,
  panBy,
  place,
  pointerGain,
  toDesktop,
  toScreen,
  zoomAbout,
  type ViewState,
} from "./screen-view";

// A 1920x1080 desktop on a portrait phone: fit scale 0.2, letterboxed.
const portrait: ViewState = { vw: 384, vh: 800, fbW: 1920, fbH: 1080, zoom: 1, panX: 0, panY: 0 };

describe("place", () => {
  test("zoom 1 fits the desktop and centers it", () => {
    expect(place(portrait)).toEqual({ left: 0, top: 292, width: 384, height: 216, scale: 0.2 });
  });

  test("pan is clamped so no empty band opens beside a zoomed desktop", () => {
    const p = place({ ...portrait, zoom: 4, panX: 500, panY: -9999 });
    expect(p.width).toBe(1536);
    expect(p.left).toBe(0);
    // Height 864 > 800: clamped to the bottom edge.
    expect(p.top).toBe(800 - 864);
    expect(place({ ...portrait, zoom: 4, panX: -5000 }).left).toBe(384 - 1536);
  });
});

describe("zoomAbout", () => {
  test("keeps the desktop point under the fingers fixed", () => {
    const before = place(portrait);
    const at = { x: 100, y: 400 };
    const desktop = toDesktop(before, 1920, 1080, at.x, at.y);
    // Zoom 5 overflows both axes, so neither is re-centered.
    const v = zoomAbout(portrait, 5, at.x, at.y);
    const after = toScreen(place(v), desktop.x, desktop.y);
    expect(after.x).toBeCloseTo(at.x, 6);
    expect(after.y).toBeCloseTo(at.y, 6);
  });

  test("is bounded to 1..MAX_ZOOM", () => {
    expect(zoomAbout(portrait, 0.2, 10, 10).zoom).toBe(1);
    expect(zoomAbout(portrait, 100, 10, 10).zoom).toBe(MAX_ZOOM);
  });
});

test("panBy cannot drag the desktop off the viewport", () => {
  const zoomed = zoomAbout(portrait, 4, 192, 400);
  const v = panBy(zoomed, 10_000, 0);
  expect(place(v).left).toBe(0);
});

describe("follow", () => {
  const zoomed = { ...portrait, zoom: 4, panX: 0, panY: -32 };

  test("pans just enough to bring the pointer inside the margin", () => {
    // Desktop x 1800 sits at 1440 CSS px, far right of the 384 px viewport.
    const v = follow(zoomed, 1800, 500, 40);
    const s = toScreen(place(v), 1800, 500);
    expect(s.x).toBeCloseTo(384 - 40, 6);
  });

  test("leaves the view alone while the pointer is comfortably inside", () => {
    const v = follow(zoomed, 200, 500, 40);
    expect(place(v).left).toBe(place(zoomed).left);
    expect(place(v).top).toBe(place(zoomed).top);
  });
});

describe("pointerGain", () => {
  test("slow strokes are 1:1, faster strokes accelerate up to a cap", () => {
    expect(pointerGain(2, 0, 16)).toBe(1);
    const medium = pointerGain(16, 0, 16);
    const fast = pointerGain(48, 0, 16);
    expect(medium).toBeGreaterThan(1);
    expect(fast).toBeGreaterThan(medium);
    expect(pointerGain(500, 0, 16)).toBe(3.5);
  });
});
