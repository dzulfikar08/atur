/**
 * /observe: read-only structured transcript channel (DEV-33).
 *
 * The hub's /attach mirrors the raw terminal grid and carries an input path.
 * /observe is the opposite trade: no input ever reaches the pane. The server
 * accepts exactly two client frames (the transcript opt-in and `older`
 * paging, see session-transcript.ts) and closes 1008 on anything else; the
 * pane text is parsed into renderable blocks so a dashboard can show what an
 * agent is doing without embedding a terminal.
 *
 * Server → client (JSON text frames only):
 *   {type:"snapshot", paneId, mode:"structured", blocks:[Block]}  first message
 *   {type:"snapshot", paneId, mode:"raw", blocks:[]}              …or raw degrade
 *   {type:"raw", mode:"raw", paneId, text}                        full pane text (raw mode)
 *   {type:"blocks", mode, blocks:[Block]}                         full replacement on change
 *   {type:"error", error}                                         bridge-level failure
 * A client that opts in (after its first snapshot) and whose pane has an agent
 * session log is switched to the conversation feed in session-transcript.ts
 * and receives no more blocks/raw frames.
 *
 * Block: {id, kind:"tool"|"output"|"model"|"error", title, model,
 *         startedAt, endedAt, text, lineCount}
 *
 * The parser is a tolerant line classifier over the ANSI-stripped visible
 * screen (the same text Watcher mirrors). Observed omp TUI grammar:
 *   ╭─── <tool header> ───╮      box open (title optional)
 *   │ $ <command> …       │      bash tool header inside the box
 *   ├─── Output ──────────┤      tool output starts
 *   │ …                   │
 *   ╰─────────────────────╯      box close
 * plus `◒ <model>` status badges, `ToolError:`/`✗` banners, and plain prose.
 * Anything that does not fit degrades to mode:"raw" — parsing never throws,
 * and a drifting omp format can never blank the client.
 */
import { PaneGoneError, type PaneBackend } from "./backend";
import { TranscriptHub } from "./session-transcript";

export type ObserveBlockKind = "tool" | "output" | "model" | "error";

export interface ObserveBlock {
  id: number;
  kind: ObserveBlockKind;
  title: string | null;
  model: string | null;
  startedAt: string;
  endedAt: string | null;
  text: string;
  lineCount: number;
}

export interface ParsedPane {
  mode: "structured" | "raw";
  blocks: ObserveBlock[];
  /** ANSI-stripped full pane text — sent verbatim as the raw frame. */
  text: string;
}

const ANSI_RE =
  /\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>NM78cD]/g;

/** herdr's strip_ansi flag has proven unreliable; the parser strips itself. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(/\x1b/g, "");
}

/** Strong error banners only — ordinary words like "failed" inside output
 *  must not reclassify a healthy block. */
