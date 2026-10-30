// One terminal row of ANSI text -> styled spans. The bridge sends each visible
// row on its own, self-contained (it opens with a reset), so there is no state
// to carry between rows. Only SGR (CSI ... m) changes the style; every other
// escape sequence is consumed and dropped so it can never leak into the text.

/** `number` = palette index 0..255; `string` = `#rrggbb`; `null` = default. */
export type AnsiColor = number | string | null;

export interface SpanStyle {
  fg: AnsiColor;
  bg: AnsiColor;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface Span extends SpanStyle {
  text: string;
  /** Terminal cells the text occupies (wide chars count 2, combining marks 0). */
  cells: number;
}

export interface ParsedRow {
  spans: Span[];
  /** Total cells across all spans. */
  cells: number;
  /** True when any span holds a double-width character or an icon glyph: the row needs per-cell layout. */
  needsGrid: boolean;
}

const DEFAULT_STYLE: SpanStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

// --- Cell width ------------------------------------------------------------

/**
 * Approximate wcwidth: 0 for combining marks / joiners / variation selectors,
 * 2 for East Asian wide and emoji blocks, 1 otherwise. Not a full Unicode
 * table; it only has to keep columns lined up for common CJK and emoji.
 */
export function charWidth(cp: number): number {
  if (cp < 0x300) return 1;
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/**
 * Private-use code points: where Nerd Font icons live (U+E000-U+F8FF and the supplementary
 * planes from U+F0000). No text font has them; the symbols font draws them.
 */
export function isIconGlyph(cp: number): boolean {
  return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
}

/** Cells a string occupies. */
export function textCells(text: string): number {
  let cells = 0;
  for (const ch of text) cells += charWidth(ch.codePointAt(0) ?? 0);
  return cells;
}

// --- SGR -------------------------------------------------------------------

const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
const rgb = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/**
 * Apply one SGR parameter list to `style` in place. Semicolon form
 * (`38;2;r;g;b`) and colon form (`38:2::r:g:b`, `38:5:n`) are both understood.
 */
function applySgr(style: SpanStyle, params: string): void {
  const parts = params === "" ? ["0"] : params.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.includes(":")) {
      applyColonSgr(style, part.split(":"));
      continue;
    }
    const code = part === "" ? 0 : Number(part);
    if (!Number.isInteger(code)) continue;
    if (code === 38 || code === 48) {
      const mode = Number(parts[i + 1]);
      let color: AnsiColor = null;
      if (mode === 5) {
        const n = Number(parts[i + 2]);
        if (Number.isInteger(n) && n >= 0 && n <= 255) color = n;
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [Number(parts[i + 2]), Number(parts[i + 3]), Number(parts[i + 4])];
        if ([r, g, b].every((v) => Number.isInteger(v))) color = rgb(r!, g!, b!);
        i += 4;
      } else {
        // Unknown extended-colour mode: its arguments are unknowable; stop here.
        return;
      }
      if (color !== null) {
        if (code === 38) style.fg = color;
        else style.bg = color;
      }
      continue;
    }
    applySimpleSgr(style, code);
  }
}

function applyColonSgr(style: SpanStyle, sub: string[]): void {
  const code = Number(sub[0]);
  if (code === 4) {
    // 4:0 = no underline; any other style (single, double, curly, ...) underlines.
    style.underline = Number(sub[1] ?? 1) !== 0;
    return;
  }
  if (code !== 38 && code !== 48) return;
  let color: AnsiColor = null;
  if (Number(sub[1]) === 5) {
    const n = Number(sub[2]);
    if (Number.isInteger(n) && n >= 0 && n <= 255) color = n;
  } else if (Number(sub[1]) === 2) {
    // 38:2:<colourspace>:r:g:b, with the colourspace id often left empty; the
    // last three fields are always r, g, b.
    const [r, g, b] = sub.slice(-3).map(Number);
    if ([r, g, b].every((v) => Number.isInteger(v))) color = rgb(r!, g!, b!);
  }
  if (color === null) return;
  if (code === 38) style.fg = color;
  else style.bg = color;
}

