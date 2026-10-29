import type { DirectLink } from "@/lib/direct/manager";
import { parsePaneTarget } from "@/lib/direct/transport-choice";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

/** File extension for an image type; `png` when the type is not one the phone produces. */
export function imageExtension(mime: string): string {
  return EXTENSIONS[mime.trim().toLowerCase()] ?? "png";
}

/**
 * Name of an image saved on the computer: `paste-<epoch ms>.<ext>`. A plain file name, which is
 * all the core accepts (no directory, no `..`, no control characters).
 */
export function pasteImageName(now: number, mime = "image/png"): string {
  return `paste-${Math.trunc(now)}.${imageExtension(mime)}`;
}

/**
 * Saves an image on the computer through the live direct connection (the road that has no
 * bridge) and returns the absolute path there, ready to insert into the prompt.
 */
export async function pasteImageDirect(
  link: Pick<DirectLink, "pasteImage"> | null,
  paneId: string,
  base64: string,
  mime = "image/png",
  now = Date.now(),
): Promise<{ path: string }> {
  if (!link) throw new Error("Not connected to your computer");
  const { sessionId } = parsePaneTarget(paneId);
  return link.pasteImage(sessionId, pasteImageName(now, mime), base64);
}
