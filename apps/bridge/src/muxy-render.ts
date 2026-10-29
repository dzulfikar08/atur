/** Muxy screen rows → ANSI text, and the herdr-style key / paste input that goes the other way. */
import { type KeyEvent, type MuxyRow, type MuxyStyle } from "./muxy-wire";

function colorParams(color: unknown, base: number): string[] {
  if (!color || typeof color !== "object") return [];
  if ("Indexed" in color && typeof color.Indexed === "number") {
    const n = color.Indexed;
    if (base !== 58 && n < 8) return [String(base + n)];
    if (base !== 58 && n < 16) return [String(base + 60 + n - 8)];
    return [`${base + (base === 58 ? 0 : 8)};5;${n}`];
  }
  if ("Rgb" in color && Array.isArray(color.Rgb) && color.Rgb.length === 3) {
    const [r, g, b] = color.Rgb as [number, number, number];
    return [`${base + (base === 58 ? 0 : 8)};2;${r};${g};${b}`];
  }
  return [];
}

const UNDERLINE_PARAMS: Record<string, string> = {
  Single: "4",
  Double: "4:2",
  Curly: "4:3",
  Dotted: "4:4",
  Dashed: "4:5",
};

/** SGR parameters for a run's style; empty for the default style. */
export function sgrParams(style: Partial<MuxyStyle>): string[] {
  const params: string[] = [];
  if (style.bold) params.push("1");
  if (style.faint) params.push("2");
  if (style.italic) params.push("3");
  const underline = style.underline ? UNDERLINE_PARAMS[style.underline] : undefined;
  if (underline) params.push(underline);
  if (style.inverse) params.push("7");
  if (style.invisible) params.push("8");
  if (style.strikethrough) params.push("9");
  if (style.overline) params.push("53");
  params.push(...colorParams(style.fg, 30), ...colorParams(style.bg, 40));
  if (underline) params.push(...colorParams(style.underline_color, 58));
  return params;
}

/**
 * One screen row as ANSI, self-contained: it ends with a reset when styled.
 * Muxy splits rows into many runs of the same style (box drawing comes one
 * cell per run), so an SGR is only written when the style changes.
 */
export function renderRow(row: MuxyRow): string {
  let out = "";
  let current = "";
  for (const run of row.runs) {
    const sgr = sgrParams(run.style).join(";");
    if (sgr !== current) {
      out += sgr === "" ? "\x1b[0m" : `\x1b[0;${sgr}m`;
      current = sgr;
    }
    out += run.text;
  }
  return current === "" ? out : `${out}\x1b[0m`;
}

/** Rows in screen order with gaps filled, `height` rows when the size is known. */
export function renderRows(rows: readonly MuxyRow[], height?: number): string[] {
  const byIndex = new Map(rows.map((r) => [r.index, r]));
  const count = height ?? (rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.index)) + 1);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = byIndex.get(i);
    out.push(row ? renderRow(row) : "");
  }
  return out;
}

// ── Input ─────────────────────────────────────────────────────────────────

const SHIFT = 1;
const MODIFIERS: Record<string, number> = { shift: SHIFT, alt: 2, ctrl: 4, super: 8 };

/** herdr key names that Muxy names differently. */
const KEY_ALIASES: Record<string, string> = { esc: "escape", return: "enter" };

/** Key names the Muxy server's key encoder knows (single characters aside). */
const NAMED_KEYS = new Set([
  "enter",
  "tab",
  "space",
  "backspace",
  "escape",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 25 }, (_, i) => `f${i + 1}`),
]);

/**
 * herdr key name ("enter", "ctrl+c", "shift+tab", "alt+x", "f5", "a") → the
 * key event the Muxy server encodes with the terminal's own modes (application
 * cursor keys, kitty keyboard protocol, ...). Unknown keys throw.
 */
export function muxyKeyEvent(name: string): KeyEvent {
  let rest = name.toLowerCase();
  let modifiers = 0;
  for (;;) {
    const m = /^(shift|alt|ctrl|super)\+(.+)$/.exec(rest);
    if (!m) break;
    modifiers |= MODIFIERS[m[1] as string] as number;
    rest = m[2] as string;
  }
  const key = KEY_ALIASES[rest] ?? rest;
  const printable = [...key].length === 1 && !/[\p{Cc}\p{Cf}\u{f700}-\u{f8ff}]/u.test(key);
  if (!NAMED_KEYS.has(key) && !printable) throw new Error(`atur-term: unsupported key "${name}"`);
  const plain = (modifiers & ~SHIFT) === 0; // shift alone still types the character
  let text = "";
  if (plain && printable) text = modifiers & SHIFT ? key.toUpperCase() : key;
  else if (plain && key === "space") text = " ";
  const codepoint = printable ? (key.codePointAt(0) as number) : key === "space" ? 0x20 : 0;
  return { key, modifiers, text, unshiftedCodepoint: codepoint };
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
/** Characters per paste frame: far below the server's 1 MiB input limit even at 4 bytes each. */
const PASTE_CHUNK = 100_000;

/**
 * Literal text → paste payloads. Paste markers inside the text are removed
 * until none is left (a nested marker reappears after one pass), so the text
 * can neither open a paste nor end one early. Chunks split on code points,
 * never inside a surrogate pair.
 */
export function pasteChunks(text: string, chunk: number = PASTE_CHUNK): string[] {
  let clean = text;
  for (let prev = ""; prev !== clean;) {
    prev = clean;
    clean = clean.split(PASTE_END).join("").split(PASTE_START).join("");
  }
  const points = Array.from(clean);
  const out: string[] = [];
  for (let i = 0; i < points.length; i += chunk) out.push(points.slice(i, i + chunk).join(""));
  return out;
}
