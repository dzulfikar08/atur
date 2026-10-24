// Pure helpers for the session-log transcript (components/terminal/transcript.tsx),
// kept free of React Native so bun can test them. The wire format is defined by
// apps/bridge/src/session-transcript.ts; `mergeEntries` below is a deliberate
// twin of the bridge's so both sides fold a tool call and its result the same way.

export type TranscriptRole = "user" | "assistant" | "tool" | "ask";
export type ToolStatus = "running" | "done" | "error";

export interface TranscriptTool {
  name: string;
  /** One line: the path, command, query or question the call is about. */
  summary: string;
  status: ToolStatus;
  /** Result text (the bridge clips it to ~40 lines); absent while running. */
  result?: string;
}

export interface TranscriptEntry {
  id: string;
  /** Total order across the session; entries are sorted by it. */
  seq: number;
  role: TranscriptRole;
  text: string;
  /** Epoch ms, when the log carried a timestamp. */
  at: number | null;
  /** An assistant entry reporting a failed or interrupted turn. */
  error?: boolean;
  tool?: TranscriptTool;
}

/** The whole chat: oldest first, plus where the next `older` request starts. */
export interface ChatState {
  entries: TranscriptEntry[];
  hasMore: boolean;
  /** Byte offset of the oldest loaded line; the `before` of the next page. */
  cursor: number;
}

const ROLES: Record<string, true> = { user: true, assistant: true, tool: true, ask: true };
const STATUSES: Record<string, true> = { running: true, done: true, error: true };

function parseTool(value: unknown): TranscriptTool | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const t = value as Record<string, unknown>;
  const status = typeof t.status === "string" && STATUSES[t.status] ? t.status : "done";
  return {
    name: typeof t.name === "string" ? t.name : "",
    summary: typeof t.summary === "string" ? t.summary : "",
    status: status as ToolStatus,
    ...(typeof t.result === "string" ? { result: t.result } : {}),
  };
}

/** Defensive frame → entry coercion; malformed entries are dropped, not trusted. */
export function parseEntry(value: unknown): TranscriptEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.seq !== "number" || !Number.isFinite(e.seq)) return null;
  if (typeof e.role !== "string" || !ROLES[e.role] || typeof e.text !== "string") return null;
  const tool = parseTool(e.tool);
  return {
    id: e.id,
    seq: e.seq,
    role: e.role as TranscriptRole,
    text: e.text,
    at: typeof e.at === "number" ? e.at : null,
    ...(e.error === true ? { error: true } : {}),
    ...(tool ? { tool } : {}),
  };
}

export function parseEntries(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseEntry).filter((e): e is TranscriptEntry => e !== null);
}

/** Fold two views of one entry id (a call and its result): keeps what either knows. */
function mergeEntry(prev: TranscriptEntry, next: TranscriptEntry): TranscriptEntry {
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

/**
 * Union by id (updates merged), ordered by seq. Unchanged entries keep their
 * object identity so memoized rows do not re-render when a page arrives.
 */
export function mergeEntries(
  base: readonly TranscriptEntry[],
  incoming: readonly TranscriptEntry[],
): TranscriptEntry[] {
  if (incoming.length === 0) return base as TranscriptEntry[];
  const byId = new Map<string, TranscriptEntry>();
  for (const e of base) byId.set(e.id, e);
  for (const e of incoming) {
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? mergeEntry(prev, e) : e);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function cursorOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Apply one bridge frame to the chat.
 *   transcript  newest page: replaces everything (first connect, reconnect, new session)
 *   append      lines written since: merged in
 *   older       reply to a page-back request: merged in, cursor/hasMore advance
 * Anything else (and append/older with no chat yet) leaves the state unchanged.
 */
export function applyChatFrame(
  state: ChatState | null,
  frame: Record<string, unknown>,
): ChatState | null {
  switch (frame.type) {
    case "transcript":
      return {
        entries: mergeEntries([], parseEntries(frame.entries)),
        hasMore: frame.hasMore === true,
        cursor: cursorOf(frame.cursor, 0),
      };
    case "append":
      return (
        state && { ...state, entries: mergeEntries(state.entries, parseEntries(frame.entries)) }
      );
    case "older": {
      // A reply to a request made before the list was replaced is stale.
      if (!state || frame.before !== state.cursor) return state;
      // `busy` = the bridge declined; nothing changed, ask again later.
      if (frame.busy === true) return state;
      return {
        entries: mergeEntries(state.entries, parseEntries(frame.entries)),
        hasMore: frame.hasMore === true,
        cursor: cursorOf(frame.cursor, state.cursor),
      };
    }
    default:
      return state;
  }
}

/** FlatList `inverted` wants the newest row first. */
export function newestFirst(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.slice().reverse();
}

/** "web_search" → "Web search". */
export function toolTitle(name: string): string {
  const spaced = name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return "Tool";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Ionicons name for a tool row. */
export function toolIcon(name: string): string {
  switch (name.toLowerCase()) {
    case "read":
      return "document-text-outline";
    case "edit":
    case "write":
    case "ast_edit":
      return "create-outline";
    case "bash":
    case "eval":
      return "terminal-outline";
    case "grep":
    case "glob":
      return "search-outline";
    case "web_search":
    case "websearch":
      return "globe-outline";
    case "task":
    case "agent":
      return "git-branch-outline";
    default:
      return "construct-outline";
  }
}

/**
 * An ask the agent is still waiting on: the newest entry, unanswered. An
 * unanswered ask further back was abandoned (interrupted), not pending.
 */
export function isPendingAsk(entry: TranscriptEntry, newest: TranscriptEntry | undefined): boolean {
  return entry.role === "ask" && entry.tool?.status === "running" && entry.id === newest?.id;
}