function applySimpleSgr(style: SpanStyle, code: number): void {
  switch (code) {
    case 0:
      Object.assign(style, DEFAULT_STYLE);
      return;
    case 1:
      style.bold = true;
      return;
    case 2:
      style.dim = true;
      return;
    case 3:
      style.italic = true;
      return;
    case 4:
    case 21:
      style.underline = true;
      return;
    case 7:
      style.inverse = true;
      return;
    case 22:
      style.bold = false;
      style.dim = false;
      return;
    case 23:
      style.italic = false;
      return;
    case 24:
      style.underline = false;
      return;
    case 27:
      style.inverse = false;
      return;
    case 39:
      style.fg = null;
      return;
    case 49:
      style.bg = null;
      return;
  }
  if (code >= 30 && code <= 37) style.fg = code - 30;
  else if (code >= 40 && code <= 47) style.bg = code - 40;
  else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
  else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
  // Everything else (blink, conceal, strike, fonts, ...) is not rendered.
}

// --- Row parser ------------------------------------------------------------

/** Parse one row. Never throws; malformed or truncated escapes are dropped. */
export function parseRow(input: string): ParsedRow {
  const spans: Span[] = [];
  const style: SpanStyle = { ...DEFAULT_STYLE };
  let text = "";
  let textCellCount = 0;
  let cells = 0;
  let needsGrid = false;
  let column = 0;

  const flush = () => {
    if (text === "") return;
    const last = spans[spans.length - 1];
    if (last && sameStyle(last, style)) {
      last.text += text;
      last.cells += textCellCount;
    } else {
      spans.push({ ...style, text, cells: textCellCount });
    }
    cells += textCellCount;
    text = "";
    textCellCount = 0;
  };

  const emit = (ch: string, width: number) => {
    if (width === 2 || isIconGlyph(ch.codePointAt(0) ?? 0)) needsGrid = true;
    text += ch;
    textCellCount += width;
    column += width;
  };

  let i = 0;
  while (i < input.length) {
    const c = input.charCodeAt(i);
    if (c === 0x1b) {
      const next = input[i + 1];
      if (next === "[") {
        // CSI: parameters/intermediates up to a final byte 0x40..0x7e.
        let j = i + 2;
        while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x3f) j++;
        if (j >= input.length) break; // truncated: drop the tail
        const final = input[j];
        if (final === "m") {
          const params = input.slice(i + 2, j);
          // Private-marker forms (CSI ? ... m, CSI > ... m) are not SGR.
          if (/^[0-9;:]*$/.test(params)) {
            flush();
            applySgr(style, params);
          }
        }
        i = j + 1;
      } else if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
        // OSC / DCS / APC / PM / SOS: string terminated by BEL or ST (ESC \).
        let j = i + 2;
        while (j < input.length) {
          if (input[j] === "\x07") {
            j += 1;
            break;
          }
          if (input[j] === "\x1b" && input[j + 1] === "\\") {
            j += 2;
            break;
          }
          j++;
        }
        i = j;
      } else if (next !== undefined && next >= " " && next <= "/") {
        // nF escape (charset designation etc.): intermediates then one final byte.
        let j = i + 2;
        while (j < input.length && input[j]! >= " " && input[j]! <= "/") j++;
        i = j + 1;
      } else {
        // Two-byte escape (ESC 7, ESC M, ...), or a lone trailing ESC.
        i += 2;
      }
      continue;
    }
    if (c === 0x09) {
      const stop = 8 - (column % 8);
      emit(" ".repeat(stop), stop);
      i += 1;
      continue;
    }
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0)) {
      i += 1; // C0/C1 controls (CR, BEL, ...) carry no glyph here
      continue;
    }
    const cp = input.codePointAt(i) ?? c;
    const ch = String.fromCodePoint(cp);
    emit(ch, charWidth(cp));
    i += ch.length;
  }
  flush();
  return { spans, cells, needsGrid };
}

