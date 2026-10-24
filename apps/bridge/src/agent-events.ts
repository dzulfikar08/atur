/**
 * Outbound agent events: watches herdr's pane list and, when an agent pane
 * finishes a turn ("done") or needs the human ("blocked"), POSTs one event to
 * the Atur Worker, which fans it out as a push notification.
 *
 * The tracker is pure (no timers, no I/O) so the settle/cancel rules are
 * testable; AgentEventWatcher owns polling and delivery.
 */
import { open } from "node:fs/promises";
import type { AgentStatus, PaneBackend, PaneSummary } from "./backend";
import { DEFAULT_ATUR_URL } from "./connect";

export type { AgentStatus } from "./backend";
export type EventStatus = "done" | "blocked";

export interface TrackedPane {
  pane_id: string;
  agent: string | null;
  agent_status: AgentStatus;
  cwd: string | null;
  title: string | null;
  session_path: string | null;
}

export interface AgentTransition {
  pane_id: string;
  status: EventStatus;
  agent: string;
  cwd: string | null;
  title: string | null;
  session_path: string | null;
}

export interface AgentEventsConfig {
  url: string;
  token: string;
}

const DETAIL_MAX = 180;
const TAIL_BYTES = 256 * 1024;

export function agentEventsConfigFromEnv(
  env: Record<string, string | undefined>,
): AgentEventsConfig | null {
  const token = env.BRIDGE_TOKEN ?? "";
  if (!token) return null;
  const url = (env.ATUR_URL || DEFAULT_ATUR_URL).replace(/\/+$/, "");
  return { url, token };
}

/** Strips omp's `π <spinner|>` title prefix; other titles pass through trimmed. */
export function cleanAgentTitle(raw: string | null): string | null {
  if (raw === null) return null;
  let t = raw.trim();
  if (t.startsWith("π")) {
    t = t.slice(1).trimStart();
    const first = [...t][0];
    if (first !== undefined && (first === ">" || /^[\u2800-\u28ff]$/.test(first))) {
      t = t.slice(first.length);
    }
    t = t.trim();
  }
  return t === "" ? null : t;
}

interface PaneState {
  status: AgentStatus;
  pending: { kind: EventStatus; since: number } | null;
}

const READY = new Set<AgentStatus>(["idle", "done"]);

export class AgentStateTracker {
  private readonly panes = new Map<string, PaneState>();
  private readonly settleMs: number;

  constructor(opts: { settleMs?: number } = {}) {
    this.settleMs = opts.settleMs ?? 3000;
  }

  observe(panes: TrackedPane[], now: number): AgentTransition[] {
    const out: AgentTransition[] = [];
    const seen = new Set<string>();
    for (const pane of panes) {
      if (pane.agent === null) continue;
      seen.add(pane.pane_id);
      const status = pane.agent_status;
      const state = this.panes.get(pane.pane_id);
      if (!state) {
        this.panes.set(pane.pane_id, { status, pending: null });
        continue;
      }
      if (status !== state.status) {
        const prev = state.status;
        if (status === "working") {
          state.pending = null;
        } else if (READY.has(status) && (prev === "working" || prev === "blocked")) {
          state.pending = { kind: "done", since: now };
        } else if (status === "blocked") {
          state.pending = { kind: "blocked", since: now };
        } else if (prev === "done" && status === "idle") {
          if (state.pending?.kind === "done") state.pending = null;
        }
        state.status = status;
      }
      const p = state.pending;
      if (p && now - p.since >= this.settleMs) {
        const qualifies = p.kind === "blocked" ? status === "blocked" : READY.has(status);
        state.pending = null;
        if (qualifies) {
          out.push({
            pane_id: pane.pane_id,
            status: p.kind,
            agent: pane.agent,
            cwd: pane.cwd,
            title: pane.title,
            session_path: pane.session_path,
          });
        }
      }
    }
    for (const id of this.panes.keys()) if (!seen.has(id)) this.panes.delete(id);
    return out;
  }
}

