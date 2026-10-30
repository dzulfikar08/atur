import { describe, expect, test } from "bun:test";

import {
  charWidth,
  chunkSpan,
  isIconGlyph,
  paletteColor,
  parseRow,
  resolveColors,
  rowText,
  textCells,
  type TerminalPalette,
} from "./ansi";

const ESC = "\x1b";
const palette: TerminalPalette = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  ansi: [
    "#2e3436",
    "#cc0000",
    "#4e9a06",
    "#c4a000",
    "#3465a4",
    "#75507b",
    "#06989a",
    "#d3d7cf",
    "#555753",
    "#ef2929",
    "#8ae234",
    "#fce94f",
    "#729fcf",
    "#ad7fa8",
    "#34e2e2",
    "#eeeeec",
  ],
};

describe("parseRow", () => {
  test("plain text is one default span", () => {
    const row = parseRow("hello");
    expect(row.spans).toHaveLength(1);
    expect(row.spans[0]).toMatchObject({ text: "hello", fg: null, bg: null, cells: 5 });
    expect(row.cells).toBe(5);
    expect(row.needsGrid).toBe(false);
  });

  test("empty input yields no spans", () => {
    expect(parseRow("")).toEqual({ spans: [], cells: 0, needsGrid: false });
    expect(parseRow(`${ESC}[0m`).spans).toEqual([]);
  });

  test("bold, dim, italic, underline, inverse and their resets", () => {
    const row = parseRow(`${ESC}[1;3;4mA${ESC}[22mB${ESC}[23;24mC${ESC}[2;7mD${ESC}[0mE`);
    const [a, b, c, d, e] = row.spans;
    expect(a).toMatchObject({ text: "A", bold: true, italic: true, underline: true });
    expect(b).toMatchObject({ text: "B", bold: false, dim: false, italic: true, underline: true });
    expect(c).toMatchObject({ text: "C", italic: false, underline: false });
    expect(d).toMatchObject({ text: "D", dim: true, inverse: true });
    expect(e).toMatchObject({ text: "E", dim: false, inverse: false });
  });

  test("27 clears inverse; 22 clears both bold and dim", () => {
    const row = parseRow(`${ESC}[1;2;7mX${ESC}[22;27mY`);
    expect(row.spans[1]).toMatchObject({ bold: false, dim: false, inverse: false });
  });

  test("16 normal and bright colours, foreground and background", () => {
    const row = parseRow(`${ESC}[31mR${ESC}[92mG${ESC}[44mB${ESC}[103mY${ESC}[39;49mD`);
    expect(row.spans.map((s) => [s.fg, s.bg])).toEqual([
      [1, null],
      [10, null],
      [10, 4],
      [10, 11],
      [null, null],
    ]);
  });

  test("256-colour in semicolon form", () => {
    const row = parseRow(`${ESC}[38;5;208mO${ESC}[48;5;17mN`);
    expect(row.spans[0]).toMatchObject({ text: "O", fg: 208 });
    expect(row.spans[1]).toMatchObject({ text: "N", fg: 208, bg: 17 });
  });

  test("truecolor in semicolon form", () => {
    const row = parseRow(`${ESC}[38;2;31;37;45m${ESC}[48;2;15;18;22mX`);
    expect(row.spans[0]).toMatchObject({ fg: "#1f252d", bg: "#0f1216" });
  });

  test("the five-field form the bridge emits (0;38;2;r;g;b-style runs in one SGR)", () => {
    const row = parseRow(`${ESC}[0;1;38;2;255;128;0;48;5;4mX`);
    expect(row.spans[0]).toMatchObject({ bold: true, fg: "#ff8000", bg: 4 });
  });

  test("colon sub-parameters: 38:2::r:g:b, 38:2:r:g:b, 38:5:n, 4:3", () => {
    expect(parseRow(`${ESC}[38:2::10:20:30mX`).spans[0]?.fg).toBe("#0a141e");
    expect(parseRow(`${ESC}[48:2:1:2:3mX`).spans[0]?.bg).toBe("#010203");
    expect(parseRow(`${ESC}[38:5:99mX`).spans[0]?.fg).toBe(99);
    expect(parseRow(`${ESC}[4:3mX`).spans[0]?.underline).toBe(true);
    expect(parseRow(`${ESC}[4mX${ESC}[4:0mY`).spans[1]?.underline).toBe(false);
  });

  test("bare ESC[m resets; out-of-range 256 index is ignored", () => {
    expect(parseRow(`${ESC}[1mA${ESC}[mB`).spans[1]?.bold).toBe(false);
    expect(parseRow(`${ESC}[38;5;999mX`).spans[0]?.fg).toBeNull();
  });

  test("truncated extended colour does not throw", () => {
    expect(parseRow(`${ESC}[38;2;1mX`).spans[0]?.text).toBe("X");
    expect(parseRow(`${ESC}[38mX`).spans[0]?.text).toBe("X");
  });

  test("adjacent runs with identical style merge", () => {
    const row = parseRow(`${ESC}[31mab${ESC}[31mcd${ESC}[0m${ESC}[31mef`);
    expect(row.spans).toHaveLength(1);
    expect(row.spans[0]?.text).toBe("abcdef");
    expect(row.spans[0]?.cells).toBe(6);
  });

  test("non-SGR CSI sequences are consumed, not rendered", () => {
    const row = parseRow(`a${ESC}[2Kb${ESC}[10;20Hc${ESC}[?25ld${ESC}[1Ae`);
    expect(rowText(row)).toBe("abcde");
  });

  test("private-marker 'm' sequences are not SGR", () => {
    const row = parseRow(`${ESC}[>4;2mX`);
    expect(row.spans[0]).toMatchObject({ text: "X", underline: false });
  });

  test("OSC terminated by BEL or ST is dropped", () => {
    const row = parseRow(
      `a${ESC}]0;window title\x07b${ESC}]8;;https://x.test${ESC}\\link${ESC}]8;;${ESC}\\c`,
    );
    expect(rowText(row)).toBe("ablinkc");
  });

  test("unterminated OSC and truncated CSI swallow only the tail", () => {
    expect(rowText(parseRow(`ok${ESC}]0;never ends`))).toBe("ok");
    expect(rowText(parseRow(`ok${ESC}[38;5`))).toBe("ok");
    expect(rowText(parseRow(`ok${ESC}`))).toBe("ok");
  });

  test("charset designation and two-byte escapes are dropped", () => {
    expect(rowText(parseRow(`a${ESC}(Bb${ESC}7c${ESC}Md`))).toBe("abcd");
  });

  test("control characters are dropped, tab expands to the next stop", () => {
    expect(rowText(parseRow("a\rb\x07c\x00d"))).toBe("abcd");
    const row = parseRow("ab\tc");
    expect(rowText(row)).toBe("ab      c");
    expect(row.cells).toBe(9);
  });

  test("wide characters count two cells and flag the row", () => {
    const row = parseRow("a漢字b");
    expect(row.cells).toBe(6);
    expect(row.needsGrid).toBe(true);
    expect(row.spans[0]?.text).toBe("a漢字b");
  });

  test("astral emoji are kept whole, not split into surrogates", () => {
    const row = parseRow("x😀y");
    expect(rowText(row)).toBe("x😀y");
    expect(row.cells).toBe(4);
  });

  test("combining marks and variation selectors take no cell", () => {
    expect(parseRow("e\u0301").cells).toBe(1);
    expect(parseRow("\u2764\ufe0f").cells).toBe(1);
  });

  test("a real bridge row: reset, truecolor fg+bg runs, padding", () => {
    const line =
      `${ESC}[0m${ESC}[38;2;31;37;45m${ESC}[48;2;15;18;22m\u2502${ESC}[0m` +
      `${ESC}[48;2;15;18;22m   ${ESC}[0m${ESC}[38;2;0;180;255m${ESC}[48;2;15;18;22m- ${ESC}[0m`;
    const row = parseRow(line);
    expect(rowText(row)).toBe("\u2502   - ");
    expect(row.spans.map((s) => s.fg)).toEqual(["#1f252d", null, "#00b4ff"]);
    expect(row.cells).toBe(6);
  });
});

