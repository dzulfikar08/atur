import { describe, expect, test } from "bun:test";

import {
  offsetForTopRow,
  planPrompt,
  topRow,
  type PromptPlan,
  type ViewGeometry,
} from "./prompt-jump";
import { nextPrompt, previousPrompt } from "./terminal-screen";

/** 100 scrollback rows (absolute 50..149), a 20-row live grid (150..169), prompts as given. */
function state(prompts: number[]) {
  return {
    history: Array.from({ length: 100 }, (_, i) => `h${i}`),
    historyBase: 50,
    lines: Array.from({ length: 20 }, (_, i) => `l${i}`),
    prompts,
  };
}

const LINE = 10;
const PAD = 4;
/** A view 200 px tall: 20 rows. */
const at = (offset: number): ViewGeometry => ({
  offset,
  viewport: 200,
  lineHeight: LINE,
  pad: PAD,
});

describe("previousPrompt / nextPrompt", () => {
  const s = state([60, 100, 155]);

  test("previous is the nearest prompt strictly above the row", () => {
    expect(previousPrompt(s, 156)).toBe(155);
    expect(previousPrompt(s, 155)).toBe(100);
    expect(previousPrompt(s, 100)).toBe(60);
    expect(previousPrompt(s, 60)).toBeNull();
    expect(previousPrompt(s, 0)).toBeNull();
  });

  test("next is the nearest prompt strictly below the row", () => {
    expect(nextPrompt(s, 0)).toBe(60);
    expect(nextPrompt(s, 60)).toBe(100);
    expect(nextPrompt(s, 100)).toBe(155);
    expect(nextPrompt(s, 155)).toBeNull();
    expect(nextPrompt(s, 1000)).toBeNull();
  });

  test("rows outside the loaded rows are ignored", () => {
    const odd = state([10, 60, 170, 900]);
    expect(previousPrompt(odd, 1000)).toBe(60);
    expect(nextPrompt(odd, 60)).toBeNull();
    expect(nextPrompt(odd, 0)).toBe(60);
  });

  test("no prompts", () => {
    expect(previousPrompt(state([]), 100)).toBeNull();
    expect(nextPrompt(state([]), 100)).toBeNull();
  });
});

describe("geometry", () => {
  const s = state([]);

  test("at the bottom the top row is the grid's row a viewport above its last", () => {
    // 120 rows end at absolute 169; the 4 px of padding leave 19 rows wholly in view.
    expect(topRow(s, at(0))).toBe(169 - 18);
  });

  test("scrolling by whole rows moves the top row by as many", () => {
    expect(topRow(s, at(50))).toBe(169 - 23);
  });

  test("a fractional offset just short of a row still counts that row as in view", () => {
    const wanted = offsetForTopRow(s, 100, at(0));
    expect(topRow(s, at(wanted - 0.4))).toBe(100);
    expect(topRow(s, at(wanted + 0.4))).toBe(100);
  });

  test("a row sent to the top is the top row", () => {
    for (const row of [60, 100, 149, 150]) {
      expect(topRow(s, at(offsetForTopRow(s, row, at(0))))).toBe(row);
    }
  });

  test("the offset stays inside the content", () => {
    expect(offsetForTopRow(s, 169, at(0))).toBe(0);
    expect(offsetForTopRow(s, 50, at(0))).toBe(PAD + LINE * 120 - 200);
    expect(offsetForTopRow(s, 49, at(0))).toBe(2 * PAD + LINE * 120 - 200);
  });
});

describe("planPrompt", () => {
  const s = state([60, 100, 155]);
  const scroll = (row: number): PromptPlan => ({
    kind: "scroll",
    offset: offsetForTopRow(s, row, at(0)),
  });

  test("previous from the bottom goes to the newest prompt above the first row in view", () => {
    // The top row at the bottom is 151: the prompt at 155 is in view, below it.
    expect(planPrompt("previous", s, at(0), false)).toEqual(scroll(100));
  });

  test("previous again goes one earlier, and next comes back", () => {
    const first = offsetForTopRow(s, 100, at(0));
    expect(planPrompt("previous", s, at(first), false)).toEqual(scroll(60));
    const second = offsetForTopRow(s, 60, at(0));
    expect(planPrompt("next", s, at(second), false)).toEqual(scroll(100));
  });

  test("next to a prompt the pane's end keeps from the top is the bottom", () => {
    const at100 = offsetForTopRow(s, 100, at(0));
    // 155 cannot reach the top (the pane ends 14 rows below it): going there means the bottom.
    expect(planPrompt("next", s, at(at100), false)).toEqual({ kind: "bottom" });
    expect(planPrompt("next", s, at(0), false)).toEqual({ kind: "bottom" });
  });

  test("previous with none above: older scrollback when there is some, else nothing", () => {
    const top = offsetForTopRow(s, 60, at(0));
    expect(planPrompt("previous", s, at(top), true)).toEqual({ kind: "older" });
    expect(planPrompt("previous", s, at(top), false)).toEqual({ kind: "none" });
  });

  test("never moves the view the wrong way", () => {
    for (let offset = 0; offset < 1000; offset += 7) {
      const previous = planPrompt("previous", s, at(offset), false);
      if (previous.kind === "scroll") expect(previous.offset).toBeGreaterThan(offset);
      const next = planPrompt("next", s, at(offset), false);
      if (next.kind === "scroll") expect(next.offset).toBeLessThan(offset);
    }
  });
});
