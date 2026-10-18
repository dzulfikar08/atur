import { describe, expect, test } from "bun:test";

import { joinTranscript, pickDictationLocale } from "./dictation-text";

describe("pickDictationLocale", () => {
  test("Indonesian device -> id-ID, anything else -> en-US", () => {
    expect(pickDictationLocale("id-ID")).toBe("id-ID");
    expect(pickDictationLocale("id")).toBe("id-ID");
    expect(pickDictationLocale("ID-id")).toBe("id-ID");
    expect(pickDictationLocale("en-GB")).toBe("en-US");
    expect(pickDictationLocale("de-DE")).toBe("en-US");
    expect(pickDictationLocale(undefined)).toBe("en-US");
  });
});

describe("joinTranscript", () => {
  test("empty field takes the transcript as-is", () => {
    expect(joinTranscript("", "hello world")).toBe("hello world");
  });

  test("appends after existing text with one space", () => {
    expect(joinTranscript("fix the bug", "in the parser")).toBe("fix the bug in the parser");
  });

  test("no double space after trailing whitespace or newline", () => {
    expect(joinTranscript("line one ", "two")).toBe("line one two");
    expect(joinTranscript("line one\n", "two")).toBe("line one\ntwo");
  });

  test("blank transcript leaves the field untouched", () => {
    expect(joinTranscript("keep", "  ")).toBe("keep");
    expect(joinTranscript("", "")).toBe("");
  });

  test("interim results re-derive from the same base, never accumulate", () => {
    const base = "note:";
    expect(joinTranscript(base, "bu")).toBe("note: bu");
    expect(joinTranscript(base, "buy milk")).toBe("note: buy milk");
  });
});
