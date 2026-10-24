const MAX_PATH_CHARS = 4096;

/** C0 controls, DEL and C1 controls. */
function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * An absolute POSIX path with `.`, `..` and repeated or trailing slashes
 * resolved, or null when the input is not absolute, too long or has control
 * characters. Authorisation compares paths textually, so the Worker normalises
 * before matching (`/repos/acme/../../etc` must not pass as inside `/repos/acme`).
 * Symlinks are the bridge's business: it stat()s the directory it is handed.
 */
export function normalizeAbsolutePath(input: string): string | null {
  if (!input.startsWith("/") || input.length > MAX_PATH_CHARS || hasControlChars(input)) {
    return null;
  }
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
