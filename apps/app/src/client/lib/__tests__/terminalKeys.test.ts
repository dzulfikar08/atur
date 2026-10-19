import { describe, expect, it } from "vitest";
import { applyModifiers, fitFontSize, insertPath } from "../terminalKeys";

describe("applyModifiers", () => {
  it("turns the first letter into its control byte and leaves the rest", () => {
    expect(applyModifiers("cd", { ctrl: true, alt: false })).toBe("\x03d");
  });
  it("prefixes ESC for Alt and composes with Ctrl", () => {
    expect(applyModifiers("b", { ctrl: false, alt: true })).toBe("\x1bb");
    expect(applyModifiers("x", { ctrl: true, alt: true })).toBe("\x1b\x18");
  });
  it("never rewrites escape sequences", () => {
    expect(applyModifiers("\x1b[A", { ctrl: true, alt: true })).toBe("\x1b[A");
  });
});

describe("fitFontSize", () => {
  it("fits the grid to the width in half-point steps, capped at the desktop size", () => {
    // 120 cols at 0.6 em in 390 px → 5.41 → 5
    expect(fitFontSize(390, 120)).toBe(5);
    expect(fitFontSize(390, 50)).toBe(13);
    expect(fitFontSize(700, 100)).toBe(11.5);
  });
});

describe("insertPath", () => {
  it("keeps the path a separate word wherever the caret is", () => {
    expect(insertPath("", 0, "/p.png")).toEqual({ text: "/p.png ", caret: 7 });
    expect(insertPath("look at", 7, "/p.png")).toEqual({ text: "look at /p.png ", caret: 15 });
    expect(insertPath("see  please", 4, "/p.png")).toEqual({
      text: "see /p.png please",
      caret: 10,
    });
  });
});
