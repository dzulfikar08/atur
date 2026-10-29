import { expect, test } from "bun:test";

import { imageExtension, pasteImageDirect, pasteImageName } from "@/lib/direct/paste-image";
import { FakeLink } from "@/lib/direct/test-support";

test("names are paste-<epoch ms>.<extension> and plain file names", () => {
  expect(pasteImageName(1730000000000)).toBe("paste-1730000000000.png");
  expect(pasteImageName(1730000000000.9, "image/jpeg")).toBe("paste-1730000000000.jpg");
  expect(pasteImageName(5, "IMAGE/WEBP")).toBe("paste-5.webp");
  for (const mime of ["image/png", "image/jpeg", "image/gif", "", "text/x/../y", "a\\b/c"]) {
    expect(pasteImageName(1730000000000, mime)).toMatch(/^paste-\d+\.[a-z]+$/);
  }
});

test("unknown types fall back to png", () => {
  expect(imageExtension("application/octet-stream")).toBe("png");
  expect(imageExtension("image/heic")).toBe("heic");
});

test("an image goes to the session of a direct pane and the path comes back", async () => {
  const link = new FakeLink();
  const result = await pasteImageDirect(link, "direct:12", "QUJD", "image/png", 99);
  expect(link.images).toEqual([{ session: "12", name: "paste-99.png", base64: "QUJD" }]);
  expect(result.path).toBe("/home/dev/.cache/atur/pastes/paste-99.png");
});

test("a bridge-style pane id uses the id as the session; no connection is an error", async () => {
  const link = new FakeLink();
  await pasteImageDirect(link, "7", "QUJD", "image/png", 1);
  expect(link.images[0]?.session).toBe("7");
  await expect(pasteImageDirect(null, "direct:7", "QUJD")).rejects.toThrow(
    "Not connected to your computer",
  );
});
