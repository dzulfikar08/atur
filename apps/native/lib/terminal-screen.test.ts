import { describe, expect, test } from "bun:test";

import { findLinks, linkAtCell } from "./terminal-links";
import {
  HISTORY_FULL_LINES,
  HISTORY_MAX_LINES,
  HISTORY_OLDER_STEP,
  HISTORY_TOP_UP_LINES,
  nextPrompt,
  previousPrompt,
  rowsAfter,
  rowsBefore,
  TerminalScreen,
  type ScreenFrame,
} from "./terminal-screen";

describe("TerminalScreen", () => {
  test("snapshot splits the visible grid on CRLF", () => {
    const screen = new TerminalScreen();
    screen.hello(100, 3);
    screen.snapshot("one\r\ntwo\r\nthree");
    expect(screen.getState()).toEqual({
      cols: 100,
      rows: 3,
      lines: ["one", "two", "three"],
      history: [],
      historyBase: 0,
      prompts: [],
      historyReplies: 0,
    });
  });
});

/** A screen wired to a fake bridge that records the line counts it is asked for. */
function wired(grid: string) {
  const screen = new TerminalScreen();
  const asked: number[] = [];
  screen.hello(80, 38);
  screen.snapshot(grid);
  screen.setHistorySource((lines) => asked.push(lines));
  return { screen, asked };
}

describe("scrollback", () => {
  test("cuts exactly the visible rows the bridge reports, not the grid height", () => {
    // herdr trims trailing blank rows: a 38-row pane reads back as 2 rows.
    const { screen } = wired("live1\r\nlive2");
    screen.loadHistory("full");
    screen.setHistory(["old1", "old2", "old3", "live1", "live2"], 2);
    expect(screen.getState().history).toEqual(["old1", "old2", "old3"]);
  });

  test("an older bridge without the count: the live row count stands in", () => {
    const { screen } = wired("live1\r\nlive2");
    screen.loadHistory("full");
    screen.setHistory(["old1", "old2", "live1", "live2"]);
    expect(screen.getState().history).toEqual(["old1", "old2"]);
  });

  test("a top-up appends only new rows; loaded rows keep their identity", () => {
    const { screen, asked } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "r3", "now"], 1);
    const before = screen.getState();

    screen.loadHistory("top-up");
    expect(asked).toEqual([HISTORY_FULL_LINES, HISTORY_TOP_UP_LINES]);
    // The window reaches back past what is loaded (a top-up asks for far more
    // rows than arrive between refreshes).
    screen.setHistory(["r0", "r1", "r2", "r3", "r4", "r5", "now"], 1);
    const after = screen.getState();
    expect(after.history).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(after.historyBase).toBe(before.historyBase);
  });

  test("a top-up that no longer reaches what is loaded asks for the full window", () => {
    const { screen, asked } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "now"], 1);
    screen.loadHistory("top-up");
    // A full top-up window with none of r1, r2 in it: rows were missed in between.
    const window = Array.from({ length: HISTORY_TOP_UP_LINES - 1 }, (_, i) => `x${i}`);
    screen.setHistory([...window, "now"], 1);
    expect(screen.getState().history).toEqual(["r1", "r2"]);
    expect(asked.at(-1)).toBe(HISTORY_FULL_LINES);

    screen.setHistory(["r1", "r2", "gap", ...window, "now"], 1);
    expect(screen.getState().history).toEqual(["r1", "r2", "gap", ...window]);
  });

  test("replace (the pane reflowed) discards the loaded rows with fresh identities", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["long line wrapped", "now"], 1);
    const base = screen.getState().historyBase;
    screen.loadHistory("replace");
    screen.setHistory(["long line", "wrapped", "now"], 1);
    expect(screen.getState().history).toEqual(["long line", "wrapped"]);
    expect(screen.getState().historyBase).not.toBe(base);
  });

  test("one request in flight; a stronger one asked meanwhile follows the reply", () => {
    const { screen, asked } = wired("now");
    screen.loadHistory("full");
    screen.loadHistory("replace");
    expect(asked).toEqual([HISTORY_FULL_LINES]);
    screen.setHistory(["a", "now"], 1);
    expect(asked).toEqual([HISTORY_FULL_LINES, HISTORY_FULL_LINES]);
  });

  test("rowsAfter places the read after the latest match of the loaded tail", () => {
    expect(rowsAfter(["x", "y"], ["x", "y", "z", "x", "y", "w"])).toEqual(["w"]);
    expect(rowsAfter(["x", "y"], ["p", "q"])).toBeNull();
    expect(rowsAfter([], ["p"])).toBeNull();
  });

  test("rowsAfter from the start takes the earliest match: blank rows could match anywhere", () => {
    const incoming = ["a", "", "", "b", "", "", "c"];
    expect(rowsAfter(["", ""], incoming)).toEqual(["c"]);
    expect(rowsAfter(["", ""], incoming, true)).toEqual(["b", "", "", "c"]);
  });

  test("rowsBefore finds where the loaded rows sit inside a longer, later window", () => {
    expect(rowsBefore(["c", "d"], ["a", "b", "c", "d", "e"])).toBe(2);
    expect(rowsBefore(["c", "d"], ["c", "d"])).toBe(0);
    // Loaded rows longer than the match length: the first and the last rows must both line up.
    const loaded = Array.from({ length: 100 }, (_, i) => `r${i}`);
    expect(rowsBefore(loaded, ["old1", "old2", ...loaded, "new1"])).toBe(2);
    // A rewritten row among the first or the last ones is noticed; rows between are not compared.
    expect(rowsBefore(loaded, [...loaded.slice(0, 5), "other", ...loaded.slice(6)])).toBeNull();
    // The window does not reach back to them, or they are gone.
    expect(rowsBefore(["c", "d"], ["d", "e"])).toBeNull();
    expect(rowsBefore(["c", "d"], ["x"])).toBeNull();
    expect(rowsBefore([], ["x"])).toBeNull();
  });
});