function sameStyle(a: SpanStyle, b: SpanStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

/** Plain text of a row (no styling), e.g. for copy and URL detection. */
export function rowText(row: ParsedRow): string {
  let out = "";
  for (const span of row.spans) out += span.text;
  return out;
}

/** A run of a span laid out on the cell grid. */
export interface CellChunk {
  text: string;
  cells: number;
  /** One icon glyph, drawn with the symbols font; `cells` is 2 when it took the space after it. */
  icon?: true;
}

/**
 * Split a span into chunks that each own a fixed number of cells: runs of
 * single-width characters stay together, every double-width character stands
 * alone, every icon glyph stands alone in the symbols font, and zero-width marks join the
 * character before them. An icon is a full em wide, nearly two cells: one followed by a space takes
 * that space (two cells), as kitty and WezTerm do, so the glyph is drawn whole. Rendering each
 * chunk at `cells * cellWidth` keeps columns aligned even though a fallback
 * font's CJK/emoji glyph is not exactly two monospace cells wide.
 */
export function chunkSpan(span: Span): CellChunk[] {
  const chunks: CellChunk[] = [];
  let run: CellChunk | null = null;
  let chunkAfterIcon: CellChunk | null = null;
  for (const ch of span.text) {
    const cp = ch.codePointAt(0) ?? 0;
    const width = charWidth(cp);
    if (chunkAfterIcon && ch === " ") {
      chunkAfterIcon.cells = 2;
      chunkAfterIcon = null;
      run = null;
      continue;
    }
    chunkAfterIcon = null;
    if (isIconGlyph(cp)) {
      run = null;
      chunkAfterIcon = { text: ch, cells: 1, icon: true };
      chunks.push(chunkAfterIcon);
      continue;
    }
    if (width === 0) {
      const last = chunks[chunks.length - 1];
      if (last) last.text += ch;
      else chunks.push({ text: ch, cells: 0 });
      continue;
    }
    if (width === 2) {
      run = null;
      chunks.push({ text: ch, cells: 2 });
      continue;
    }
    if (!run) {
      run = { text: "", cells: 0 };
      chunks.push(run);
    }
    run.text += ch;
    run.cells += width;
  }
  return chunks;
}

// --- Colour resolution -----------------------------------------------------

export interface TerminalPalette {
  background: string;
  foreground: string;
  /** The 16 ANSI colours: 0-7 normal, 8-15 bright. */
  ansi: readonly string[];
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** Hex for palette index 0..255: 0-15 from the palette, 16-231 colour cube, 232-255 greys. */
export function paletteColor(index: number, palette: TerminalPalette): string {
  if (index < 16) return palette.ansi[index] ?? palette.foreground;
  if (index < 232) {
    const n = index - 16;
    return rgb(
      CUBE_LEVELS[Math.floor(n / 36)] ?? 0,
      CUBE_LEVELS[Math.floor(n / 6) % 6] ?? 0,
      CUBE_LEVELS[n % 6] ?? 0,
    );
  }
  const level = 8 + (index - 232) * 10;
  return rgb(level, level, level);
}

export interface ResolvedColors {
  color: string;
  /** Null when the span paints no background of its own (the default one). */
  backgroundColor: string | null;
}

/**
 * Final foreground/background for a span: palette lookup, bold promoting the
 * 8 normal colours to bright (as xterm.js does for its default theme), then
 * inverse. Dim blends the foreground towards the background.
 */
export function resolveColors(style: SpanStyle, palette: TerminalPalette): ResolvedColors {
  const fgIndex =
    typeof style.fg === "number" && style.bold && style.fg < 8 ? style.fg + 8 : style.fg;
  let fg =
    fgIndex === null
      ? palette.foreground
      : typeof fgIndex === "number"
        ? paletteColor(fgIndex, palette)
        : fgIndex;
  let bg: string | null =
    style.bg === null
      ? null
      : typeof style.bg === "number"
        ? paletteColor(style.bg, palette)
        : style.bg;
  if (style.inverse) {
    const swappedBg = fg;
    fg = bg ?? palette.background;
    bg = swappedBg;
  }
  if (style.dim) fg = blend(fg, bg ?? palette.background, 0.5);
  return { color: fg, backgroundColor: bg };
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

/** `amount` of `a` mixed with the rest of `b`; non-hex input returns `a` unchanged. */
function blend(a: string, b: string, amount: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const mix = (x: number, y: number) => Math.round(x * amount + y * (1 - amount));
  return rgb(mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2]));
}