describe("cell width", () => {
  test("charWidth", () => {
    expect(charWidth("a".codePointAt(0)!)).toBe(1);
    expect(charWidth("\u2502".codePointAt(0)!)).toBe(1);
    expect(charWidth("日".codePointAt(0)!)).toBe(2);
    expect(charWidth("한".codePointAt(0)!)).toBe(2);
    expect(charWidth("😀".codePointAt(0)!)).toBe(2);
    expect(charWidth(0x200d)).toBe(0);
  });

  test("textCells", () => {
    expect(textCells("abc日本")).toBe(7);
  });
});

describe("colour resolution", () => {
  test("paletteColor: ANSI 16, colour cube, greyscale ramp", () => {
    expect(paletteColor(1, palette)).toBe("#cc0000");
    expect(paletteColor(15, palette)).toBe("#eeeeec");
    expect(paletteColor(16, palette)).toBe("#000000");
    expect(paletteColor(21, palette)).toBe("#0000ff");
    expect(paletteColor(196, palette)).toBe("#ff0000");
    expect(paletteColor(231, palette)).toBe("#ffffff");
    expect(paletteColor(232, palette)).toBe("#080808");
    expect(paletteColor(255, palette)).toBe("#eeeeee");
  });

  const base = parseRow("x").spans[0]!;

  test("defaults fall through to the palette foreground with no background", () => {
    expect(resolveColors(base, palette)).toEqual({ color: "#e5e5e5", backgroundColor: null });
  });

  test("indexed and truecolor values", () => {
    expect(resolveColors({ ...base, fg: 2, bg: "#112233" }, palette)).toEqual({
      color: "#4e9a06",
      backgroundColor: "#112233",
    });
  });

  test("bold promotes normal colours 0-7 to bright, leaves 256/truecolor alone", () => {
    expect(resolveColors({ ...base, fg: 1, bold: true }, palette).color).toBe("#ef2929");
    expect(resolveColors({ ...base, fg: 100, bold: true }, palette).color).toBe(
      paletteColor(100, palette),
    );
    expect(resolveColors({ ...base, fg: "#123456", bold: true }, palette).color).toBe("#123456");
  });

  test("inverse swaps, using palette defaults for unset sides", () => {
    expect(resolveColors({ ...base, inverse: true }, palette)).toEqual({
      color: "#0a0a0a",
      backgroundColor: "#e5e5e5",
    });
    expect(resolveColors({ ...base, fg: 1, bg: 4, inverse: true }, palette)).toEqual({
      color: "#3465a4",
      backgroundColor: "#cc0000",
    });
  });

  test("dim blends the foreground halfway into the background", () => {
    expect(resolveColors({ ...base, fg: "#ffffff", bg: "#000000", dim: true }, palette)).toEqual({
      color: "#808080",
      backgroundColor: "#000000",
    });
  });
});