/** `n` numbered scrollback rows, row `from` first. */
function rowsNumbered(from: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `row${from + i}`);
}

describe("paged scrollback", () => {
  /** A screen whose first read (`HISTORY_FULL_LINES`) is the newest rows 1500..2499 plus the grid. */
  function loaded() {
    const { screen, asked } = wired("g1\r\ng2");
    screen.loadHistory("full");
    screen.setHistory([...rowsNumbered(1500, 998), "g1", "g2"], 2);
    return { screen, asked };
  }

  test("loadOlder reads a longer window and puts the older rows above, keeping identities", () => {
    const { screen, asked } = loaded();
    const before = screen.getState();
    expect(before.history).toHaveLength(998);
    // The pane has more than it was asked for, so the first read does not say "start reached".
    screen.loadOlder();
    expect(asked.at(-1)).toBe(998 + 2 + Math.max(HISTORY_OLDER_STEP, 998));

    // Rows 1500..2497 are loaded; meanwhile 2 more scrolled into the scrollback (up to row 2499).
    const window = [...rowsNumbered(500, 2000), "g1", "g2"];
    screen.setHistory(window, 2);
    const after = screen.getState();
    expect(after.history).toEqual(rowsNumbered(500, 2000));
    // row1500 was history[0] under key base; it still is, at index 1000 of the new history.
    expect(after.history[1000]).toBe("row1500");
    expect(after.historyBase + 1000).toBe(before.historyBase);
  });

  test("loadOlder stops once a read comes back shorter than asked: the start is loaded", () => {
    const { screen, asked } = loaded();
    screen.loadOlder();
    const asking = asked.at(-1)!;
    // The pane only has 1200 rows altogether.
    screen.setHistory([...rowsNumbered(1300, 1198), "g1", "g2"], 2);
    expect(asking).toBeGreaterThan(1200);
    const count = asked.length;
    screen.loadOlder();
    screen.loadOlder();
    expect(asked).toHaveLength(count);
  });

  test("loadOlder never asks for more than the cap, and not at all once it is loaded", () => {
    const { screen, asked } = wired("g");
    screen.loadHistory("full");
    // Cap-sized read: every row it asked for came back.
    screen.setHistory([...rowsNumbered(0, HISTORY_FULL_LINES - 1), "g"], 1);
    for (let i = 0; i < 12; i++) {
      screen.loadOlder();
      const asking = asked.at(-1)!;
      expect(asking).toBeLessThanOrEqual(HISTORY_MAX_LINES);
      screen.setHistory([...rowsNumbered(0, asking - 1), "g"], 1);
    }
    const count = asked.length;
    screen.loadOlder();
    expect(asked).toHaveLength(count);
    expect(asked.at(-1)).toBe(HISTORY_MAX_LINES);
  });

  test("one older read at a time; asking again meanwhile waits for the reply", () => {
    const { screen, asked } = loaded();
    screen.loadOlder();
    screen.loadOlder();
    screen.loadOlder();
    expect(asked).toHaveLength(2);
  });

  test("an older read that cannot be placed replaces the rows with fresh identities", () => {
    const { screen } = loaded();
    const before = screen.getState();
    screen.loadOlder();
    // The scrollback was rewritten (cleared and printed again): none of the loaded rows is in it.
    screen.setHistory([...rowsNumbered(9000, 3000), "g1", "g2"], 2);
    const after = screen.getState();
    expect(after.history).toHaveLength(3000);
    expect(after.historyBase).toBeGreaterThan(before.historyBase + before.history.length);
  });

  test("a top-up after older rows came in appends below them", () => {
    const { screen, asked } = loaded();
    screen.loadOlder();
    screen.setHistory([...rowsNumbered(500, 2000), "g1", "g2"], 2);
    const base = screen.getState().historyBase;
    screen.loadHistory("top-up");
    expect(asked.at(-1)).toBe(HISTORY_TOP_UP_LINES);
    // Three rows more scrolled off since: rows 2500..2502.
    screen.setHistory([...rowsNumbered(2105, 398), "g1", "g2"], 2);
    const after = screen.getState();
    expect(after.history).toHaveLength(2003);
    expect(after.history.at(-1)).toBe("row2502");
    expect(after.historyBase).toBe(base);
  });

  test("a failed read frees the slot", () => {
    const { screen, asked } = loaded();
    screen.loadOlder();
    expect(asked).toHaveLength(2);
    screen.historyFailed();
    screen.loadOlder();
    expect(asked).toHaveLength(3);
  });

  test("a full read after loading asks for a window that reaches back over what is loaded", () => {
    const { screen, asked } = loaded();
    screen.loadOlder();
    screen.setHistory([...rowsNumbered(500, 2000), "g1", "g2"], 2);
    screen.loadHistory("full");
    expect(asked.at(-1)).toBe(2000 + 2 + HISTORY_TOP_UP_LINES);
  });
});

