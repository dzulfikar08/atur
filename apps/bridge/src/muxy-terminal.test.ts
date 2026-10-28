/** Attached terminal: pushed frames build the grid, and the scrollback cache never serves stale rows. */
import { describe, expect, test } from "bun:test";
import { MuxyServerError } from "./muxy-client";
import { MuxyTerminal, type PageSource } from "./muxy-terminal";
import {
  ErrorCode,
  type Attached,
  type HistoryPage,
  type MuxyRow,
  type ScreenFrame,
} from "./muxy-wire";

const row = (index: number, text: string): MuxyRow => ({
  index,
  runs: text === "" ? [] : [{ text, style: {} }],
});

function attached(overrides: Partial<Attached> = {}): Attached {
  return {
    channel: 1,
    size: { cols: 10, rows: 3 },
    rows: [],
    title: "",
    directory: "/tmp",
    process: null,
    history: [],
    historyCursor: null,
    historyTotal: 0,
    ...overrides,
  };
}

const frame = (rows: MuxyRow[], extra: Partial<ScreenFrame> = {}): ScreenFrame => ({
  size: { cols: 10, rows: 3 },
  seq: 1,
  reset: false,
  rows,
  ...extra,
});

describe("screen", () => {
  test("frames replace the rows they carry and keep the others", () => {
    const t = new MuxyTerminal("1", attached({ rows: [row(0, "one"), row(1, "two")] }));
    expect(t.screenLines()).toEqual(["one", "two", ""]);
    t.applyFrame(frame([row(1, "TWO"), row(2, "three")]));
    expect(t.screenLines()).toEqual(["one", "TWO", "three"]);
    t.applyFrame(frame([row(0, "")]));
    expect(t.screenLines()).toEqual(["", "TWO", "three"]);
  });

  test("a reset frame or a new size repaints from nothing", () => {
    const t = new MuxyTerminal("1", attached({ rows: [row(0, "one"), row(1, "two")] }));
    t.applyFrame(frame([row(2, "z")], { reset: true }));
    expect(t.screenLines()).toEqual(["", "", "z"]);
    t.applyFrame(frame([row(0, "a")], { size: { cols: 20, rows: 2 } }));
    expect(t.size).toEqual({ cols: 20, rows: 2 });
    expect(t.screenLines()).toEqual(["a", ""]);
  });

  test("the revision moves only when the text does", () => {
    const t = new MuxyTerminal("1", attached({ rows: [row(0, "one")] }));
    const first = t.read();
    expect(first.revision).toBe(1);
    expect(first.text).toBe("one\r\n\r\n");
    t.applyFrame(frame([])); // cursor-only frame
    expect(t.read().revision).toBe(1);
    t.applyFrame(frame([row(0, "two")]));
    expect(t.read()).toEqual({ text: "two\r\n\r\n", revision: 2 });
  });

  test("pushed metadata updates title, directory, process and history size", () => {
    const t = new MuxyTerminal("1", attached());
    t.applyEvent({ type: "title", title: "π ⠋ work" });
    t.applyEvent({ type: "directory", directory: "/srv" });
    t.applyEvent({ type: "process", process: { name: "omp", isShell: false } });
    t.applyEvent({ type: "history", total: 42 });
    expect(t).toMatchObject({
      title: "π ⠋ work",
      directory: "/srv",
      process: { name: "omp", isShell: false },
      historyTotal: 42,
    });
  });
});

/** A scrollback with Muxy's cursor rules: `generation << 32 | row index`, 500 rows per page. */
class FakeHistory {
  lines: string[] = [];
  generation = 1;
  calls: Array<{ before: bigint; max: number }> = [];
  /** Throws a stale-cursor error on the next older-page request. */
  staleOnce = false;

  append(...lines: string[]): void {
    this.lines.push(...lines);
  }

  /** Scrollback stopped being append-only: Muxy starts a new generation. */
  restart(lines: string[]): void {
    this.lines = lines;
    this.generation++;
  }

  private cursor(index: number): bigint {
    return (BigInt(this.generation) << 32n) | BigInt(index);
  }

  source: PageSource = async (before, max) => {
    this.calls.push({ before: BigInt(before), max });
    if (max < 1 || max > 500) throw new Error("history pages hold 1 through 500 rows");
    const total = this.lines.length;
    let end = total;
    if (BigInt(before) !== 0n) {
      if (this.staleOnce) {
        this.staleOnce = false;
        throw new MuxyServerError(ErrorCode.StaleHistoryCursor, "history changed");
      }
      end = Number(BigInt(before) & 0xffffffffn);
      if (BigInt(before) !== this.cursor(end) || end > total) {
        throw new MuxyServerError(ErrorCode.StaleHistoryCursor, "history changed");
      }
    }
    const start = Math.max(end - max, 0);
    const page: HistoryPage = {
      rows: this.lines.slice(start, end).map((text, i) => row(i, text)),
      next: start > 0 ? this.cursor(start) : null,
      total,
      screen: null,
    };
    return page;
  };
}

