// Atur usage auto-report hook for omp.
// Install: ~/.omp/agent/extensions/atur-usage.ts (auto-discovered, all sessions).
// Source of truth copy lives in the atur repo: scripts/omp/atur-usage.ts.
//
// Watches Atur MCP tool calls to learn which issue the agent is tackling,
// sums exact token usage from session entries (assistant messages carry
// usage: input/output/cacheRead/cacheWrite), and files a time entry with
// source="agent" when the agent switches issues or the session ends.
// The agent never has to self-report; this is the harness-verified path.
//
//   ATUR_API_KEY      X-API-Key value; falls back to ATUR_API_KEY_FILE, then
//   ATUR_API_KEY_FILE key file path; falls back to ~/.config/atur/crew-api-key
//   ATUR_BASE_URL     default https://app.diatur.com
//   ATUR_AGENT_NAME  default omp/pane-<HERDR_PANE_ID> | omp/<session-id8>
//
// Failure model: every handler swallows its own errors — a broken report
// must never block a tool call or crash a session. Failed POSTs keep the
// cursor and retry on the next trigger.
// @ts-nocheck -- HookAPI types resolve only inside the omp host process

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

type IssueRef = { workspace: string; projectId: string; issueId: string };

const state: { issue: IssueRef | null; windowStart: number } = { issue: null, windowStart: 0 };
// Cursor = id of the last session entry already accounted for. Usage appended
// after the cursor is unreported; on success we advance it. Initialized at
// session start so resumed sessions never re-report their earlier life.
let cursor: string | null = null;
let initialized = false;

// Read per call so tests and long-lived sessions pick up env changes.
function baseUrl(): string {
  return (process.env.ATUR_BASE_URL || "https://app.diatur.com").replace(/\/+$/, "");
}

// Resolution: env var, then env-named file, then the default crew key file —
// panes and crewmates report without any env setup at all.
function apiKey(): string {
  if (process.env.ATUR_API_KEY) return process.env.ATUR_API_KEY;
  const file = process.env.ATUR_API_KEY_FILE || `${homedir()}/.config/atur/crew-api-key`;
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function agentName(sessionFile: string | undefined): string {
  if (process.env.ATUR_AGENT_NAME) return process.env.ATUR_AGENT_NAME;
  if (process.env.HERDR_PANE_ID) return `omp/pane-${process.env.HERDR_PANE_ID}`;
  const m = /([0-9a-f]{8})\.jsonl$/i.exec(sessionFile || "");
  return `omp/${m ? m[1] : "session"}`;
}

function ensureInit(ctx: any): void {
  if (initialized) return;
  initialized = true;
  try {
    const entries = ctx.sessionManager.getEntries();
    cursor = entries.length ? entries[entries.length - 1].id : null;
  } catch {
    cursor = null;
  }
}

// Walk session entries after the cursor, summing assistant-message usage.
function sumUsageSince(ctx: any): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: string | null;
  newCursor: string | null;
} {
  const sum = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    model: null as string | null,
    newCursor: cursor,
  };
  let seenCursor = cursor === null;
  for (const e of ctx.sessionManager.getEntries()) {
    if (!seenCursor) {
      if (e.id === cursor) seenCursor = true;
      continue;
    }
    const msg = e.type === "message" ? e.message : null;
    if (msg?.role === "assistant" && msg.usage) {
      const u = msg.usage;
      sum.input += Number(u.input) || 0;
      sum.output += Number(u.output) || 0;
      sum.cacheRead += Number(u.cacheRead) || 0;
      sum.cacheWrite += Number(u.cacheWrite) || 0;
      if (msg.model) sum.model = msg.model;
    }
    sum.newCursor = e.id;
  }
  return sum;
}

// File one time entry for the open window, then adopt `next` (issue switch)
// or close the window. Throws on POST failure; callers swallow and retry later.
async function flush(ctx: any, next?: { issue: IssueRef; windowStart: number }): Promise<void> {
  const issue = state.issue;
  if (!issue) {
    if (next) Object.assign(state, next);
    return;
  }
  const sum = sumUsageSince(ctx);
  const total = sum.input + sum.output + sum.cacheRead + sum.cacheWrite;
  if (total <= 0) {
    cursor = sum.newCursor;
    if (next) Object.assign(state, next);
    return;
  }
  const name = agentName(ctx?.sessionManager?.getSessionFile?.());
  const body: Record<string, unknown> = {
    duration_seconds: Math.max(60, Math.round((Date.now() - state.windowStart) / 1000)),
    description: `auto: ${name}`,
    source: "agent",
    agent_name: name,
    input_tokens: Math.round(sum.input),
    output_tokens: Math.round(sum.output),
    cache_read_tokens: Math.round(sum.cacheRead),
    cache_write_tokens: Math.round(sum.cacheWrite),
  };
  if (sum.model) body.model = sum.model;
  const url = `${baseUrl()}/api/workspaces/${issue.workspace}/projects/${issue.projectId}/issues/${issue.issueId}/time-entries`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`atur-usage: POST ${url} -> ${res.status}`);
  cursor = sum.newCursor;
  if (next) Object.assign(state, next);
  else state.issue = null;
}

export default function aturUsageHook(pi: any): void {
  // Open/switch the usage window when the agent works an Atur issue via MCP.
  pi.on("tool_call", async (event: any, ctx: any) => {
    try {
      if (!apiKey()) return;
      ensureInit(ctx);
      const tool = String(event?.toolName ?? "");
      const input = event?.input;
      if (!/atur/i.test(tool) || !input) return;
      const workspace = input.workspace;
      const projectId = input.project_id;
      const issueId = input.issue_id;
      if (typeof workspace !== "string" || !workspace) return;
      if (typeof projectId !== "string" || !projectId) return;
      if (typeof issueId !== "string" || !issueId) return;
      if (state.issue?.issueId === issueId) return;
      await flush(ctx, { issue: { workspace, projectId, issueId }, windowStart: Date.now() });
    } catch (err: any) {
      pi.logger?.error?.(`atur-usage: ${err?.message ?? err}`);
    }
  });

  // File the window when the session ends or the user switches away.
  const endHandler = async (_event: any, ctx: any) => {
    try {
      if (!apiKey()) return;
      ensureInit(ctx);
      await flush(ctx);
    } catch (err: any) {
      pi.logger?.error?.(`atur-usage: ${err?.message ?? err}`);
    }
  };
  pi.on("session_shutdown", endHandler);
  pi.on("session_before_switch", endHandler);

  // Initialize the cursor before any turn can run.
  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      ensureInit(ctx);
    } catch {
      initialized = true;
      cursor = null;
    }
  });
}