describe("prompt rows", () => {
  test("the first read keeps the prompts as absolute rows, scrollback and visible grid", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "r3", "now"], 1, [1, 3]);
    const state = screen.getState();
    // r2 is history[1]; "now" is the grid's first row, one past the three scrollback rows.
    expect(state.prompts).toEqual([state.historyBase + 1, state.historyBase + 3]);
    expect(previousPrompt(state, state.historyBase + 3)).toBe(state.historyBase + 1);
    expect(nextPrompt(state, state.historyBase + 1)).toBe(state.historyBase + 3);
  });

  test("a reply without prompts (an older core) or with bad ones leaves none", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "now"], 1);
    expect(screen.getState().prompts).toEqual([]);
    screen.loadHistory("replace");
    screen.setHistory(["r1", "r2", "now"], 1, [2, 1, 1, -1, 3, 0.5]);
    expect(screen.getState().prompts).toHaveLength(1);
  });

  test("a top-up keeps the older prompts and replaces the ones in the window it covers", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "r3", "now"], 1, [0, 3]);
    const base = screen.getState().historyBase;
    expect(screen.getState().prompts).toEqual([base, base + 3]);
    screen.loadHistory("top-up");
    // r4 and r5 scrolled off since; r4 holds the prompt that was on the grid ("now") and is again.
    screen.setHistory(["r1", "r2", "r3", "r4", "r5", "now"], 1, [0, 3, 5]);
    const after = screen.getState();
    expect(after.historyBase).toBe(base);
    expect(after.history).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(after.prompts).toEqual([base, base + 3, base + 5]);
  });

  test("a top-up that adds no row still refreshes the prompts of the grid", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "r3", "now"], 1, [0]);
    const before = screen.getState();
    screen.loadHistory("top-up");
    screen.setHistory(["r1", "r2", "r3", "now"], 1, [0, 3]);
    const after = screen.getState();
    expect(after.history).toBe(before.history);
    expect(after.prompts).toEqual([before.historyBase, before.historyBase + 3]);
    expect(after.historyReplies).toBe(before.historyReplies + 1);
  });

  test("older rows come in above with their prompts, and the loaded prompts keep their rows", () => {
    const { screen } = wired("g1\r\ng2");
    screen.loadHistory("full");
    screen.setHistory([...rowsNumbered(1500, 998), "g1", "g2"], 2, [10, 998]);
    const before = screen.getState();
    expect(before.prompts).toEqual([before.historyBase + 10, before.historyBase + 998]);
    expect(screen.hasOlder()).toBe(true);
    screen.loadOlder();
    // 2 rows scrolled off meanwhile: the grid now begins 2 rows lower.
    screen.setHistory([...rowsNumbered(500, 2000), "g1", "g2"], 2, [5, 1010, 2000]);
    const after = screen.getState();
    expect(after.history[1010]).toBe("row1510");
    expect(after.prompts).toEqual([
      after.historyBase + 5,
      before.historyBase + 10,
      after.historyBase + 2000,
    ]);
  });

  test("hasOlder is false before anything is loaded and once the start is in", () => {
    const { screen } = wired("now");
    expect(screen.hasOlder()).toBe(false);
    screen.loadHistory("full");
    screen.setHistory(["r1", "now"], 1);
    expect(screen.hasOlder()).toBe(false);
  });

  test("a read that cannot be placed starts the prompts over with its rows", () => {
    const { screen } = wired("now");
    screen.loadHistory("full");
    screen.setHistory(["r1", "r2", "r3", "now"], 1, [0, 3]);
    screen.loadHistory("replace");
    screen.setHistory(["x1", "x2", "now"], 1, [1]);
    const state = screen.getState();
    expect(state.history).toEqual(["x1", "x2"]);
    expect(state.prompts).toEqual([state.historyBase + 1]);
  });
});

describe("TerminalScreen frames", () => {
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