const numbered = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);

describe("scrollback", () => {
  test("reads the newest rows across pages, oldest first", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 1200));
    const t = new MuxyTerminal("1", attached({ historyTotal: 1200 }));
    const rows = await t.scrollback(1000, h.source);
    expect(rows).toEqual(numbered(201, 1200));
    expect(h.calls).toHaveLength(2);
  });

  test("a history shorter than asked returns all of it", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 30));
    const t = new MuxyTerminal("1", attached({ historyTotal: 30 }));
    expect(await t.scrollback(100, h.source)).toEqual(numbered(1, 30));
  });

  test("an unchanged history is served without asking Muxy", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 800));
    const t = new MuxyTerminal("1", attached({ historyTotal: 800 }));
    await t.scrollback(700, h.source);
    h.calls = [];
    expect(await t.scrollback(700, h.source)).toEqual(numbered(101, 800));
    expect(await t.scrollback(50, h.source)).toEqual(numbered(751, 800));
    expect(h.calls).toEqual([]);
  });

  test("new rows are fetched alone and appended", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 800));
    const t = new MuxyTerminal("1", attached({ historyTotal: 800 }));
    await t.scrollback(700, h.source);
    h.calls = [];
    h.append(...numbered(801, 812));
    t.applyEvent({ type: "history", total: 812 });
    expect(await t.scrollback(700, h.source)).toEqual(numbered(113, 812));
    expect(h.calls).toEqual([{ before: 0n, max: 16 }]); // 12 new rows + 4 to cross-check
  });

  test("more rows than the page asked for are fetched in a second round", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 600));
    const t = new MuxyTerminal("1", attached({ historyTotal: 600 }));
    await t.scrollback(300, h.source);
    h.calls = [];
    // The event said 2 new rows, but 10 arrived before the page was read.
    h.append(...numbered(601, 610));
    t.applyEvent({ type: "history", total: 602 });
    expect(await t.scrollback(300, h.source)).toEqual(numbered(311, 610));
    expect(h.calls.map((c) => c.max)).toEqual([6, 14]);
  });

  test("asking for more than is cached pages older rows in front", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 900));
    const t = new MuxyTerminal("1", attached({ historyTotal: 900 }));
    expect(await t.scrollback(100, h.source)).toEqual(numbered(801, 900));
    h.calls = [];
    expect(await t.scrollback(600, h.source)).toEqual(numbered(301, 900));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.max).toBe(500);
  });

  test("a new generation is rebuilt, never extended: clear, trim and resize", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 600));
    const t = new MuxyTerminal("1", attached({ historyTotal: 600 }));
    await t.scrollback(500, h.source);
    // The top of the history was trimmed while 5 rows were added: same row count is possible.
    h.restart(numbered(6, 605));
    t.applyEvent({ type: "history", total: 605 });
    expect(await t.scrollback(500, h.source)).toEqual(numbered(106, 605));
    // The history shrank (clear): fewer rows than cached.
    h.restart(numbered(1000, 1019));
    t.applyEvent({ type: "history", total: 20 });
    expect(await t.scrollback(500, h.source)).toEqual(numbered(1000, 1019));
  });

  test("a repaint drops the cache even when the row count did not move", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 600));
    const t = new MuxyTerminal("1", attached({ historyTotal: 600 }));
    await t.scrollback(500, h.source);
    h.restart(numbered(2001, 2600)); // resize reflowed the history, same count
    t.applyFrame(frame([], { reset: true }));
    expect(await t.scrollback(500, h.source)).toEqual(numbered(2101, 2600));
  });

  test("rows that no longer match the cache's newest rows force a rebuild", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 600));
    const t = new MuxyTerminal("1", attached({ historyTotal: 600 }));
    await t.scrollback(500, h.source);
    // Same generation, but the rows Muxy returns are not the ones cached.
    h.lines = numbered(1, 600).map((l) => `${l}!`);
    h.append(...numbered(601, 603));
    t.applyEvent({ type: "history", total: 603 });
    const rows = await t.scrollback(500, h.source);
    expect(rows).toHaveLength(500);
    expect(rows[0]).toBe("line 104!");
  });

  test("a cursor gone stale mid-read restarts from the newest rows", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 1200));
    h.staleOnce = true;
    const t = new MuxyTerminal("1", attached({ historyTotal: 1200 }));
    expect(await t.scrollback(700, h.source)).toEqual(numbered(501, 1200));
  });

  test("a failed read leaves the next one able to start over", async () => {
    const h = new FakeHistory();
    h.append(...numbered(1, 100));
    const t = new MuxyTerminal("1", attached({ historyTotal: 100 }));
    await expect(
      t.scrollback(50, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await t.scrollback(50, h.source)).toEqual(numbered(51, 100));
  });
});