const RE_ERROR_LINE = /^\s*(?:ToolError\b|Error:|ERROR[: ]|FATAL[: ]|✗|✖)/;
/** omp's failure Status entries: `└─ 📄 browser: Failed to attach …` */
const RE_STATUS_FAIL = /^└─[^(]*Failed|^└─.*✗/;
const RE_MODEL_BADGE = /◒\s*([^\s·│╮╭]+)/;
const RE_BASH_HEADER = /^\$\s?/;

interface RawBlock {
  kind: ObserveBlockKind;
  title: string | null;
  model: string | null;
  lines: string[];
  /** Unix ms of the block's last content change (frozen across re-parses). */
  changedAt: number;
}

/**
 * Incremental identity across screen polls: a block whose text survives a
 * refresh keeps its id and startedAt, so clients can key blocks and the
 * timestamps mean "first/last seen", not "last re-render". Text that changed
 * is a new block — the visible screen is a rolling window, nothing more is
 * knowable about it.
 */
export class SessionParser {
  private nextId = 1;
  private identity = new Map<string, { id: number; startedAt: number; endedAt?: number }>();

  parse(rawScreen: string): ParsedPane {
    const text = stripAnsi(rawScreen);
    try {
      return this.parseInner(text);
    } catch {
      // Belt and braces: a pathological screen must degrade, never throw.
      return { mode: "raw", blocks: [], text };
    }
  }

  private parseInner(text: string): ParsedPane {
    const lines = text.split(/\r\n|\n/).map((l) => l.replace(/\r$/, "").trimEnd());
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const now = Date.now();

    const blocks: RawBlock[] = [];
    let inBox = false;
    let boxTitle: string | null = null;
    let boxDerivedTitle: string | null = null;
    let toolLines: string[] | null = null;
    let outLines: string[] | null = null;
    let toolErrored = false;
    let outErrored = false;
    let prose: string[] | null = null;
    let proseErrored = false;

    const flushBox = () => {
      if (toolLines !== null) {
        blocks.push({
          kind: toolErrored ? "error" : "tool",
          title: boxTitle ?? boxDerivedTitle,
          model: null,
          lines: toolLines,
          changedAt: now,
        });
      }
      if (outLines !== null) {
        blocks.push({
          kind: outErrored ? "error" : "output",
          title: boxTitle,
          model: null,
          lines: outLines,
          changedAt: now,
        });
      }
      inBox = false;
      boxTitle = null;
      boxDerivedTitle = null;
      toolLines = null;
      outLines = null;
      toolErrored = false;
      outErrored = false;
    };

    const flushProse = () => {
      if (prose !== null && prose.some((l) => l !== "")) {
        blocks.push({
          kind: proseErrored ? "error" : "output",
          title: null,
          model: null,
          lines: prose,
          changedAt: now,
        });
      }
      prose = null;
      proseErrored = false;
    };

    for (const rawLine of lines) {
      const head = rawLine[0] ?? "";
      if (head === "╭" && rawLine.endsWith("╮") && rawLine.length >= 2) {
        flushBox();
        flushProse();
        const inner = rawLine.slice(1, -1);
        const title = inner.replace(/^[-─\s]+/, "").replace(/[-─\s]+$/, "");
        inBox = true;
        boxTitle = title === "" ? null : title;
        toolLines = [];
        continue;
      }
      if (head === "├" && rawLine.endsWith("┤") && inBox) {
        // Tool output separator: freeze the call part, start the output part.
        if (outLines === null) {
          if (toolLines !== null) {
            blocks.push({
              kind: toolErrored ? "error" : "tool",
              title: boxTitle ?? boxDerivedTitle,
              model: null,
              lines: toolLines,
              changedAt: now,
            });
          }
          toolLines = null;
          outLines = [];
        }
        continue;
      }
      if (head === "╰" && /^╰[-─\s]*╯$/.test(rawLine)) {
        flushBox();
        flushProse();
        continue;
      }
      if (head === "│") {
        const stripped = rawLine
          .slice(1)
          .replace(/\s*│\s*$/, "")
          .trimEnd()
          .replace(/^ /, "");
        if (inBox) {
          const part = outLines ?? toolLines;
          if (part === null) continue;
          if (outLines === null) {
            // First body line of a headerless box: bash commands render as `$ cmd`.
            if (boxTitle === null && boxDerivedTitle === null && RE_BASH_HEADER.test(stripped)) {
              boxDerivedTitle = stripped.trim();
            }
          }
          if (RE_ERROR_LINE.test(stripped)) {
            if (outLines === null) toolErrored = true;
            else outErrored = true;
          }
          part.push(stripped);
        } else {
          // Orphan body line (box cut by the screen edge) — keep as prose.
          flushProse();
          prose = [stripped];
        }
        continue;
      }
      if (rawLine.trim() === "") {
        if (inBox) {
          (outLines ?? toolLines)?.push("");
        } else {
          flushProse();
        }
        continue;
      }

      // Everything below lives outside tool boxes.
      if (RE_MODEL_BADGE.test(rawLine)) {
        flushBox();
        flushProse();
        const model = RE_MODEL_BADGE.exec(rawLine)?.[1] ?? null;
        const prev = blocks[blocks.length - 1];
        if (prev !== undefined && prev.kind === "model" && prev.model === model) {
          prev.lines.push(rawLine.trim());
          prev.changedAt = now;
        } else {
          blocks.push({
            kind: "model",
            title: null,
            model,
            lines: [rawLine.trim()],
            changedAt: now,
          });
        }
        continue;
      }
      if (RE_ERROR_LINE.test(rawLine) || RE_STATUS_FAIL.test(rawLine)) {
        if (prose === null || !proseErrored) {
          flushProse();
          proseErrored = true;
        }
        prose = prose ?? [];
        prose.push(rawLine.trim());
        continue;
      }
      // Plain prose. After an error banner, following lines continue that
      // block (stack frames, URLs) until a blank line separates them.
      if (prose === null) prose = [];
      prose.push(rawLine.trim());
    }
    flushBox();
    flushProse();

    // A screen that only ever shows unstructured prose is not a transcript —
    // degrade to raw so the client renders the text instead of fake blocks.
    const structured = blocks.some((b) => b.kind !== "output");
    const parsed = this.stamp(blocks, now);
    return {
      mode: structured ? "structured" : "raw",
      blocks: structured ? parsed : [],
      text,
    };
  }

  /** Assign stable ids/timestamps via the identity map, then freeze it to
   *  exactly the blocks present in this parse (scrolled-off entries die). */
  private stamp(blocks: RawBlock[], now: number): ObserveBlock[] {
    const identity = new Map<string, { id: number; startedAt: number; endedAt?: number }>();
    const seenKeys = new Map<string, number>();
    const stamped: ObserveBlock[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const blockText = b.lines.join("\n");
      // Two identical blocks can share a screen (e.g. twin one-line boxes).
      // Disambiguate occurrences within THIS parse before consulting the
      // cross-parse identity map, or the second occurrence would overwrite
      // the first's entry and both would flip to one id on the next parse.
      let key = `${b.kind}\x00${b.title ?? ""}\x00${b.model ?? ""}\x00${blockText}`;
      const occurrence = seenKeys.get(key) ?? 0;
      seenKeys.set(key, occurrence + 1);
      if (occurrence > 0) key = `${key}#${occurrence}`;
      const prev = this.identity.get(key);
      const isBottom = i === blocks.length - 1;
      const id = prev?.id ?? this.nextId++;
      const startedAt = prev?.startedAt ?? now;
      const endedAt = isBottom ? undefined : (prev?.endedAt ?? b.changedAt);
      identity.set(key, { id, startedAt, endedAt });
      stamped.push({
        id,
        kind: b.kind,
        title: b.title,
        model: b.model,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt === undefined ? null : new Date(endedAt).toISOString(),
        text: blockText,
        lineCount: b.lines.length,
      });
    }
    if (identity.size > 1000) {
      for (const k of identity.keys()) {
        identity.delete(k);
        if (identity.size <= 500) break;
      }
    }
    this.identity = identity;
    return stamped;
  }
}

/** Minimal socket surface ObserveHub needs — ServerWebSocket satisfies it. */
export interface ObserveClient {
  /** WebSocket READY_STATE (1 = open). Bun's send() on a closed socket is a
   *  silent no-op, so liveness must be checked before adopting a client. */
  readonly readyState: number;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
  getBufferedAmount(): number;
}

const IDLE_POLL_MS = 400;
const FAST_POLL_MS = 100;
const ACTIVITY_BURST_MS = 1_500;
/** Backpressure cap, same rationale as the attach fan-out: full-state frames
 *  make skips lossless. */
const MAX_BUFFERED_BYTES = 1_000_000;

class ObserveSession {
  readonly observers = new Set<ObserveClient>();
  private lastRaw: string | null = null;
  private parser = new SessionParser();
  private pumping = false;
  private fastUntil = 0;
  private pollTimer: Timer | null = null;

  constructor(
    readonly paneId: string,
    private readonly backend: PaneBackend,
    private readonly onIdle: (session: ObserveSession) => void,
  ) {
    this.scheduleNext();
  }

  dispose(): void {
    clearTimeout(this.pollTimer ?? undefined);
    this.pollTimer = null;
  }

  private scheduleNext(): void {
    if (this.pollTimer) return;
    const ms = Date.now() < this.fastUntil ? FAST_POLL_MS : IDLE_POLL_MS;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pump();
      this.scheduleNext();
    }, ms);
  }

  /** First message(s) for a fresh observer: snapshot always, plus the raw
   *  text frame when the parser found no structure. The observer joins only
   *  after its snapshot is in flight, so broadcasts can never overtake it. */
  async snapshot(ws: ObserveClient): Promise<void> {
    const res = await this.backend.readVisible(this.paneId);
    // The client may have disconnected during the subscribe awaits; its
    // close handler's detach was a no-op (not yet an observer). Adopting a
    // dead socket here would pin the 400ms poller until the pane dies.
    if (ws.readyState !== 1) return;
    this.lastRaw = res.text;
    const parsed = this.parser.parse(res.text);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        paneId: this.paneId,
        mode: parsed.mode,
        blocks: parsed.blocks,
      }),
    );
    if (parsed.mode === "raw") {
      ws.send(JSON.stringify({ type: "raw", mode: "raw", paneId: this.paneId, text: parsed.text }));
    }
    this.observers.add(ws);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    if (this.observers.size === 0) return;
    this.pumping = true;
    try {
      const res = await this.backend.readVisible(this.paneId);
      if (res.text === this.lastRaw) return;
      this.lastRaw = res.text;
      const parsed = this.parser.parse(res.text);
      const payload =
        parsed.mode === "structured"
          ? JSON.stringify({ type: "blocks", mode: "structured", blocks: parsed.blocks })
          : JSON.stringify({ type: "raw", mode: "raw", paneId: this.paneId, text: parsed.text });
      for (const ws of this.observers) {
        if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) continue;
        ws.send(payload);
      }
      this.fastUntil = Date.now() + ACTIVITY_BURST_MS;
    } catch (e) {
      // Same contract as the attach watcher: only a missing pane is terminal;
      // backend hiccups are retried on the next tick.
      const gone = e instanceof PaneGoneError;
      if (!gone) {
        console.error(`observe pane.read ${this.paneId} failed (transient, will retry):`, e);
        return;
      }
      const reason = e instanceof Error ? e.message : String(e);
      this.dispose();
      for (const ws of this.observers) {
        ws.send(JSON.stringify({ type: "error", error: reason }));
        ws.close(1001, "pane gone");
      }
      this.observers.clear();
      this.onIdle(this);
    } finally {
      this.pumping = false;
    }
  }
}