function collapse(text: string): string | null {
  // Notifications render plain text: drop markdown emphasis and code ticks.
  const s = text
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s;
}

async function readTail(path: string): Promise<string> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl < 0 ? "" : text.slice(nl + 1);
    }
    return text;
  } finally {
    await fh.close();
  }
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null;
}

/** Best-effort one-line context from an omp session file; null on any problem. */
export async function readSessionDetail(path: string, status: EventStatus): Promise<string | null> {
  try {
    const lines = (await readTail(path)).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObj(entry) || !isObj(entry.message) || entry.message.role !== "assistant") continue;
      const content = entry.message.content;
      if (!Array.isArray(content)) continue;
      if (status === "blocked") {
        for (let j = content.length - 1; j >= 0; j--) {
          const part: unknown = content[j];
          if (!isObj(part) || part.type !== "toolCall" || part.name !== "ask") continue;
          const questions = isObj(part.arguments) ? part.arguments.questions : undefined;
          const q =
            Array.isArray(questions) && isObj(questions[0]) ? questions[0].question : undefined;
          if (typeof q === "string") return collapse(q);
        }
      } else {
        const text = content
          .map((p: unknown) =>
            isObj(p) && p.type === "text" && typeof p.text === "string" ? p.text : "",
          )
          .join(" ");
        const detail = collapse(text);
        if (detail) return detail;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Delivery over the relay socket (see connect.ts) instead of HTTP. */
export interface EventRelay {
  sendEvent(event: unknown): boolean;
}

export class AgentEventWatcher {
  private readonly tracker: AgentStateTracker;
  private readonly pollMs: number;
  private readonly relay: EventRelay | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private pollFailing = false;

  /**
   * With `opts.relay` set, events travel as `event` frames over the relay
   * socket and nothing is POSTed; otherwise they go to `config.url` over HTTP
   * (the owner's tunnel setup).
   */
  constructor(
    private readonly config: AgentEventsConfig | null,
    private readonly backend: PaneBackend,
    opts: { pollMs?: number; settleMs?: number; relay?: EventRelay } = {},
  ) {
    this.tracker = new AgentStateTracker({ settleMs: opts.settleMs });
    this.pollMs = opts.pollMs ?? (Number(process.env.AGENT_POLL_MS) || 2000);
    this.relay = opts.relay ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      let panes: PaneSummary[];
      try {
        panes = await this.backend.pollPanes();
        this.pollFailing = false;
      } catch (e) {
        if (!this.pollFailing) console.error("agent-events: pane list failed:", e);
        this.pollFailing = true;
        return;
      }
      const byId = new Map<string, TrackedPane>();
      for (const p of panes) {
        byId.set(p.id, {
          pane_id: p.id,
          agent: p.agent,
          agent_status: p.agentStatus ?? "unknown",
          cwd: p.cwd,
          title: cleanAgentTitle(p.title),
          session_path: p.agentSessionPath,
        });
      }
      for (const t of this.tracker.observe([...byId.values()], Date.now())) {
        await this.send(t);
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async send(t: AgentTransition): Promise<void> {
    const detail =
      t.agent === "omp" && t.session_path
        ? await readSessionDetail(t.session_path, t.status)
        : null;
    const body = {
      pane_id: t.pane_id,
      status: t.status,
      agent: t.agent,
      cwd: t.cwd,
      title: t.title,
      detail,
    };
    if (this.relay) {
      const sent = this.relay.sendEvent(body);
      console.log(
        `agent-events: ${t.pane_id} ${t.status} → relay${sent ? "" : " (queued, offline)"}`,
      );
      return;
    }
    if (!this.config) return;
    try {
      const res = await fetch(`${this.config.url}/api/bridge/agent-events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bridge-token": this.config.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`agent-events: ${t.pane_id} ${t.status} → ${res.status}`);
    } catch (e) {
      console.error(`agent-events: ${t.pane_id} ${t.status} failed:`, e);
    }
  }
}
