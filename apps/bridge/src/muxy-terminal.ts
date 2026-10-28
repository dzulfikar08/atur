/**
 * One attached Muxy terminal: the visible grid kept current from pushed
 * frames, the live title/directory/process from pushed metadata, and a cache
 * of the scrollback so repeated history reads cost no more than the rows that
 * arrived since the last one.
 */
import type { ScreenRead } from "./backend";
import { MuxyServerError } from "./muxy-client";
import {
  ErrorCode,
  MAX_HISTORY_ROWS,
  cursorGeneration,
  type Attached,
  type HistoryPage,
  type MuxyRow,
  type Process,
  type ScreenFrame,
  type TerminalEvent,
  type U64,
} from "./muxy-wire";
import { renderRow, renderRows } from "./muxy-render";

/** Rows of the last scrollback read that a catch-up must reproduce, as a sanity check. */
const OVERLAP = 4;
/** Cached scrollback rows before the cache is dropped and rebuilt from the newest rows. */
const CACHE_MAX_ROWS = 6000;

/** Reads one history page: `before` 0 is the newest rows, otherwise a cursor from an earlier page. */
export type PageSource = (before: U64, maxRows: number) => Promise<HistoryPage>;

interface HistoryCache {
  /** Null when the whole history fit in one page (no cursor to read it from). */
  generation: bigint | null;
  /** History rows Muxy held when the cache was last brought up to date. */
  total: number;
  /** The newest rows, rendered, oldest first. */
  rows: string[];
  /** Cursor to the rows above `rows`; null when `rows` reaches the top of the history. */
  older: U64 | null;
}

export class MuxyTerminal {
  readonly id: string;
  channel: number;
  size: { cols: number; rows: number };
  title: string;
  directory: string;
  process: Process | null;
  lastUsed = Date.now();
  /** Scrollback rows Muxy reports holding (snapshot, then pushed updates). */
  historyTotal: number;

  private rows: (MuxyRow | undefined)[] = [];
  private version = 0;
  private renderedVersion = -1;
  private text = "";
  private revision = 0;
  private history: HistoryCache | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(id: string, attached: Attached) {
    this.id = id;
    this.channel = attached.channel;
    this.size = attached.size;
    this.title = attached.title;
    this.directory = attached.directory;
    this.process = attached.process;
    this.historyTotal = attached.historyTotal;
    for (const row of attached.rows) this.rows[row.index] = row;
  }

  applyFrame(frame: ScreenFrame): void {
    const resized = frame.size.cols !== this.size.cols || frame.size.rows !== this.size.rows;
    if (resized || frame.reset) {
      this.size = frame.size;
      this.rows = [];
      this.history = null;
    }
    for (const row of frame.rows) this.rows[row.index] = row;
    this.version++;
  }

  applyEvent(event: TerminalEvent): void {
    if (event.type === "title") this.title = event.title;
    else if (event.type === "directory") this.directory = event.directory;
    else if (event.type === "process") this.process = event.process;
    else this.historyTotal = event.total;
  }

  /** The visible grid as ANSI rows, one per screen row. */
  screenLines(): string[] {
    return renderRows(
      this.rows.filter((r): r is MuxyRow => r !== undefined),
      this.size.rows,
    );
  }

  /** The visible grid joined by `\r\n`; the revision moves only when the text does. */
  read(): ScreenRead {
    if (this.renderedVersion !== this.version || this.revision === 0) {
      const text = this.screenLines().join("\r\n");
      if (this.revision === 0 || text !== this.text) {
        this.text = text;
        this.revision++;
      }
      this.renderedVersion = this.version;
    }
    return { text: this.text, revision: this.revision };
  }

  /** The newest `need` scrollback rows (fewer when the history is shorter), oldest first. */
  scrollback(need: number, source: PageSource): Promise<string[]> {
    const run = this.queue.then(() => this.scrollbackNow(need, source));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async scrollbackNow(need: number, source: PageSource): Promise<string[]> {
    let cache = this.history;
    if (cache && cache.total !== this.historyTotal) cache = await this.catchUp(cache, source);
    cache ??= await this.rebuild(need, source);
    while (cache.rows.length < need && cache.older !== null) {
      const page = await source(cache.older, Math.min(MAX_HISTORY_ROWS, need - cache.rows.length));
      if (page.rows.length === 0) break;
      cache = { ...cache, rows: [...page.rows.map(renderRow), ...cache.rows], older: page.next };
    }
    this.history = cache.rows.length > CACHE_MAX_ROWS ? null : cache;
    return cache.rows.slice(Math.max(cache.rows.length - need, 0));
  }

  /** Newest rows from scratch: the newest page, then older pages until `need` rows are held. */
  private async rebuild(need: number, source: PageSource): Promise<HistoryCache> {
    for (let attempt = 0; ; attempt++) {
      try {
        const first = await source(0, Math.min(Math.max(need, 1), MAX_HISTORY_ROWS));
        let rows = first.rows.map(renderRow);
        let older = first.next;
        const generation = older === null ? null : cursorGeneration(older);
        while (older !== null && rows.length < need) {
          const page = await source(older, Math.min(MAX_HISTORY_ROWS, need - rows.length));
          if (page.rows.length === 0) break;
          rows = [...page.rows.map(renderRow), ...rows];
          older = page.next;
        }
        this.historyTotal = first.total;
        return { generation, total: first.total, rows, older };
      } catch (e) {
        // Scrollback changed under the cursor: start again from the newest rows.
        const stale = e instanceof MuxyServerError && e.code === ErrorCode.StaleHistoryCursor;
        if (!stale || attempt >= 2) throw e;
      }
    }
  }

  /**
   * Brings the cache up to the rows added since, from one small page of the
   * newest rows. The cache is only extended while scrollback stayed
   * append-only (same cursor generation) and the page's oldest rows equal the
   * cache's newest ones; anything else answers null and the caller rebuilds.
   */
  private async catchUp(cache: HistoryCache, source: PageSource): Promise<HistoryCache | null> {
    const added = this.historyTotal - cache.total;
    if (added < 0 || cache.generation === null || cache.rows.length === 0) return null;
    const overlap = Math.min(OVERLAP, cache.rows.length);
    let want = Math.min(added + overlap, MAX_HISTORY_ROWS);
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = await source(0, want);
      if (page.next === null || cursorGeneration(page.next) !== cache.generation) return null;
      if (page.total < cache.total) return null;
      const start = page.total - page.rows.length;
      const overlapFrom = cache.total - overlap;
      if (start > overlapFrom) {
        // More rows arrived than the page was asked for: ask again with the real count.
        if (want >= MAX_HISTORY_ROWS) return null;
        want = Math.min(page.total - cache.total + overlap, MAX_HISTORY_ROWS);
        continue;
      }
      const rendered = page.rows.map(renderRow);
      const tail = cache.rows.slice(cache.rows.length - overlap);
      for (let i = 0; i < overlap; i++) {
        if (rendered[overlapFrom - start + i] !== tail[i]) return null;
      }
      this.historyTotal = page.total;
      return {
        generation: cache.generation,
        total: page.total,
        rows: [...cache.rows, ...rendered.slice(cache.total - start)],
        older: cache.older,
      };
    }
    return null;
  }
}
