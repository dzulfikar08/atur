import { describe, expect, test } from "bun:test";

import { fileExtension, fileKind, formatBytes } from "@/lib/file-kind";

describe("fileKind", () => {
  test("extension wins over MIME", () => {
    expect(fileKind("text/plain", "notes.md")).toBe("markdown");
    expect(fileKind("video/mp2t", "app.ts")).toBe("text");
  });

  test("falls back to the MIME type when the extension says nothing", () => {
    expect(fileKind("", "clip.mp4")).toBe("video");
    expect(fileKind("application/pdf", "doc")).toBe("pdf");
    expect(fileKind("image/png; charset=binary", "shot")).toBe("image");
    expect(fileKind("audio/mpeg", null)).toBe("audio");
    expect(fileKind("text/x-markdown", "readme")).toBe("markdown");
    expect(fileKind("application/json", "data")).toBe("text");
  });

  test("unknown files are other", () => {
    expect(fileKind("application/zip", "bundle.zip")).toBe("other");
    expect(fileKind(null, undefined)).toBe("other");
  });
});

describe("fileExtension", () => {
  test("lowercases the last extension", () => {
    expect(fileExtension("Report.FINAL.PDF")).toBe("pdf");
    expect(fileExtension("Makefile")).toBe("");
  });
});

describe("formatBytes", () => {
  test("KB below 1 MB (never 0 KB), MB above, empty when unknown", () => {
    expect(formatBytes(10)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(null)).toBe("");
  });
});
