/**
 * Images pasted into a pane's prompt (web or app). The agent in the pane runs
 * on this machine, so the image is saved here and the client inserts its path
 * into the prompt, Termius-style: agents read images by path.
 *
 * Files live in one private directory (0700, files 0600) under a random name;
 * the client never chooses the path. Files older than `maxAgeMs` are swept on
 * each save.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_PASTE_BYTES = 20 * 1024 * 1024;

const SIGNATURES: { ext: string; bytes: (number | null)[] }[] = [
  { ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { ext: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // RIFF....WEBP
  { ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
];

/** File extension for a supported image, by its magic bytes; null otherwise. */
export function imageExtension(bytes: Uint8Array): string | null {
  const hit = SIGNATURES.find((s) => s.bytes.every((b, i) => b === null || bytes[i] === b));
  return hit?.ext ?? null;
}

export function pasteDirFromEnv(env: Record<string, string | undefined>): string {
  return (
    env.ATUR_PASTE_DIR || join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "atur", "pastes")
  );
}

export interface SavedPaste {
  path: string;
  bytes: number;
}

export async function savePaste(
  dir: string,
  image: Uint8Array,
  opts: { now?: number; maxAgeMs?: number } = {},
): Promise<SavedPaste> {
  const ext = imageExtension(image);
  if (!ext) throw new PasteError(415, "unsupported image type (png, jpeg, gif or webp)");
  if (image.length > MAX_PASTE_BYTES) throw new PasteError(413, "image too large");
  const now = opts.now ?? Date.now();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await sweep(dir, now - (opts.maxAgeMs ?? 7 * 24 * 3600_000));
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const path = join(dir, `paste-${stamp}-${randomBytes(4).toString("hex")}.${ext}`);
  await writeFile(path, image, { mode: 0o600, flag: "wx" });
  return { path, bytes: image.length };
}

async function sweep(dir: string, olderThan: number): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith("paste-")) continue;
    const file = join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < olderThan) await unlink(file).catch(() => {});
  }
}

export class PasteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
