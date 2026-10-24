import { describe, expect, it } from "vitest";
import { normalizeAbsolutePath } from "../panePaths";

describe("normalizeAbsolutePath", () => {
  it("resolves dots and slashes", () => {
    expect(normalizeAbsolutePath("/srv/acme")).toBe("/srv/acme");
    expect(normalizeAbsolutePath("/srv//acme/./app/")).toBe("/srv/acme/app");
    expect(normalizeAbsolutePath("/srv/acme/../etc")).toBe("/srv/etc");
    expect(normalizeAbsolutePath("/srv/acme/a/../../..")).toBe("/");
    expect(normalizeAbsolutePath("/../../etc")).toBe("/etc");
    expect(normalizeAbsolutePath("/")).toBe("/");
  });

  it("rejects relative, oversized and control-character paths", () => {
    expect(normalizeAbsolutePath("srv/acme")).toBeNull();
    expect(normalizeAbsolutePath("~/code")).toBeNull();
    expect(normalizeAbsolutePath("")).toBeNull();
    expect(normalizeAbsolutePath("/srv/acme\n")).toBeNull();
    expect(normalizeAbsolutePath("/srv/\u0000")).toBeNull();
    expect(normalizeAbsolutePath(`/${"a".repeat(4096)}`)).toBeNull();
  });
});
