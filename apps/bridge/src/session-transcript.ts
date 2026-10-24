/**
 * Session transcript: the agent's own conversation log as a chat feed.
 *
 * The screen parser in observe.ts only sees the visible terminal, so history
 * scrolls away. This module reads the agent's session file instead (omp
 * `~/.omp/agent/sessions/**.jsonl`, Claude Code `~/.claude/projects/**.jsonl`;
 * the format is detected per line) and serves it over the same /observe
 * WebSocket, strictly opt-in so existing clients are untouched.
 *
 * Client → bridge (text JSON frames; anything else still closes 1008):
 *   {type:"transcript"}           sent after the first `snapshot`; opts in
 *   {type:"older", before}        page back; `before` = a `cursor` we sent
 *
 * Bridge → client:
 *   {type:"transcript", agent, entries, hasMore, cursor}   newest page; replaces any list
 *   {type:"append", entries}                                entries after that page
 *   {type:"older", before, entries, hasMore, cursor}        reply to `older`
 *   {type:"transcript-unavailable", reason}                 stay on the screen parser
 *
 * Entries are {id, seq, role, text, at, tool?}. `seq` orders them (byte offset
 * of the source line × SEQ_STRIDE + part index) and `cursor` is a byte offset
 * of a line start, so paging is exact over files of any size: older pages are
 * read backwards in chunks, never the whole file. A tool call and its result
 * are one entry id (the tool call id) that a result line updates in place;
 * `mergeEntries` (duplicated in apps/native/lib/transcript.ts) folds updates.
 */
import { open, stat, type FileHandle } from "node:fs/promises";
import { PaneGoneError, type PaneBackend } from "./backend";

export type TranscriptRole = "user" | "assistant" | "tool" | "ask";
export type ToolStatus = "running" | "done" | "error";

export interface TranscriptTool {
  name: string;
  /** One line: the path, command, query or question the call is about. */
  summary: string;
  status: ToolStatus;
  /** Result text, clipped; absent while running. */
  result?: string;
}

export interface TranscriptEntry {
  id: string;
  seq: number;
  role: TranscriptRole;
  text: string;
  /** Epoch ms; null when the log line carries no timestamp. */
  at: number | null;
  /** Assistant entry that reports a failed or interrupted turn. */
  error?: boolean;
  tool?: TranscriptTool;
}

export const SEQ_STRIDE = 1024;
const PAGE_ENTRIES = 300;
const PAGE_CHARS = 1_500_000;
const CHUNK_BYTES = 256 * 1024;
/** A single log line bigger than this (embedded screenshots) is skipped. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const TEXT_MAX_CHARS = 16_000;
const RESULT_MAX_CHARS = 4_000;
const RESULT_MAX_LINES = 40;
const SUMMARY_MAX_CHARS = 140;
const APPEND_BATCH = 200;
const POLL_MS = 1_000;
const SESSION_CHECK_MS = 3_000;
const MAX_PENDING_CALLS = 2_000;
const MAX_POLL_BYTES = 8 * 1024 * 1024;

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Local copy of observe.ts's stripAnsi (importing it would make a cycle).
const ANSI_RE = /\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clipResult(raw: string): string {
  const text = raw.replace(ANSI_RE, "").replace(/\r\n?/g, "\n").trimEnd();
  const lines = text.split("\n");
  const shown = lines.length > RESULT_MAX_LINES ? lines.slice(0, RESULT_MAX_LINES) : lines;
  let out = clip(shown.join("\n"), RESULT_MAX_CHARS);
  if (lines.length > shown.length) out += `\n… ${lines.length - shown.length} more lines`;
  return out;
}

function oneLine(text: string, max = SUMMARY_MAX_CHARS): string {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  return clip(first.replace(/\s+/g, " ").trim(), max);
}

/** Text of a message `content`: a string, or parts (images become a marker). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const part of content) {
    if (!isObj(part)) continue;
    if (part.type === "text" && typeof part.text === "string") out.push(part.text);
    else if (part.type === "image") out.push("[image]");
  }
  return out.join("\n");
}

const SYSTEMISH = /^\s*<(?:command-|local-command|system-|task-notification|bash-|user-prompt)/;

function isAsk(name: string): boolean {
  const n = name.toLowerCase();
  return n === "ask" || n === "askuserquestion";
}

function askText(args: unknown): string {
  const questions = isObj(args) && Array.isArray(args.questions) ? args.questions : [];
  const blocks: string[] = [];
  for (const q of questions) {
    if (!isObj(q)) continue;
    const lines = [str(q.question)];
    if (Array.isArray(q.options)) {
      for (const o of q.options) {
        const label = isObj(o) ? str(o.label) : str(o);
        if (label) lines.push(`- ${label}`);
      }
    }
    if (lines[0]) blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export function summarizeTool(name: string, args: unknown): string {
  const a = isObj(args) ? args : {};
  const path = str(a.path) || str(a.file_path);
  switch (name.toLowerCase()) {
    case "read":
    case "write":
      if (path) return clip(path, SUMMARY_MAX_CHARS);
      break;
    case "edit": {
      if (path) return clip(path, SUMMARY_MAX_CHARS);
      // omp's edit takes `[path#tag]` as the first line of its `input`.
      const header = /^\s*\[([^\]#\n]+)/.exec(str(a.input));
      if (header?.[1]) return clip(header[1], SUMMARY_MAX_CHARS);
      break;
    }
    case "bash":
      if (str(a.command)) return oneLine(str(a.command));
      break;
    case "grep": {
      const pattern = str(a.pattern);
      if (pattern) return oneLine(path ? `${pattern} in ${path}` : pattern);
      break;
    }
    case "glob":
      if (path || str(a.pattern)) return oneLine(path || str(a.pattern));
      break;
    case "web_search":
    case "websearch":
      if (str(a.query)) return oneLine(str(a.query));
      break;
  }
  const intent = str(a.i) || str(a.description) || str(a.intent);
  if (intent) return oneLine(intent);
  if (path) return clip(path, SUMMARY_MAX_CHARS);
  for (const v of Object.values(a)) if (typeof v === "string" && v.trim()) return oneLine(v);
  return "";
}

/** Fold an update of the same entry id (a result for a call, or the call
 *  arriving after its result): keeps every field either side knows. */
