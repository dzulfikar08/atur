import { describe, expect, test } from "bun:test";

import {
  DOUBLE_TAP_MS,
  GestureRecognizer,
  HOLD_MS,
  type GestureAction,
  type MouseMode,
} from "./screen-gestures";

/** Drives a recognizer like the WebView does, firing ticks at their deadlines. */
function driver(mode: MouseMode) {
  const g = new GestureRecognizer(mode);
  let now = 0;
  const log: GestureAction[] = [];
  const advance = (to: number) => {
    for (let d = g.deadline(); d !== null && d <= to; d = g.deadline()) {
      now = d;
      log.push(...g.tick(d));
    }
    now = to;
  };
  return {
    log,
    down(at: number, ...pts: [number, number, number][]) {
      advance(at);
      log.push(
        ...g.down(
          pts.map(([id, x, y]) => ({ id, x, y })),
          at,
        ),
      );
    },
    move(at: number, ...pts: [number, number, number][]) {
      advance(at);
      log.push(
        ...g.move(
          pts.map(([id, x, y]) => ({ id, x, y })),
          at,
        ),
      );
    },
    up(at: number, ...ids: number[]) {
      advance(at);
      log.push(...g.up(ids, at));
    },
    settle() {
      advance(now + 5000);
    },
    mode(next: MouseMode) {
      log.push(...g.setMode(next));
    },
    kinds: () => log.filter((a) => a.k !== "feedback").map((a) => a.k),
    clicks: () => log.filter((a): a is Extract<GestureAction, { k: "click" }> => a.k === "click"),
  };
}

describe("mouse pointer mode", () => {
  test("a tap clicks once, but only after the double-tap window closes", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    expect(d.clicks()).toEqual([]);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 0, count: 1 }]);
  });

  test("two quick taps are one double click, never two singles", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    d.down(80 + DOUBLE_TAP_MS - 50, [2, 110, 105]);
    d.up(80 + DOUBLE_TAP_MS, 2);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 0, count: 2 }]);
  });

  test("taps far apart stay two single clicks", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    d.down(150, [2, 300, 300]);
    expect(d.clicks()).toHaveLength(1);
    d.up(220, 2);
    d.settle();
    expect(d.clicks().map((c) => c.count)).toEqual([1, 1]);
  });

  test("one-finger drag moves the pointer without clicking, slop included", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.move(16, [1, 130, 100]);
    d.move(32, [1, 160, 110]);
    d.up(48, 1);
    d.settle();
    const moves = d.log.filter((a) => a.k === "move");
    expect(moves.reduce((s, a) => s + (a.k === "move" ? a.dx : 0), 0)).toBe(60);
    expect(d.clicks()).toEqual([]);
    expect(d.log.some((a) => a.k === "button")).toBe(false);
  });

  test("double-tap and hold, then drag, holds the left button through the drag", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    d.down(200, [2, 102, 102]);
    d.move(260, [2, 160, 102]);
    d.move(300, [2, 200, 140]);
    d.up(340, 2);
    d.settle();
    expect(d.kinds()).toEqual(["button", "move", "move", "button"]);
    expect(d.log.filter((a) => a.k === "button")).toEqual([
      { k: "button", button: 0, down: true },
      { k: "button", button: 0, down: false },
    ]);
    expect(d.clicks()).toEqual([]);
  });

  test("double-tap and hold presses the button before any movement", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    d.down(200, [2, 100, 100]);
    d.move(200 + HOLD_MS + 10, [2, 100, 101]);
    expect(d.log).toContainEqual({ k: "button", button: 0, down: true });
    expect(d.log).toContainEqual({ k: "feedback", kind: "drag" });
    d.up(900, 2);
    expect(d.log.at(-1)).toEqual({ k: "button", button: 0, down: false });
  });

  test("tap and hold is a right click on release, with a haptic cue at the hold", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.move(HOLD_MS + 20, [1, 103, 100]);
    expect(d.log).toEqual([{ k: "feedback", kind: "hold" }]);
    d.up(HOLD_MS + 100, 1);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 2, count: 1 }]);
  });

  test("tap and hold, then drag, moves the pointer instead of right clicking", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.move(HOLD_MS + 50, [1, 150, 100]);
    d.up(HOLD_MS + 100, 1);
    d.settle();
    expect(d.clicks()).toEqual([]);
    expect(d.log).toContainEqual(expect.objectContaining({ k: "move", dx: 50, dy: 0 }));
  });

  test("two-finger tap right clicks, even when the fingers lift apart", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.down(30, [2, 160, 100]);
    d.up(120, 1);
    d.up(150, 2);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 2, count: 1 }]);
  });

  test("three-finger tap middle clicks", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100], [2, 150, 100], [3, 200, 100]);
    d.up(120, 1, 2, 3);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 1, count: 1 }]);
  });

  test("three-finger tap survives fingers lifting one by one with jitter", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100], [2, 150, 100], [3, 200, 100]);
    d.up(80, 1);
    d.move(90, [2, 151, 101], [3, 201, 100]);
    d.up(110, 2);
    d.move(115, [3, 202, 99]);
    d.up(130, 3);
    d.settle();
    expect(d.clicks()).toEqual([{ k: "click", button: 1, count: 1 }]);
  });

  test("two-finger drag scrolls by the centroid's travel and never clicks", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100], [2, 160, 100]);
    d.move(16, [1, 100, 80], [2, 160, 80]);
    d.move(32, [1, 100, 60], [2, 160, 60]);
    d.up(48, 1);
    d.move(60, [2, 160, 20]);
    d.up(70, 2);
    d.settle();
    const scrolls = d.log.filter((a) => a.k === "scroll");
    expect(scrolls).toEqual([
      { k: "scroll", dx: 0, dy: -20 },
      { k: "scroll", dx: 0, dy: -20 },
    ]);
    expect(d.clicks()).toEqual([]);
    expect(d.log.some((a) => a.k === "move")).toBe(false);
  });

  test("spreading two fingers zooms instead of scrolling", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100], [2, 200, 100]);
    d.move(16, [1, 80, 100], [2, 220, 100]);
    d.up(40, 1, 2);
    const pinch = d.log.find((a) => a.k === "pinch");
    expect(pinch).toMatchObject({ k: "pinch", ratio: 1.4, cx: 150, cy: 100 });
    expect(d.log.some((a) => a.k === "scroll")).toBe(false);
  });

  test("switching modes mid-drag releases the button", () => {
    const d = driver("pointer");
    d.down(0, [1, 100, 100]);
    d.up(80, 1);
    d.down(200, [2, 100, 100]);
    d.move(260, [2, 160, 100]);
    d.mode("touch");
    expect(d.log.at(-1)).toEqual({ k: "button", button: 0, down: false });
  });
});

