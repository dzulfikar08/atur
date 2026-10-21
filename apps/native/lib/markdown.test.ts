import { describe, expect, test } from "bun:test";
import { lexer, type Tokens } from "marked";

import { decodeEntities, imageTarget, linkTarget, splitInlineImages } from "@/lib/markdown";

describe("linkTarget", () => {
  test("follows http(s) only", () => {
    expect(linkTarget("https://atur.app/x")).toBe("https://atur.app/x");
    expect(linkTarget(" HTTP://example.com ")).toBe("HTTP://example.com");
    expect(linkTarget("javascript:alert(1)")).toBeNull();
    expect(linkTarget("file:///etc/passwd")).toBeNull();
    expect(linkTarget("intent://x#Intent;end")).toBeNull();
    expect(linkTarget("#section")).toBeNull();
    expect(linkTarget(null)).toBeNull();
  });
});

describe("imageTarget", () => {
  test("absolute URLs and server paths load, other relative paths do not", () => {
    expect(imageTarget("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(imageTarget("/api/assets/abc")).toBe("/api/assets/abc");
    expect(imageTarget("//evil.example/a.png")).toBeNull();
    expect(imageTarget("./diagram.png")).toBeNull();
    expect(imageTarget("data:image/png;base64,AAAA")).toBeNull();
  });
});

describe("splitInlineImages", () => {
  const paragraph = (src: string) => lexer(src)[0] as Tokens.Paragraph;

  test("a paragraph without images stays one inline run", () => {
    const segments = splitInlineImages(paragraph("some **bold** text").tokens);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("inline");
  });

  test("images split the surrounding text into runs", () => {
    const segments = splitInlineImages(paragraph("before ![a](/api/assets/1) after").tokens);
    expect(segments.map((s) => s.kind)).toEqual(["inline", "image", "inline"]);
    const image = segments[1];
    expect(image.kind === "image" && image.token.href).toBe("/api/assets/1");
  });

  test("a lone image produces no empty text runs", () => {
    const segments = splitInlineImages(paragraph("![a](/api/assets/1)").tokens);
    expect(segments.map((s) => s.kind)).toEqual(["image"]);
  });
});

describe("decodeEntities", () => {
  test("resolves named and numeric references, leaves unknown ones", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;q&quot; &#39;s&#39;")).toBe(
      `a & b <c> "q" 's'`,
    );
    expect(decodeEntities("&#x1F600; &#128512;")).toBe("😀 😀");
    expect(decodeEntities("&bogus; &#0; AT&T")).toBe("&bogus; &#0; AT&T");
  });
});
