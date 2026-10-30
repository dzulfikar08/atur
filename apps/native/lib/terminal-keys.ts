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

/** Ctrl chords on keys whose character is not in @A-Z[\\]^_ but which terminals still map. */
const CTRL_ALIASES: Readonly<Record<string, string>> = {
  " ": "\x00",
  "2": "\x00",
  "6": "\x1e",
  "-": "\x1f",
  "/": "\x1f",
};

/** A key press as a hardware keyboard reports it: the key's base character plus held modifiers. */
export interface KeyChord {
  /**
   * One character ("a", "[", " "), "Backspace", or a navigation key: ArrowUp/Down/Left/Right,
   * Escape, Tab, Home, End, PageUp, PageDown, Delete (iOS reports these; Android's text field
   * already handles them).
   */
  key: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  /** Reported by iOS only; matters for navigation keys (Shift+Tab, Shift+Arrow). */
  shift?: boolean;
}

/** xterm names for the CSI navigation keys: final byte, or the number of a `CSI n ~` key. */
const CSI_KEYS: Readonly<Record<string, { final: string } | { code: number }>> = {
  ArrowUp: { final: "A" },
  ArrowDown: { final: "B" },
  ArrowRight: { final: "C" },
  ArrowLeft: { final: "D" },
  Home: { final: "H" },
  End: { final: "F" },
  Delete: { code: 3 },
  PageUp: { code: 5 },
  PageDown: { code: 6 },
};

/** A navigation key, with xterm's modifier parameter (1 + Shift + 2 Alt/Meta + 4 Ctrl) when modified. */
function encodeNavigation({ key, ctrl, alt, meta, shift }: KeyChord): string | null {
  const param = 1 + (shift ? 1 : 0) + (alt || meta ? 2 : 0) + (ctrl ? 4 : 0);
  if (key === "Escape") return alt || meta ? "\x1b\x1b" : KEY_DATA.esc;
  if (key === "Tab") {
    if (ctrl) return null;
    if (shift) return "\x1b[Z";
    return alt || meta ? `\x1b${KEY_DATA.tab}` : KEY_DATA.tab;
  }
  const csi = CSI_KEYS[key];
  if (!csi) return null;
  if ("final" in csi) return param === 1 ? `\x1b[${csi.final}` : `\x1b[1;${param}${csi.final}`;
  return param === 1 ? `\x1b[${csi.code}~` : `\x1b[${csi.code};${param}~`;
}

/**
 * The bytes a terminal sends for a chord with Ctrl, Alt or Meta held, or a navigation key: Ctrl turns the key into
 * its control byte (^A..^Z, ^[, ^\\, ^], ^^, ^_), Alt and Meta prefix ESC. Null when the chord has
 * no terminal form (Ctrl+5), so nothing is sent.
 */
export function encodeChord(chord: KeyChord): string | null {
  const { key, ctrl, alt, meta } = chord;
  if (key in CSI_KEYS || key === "Escape" || key === "Tab") return encodeNavigation(chord);
  let base: string | null;
  if (key === "Backspace") base = ctrl ? "\x08" : KEY_DATA.backspace;
  else if (Array.from(key).length !== 1) return null;
  else if (ctrl) base = controlChar(key) ?? CTRL_ALIASES[key] ?? null;
  else base = key;
  if (base === null) return null;
  return alt || meta ? `\x1b${base}` : base;
}

/** The result of a line-editing key on a draft: the new text and where the caret is. */
export interface DraftEdit {
  text: string;
  caret: number;
}

/**
 * Ctrl+<letter> on the prompt draft, as a terminal's line editor (readline) does it: A/E caret to
 * the start/end of the current line, B/F caret left/right, U/K delete to the line start/end, W
 * delete the previous word. `caret` is the caret offset. Null when the key is not an editing key
 * (it belongs to the terminal: Ctrl+C, Ctrl+D, ...) or the draft is empty (nothing to edit, so
 * even A/E/U... reach the terminal).
 */
export function editDraft(text: string, caret: number, key: string): DraftEdit | null {
  if (text === "") return null;
  const at = Math.max(0, Math.min(caret, text.length));
  const lineStart = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  const found = text.indexOf("\n", at);
  const lineEnd = found === -1 ? text.length : found;
  const cut = (from: number, to: number): DraftEdit => ({
    text: text.slice(0, from) + text.slice(to),
    caret: from,
  });
  switch (key.toLowerCase()) {
    case "a":
      return { text, caret: lineStart };
    case "e":
      return { text, caret: lineEnd };
    case "b":
      return { text, caret: Math.max(0, at - 1) };
    case "f":
      return { text, caret: Math.min(text.length, at + 1) };
    case "u":
      return cut(lineStart, at);
    case "k":
      return cut(at, lineEnd);
    case "w": {
      let start = at;
      while (start > 0 && /\s/.test(text[start - 1]!)) start--;
      while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
      return cut(start, at);
    }
    default:
      return null;
  }
}

/**
 * What a text field gained between two values when the change is a pure insertion
 * (nothing deleted or replaced); null for any other edit.
 */
export function insertedText(prev: string, next: string): string | null {
  if (next.length <= prev.length) return null;
  let start = 0;
  while (start < prev.length && prev[start] === next[start]) start++;
  let tail = 0;
  while (
    tail < prev.length - start &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }
  return start + tail === prev.length ? next.slice(start, next.length - tail) : null;
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
  return {
    text: before + inserted + after,
    caret: before.length + inserted.length,
  };
}