export function mergeEntry(prev: TranscriptEntry, next: TranscriptEntry): TranscriptEntry {
  if (!prev.tool || !next.tool) return next;
  const result = next.tool.result ?? prev.tool.result;
  return {
    ...next,
    seq: Math.min(prev.seq, next.seq),
    at: prev.at ?? next.at,
    text: next.text || prev.text,
    tool: {
      name: next.tool.name || prev.tool.name,
      summary: next.tool.summary || prev.tool.summary,
      // A finished state never falls back to "running" (a call re-read from an older page).
      status: next.tool.status === "running" ? prev.tool.status : next.tool.status,
      ...(result === undefined ? {} : { result }),
    },
  };
}

/** Union by id (updates merged), ordered by seq. */
export function mergeEntries(
  base: readonly TranscriptEntry[],
  incoming: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const byId = new Map<string, TranscriptEntry>();
  for (const e of base) byId.set(e.id, e);
  for (const e of incoming) {
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeEntry(prev, e) : e);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function parseTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Stateful line parser. `feed` returns the entries a line produces: new ones,
 * plus updated copies of earlier tool entries when the line is their result.
 * A result whose call this parser never saw (older than the window) comes out
 * as a result-only entry; the merge fills the call half in later.
 */
export class TranscriptParser {
  private pending = new Map<string, TranscriptEntry>();

  feed(line: string, pos: number): TranscriptEntry[] {
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isObj(o) || !isObj(o.message)) return [];
    const at = parseTime(o.timestamp) ?? parseTime(o.message.timestamp);
    if (o.type === "message") return this.omp(o.message, pos, at);
    if ((o.type === "user" || o.type === "assistant") && o.isSidechain !== true && !o.isMeta) {
      return this.claude(o.type, o.message, pos, at);
    }
    return [];
  }

  private id(pos: number, sub: number): { id: string; seq: number } {
    return { id: `${pos}:${sub}`, seq: pos * SEQ_STRIDE + Math.min(sub, SEQ_STRIDE - 1) };
  }

  private userEntry(text: string, pos: number, sub: number, at: number | null) {
    const t = text.trim();
    if (!t || SYSTEMISH.test(t)) return null;
    return { ...this.id(pos, sub), role: "user", text: clip(t, TEXT_MAX_CHARS), at } as const;
  }

  private assistantEntry(text: string, pos: number, sub: number, at: number | null) {
    const t = text.trim();
    if (!t) return null;
    return { ...this.id(pos, sub), role: "assistant", text: clip(t, TEXT_MAX_CHARS), at } as const;
  }

  private call(
    id: string,
    name: string,
    args: unknown,
    pos: number,
    sub: number,
    at: number | null,
  ): TranscriptEntry {
    const ask = isAsk(name);
    const entry: TranscriptEntry = {
      id,
      seq: this.id(pos, sub).seq,
      role: ask ? "ask" : "tool",
      text: ask ? clip(askText(args), TEXT_MAX_CHARS) : "",
      at,
      tool: {
        name,
        summary: ask ? oneLine(askText(args)) : summarizeTool(name, args),
        status: "running",
      },
    };
    if (id) {
      this.pending.set(id, entry);
      if (this.pending.size > MAX_PENDING_CALLS) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
    }
    return entry;
  }

  private result(
    callId: string,
    toolName: string,
    content: unknown,
    isError: boolean,
    pos: number,
    at: number | null,
  ): TranscriptEntry[] {
    const status: ToolStatus = isError ? "error" : "done";
    const result = clipResult(textOf(content));
    const call = callId ? this.pending.get(callId) : undefined;
    if (call?.tool) {
      this.pending.delete(callId);
      return [{ ...call, tool: { ...call.tool, status, result } }];
    }
    if (!callId) return [];
    return [
      {
        id: callId,
        seq: pos * SEQ_STRIDE,
        role: isAsk(toolName) ? "ask" : "tool",
        text: "",
        at,
        tool: { name: toolName, summary: "", status, result },
      },
    ];
  }

  private omp(m: Json, pos: number, at: number | null): TranscriptEntry[] {
    const out: TranscriptEntry[] = [];
    if (m.role === "user") {
      if (m.attribution === "agent") return out;
      const e = this.userEntry(textOf(m.content), pos, 0, at);
      if (e) out.push(e);
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      m.content.forEach((part: unknown, j) => {
        if (!isObj(part)) return;
        if (part.type === "text") {
          const e = this.assistantEntry(str(part.text), pos, j, at);
          if (e) out.push(e);
        } else if (part.type === "toolCall") {
          out.push(this.call(str(part.id), str(part.name), part.arguments, pos, j, at));
        }
      });
      if ((m.stopReason === "error" || m.stopReason === "aborted") && str(m.errorMessage)) {
        out.push({
          ...this.id(pos, SEQ_STRIDE - 1),
          role: "assistant",
          text: clip(str(m.errorMessage).trim(), TEXT_MAX_CHARS),
          at,
          error: true,
        });
      }
    } else if (m.role === "toolResult") {
      out.push(
        ...this.result(str(m.toolCallId), str(m.toolName), m.content, m.isError === true, pos, at),
      );
    }
    return out;
  }

  private claude(role: string, m: Json, pos: number, at: number | null): TranscriptEntry[] {
    const out: TranscriptEntry[] = [];
    if (typeof m.content === "string") {
      const e =
        role === "user"
          ? this.userEntry(m.content, pos, 0, at)
          : this.assistantEntry(m.content, pos, 0, at);
      if (e) out.push(e);
      return out;
    }
    if (!Array.isArray(m.content)) return out;
    m.content.forEach((part: unknown, j) => {
      if (!isObj(part)) return;
      if (part.type === "text") {
        const e =
          role === "user"
            ? this.userEntry(str(part.text), pos, j, at)
            : this.assistantEntry(str(part.text), pos, j, at);
        if (e) out.push(e);
      } else if (part.type === "tool_use" && role === "assistant") {
        out.push(this.call(str(part.id), str(part.name), part.input, pos, j, at));
      } else if (part.type === "tool_result" && role === "user") {
        out.push(
          ...this.result(
            str(part.tool_use_id),
            "tool",
            part.content,
            part.is_error === true,
            pos,
            at,
          ),
        );
      }
    });
    return out;
  }
}