describe("direct touch mode", () => {
  test("a tap moves the pointer to the finger, then clicks", () => {
    const d = driver("touch");
    d.down(0, [1, 240, 320]);
    d.up(60, 1);
    d.settle();
    expect(d.log).toEqual([
      { k: "moveTo", x: 240, y: 320 },
      { k: "click", button: 0, count: 1 },
    ]);
  });

  test("tap and hold right clicks where the finger is", () => {
    const d = driver("touch");
    d.down(0, [1, 50, 60]);
    d.up(HOLD_MS + 40, 1);
    expect(d.log.filter((a) => a.k !== "feedback")).toEqual([
      { k: "moveTo", x: 50, y: 60 },
      { k: "click", button: 2, count: 1 },
    ]);
  });

  test("a plain one-finger drag pans the view and sends nothing", () => {
    const d = driver("touch");
    d.down(0, [1, 100, 100]);
    d.move(16, [1, 120, 90]);
    d.up(32, 1);
    d.settle();
    expect(d.log).toEqual([{ k: "pan", dx: 20, dy: -10 }]);
  });

  test("double-tap and hold, then drag, drags from where the finger landed", () => {
    const d = driver("touch");
    d.down(0, [1, 100, 100]);
    d.up(60, 1);
    d.down(150, [2, 104, 98]);
    d.move(200, [2, 180, 98]);
    d.up(260, 2);
    d.settle();
    expect(d.log.filter((a) => a.k !== "feedback")).toEqual([
      { k: "moveTo", x: 104, y: 98 },
      { k: "button", button: 0, down: true },
      { k: "moveTo", x: 180, y: 98 },
      { k: "button", button: 0, down: false },
    ]);
  });

  test("two-finger scroll first puts the pointer under the fingers", () => {
    const d = driver("touch");
    d.down(0, [1, 100, 100], [2, 140, 100]);
    d.move(16, [1, 100, 70], [2, 140, 70]);
    d.up(30, 1, 2);
    expect(d.log).toEqual([
      { k: "moveTo", x: 120, y: 100 },
      { k: "scroll", dx: 0, dy: -30 },
    ]);
  });
});
