import { expect, test } from "bun:test";

import {
  MAX_NOTCHES,
  ScreenInput,
  zoomFrame,
  type ScreenInputSink,
} from "@/lib/direct/screen-input";

function setup(viewport: [number, number] = [400, 800], picture: [number, number] = [1920, 1080]) {
  const log: unknown[][] = [];
  let changes = 0;
  const sink: ScreenInputSink = {
    pointer: (x, y, buttons) => log.push(["pointer", x, y, buttons]),
    scroll: (x, y, dx, dy) => log.push(["scroll", x, y, dx, dy]),
    feedback: (kind) => log.push(["feedback", kind]),
    ripple: (_x, _y, kind) => log.push(["ripple", kind]),
    changed: () => changes++,
  };
  const input = new ScreenInput(sink);
  input.setViewport(...viewport);
  input.setPicture(...picture);
  return {
    input,
    log,
    get changes() {
      return changes;
    },
  };
}

// 400x800 viewport, 1920x1080 desktop: fit scale 0.2083, a 400x225 picture centered at y = 287.5.

test("nothing moves before the desktop size and the viewport are known", () => {
  const log: unknown[][] = [];
  const input = new ScreenInput({
    pointer: (...args) => log.push(args),
    scroll: (...args) => log.push(args),
    feedback: () => {},
    ripple: () => {},
    changed: () => {},
  });
  input.apply({ k: "move", dx: 10, dy: 10, dt: 16 });
  input.apply({ k: "click", button: 0, count: 1 });
  input.apply({ k: "scroll", dx: 0, dy: 50 });
  expect(log).toEqual([]);
});

test("the pointer starts at the middle of the desktop", () => {
  const { input } = setup();
  expect(input.pointer).toEqual({ x: 960, y: 540 });
});

test("a slow stroke moves the pointer 1:1 in desktop pixels", () => {
  const { input, log } = setup();
  input.apply({ k: "move", dx: 10, dy: 0, dt: 100 });
  expect(log).toEqual([["pointer", 1008, 540, 0]]);
});

test("a fast flick is amplified and the pointer stays on the desktop", () => {
  const { input, log } = setup();
  input.apply({ k: "move", dx: 400, dy: 0, dt: 10 });
  const sent = log.at(-1);
  expect(sent?.[0]).toBe("pointer");
  expect(sent?.[1]).toBe(1919);
});

test("direct touch puts the pointer under the finger", () => {
  const { input, log } = setup();
  input.apply({ k: "moveTo", x: 100, y: 300 });
  expect(log).toEqual([["pointer", 480, 60, 0]]);
  // Off the picture clamps to its edge.
  input.apply({ k: "moveTo", x: -50, y: 9999 });
  expect(log.at(-1)).toEqual(["pointer", 0, 1079, 0]);
});

test("a click is press and release at the pointer; a double click is two", () => {
  const { input, log } = setup();
  input.apply({ k: "click", button: 0, count: 2 });
  expect(log).toEqual([
    ["ripple", "left"],
    ["pointer", 960, 540, 1],
    ["pointer", 960, 540, 0],
    ["pointer", 960, 540, 1],
    ["pointer", 960, 540, 0],
  ]);
});

test("buttons map to the RFB mask: left 1, middle 2, right 4", () => {
  const { input, log } = setup();
  input.apply({ k: "click", button: 2, count: 1 });
  input.apply({ k: "click", button: 1, count: 1 });
  expect(log.filter((entry) => entry[0] === "pointer").map((entry) => entry[3])).toEqual([
    4, 0, 2, 0,
  ]);
  expect(log[0]).toEqual(["ripple", "right"]);
});

test("a drag holds the button while the pointer moves, then lets go", () => {
  const { input, log } = setup();
  input.apply({ k: "button", button: 0, down: true });
  input.apply({ k: "move", dx: 10, dy: 0, dt: 100 });
  input.apply({ k: "button", button: 0, down: false });
  expect(log.filter((entry) => entry[0] === "pointer")).toEqual([
    ["pointer", 960, 540, 1],
    ["pointer", 1008, 540, 1],
    ["pointer", 1008, 540, 0],
  ]);
});

test("releaseButtons lets go of what is held, once", () => {
  const { input, log } = setup();
  input.apply({ k: "button", button: 0, down: true });
  input.apply({ k: "button", button: 2, down: true });
  input.releaseButtons();
  input.releaseButtons();
  expect(log.filter((entry) => entry[0] === "pointer").map((entry) => entry[3])).toEqual([1, 5, 0]);
});

test("scroll follows the fingers: a drag down scrolls up, a drag right scrolls left", () => {
  const { input, log } = setup();
  input.apply({ k: "scroll", dx: 0, dy: 40 });
  input.apply({ k: "scroll", dx: 50, dy: 0 });
  input.apply({ k: "scroll", dx: 0, dy: -120 });
  expect(log).toEqual([
    ["scroll", 960, 540, 0, 1],
    ["scroll", 960, 540, -1, 0],
    ["scroll", 960, 540, 0, -3],
  ]);
});

