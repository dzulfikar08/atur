import { describe, expect, it } from "vitest";
import { sanitizeHeader } from "../email";

describe("sanitizeHeader", () => {
  it("strips CR/LF sequences", () => {
    expect(sanitizeHeader("hello\r\nworld")).toBe("hello world");
    expect(sanitizeHeader("a\nb\nc")).toBe("a b c");
    expect(sanitizeHeader("a\r\n\r\nb")).toBe("a b");
  });

  it("leaves clean values untouched", () => {
    expect(sanitizeHeader("How was your experience, Ada?")).toBe(
      "How was your experience, Ada?",
    );
  });
});
