import { describe, expect, it } from "vitest";
import { codeLanguage, fileKind } from "../fileKind";

describe("fileKind", () => {
  it("trusts a known extension over the browser-reported MIME", () => {
    expect(fileKind("text/plain", "README.md")).toBe("markdown");
    expect(fileKind("", "notes.markdown")).toBe("markdown");
    // Browsers label TypeScript as MPEG transport stream video.
    expect(fileKind("video/mp2t", "app.ts")).toBe("text");
    expect(fileKind("", "clip.MP4")).toBe("video");
  });

  it("falls back to the MIME type for unknown or missing extensions", () => {
    expect(fileKind("application/pdf", "scan")).toBe("pdf");
    expect(fileKind("video/quicktime; codecs=avc1", "upload")).toBe("video");
    expect(fileKind("audio/mpeg", "voice")).toBe("audio");
    expect(fileKind("application/json", "data.bin")).toBe("text");
    expect(fileKind("text/markdown", "x")).toBe("markdown");
    expect(fileKind("application/zip", "bundle.zip")).toBe("other");
    expect(fileKind(null, null)).toBe("other");
  });

  it("never auto-detects a language for unmapped text", () => {
    expect(codeLanguage("server.py")).toBe("python");
    expect(codeLanguage("data.csv")).toBe("plaintext");
  });
});
