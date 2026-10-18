import { describe, expect, test } from "bun:test";

import { findLinks, linkAtCell } from "./terminal-links";
import { TerminalScreen, type ScreenFrame } from "./terminal-screen";

describe("TerminalScreen", () => {
  test("snapshot splits the visible grid on CRLF", () => {
    const screen = new TerminalScreen();
    screen.hello(100, 3);
    screen.snapshot("one\r\ntwo\r\nthree");
    expect(screen.getState()).toEqual({ cols: 100, rows: 3, lines: ["one", "two", "three"] });
  });

  test("diff replaces rows by index and leaves the others", () => {
    const screen = new TerminalScreen();
    screen.snapshot("a\r\nb\r\nc");
    screen.diff([
      [1, "B"],
      [2, "C"],
    ]);
    expect(screen.getState().lines).toEqual(["a", "B", "C"]);
  });

  test("diff past the end pads with empty rows; absurd indices are ignored", () => {
    const screen = new TerminalScreen();
    screen.snapshot("a");
    screen.diff([
      [3, "d"],
      [-1, "x"],
      [1.5, "x"],
      [5000, "x"],
    ]);
    expect(screen.getState().lines).toEqual(["a", "", "", "d"]);
  });

  test("an unchanged diff keeps the same state object and does not notify", () => {
    const screen = new TerminalScreen();
    screen.snapshot("a\r\nb");
    const before = screen.getState();
    let notified = 0;
    screen.subscribe(() => notified++);
    screen.diff([[0, "a"]]);
    expect(screen.getState()).toBe(before);
    expect(notified).toBe(0);
  });

  test("state subscribers fire per change and can unsubscribe", () => {
    const screen = new TerminalScreen();
    let notified = 0;
    const off = screen.subscribe(() => notified++);
    screen.hello(80, 24);
    screen.snapshot("x");
    expect(notified).toBe(2);
    off();
    screen.diff([[0, "y"]]);
    expect(notified).toBe(2);
  });

  test("a later snapshot with fewer rows shrinks the grid", () => {
    const screen = new TerminalScreen();
    screen.snapshot("a\r\nb\r\nc");
    screen.snapshot("z");
    expect(screen.getState().lines).toEqual(["z"]);
  });

  test("replay rebuilds a late-mounting renderer: hello then the full snapshot", () => {
    const screen = new TerminalScreen();
    expect(screen.replay()).toEqual([]);
    screen.hello(120, 2);
    screen.snapshot("a\r\nb");
    screen.diff([[1, "B"]]);
    expect(screen.replay()).toEqual([
      { t: "hello", cols: 120, rows: 2 },
      { t: "snapshot", ansi: "a\r\nB" },
    ]);
  });

  test("frame subscribers get the live vocabulary the WebView page understands", () => {
    const screen = new TerminalScreen();
    const seen: ScreenFrame[] = [];
    const off = screen.subscribeFrames((f) => seen.push(f));
    screen.hello(10, 2);
    screen.snapshot("a\r\nb");
    screen.diff([[0, "A"]]);
    off();
    screen.diff([[1, "B"]]);
    expect(seen).toEqual([
      { t: "hello", cols: 10, rows: 2 },
      { t: "snapshot", ansi: "a\r\nb" },
      { t: "diff", rows: [[0, "A"]] },
    ]);
  });
});

describe("links", () => {
  test("finds http and https URLs and trims sentence punctuation", () => {
    expect(
      findLinks("see https://example.com/a. and (http://b.test/x), ok").map((l) => l.url),
    ).toEqual(["https://example.com/a", "http://b.test/x"]);
  });

  test("keeps a balanced closing parenthesis inside the URL", () => {
    expect(findLinks("https://en.wikipedia.org/wiki/Foo_(bar)").map((l) => l.url)).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  test("ignores a bare scheme", () => {
    expect(findLinks("https:// nothing")).toEqual([]);
  });

  test("linkAtCell resolves a touched column to the URL under it", () => {
    const text = "run https://x.test/ok now";
    expect(linkAtCell(text, 3)).toBeNull();
    expect(linkAtCell(text, 4)).toBe("https://x.test/ok");
    expect(linkAtCell(text, 20)).toBe("https://x.test/ok");
    expect(linkAtCell(text, 21)).toBeNull();
    expect(linkAtCell(text, 400)).toBeNull();
    expect(linkAtCell(text, -1)).toBeNull();
  });

  test("linkAtCell accounts for wide characters before the URL", () => {
    // "日本" occupies columns 0-3, the space is column 4, the URL starts at column 5.
    const text = "日本 https://x.test/w";
    expect(linkAtCell(text, 4)).toBeNull();
    expect(linkAtCell(text, 5)).toBe("https://x.test/w");
  });
});
