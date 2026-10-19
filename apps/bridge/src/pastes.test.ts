import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageExtension, MAX_PASTE_BYTES, savePaste } from "./pastes";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("imageExtension", () => {
  it("recognises png, jpeg, gif and webp by magic bytes only", () => {
    expect(imageExtension(PNG)).toBe("png");
    expect(imageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(imageExtension(new TextEncoder().encode("GIF89a"))).toBe("gif");
    expect(imageExtension(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(imageExtension(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(imageExtension(new TextEncoder().encode("#!/bin/sh"))).toBeNull();
  });
});

describe("savePaste", () => {
  it("writes a private file under a generated name and returns its path", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pastes-")), "nested");
    const saved = await savePaste(dir, PNG);
    expect(saved.path.startsWith(`${dir}/paste-`)).toBe(true);
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(new Uint8Array(readFileSync(saved.path))).toEqual(PNG);
    expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("rejects non-images and oversized images", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pastes-"));
    await expect(savePaste(dir, new TextEncoder().encode("hello"))).rejects.toMatchObject({
      status: 415,
    });
    const big = new Uint8Array(MAX_PASTE_BYTES + 1);
    big.set(PNG);
    await expect(savePaste(dir, big)).rejects.toMatchObject({ status: 413 });
  });

  it("sweeps old pastes but leaves other files alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pastes-"));
    const old = join(dir, "paste-old.png");
    const mine = join(dir, "notes.txt");
    writeFileSync(old, PNG);
    writeFileSync(mine, "keep");
    const week = 8 * 24 * 3600;
    const past = Date.now() / 1000 - week;
    utimesSync(old, past, past);
    utimesSync(mine, past, past);
    await savePaste(dir, PNG);
    expect(() => statSync(old)).toThrow();
    expect(statSync(mine).isFile()).toBe(true);
  });
});