// --- file reading -------------------------------------------------------------

export interface TranscriptPage {
  entries: TranscriptEntry[];
  /** Byte offset of the oldest line in this page; pass as `before` for the next. */
  cursor: number;
  hasMore: boolean;
  /** End of the complete lines read (the start offset for following). */
  end: number;
}

interface FileLine {
  pos: number;
  text: string;
}

function splitLines(buf: Buffer, base: number, from: number): FileLine[] {
  const lines: FileLine[] = [];
  let p = from;
  while (p < buf.length) {
    let q = buf.indexOf(0x0a, p);
    if (q < 0) q = buf.length;
    if (q > p) lines.push({ pos: base + p, text: buf.toString("utf8", p, q) });
    p = q + 1;
  }
  return lines;
}

async function readRange(fh: FileHandle, start: number, end: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(end - start);
  let got = 0;
  while (got < buf.length) {
    const { bytesRead } = await fh.read(buf, got, buf.length - got, start + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return got === buf.length ? buf : buf.subarray(0, got);
}

/** Offset just past the last newline at or before `size`; 0 when there is none. */
async function lastLineEnd(fh: FileHandle, size: number): Promise<number> {
  let end = size;
  let chunk = CHUNK_BYTES;
  while (end > 0) {
    const start = Math.max(0, end - chunk);
    const buf = await readRange(fh, start, end);
    const nl = buf.lastIndexOf(0x0a);
    if (nl >= 0) return start + nl + 1;
    if (start === 0 || chunk >= MAX_LINE_BYTES) return 0;
    end = start;
    chunk *= 2;
  }
  return 0;
}

/**
 * One page of the newest entries strictly before `before` (default: the end
 * of the file), reading backwards in chunks so the cost is the page, not the
 * file. `before` must be a line start (a previous `cursor`) or `end`.
 */
export async function readTranscriptPage(
  path: string,
  opts: { before?: number; limit?: number } = {},
): Promise<TranscriptPage> {
  const limit = opts.limit ?? PAGE_ENTRIES;
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const end =
      opts.before === undefined ? await lastLineEnd(fh, size) : Math.min(opts.before, size);
    let cursor = end;
    let chunk = CHUNK_BYTES;
    let merged: TranscriptEntry[] = [];
    while (cursor > 0 && merged.length < limit) {
      const start = Math.max(0, cursor - chunk);
      const buf = await readRange(fh, start, cursor);
      let from = 0;
      if (start > 0) {
        // The last byte is the newline ending the previous line: ignore it, or
        // a line longer than the chunk would match its own terminator.
        const nl = buf.subarray(0, buf.length - 1).indexOf(0x0a);
        if (nl < 0) {
          if (chunk >= MAX_LINE_BYTES) {
            cursor = start;
            chunk = CHUNK_BYTES;
          } else chunk *= 2;
          continue;
        }
        from = nl + 1;
      }
      const parser = new TranscriptParser();
      const entries: TranscriptEntry[] = [];
      for (const line of splitLines(buf, start, from))
        entries.push(...parser.feed(line.text, line.pos));
      merged = mergeEntries(entries, merged);
      cursor = start + from;
      chunk = CHUNK_BYTES;
    }

    // Keep the newest entries within the count and payload budget, cutting on a
    // line boundary so no line's entries straddle two pages.
    let keepFrom = 0;
    let chars = 0;
    for (let i = merged.length - 1; i >= 0; i--) {
      const e = merged[i]!;
      chars += e.text.length + (e.tool?.result?.length ?? 0) + (e.tool?.summary.length ?? 0) + 80;
      const kept = merged.length - i;
      if (kept > limit || (chars > PAGE_CHARS && kept > 20)) {
        keepFrom = i + 1;
        break;
      }
    }
    let entries = merged;
    if (keepFrom > 0 && keepFrom < merged.length) {
      const cutPos = Math.floor(merged[keepFrom]!.seq / SEQ_STRIDE);
      entries = merged.filter((e) => Math.floor(e.seq / SEQ_STRIDE) >= cutPos);
      cursor = cutPos;
    }
    return { entries, cursor, hasMore: cursor > 0, end };
  } finally {
    await fh.close();
  }
}

// --- following ----------------------------------------------------------------

/** What the hub needs from a socket (ObserveClient satisfies it). */
export interface TranscriptSocket {
  readonly readyState: number;
  send(data: string): unknown;
}

interface FeedClient {
  ws: TranscriptSocket;
  paneId: string;
  agent: string | null;
  /** Appends arriving while the first page loads; flushed right after it. */
  queue: TranscriptEntry[] | null;
  olderInFlight: number;
}

function sendFrame(ws: TranscriptSocket, frame: Json): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
}