export class ObserveHub {
  private sessions = new Map<string, ObserveSession>();
  private transcripts: TranscriptHub;

  constructor(private readonly backend: PaneBackend) {
    this.transcripts = new TranscriptHub(backend);
  }

  stop(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.transcripts.stop();
  }

  /**
   * A client frame. The channel never reaches the pane; the only frames it
   * accepts are the transcript opt-in and paging requests (session-transcript.ts).
   * False = anything else: the caller closes the socket 1008.
   */
  message(ws: ObserveClient, paneId: string, raw: string): boolean {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return false;
    }
    if (typeof msg !== "object" || msg === null) return false;
    const frame = msg as { type?: unknown; before?: unknown };
    if (frame.type === "transcript") {
      void this.transcripts
        .subscribe(ws, paneId)
        .then((fed) => {
          // Fed from the session log: the screen parser has nothing left to add.
          if (fed) this.leaveScreen(ws);
        })
        .catch((e: unknown) => console.error(`transcript subscribe ${paneId} failed:`, e));
      return true;
    }
    if (frame.type === "older") {
      void this.transcripts.older(ws, frame.before);
      return true;
    }
    return false;
  }

  /** Validate the pane exists, then attach the observer and deliver its
   *  snapshot. False = unknown pane (caller sends the error frame + close). */
  async subscribe(ws: ObserveClient, paneId: string): Promise<boolean> {
    try {
      await this.backend.getPane(paneId, 4000);
    } catch {
      return false;
    }
    let session = this.sessions.get(paneId);
    if (!session) {
      session = new ObserveSession(paneId, this.backend, (idle) => {
        if (idle.observers.size === 0) {
          idle.dispose();
          this.sessions.delete(idle.paneId);
        }
      });
      this.sessions.set(paneId, session);
    }
    try {
      await session.snapshot(ws);
    } catch (e) {
      // Snapshot read failed before the observer joined: don't leak a
      // polling session nobody is attached to.
      if (session.observers.size === 0) {
        session.dispose();
        this.sessions.delete(paneId);
      }
      throw e;
    }
    if (session.observers.size === 0) {
      // Snapshot skipped adoption (client disconnected mid-subscribe): don't
      // leave a poller running for a session nobody is attached to.
      session.dispose();
      this.sessions.delete(paneId);
    }
    return true;
  }

  detach(ws: ObserveClient): void {
    this.transcripts.detach(ws);
    this.leaveScreen(ws);
  }

  private leaveScreen(ws: ObserveClient): void {
    for (const session of this.sessions.values()) {
      if (!session.observers.delete(ws)) continue;
      if (session.observers.size === 0) {
        session.dispose();
        this.sessions.delete(session.paneId);
      }
    }
  }
}
