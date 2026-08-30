import { describe, expect, it } from "vitest";
import { serveInline } from "../assets";

// The asset read path trusts this policy to decide inline vs forced download —
// a regression here re-opens the stored-XSS sink (routes/assets.ts GET /:id).
describe("serveInline (asset content-type policy)", () => {
  it("serves raster images and PDFs inline", () => {
    expect(serveInline("image/png")).toBe(true);
    expect(serveInline("image/jpeg")).toBe(true);
    expect(serveInline("image/webp")).toBe(true);
    expect(serveInline("application/pdf")).toBe(true);
  });

  it("forces SVG and everything scriptable to download", () => {
    expect(serveInline("image/svg+xml")).toBe(false);
    expect(serveInline("text/html")).toBe(false);
    expect(serveInline("text/plain")).toBe(false);
    expect(serveInline("application/javascript")).toBe(false);
  });

  it("downloads when the stored type is missing or opaque", () => {
    expect(serveInline("")).toBe(false);
    expect(serveInline("application/octet-stream")).toBe(false);
  });
});