function sendAppend(ws: TranscriptSocket, entries: TranscriptEntry[]): void {
  for (let i = 0; i < entries.length; i += APPEND_BATCH) {
    sendFrame(ws, { type: "append", entries: entries.slice(i, i + APPEND_BATCH) });
  }
}

/** One followed session file, shared by every client reading it. */
class TranscriptFeed {
  readonly clients = new Set<FeedClient>();
  offset = 0;
  private parser = new TranscriptParser();
  private timer: Timer | null = null;
  private polling = false;

  private starting: Promise<void> | null = null;

  constructor(
    readonly path: string,
    private readonly pollMs: number,
    private readonly onReset: (feed: TranscriptFeed) => void,
  ) {}

  /** Start following from the current end of the file; shared by concurrent joiners. */
  start(): Promise<void> {
    this.starting ??= this.begin();
    return this.starting;
  }

  private async begin(): Promise<void> {
    const fh = await open(this.path, "r");
    try {
      this.offset = await lastLineEnd(fh, (await fh.stat()).size);
    } finally {
      await fh.close();
    }
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  dispose(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.polling || this.clients.size === 0) return;
    this.polling = true;
    try {
      const { size } = await stat(this.path);
      if (size < this.offset) {
        // Rewritten or truncated: every client starts over from a fresh page.
        this.parser = new TranscriptParser();
        const fh = await open(this.path, "r");
        try {
          this.offset = await lastLineEnd(fh, (await fh.stat()).size);
        } finally {
          await fh.close();
        }
        this.onReset(this);
        return;
      }
      if (size === this.offset) return;
      const fh = await open(this.path, "r");
      let buf: Buffer;
      try {
        buf = await readRange(fh, this.offset, Math.min(size, this.offset + MAX_POLL_BYTES));
      } finally {
        await fh.close();
      }
      const nl = buf.lastIndexOf(0x0a);
      if (nl < 0) return;
      const entries: TranscriptEntry[] = [];
      for (const line of splitLines(buf.subarray(0, nl + 1), this.offset, 0)) {
        entries.push(...this.parser.feed(line.text, line.pos));
      }
      // Offset and broadcast in one synchronous step: a client that joins
      // between polls reads its first page up to exactly this offset.
      this.offset += nl + 1;
      if (entries.length === 0) return;
      for (const c of this.clients) {
        if (c.queue) c.queue.push(...entries);
        else sendAppend(c.ws, entries);
      }
    } catch (e) {
      console.error(`transcript follow ${this.path} failed (will retry):`, e);
    } finally {
      this.polling = false;
    }
  }
}