describe("isIconGlyph", () => {
  test("private-use ranges only", () => {
    expect(isIconGlyph(0xe000)).toBe(true);
    expect(isIconGlyph(0xf8ff)).toBe(true);
    expect(isIconGlyph(0xf0000)).toBe(true);
    expect(isIconGlyph(0xdfff)).toBe(false);
    expect(isIconGlyph(0xf900)).toBe(false);
    expect(isIconGlyph(0x41)).toBe(false);
  });
});

describe("chunkSpan", () => {
  test("narrow runs stay together; each wide char is its own two-cell chunk", () => {
    const span = parseRow("ab漢字cd").spans[0]!;
    expect(chunkSpan(span)).toEqual([
      { text: "ab", cells: 2 },
      { text: "漢", cells: 2 },
      { text: "字", cells: 2 },
      { text: "cd", cells: 2 },
    ]);
  });

  test("zero-width marks join the preceding chunk", () => {
    const span = parseRow("e\u0301x").spans[0]!;
    expect(chunkSpan(span)).toEqual([{ text: "e\u0301x", cells: 2 }]);
  });

  test("Nerd Font icons are chunks of their own, taking one following space", () => {
    const span = parseRow("a\ue0b0 \udb80\udc00b").spans[0]!;
    expect(chunkSpan(span)).toEqual([
      { text: "a", cells: 1 },
      { text: "\ue0b0", cells: 2, icon: true },
      { text: "\u{f0000}", cells: 1, icon: true },
      { text: "b", cells: 1 },
    ]);
    expect(chunkSpan(parseRow("\uf013\uf09b ").spans[0]!)).toEqual([
      { text: "\uf013", cells: 1, icon: true },
      { text: "\uf09b", cells: 2, icon: true },
    ]);
  });

  test("a row with an icon needs the grid layout, a plain one does not", () => {
    expect(parseRow("x\uf013y").needsGrid).toBe(true);
    expect(parseRow("plain").needsGrid).toBe(false);
  });

  test("chunk cells add up to the span's cells", () => {
    const span = parseRow("a😀b漢").spans[0]!;
    expect(chunkSpan(span).reduce((n, c) => n + c.cells, 0)).toBe(span.cells);
  });
});
