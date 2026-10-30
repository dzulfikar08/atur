import { describe, expect, test } from "bun:test";

import {
  applyModifiers,
  controlChar,
  encodeChord,
  insertedText,
  insertPath,
  isSelectAll,
  KEY_DATA,
  swipeSteps,
} from "./terminal-keys";
import { clampFontSize, DEFAULT_FONT_SIZE, fitFontSize, gridForViewport } from "./terminal-metrics";

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

  test("gridForViewport is the largest grid that fits without horizontal scroll", () => {
    // 11pt: cell 6.6 * 1.03 = 6.798px, line round(14.85) = 15px.
    // (393 - 12) / 6.798 = 56.05 -> 56 cols; (600 - 8) / 15 = 39.47 -> 39 rows.
    const grid = gridForViewport(393, 600, 11);
    expect(grid).toEqual({ cols: 56, rows: 39 });
    // The rendered row width TerminalView uses must not exceed the view.
    expect(Math.ceil(grid.cols * 11 * 0.6 * 1.03) + 12).toBeLessThanOrEqual(393);
    expect(gridForViewport(0, 0, 11)).toEqual({ cols: 0, rows: 0 });
  });
});

const chord = (
  key: string,
  mods: Partial<{ ctrl: boolean; alt: boolean; meta: boolean }> = {},
) => ({
  key,
  ctrl: false,
  alt: false,
  meta: false,
  ...mods,
});

describe("encodeChord", () => {
  test("Ctrl+letter is the control byte, for every letter", () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(0x61 + i);
      expect(encodeChord(chord(letter, { ctrl: true }))).toBe(String.fromCharCode(i + 1));
    }
    expect(encodeChord(chord("A", { ctrl: true }))).toBe("\x01");
  });

  test("Ctrl on the punctuation range: ^[ ^\\ ^] ^^ ^_ and NUL", () => {
    expect(encodeChord(chord("[", { ctrl: true }))).toBe("\x1b");
    expect(encodeChord(chord("\\", { ctrl: true }))).toBe("\x1c");
    expect(encodeChord(chord("]", { ctrl: true }))).toBe("\x1d");
    expect(encodeChord(chord("^", { ctrl: true }))).toBe("\x1e");
    expect(encodeChord(chord("6", { ctrl: true }))).toBe("\x1e");
    expect(encodeChord(chord("_", { ctrl: true }))).toBe("\x1f");
    expect(encodeChord(chord("-", { ctrl: true }))).toBe("\x1f");
    expect(encodeChord(chord(" ", { ctrl: true }))).toBe("\x00");
  });

  test("Alt and Meta prefix ESC", () => {
    expect(encodeChord(chord("b", { alt: true }))).toBe("\x1bb");
    expect(encodeChord(chord("f", { meta: true }))).toBe("\x1bf");
    expect(encodeChord(chord("Backspace", { alt: true }))).toBe("\x1b\x7f");
  });

  test("Ctrl+Alt is ESC then the control byte", () => {
    expect(encodeChord(chord("d", { ctrl: true, alt: true }))).toBe("\x1b\x04");
  });

  test("a Ctrl chord with no terminal form sends nothing", () => {
    expect(encodeChord(chord("5", { ctrl: true }))).toBeNull();
    expect(encodeChord(chord("Enter", { ctrl: true }))).toBeNull();
  });
});

describe("isSelectAll", () => {
  test("only plain Ctrl+A", () => {
    expect(isSelectAll(chord("a", { ctrl: true }))).toBe(true);
    expect(isSelectAll(chord("A", { ctrl: true }))).toBe(true);
    expect(isSelectAll(chord("a"))).toBe(false);
    expect(isSelectAll(chord("a", { ctrl: true, alt: true }))).toBe(false);
    expect(isSelectAll(chord("b", { ctrl: true }))).toBe(false);
  });
});

describe("insertedText", () => {
  test("a pure insertion anywhere is returned", () => {
    expect(insertedText("", "a")).toBe("a");
    expect(insertedText("bc", "bca")).toBe("a");
    expect(insertedText("bc", "abc")).toBe("a");
    expect(insertedText("bc", "bxc")).toBe("x");
  });

  test("deletions and replacements are not insertions", () => {
    expect(insertedText("abc", "ab")).toBeNull();
    expect(insertedText("abc", "axc")).toBeNull();
    expect(insertedText("abc", "abc")).toBeNull();
    expect(insertedText("abc", "xyzw")).toBeNull();
  });
});