function sessionPathOk(path: string | null): path is string {
  return !!path && path.startsWith("/") && path.endsWith(".jsonl");
}

/** Serves transcript frames to the /observe sockets that opted in. */
export class TranscriptHub {
  private feeds = new Map<string, TranscriptFeed>();
  private clients = new Map<TranscriptSocket, { client: FeedClient; feed: TranscriptFeed }>();
  private checkTimer: Timer | null = null;
  private checking = false;

  constructor(
    private readonly backend: PaneBackend,
    private readonly intervals: { pollMs?: number; sessionCheckMs?: number } = {},
  ) {}

  stop(): void {
    for (const feed of this.feeds.values()) feed.dispose();
    this.feeds.clear();
    this.clients.clear();
    clearInterval(this.checkTimer ?? undefined);
    this.checkTimer = null;
  }

  has(ws: TranscriptSocket): boolean {
    return this.clients.has(ws);
  }

  /** Number of session files currently followed. */
  get following(): number {
    return this.feeds.size;
  }

  /**
   * Attach `ws` to the pane's session log. Resolves true when it is now being
   * fed (the caller stops sending it screen frames), false after an
   * `unavailable` frame (the caller keeps the screen parser going).
   */
  async subscribe(ws: TranscriptSocket, paneId: string): Promise<boolean> {
    if (this.clients.has(ws)) return true;
    let pane;
    try {
      pane = await this.backend.getPane(paneId, 4000);
    } catch (e) {
      sendFrame(ws, {
        type: "transcript-unavailable",
        reason: e instanceof PaneGoneError ? "pane is gone" : "pane lookup failed",
      });
      return false;
    }
    if (!sessionPathOk(pane.agentSessionPath)) {
      sendFrame(ws, { type: "transcript-unavailable", reason: "no session log for this pane" });
      return false;
    }
    if (ws.readyState !== 1) return false;
    return this.join(ws, paneId, pane.agent, pane.agentSessionPath);
  }