test("small drags add up to a notch instead of being lost", () => {
  const { input, log } = setup();
  for (let i = 0; i < 3; i++) input.apply({ k: "scroll", dx: 0, dy: 10 });
  expect(log).toEqual([]);
  input.apply({ k: "scroll", dx: 0, dy: 10 });
  expect(log).toEqual([["scroll", 960, 540, 0, 1]]);
});

test("a huge drag is clamped to the core's limit", () => {
  const { input, log } = setup();
  input.apply({ k: "scroll", dx: 0, dy: 100_000 });
  expect(log).toEqual([["scroll", 960, 540, 0, MAX_NOTCHES]]);
});

test("pinch zooms about the fingers and the frame follows by transform", () => {
  const { input } = setup();
  const before = zoomFrame(input.view);
  expect(before.scale).toBe(1);
  expect(before.left).toBeCloseTo(0);
  expect(before.width).toBeCloseTo(400);
  expect(before.height).toBeCloseTo(225);
  expect(before.top).toBeCloseTo(287.5);
  expect(before.translateX).toBeCloseTo(0);
  expect(before.translateY).toBeCloseTo(0);

  input.apply({ k: "pinch", ratio: 2, cx: 200, cy: 400, dx: 0, dy: 0 });
  const zoomed = zoomFrame(input.view);
  expect(input.view.zoom).toBe(2);
  // The layout stays at the zoom 1 fit; only the transform moves.
  expect(zoomed).toMatchObject({
    left: before.left,
    top: before.top,
    width: before.width,
    height: before.height,
    scale: 2,
  });
  expect(zoomed.translateX).toBeCloseTo(-200);
  expect(zoomed.translateY).toBeCloseTo(-112.5);
});

test("zoom is limited and pan stays inside the desktop", () => {
  const { input } = setup();
  input.apply({ k: "pinch", ratio: 100, cx: 200, cy: 400, dx: 0, dy: 0 });
  expect(input.view.zoom).toBe(6);
  input.apply({ k: "pan", dx: 100_000, dy: 100_000 });
  const frame = zoomFrame(input.view);
  expect(frame.translateX).toBeCloseTo(0);
  input.apply({ k: "pan", dx: -100_000, dy: 0 });
  expect(zoomFrame(input.view).translateX).toBeCloseTo(400 - 400 * 6);
  input.fit();
  expect(input.view.zoom).toBe(1);
});

test("a zoomed view follows the pointer toward the edge", () => {
  const { input } = setup();
  input.apply({ k: "pinch", ratio: 4, cx: 0, cy: 400, dx: 0, dy: 0 });
  const before = input.placement().left;
  for (let i = 0; i < 10; i++) input.apply({ k: "move", dx: 60, dy: 0, dt: 100 });
  expect(input.placement().left).toBeLessThan(before);
});

test("view only sends nothing, lets go of held buttons first, and still pans and zooms", () => {
  const { input, log } = setup();
  input.apply({ k: "button", button: 0, down: true });
  input.setViewOnly(true);
  expect(log.filter((entry) => entry[0] === "pointer")).toEqual([
    ["pointer", 960, 540, 1],
    ["pointer", 960, 540, 0],
  ]);
  const sent = log.length;
  input.apply({ k: "click", button: 0, count: 1 });
  input.apply({ k: "move", dx: 5, dy: 5, dt: 16 });
  input.apply({ k: "scroll", dx: 0, dy: 100 });
  expect(log.slice(sent)).toEqual([["ripple", "view"]]);
  input.apply({ k: "pinch", ratio: 2, cx: 200, cy: 400, dx: 0, dy: 0 });
  expect(input.view.zoom).toBe(2);
  input.setViewOnly(false);
  input.apply({ k: "click", button: 0, count: 1 });
  expect(log.at(-1)).toEqual(["pointer", expect.any(Number), expect.any(Number), 0]);
});

test("a new desktop size keeps the pointer at the same place on the desktop", () => {
  const { input } = setup();
  input.setPicture(960, 540);
  expect(input.pointer).toEqual({ x: 480, y: 270 });
  expect(input.view.fbW).toBe(960);
});

test("a viewport change (rotation) re-fits the zoom 1 frame", () => {
  const { input } = setup();
  input.setViewport(800, 400);
  const frame = zoomFrame(input.view);
  // 1920x1080 in 800x400: height limits, 711x400, centered.
  expect(frame.height).toBeCloseTo(400);
  expect(frame.width).toBeCloseTo(711.1, 0);
  expect(frame.left).toBeCloseTo((800 - frame.width) / 2);
});

test("haptic cues are passed through", () => {
  const { input, log } = setup();
  input.apply({ k: "feedback", kind: "hold" });
  input.apply({ k: "feedback", kind: "drag" });
  expect(log).toEqual([
    ["feedback", "hold"],
    ["feedback", "drag"],
  ]);
});

test("the sink hears of every change to the view", () => {
  const state = setup();
  const before = state.changes;
  state.input.apply({ k: "pan", dx: 1, dy: 1 });
  expect(state.changes).toBe(before + 1);
});

test("zoomFrame without a desktop size fills the viewport", () => {
  const frame = zoomFrame({ vw: 300, vh: 500, fbW: 0, fbH: 0, zoom: 1, panX: 0, panY: 0 });
  expect(frame).toMatchObject({ left: 0, top: 0, width: 300, height: 500, scale: 1 });
});
