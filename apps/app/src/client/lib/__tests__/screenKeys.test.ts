import { describe, expect, it } from "vitest";
import { KEYSYM, charToKeysym, diffInput } from "../screenKeys";

describe("charToKeysym", () => {
  it("maps ASCII and Latin-1 to their code points", () => {
    expect(charToKeysym("a")).toBe(0x61);
    expect(charToKeysym("A")).toBe(0x41);
    expect(charToKeysym("@")).toBe(0x40);
    expect(charToKeysym("é")).toBe(0xe9);
  });

  it("maps non-Latin-1 characters into the Unicode keysym range", () => {
    expect(charToKeysym("€")).toBe(0x01000000 + 0x20ac);
    expect(charToKeysym("😀")).toBe(0x01000000 + 0x1f600);
  });

  it("maps newline and tab to Return and Tab, drops other control characters", () => {
    expect(charToKeysym("\n")).toBe(KEYSYM.Return);
    expect(charToKeysym("\r")).toBe(KEYSYM.Return);
    expect(charToKeysym("\t")).toBe(KEYSYM.Tab);
    expect(charToKeysym("\u0007")).toBeNull();
    expect(charToKeysym("")).toBeNull();
  });
});

describe("diffInput", () => {
  const S = "\u200b\u200b";

  it("reports inserted text appended to the sentinel", () => {
    expect(diffInput(S, `${S}hi`)).toEqual({ deleted: 0, inserted: "hi" });
  });

  it("reports deletions from the end", () => {
    expect(diffInput(S, "\u200b")).toEqual({ deleted: 1, inserted: "" });
    expect(diffInput(S, "")).toEqual({ deleted: 2, inserted: "" });
  });

  it("reports a replacement as delete + insert", () => {
    expect(diffInput(S, "\u200bx")).toEqual({ deleted: 1, inserted: "x" });
  });
});