  private async join(
    ws: TranscriptSocket,
    paneId: string,
    agent: string | null,
    path: string,
  ): Promise<boolean> {
    let feed = this.feeds.get(path);
    if (!feed) {
      feed = new TranscriptFeed(
        path,
        this.intervals.pollMs ?? POLL_MS,
        (f) => void this.resetFeed(f),
      );
      this.feeds.set(path, feed);
    }
    try {
      await feed.start();
    } catch {
      if (this.feeds.get(path) === feed) this.feeds.delete(path);
      sendFrame(ws, { type: "transcript-unavailable", reason: "session log unreadable" });
      return false;
    }
    if (ws.readyState !== 1) {
      this.release(feed);
      return false;
    }
    const client: FeedClient = { ws, paneId, agent, queue: [], olderInFlight: 0 };
    feed.clients.add(client);
    this.clients.set(ws, { client, feed });
    try {
      await this.sendFirstPage(client, feed);
    } catch {
      this.leave(ws);
      sendFrame(ws, { type: "transcript-unavailable", reason: "session log unreadable" });
      return false;
    }
    this.ensureChecker();
    return true;
  }

  private async sendFirstPage(client: FeedClient, feed: TranscriptFeed): Promise<void> {
    // Read exactly up to the offset the feed had when the client joined; every
    // later line reaches it through `queue`.
    const page = await readTranscriptPage(feed.path, { before: feed.offset });
    sendFrame(client.ws, {
      type: "transcript",
      agent: client.agent,
      entries: page.entries,
      hasMore: page.hasMore,
      cursor: page.cursor,
    });
    const queued = client.queue ?? [];
    client.queue = null;
    if (queued.length > 0) sendAppend(client.ws, queued);
  }

  /** `older` request from a client. */
  async older(ws: TranscriptSocket, before: unknown): Promise<void> {
    const sub = this.clients.get(ws);
    if (!sub || typeof before !== "number" || !Number.isInteger(before) || before < 0) return;
    if (sub.client.olderInFlight >= 2) {
      sendFrame(ws, {
        type: "older",
        before,
        entries: [],
        hasMore: true,
        cursor: before,
        busy: true,
      });
      return;
    }
    sub.client.olderInFlight++;
    try {
      const page = await readTranscriptPage(sub.feed.path, { before });
      sendFrame(ws, {
        type: "older",
        before,
        entries: page.entries,
        hasMore: page.hasMore,
        cursor: page.cursor,
      });
    } catch {
      sendFrame(ws, {
        type: "older",
        before,
        entries: [],
        hasMore: true,
        cursor: before,
        busy: true,
      });
    } finally {
      sub.client.olderInFlight--;
    }
  }

  detach(ws: TranscriptSocket): void {
    this.leave(ws);
  }

  private leave(ws: TranscriptSocket): void {
    const sub = this.clients.get(ws);
    if (!sub) return;
    this.clients.delete(ws);
    sub.feed.clients.delete(sub.client);
    this.release(sub.feed);
    if (this.clients.size === 0) {
      clearInterval(this.checkTimer ?? undefined);
      this.checkTimer = null;
    }
  }

  private release(feed: TranscriptFeed): void {
    if (feed.clients.size > 0) return;
    feed.dispose();
    if (this.feeds.get(feed.path) === feed) this.feeds.delete(feed.path);
  }

  /** The file shrank: replace every client's list with a fresh first page. */
  private async resetFeed(feed: TranscriptFeed): Promise<void> {
    const clients = [...feed.clients];
    for (const client of clients) client.queue = [];
    for (const client of clients) {
      try {
        await this.sendFirstPage(client, feed);
      } catch {
        this.leave(client.ws);
      }
    }
  }

  private ensureChecker(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(
      () => void this.checkSessions(),
      this.intervals.sessionCheckMs ?? SESSION_CHECK_MS,
    );
  }

  /** A pane can start a new agent session (new file); follow it. */
  private async checkSessions(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const [ws, { client, feed }] of [...this.clients]) {
        let pane;
        try {
          pane = await this.backend.getPane(client.paneId, 4000);
        } catch {
          continue;
        }
        const next = pane.agentSessionPath;
        if (!sessionPathOk(next) || next === feed.path || !this.clients.has(ws)) continue;
        this.leave(ws);
        await this.join(ws, client.paneId, pane.agent, next);
      }
    } finally {
      this.checking = false;
    }
  }
}
