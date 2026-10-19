// Key data the native terminal sends, as the byte strings a terminal would. The
// bridge's `input` frame carries exactly this (xterm.js `onData` chunks) and
// translates it to herdr key presses (apps/bridge/src/hub.ts translateInput).

/** CSI forms: what shells and TUIs accept without tracking the app's cursor-key mode. */
export const KEY_DATA = {
  esc: "\x1b",
  tab: "\t",
  enter: "\r",
  backspace: "\x7f",
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
 * Fold sticky Ctrl/Alt into outgoing data. Like a physical keyboard, a
 * modifier acts on the first key only: Ctrl turns a letter into its control
 * byte (a non-letter passes through unchanged), Alt prefixes ESC. Escape
 * sequences (arrows, PgUp, ...) are not rewritten.
 */
export function applyModifiers(data: string, mods: Modifiers): string {
  if (data === "" || data.startsWith("\x1b")) return data;
  const [first = "", ...rest] = Array.from(data);
  let head = first;
  if (mods.ctrl) head = controlChar(first) ?? first;
  if (mods.alt) head = `\x1b${head}`;
  return head + rest.join("");
}

/**
 * Key presses owed after a drag of `totalPx` when `emitted` have been sent:
 * positive = to the right/down, negative = left/up. One press per `stepPx`.
 */
export function swipeSteps(totalPx: number, stepPx: number, emitted: number): number {
  return Math.trunc(totalPx / stepPx) - emitted;
}

/**
 * Insert an image path into a prompt draft at the caret, padded with spaces so
 * it stays a separate word. Mirrors insertPath in the web's lib/terminalKeys.ts.
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
