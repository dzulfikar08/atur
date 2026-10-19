import { describe, expect, test } from "bun:test";

import { applyModifiers, controlChar, insertPath, KEY_DATA, swipeSteps } from "./terminal-keys";
import { clampFontSize, DEFAULT_FONT_SIZE, fitFontSize } from "./terminal-metrics";

const none = { ctrl: false, alt: false };

describe("insertPath", () => {
  test("keeps the image path a separate word wherever the caret is", () => {
    expect(insertPath("", 0, "/p.png")).toEqual({ text: "/p.png ", caret: 7 });
    expect(insertPath("look at", 7, "/p.png")).toEqual({ text: "look at /p.png ", caret: 15 });
    expect(insertPath("see  it", 4, "/p.png")).toEqual({ text: "see /p.png it", caret: 10 });
  });
});

describe("controlChar", () => {
  test("letters and the ctrl punctuation range map to control bytes", () => {
    expect(controlChar("c")).toBe("\x03");
    expect(controlChar("C")).toBe("\x03");
    expect(controlChar("a")).toBe("\x01");
    expect(controlChar("[")).toBe("\x1b");
    expect(controlChar("\\")).toBe("\x1c");
  });

  test("keys with no control form are null", () => {
    expect(controlChar("1")).toBeNull();
    expect(controlChar("ab")).toBeNull();
    expect(controlChar("")).toBeNull();
  });
});

describe("applyModifiers", () => {
  test("no modifiers: data unchanged", () => {
    expect(applyModifiers("hello", none)).toBe("hello");
  });

  test("ctrl acts on the first key only", () => {
    expect(applyModifiers("cat", { ctrl: true, alt: false })).toBe("\x03at");
  });

  test("ctrl on a key with no control form passes it through", () => {
    expect(applyModifiers("5", { ctrl: true, alt: false })).toBe("5");
  });

  test("alt prefixes ESC; ctrl+alt does both", () => {
    expect(applyModifiers("b", { ctrl: false, alt: true })).toBe("\x1bb");
    expect(applyModifiers("d", { ctrl: true, alt: true })).toBe("\x1b\x04");
  });

  test("escape sequences are left alone", () => {
    expect(applyModifiers(KEY_DATA.left, { ctrl: true, alt: true })).toBe(KEY_DATA.left);
  });

  test("wide first character is not split", () => {
    expect(applyModifiers("😀x", { ctrl: false, alt: true })).toBe("\x1b😀x");
  });

  test("empty data stays empty", () => {
    expect(applyModifiers("", { ctrl: true, alt: true })).toBe("");
  });
});

describe("swipeSteps", () => {
  test("one press per step, signed, net of what was already sent", () => {
    expect(swipeSteps(0, 14, 0)).toBe(0);
    expect(swipeSteps(13, 14, 0)).toBe(0);
    expect(swipeSteps(14, 14, 0)).toBe(1);
    expect(swipeSteps(45, 14, 1)).toBe(2);
    expect(swipeSteps(-30, 14, 0)).toBe(-2);
    expect(swipeSteps(-30, 14, -2)).toBe(0);
    // Reversing direction owes the way back.
    expect(swipeSteps(0, 14, 3)).toBe(-3);
  });
});

describe("font size", () => {
  test("clamps and snaps to half points", () => {
    expect(clampFontSize(2)).toBe(6);
    expect(clampFontSize(99)).toBe(24);
    expect(clampFontSize(11.3)).toBe(11.5);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
  });

  test("fitFontSize fills the width, within bounds", () => {
    // 390px / (80 cols * 0.6) = 8.125 -> 8
    expect(fitFontSize(390, 80)).toBe(8);
    // 156 cols would need ~4px: clamped to the minimum.
    expect(fitFontSize(390, 156)).toBe(6);
    expect(fitFontSize(0, 80)).toBe(DEFAULT_FONT_SIZE);
  });
});
