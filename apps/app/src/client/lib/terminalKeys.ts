// Mirrors apps/native/lib/terminal-keys.ts (the app's key row); keep the two in
// step, the native app cannot import from the web workspace. The bytes are what
// xterm.js `onData` would send; the bridge turns them into herdr key presses.

export const KEY_DATA = {
  esc: "\x1b",
  tab: "\t",
  enter: "\r",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
} as const;

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
}

/** Ctrl+<char>: the control byte a terminal sends, or null when the key has no control form. */
export function controlChar(char: string): string | null {
  if (char.length !== 1) return null;
  const code = char.toUpperCase().charCodeAt(0);
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : null;
}

/**
 * Fold sticky Ctrl/Alt into outgoing data: a modifier acts on the first key
 * only. Ctrl turns a letter into its control byte, Alt prefixes ESC. Escape
 * sequences (arrows, PgUp, ...) pass through.
 */
export function applyModifiers(data: string, mods: Modifiers): string {
  if (data === "" || data.startsWith("\x1b")) return data;
  const [first = "", ...rest] = Array.from(data);
  let head = first;
  if (mods.ctrl) head = controlChar(first) ?? first;
  if (mods.alt) head = `\x1b${head}`;
  return head + rest.join("");
}

/** Font size (CSS px, half-point steps) at which `cols` monospace cells fill `widthPx`. */
export function fitFontSize(widthPx: number, cols: number, cellEm = 0.6): number {
  if (widthPx <= 0 || cols <= 0) return 13;
  const size = Math.floor((widthPx / (cols * cellEm)) * 2) / 2;
  return Math.min(13, Math.max(5, size));
}

/**
 * Insert an image path into a prompt draft at the caret, padded with spaces so
 * it stays a separate word. Returns the new text and caret position.
 */
export function insertPath(
  text: string,
  caret: number,
  path: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before === "" || /\s$/.test(before) ? "" : " ";
  const trail = after.startsWith(" ") ? "" : " ";
  const inserted = `${lead}${path}${trail}`;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}
