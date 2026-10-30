// Agent terminal <-> Atur issue links (table agent_sessions).
//
// A link says "the agent in this pane is working on this issue". Sources, from
// strongest to weakest evidence of intent: the claim comment convention
// (AGENTS.md "Picked up by <agent> (pane <id>)"), an explicit link (UI / MCP
// link_session_issue), and the atur-usage hook's detection from the session's
// MCP calls. State follows the bridge's agent events (done / blocked) and,
// per workspace setting, reacts on the issue (comment, suggested state, or an
// automatic state change; default is a comment on "blocked" only).
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import type { AgentEvent } from "./agentPush";
import { splitPaneId } from "../lib/relayProtocol";
import * as workspaceRepo from "../repositories/workspaces";
import * as memberRepo from "../repositories/members";
import * as commentsRepo from "../repositories/comments";
import * as issuesRepo from "../repositories/issues";
import * as activitiesRepo from "../repositories/activities";

export const SESSION_STATES = ["working", "done", "blocked", "idle", "unknown"] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const LINK_SOURCES = ["claim_comment", "usage_hook", "mcp", "manual"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];
export const REACTIONS = ["off", "comment", "suggest", "auto"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const APP_URL = "https://app.diatur.com";
/** A comment per (session, state) at most this often: turns end many times per task. */
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
/** Rows not touched for this long no longer count as "active". */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AgentSessionIssue {
  id: string;
  key: string;
  name: string;
  projectId: string;
  workspaceSlug: string;
  stateId: string | null;
  stateKey: string | null;
  stateName: string | null;
  stateGroup: string | null;
  priority: string | null;
  url: string;
}

export interface AgentSessionWire {
  id: string;
  /** Client-facing id: `<machine>~<local>` for a relay machine, else the bridge-local id. */
  paneId: string;
  machineId: string | null;
  localPaneId: string;
  sessionId: string | null;
  agent: string | null;
  state: SessionState;
  stateAt: number;
  source: LinkSource;
  linkedAt: number;
  updatedAt: number;
  endedAt: number | null;
  cwd: string | null;
  title: string | null;
  suggestedStateId: string | null;
  issue: AgentSessionIssue;
}

// ── Pane id helpers ───────────────────────────────────────────────────────

/** Split a client-facing pane id (optionally with an explicit machine id) into the stored key. */
export function paneKey(
  paneId: string,
  machineId?: string | null,
): { machineId: string; paneId: string } {
  const split = splitPaneId(paneId);
  if (split) return split;
  return { machineId: machineId ?? "", paneId };
}

export const clientPaneId = (machineId: string, paneId: string): string =>
  machineId ? `${machineId}~${paneId}` : paneId;

/**
 * Session id from an agent transcript path (omp: `<timestamp>_<uuid>.jsonl`):
 * the part after the first underscore, without the extension. The bridge and
 * the atur-usage hook derive it the same way so their reports meet.
 */
export function sessionIdFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path
    .split("/")
    .pop()!
    .replace(/\.jsonl?$/i, "");
  const id = base.includes("_") ? base.slice(base.indexOf("_") + 1) : base;
  return id || null;
}

// ── Claim comment ─────────────────────────────────────────────────────────

const CLAIM = /Picked up by\s+(.+?)\s*\(\s*pane\s+([^\s)]+)\s*\)/i;

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/** The agent and pane id of a "Picked up by <agent> (pane <id>)" claim, or null. */
export function parseClaim(html: string): { agent: string; paneId: string } | null {
  const m = CLAIM.exec(htmlToText(html));
  if (!m) return null;
  const paneId = m[2]!.replace(/[.,;:]+$/, "");
  if (!paneId || paneId.startsWith("<")) return null; // an unfilled template placeholder
  return { agent: m[1]!.trim().slice(0, 64), paneId: paneId.slice(0, 128) };
}

/** Best-effort: link the pane named by a claim comment to the issue it was posted on. */
export async function linkFromComment(
  db: DbClient,
  issue: { id: string; projectId: string; workspaceId: string },
  actorId: string,
  commentHtml: string,
): Promise<void> {
  const claim = parseClaim(commentHtml);
  if (!claim) return;
  try {
    const key = paneKey(claim.paneId);
    await linkPane(db, {
      ...key,
      workspaceId: issue.workspaceId,
      projectId: issue.projectId,
      issueId: issue.id,
      agent: claim.agent,
      source: "claim_comment",
      state: "working",
      linkedById: actorId,
    });
  } catch (err) {
    console.error("agent session claim link failed:", err);
  }
}

// ── Writes ────────────────────────────────────────────────────────────────

export interface LinkInput {
  machineId: string;
  paneId: string;
  workspaceId: string;
  projectId: string;
  issueId: string;
  sessionId?: string | null;
  agent?: string | null;
  source: LinkSource;
  state?: SessionState;
  cwd?: string | null;
  title?: string | null;
  linkedById?: string | null;
}

type Row = typeof schema.agentSessions.$inferSelect;

/** The row for a pane; a row stored without a machine (claim comment) matches any machine. */
async function findRow(db: DbClient, machineId: string, paneId: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.paneId, paneId));
  const exact = rows.find((r) => r.machineId === machineId);
  if (exact) return exact;
  if (machineId) return rows.find((r) => r.machineId === "") ?? null;
  return rows.length === 1 ? rows[0]! : (rows.find((r) => r.machineId === "") ?? null);
}

/** Create or replace the link for a pane. The usage hook never overrides a stronger link of the same session. */
export async function linkPane(db: DbClient, input: LinkInput): Promise<Row> {
  const now = Date.now();
  const existing = await findRow(db, input.machineId, input.paneId);
  if (!existing) {
    const row: Row = {
      id: uuid(),
      paneId: input.paneId,
      machineId: input.machineId,
      sessionId: input.sessionId ?? null,
      agent: input.agent ?? null,
      state: input.state ?? "unknown",
      stateAt: now,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      issueId: input.issueId,
      source: input.source,
      cwd: input.cwd ?? null,
      title: input.title ?? null,
      linkedById: input.linkedById ?? null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
      lastNotifiedState: null,
      lastNotifiedAt: null,
      suggestedStateId: null,
    };
    await db.insert(schema.agentSessions).values(row);
    return row;
  }

  const sameSession =
    !existing.sessionId || !input.sessionId || existing.sessionId === input.sessionId;
  const protectedLink =
    input.source === "usage_hook" &&
    sameSession &&
    existing.endedAt === null &&
    (existing.source === "manual" || existing.source === "claim_comment");
  const sameIssue = existing.issueId === input.issueId;
  const keepIssue = protectedLink && !sameIssue;

  const patch: Partial<Row> = {
    updatedAt: now,
    machineId: existing.machineId || input.machineId,
    sessionId: input.sessionId ?? existing.sessionId,
    agent: input.agent ?? existing.agent,
    cwd: input.cwd ?? existing.cwd,
    title: input.title ?? existing.title,
  };
  if (!keepIssue) {
    Object.assign(patch, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      issueId: input.issueId,
      source: protectedLink ? existing.source : input.source,
      linkedById: input.linkedById ?? existing.linkedById,
      endedAt: null,
    });
    if (!sameIssue) {
      Object.assign(patch, {
        suggestedStateId: null,
        lastNotifiedState: null,
        lastNotifiedAt: null,
        state: input.state ?? "unknown",
        stateAt: now,
      });
    } else if (input.state && input.state !== existing.state) {
      Object.assign(patch, { state: input.state, stateAt: now });
    }
  }
  await db.update(schema.agentSessions).set(patch).where(eq(schema.agentSessions.id, existing.id));
  return { ...existing, ...patch } as Row;
}

export async function unlinkPane(
  db: DbClient,
  machineId: string,
  paneId: string,
): Promise<Row | null> {
  const row = await findRow(db, machineId, paneId);
  if (!row) return null;
  await db.delete(schema.agentSessions).where(eq(schema.agentSessions.id, row.id));
  return row;
}

/** The agent session ended (hook `session_shutdown`): keep the link, mark it inactive. */
export async function endSession(
  db: DbClient,
  machineId: string,
  paneId: string,
  sessionId: string | null,
): Promise<Row | null> {
  const row = await findRow(db, machineId, paneId);
  if (!row) return null;
  if (sessionId && row.sessionId && row.sessionId !== sessionId) return row; // a newer session owns the pane
  const now = Date.now();
  await db
    .update(schema.agentSessions)
    .set({ endedAt: now, updatedAt: now, state: "idle", stateAt: now })
    .where(eq(schema.agentSessions.id, row.id));
  return { ...row, endedAt: now, state: "idle", stateAt: now, updatedAt: now };
}

/** Bind rows stored without a machine to the machine that turned out to own the pane. */
export async function adoptMachine(db: DbClient, machineId: string, paneId: string): Promise<void> {
  if (!machineId) return;
  const rows = await db
    .select({ id: schema.agentSessions.id, machineId: schema.agentSessions.machineId })
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.paneId, paneId));
  if (rows.some((r) => r.machineId === machineId)) return;
  const blank = rows.find((r) => r.machineId === "");
  if (!blank) return;
  await db
    .update(schema.agentSessions)
    .set({ machineId })
    .where(eq(schema.agentSessions.id, blank.id));
}

// ── Settings ──────────────────────────────────────────────────────────────

export const settingsSchema = z.object({
  on_blocked: z.enum(REACTIONS).optional(),
  on_done: z.enum(REACTIONS).optional(),
});

export interface AgentSessionSettings {
  onBlocked: Reaction;
  onDone: Reaction;
}

export async function getSettings(
  db: DbClient,
  workspaceId: string,
): Promise<AgentSessionSettings> {
  const [row] = await db
    .select()
    .from(schema.agentSessionSettings)
    .where(eq(schema.agentSessionSettings.workspaceId, workspaceId))
    .limit(1);
  return {
    onBlocked: (row?.onBlocked as Reaction) ?? "comment",
    onDone: (row?.onDone as Reaction) ?? "off",
  };
}

export async function updateSettings(
  db: DbClient,
  workspaceId: string,
  patch: z.infer<typeof settingsSchema>,
): Promise<AgentSessionSettings> {
  const current = await getSettings(db, workspaceId);
  const next = {
    onBlocked: patch.on_blocked ?? current.onBlocked,
    onDone: patch.on_done ?? current.onDone,
  };
  await db
    .insert(schema.agentSessionSettings)
    .values({ workspaceId, ...next, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.agentSessionSettings.workspaceId,
      set: { ...next, updatedAt: Date.now() },
    });
  return next;
}

// ── Agent events ──────────────────────────────────────────────────────────

export interface SessionEvent {
  status: "done" | "blocked";
  paneId: string;
  machineId: string;
  agent?: string | null;
  cwd?: string | null;
  title?: string | null;
  detail?: string | null;
  sessionId?: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * An agent finished a turn (done) or needs the human (blocked): record it on
 * the linked session and apply the workspace's reaction on the issue. Returns
 * what was done; a pane without a link is ignored.
 */
export async function recordEvent(
  db: DbClient,
  event: SessionEvent,
): Promise<{ linked: boolean; action: "none" | "comment" | "suggest" | "auto" }> {
  const row = await findRow(db, event.machineId, event.paneId);
  if (!row || row.endedAt !== null) return { linked: false, action: "none" };
  const now = Date.now();
  const state: SessionState = event.status;
  const patch: Partial<Row> = {
    state,
    stateAt: now,
    updatedAt: now,
    machineId: row.machineId || event.machineId,
    agent: event.agent ?? row.agent,
    cwd: event.cwd ?? row.cwd,
    title: event.title ?? row.title,
    sessionId: row.sessionId ?? event.sessionId ?? null,
  };

  const settings = await getSettings(db, row.workspaceId);
  const reaction = event.status === "blocked" ? settings.onBlocked : settings.onDone;
  const cooled =
    row.lastNotifiedState === state &&
    row.lastNotifiedAt !== null &&
    now - row.lastNotifiedAt < NOTIFY_COOLDOWN_MS;
  let action: "none" | "comment" | "suggest" | "auto" = "none";

  if (reaction !== "off" && !cooled) {
    const issue = await issuesRepo.findById(db, row.issueId);
    if (issue && !issue.deletedAt) {
      const target = await targetState(db, issue, event.status);
      const label = event.status === "blocked" ? "needs you" : "finished a turn";
      const where = row.agent
        ? `${esc(row.agent)} (pane ${esc(event.paneId)})`
        : `pane ${esc(event.paneId)}`;
      let html = `<p>Agent ${where} ${label}${event.detail ? `: ${esc(event.detail)}` : "."}</p>`;
      if (reaction === "suggest" && target) {
        html += `<p>Suggested state: <strong>${esc(target.name)}</strong>.</p>`;
        patch.suggestedStateId = target.id;
      }
      if (reaction === "auto" && target) {
        await moveIssue(db, issue, target, row.linkedById);
        html += `<p>Moved to <strong>${esc(target.name)}</strong> automatically.</p>`;
        patch.suggestedStateId = null;
      }
      if (row.linkedById) {
        await commentsRepo.create(db, {
          commentHtml: html,
          access: "internal",
          issueId: issue.id,
          actorId: row.linkedById,
        });
        action =
          reaction === "auto" && target
            ? "auto"
            : reaction === "suggest" && target
              ? "suggest"
              : "comment";
        patch.lastNotifiedState = state;
        patch.lastNotifiedAt = now;
      }
    }
  }
  await db.update(schema.agentSessions).set(patch).where(eq(schema.agentSessions.id, row.id));
  return { linked: true, action };
}

type IssueRow = typeof schema.issues.$inferSelect;

/** State key to propose for an event, only when the issue is in a state it may leave. */
async function targetState(
  db: DbClient,
  issue: IssueRow,
  status: "done" | "blocked",
): Promise<{ id: string; name: string; key: string } | null> {
  const current = issue.stateId
    ? (
        await db
          .select({ key: schema.states.key, group: schema.states.groupName })
          .from(schema.states)
          .where(eq(schema.states.id, issue.stateId))
          .limit(1)
      )[0]
    : undefined;
  const group = current?.group ?? "";
  if (group === "completed" || group === "cancelled") return null;
  const wantKey = status === "done" ? "need_review" : "needs_you";
  if (current?.key === wantKey) return null;
  // A finished turn only proposes review for work that is under way.
  if (status === "done" && current?.key !== "in_progress") return null;
  const [state] = await db
    .select({ id: schema.states.id, name: schema.states.name, key: schema.states.key })
    .from(schema.states)
    .where(
      and(
        eq(schema.states.projectId, issue.projectId),
        eq(schema.states.key, wantKey),
        isNull(schema.states.deletedAt),
      ),
    )
    .limit(1);
  return state ? { id: state.id, name: state.name, key: state.key ?? wantKey } : null;
}

async function moveIssue(
  db: DbClient,
  issue: IssueRow,
  target: { id: string; name: string },
  actorId: string | null,
): Promise<void> {
  const [old] = issue.stateId
    ? await db
        .select({ name: schema.states.name })
        .from(schema.states)
        .where(eq(schema.states.id, issue.stateId))
        .limit(1)
    : [];
  await issuesRepo.update(db, issue.id, { stateId: target.id });
  await activitiesRepo.create(db, {
    verb: "updated",
    field: "state",
    oldValue: old?.name ?? null,
    newValue: target.name,
    issueId: issue.id,
    actorId,
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────

export interface ListOpts {
  workspaceIds: string[];
  /** Client-facing pane ids; each matches by stored machine + local id. */
  panes?: string[];
  sessionId?: string;
  state?: SessionState;
  activeOnly?: boolean;
  limit?: number;
}

/** Sessions in the given workspaces, newest activity first, with the linked issue resolved. */
export async function list(db: DbClient, opts: ListOpts): Promise<AgentSessionWire[]> {
  if (opts.workspaceIds.length === 0) return [];
  const conds = [
    inArray(schema.agentSessions.workspaceId, opts.workspaceIds),
    isNull(schema.issues.deletedAt),
  ];
  if (opts.state) conds.push(eq(schema.agentSessions.state, opts.state));
  if (opts.sessionId) conds.push(eq(schema.agentSessions.sessionId, opts.sessionId));
  if (opts.activeOnly) {
    conds.push(isNull(schema.agentSessions.endedAt));
    conds.push(sql`${schema.agentSessions.updatedAt} >= ${Date.now() - ACTIVE_WINDOW_MS}`);
  }
  if (opts.panes) {
    const keys = opts.panes.map((p) => paneKey(p));
    if (keys.length === 0) return [];
    const byPane = keys.map((k) =>
      k.machineId
        ? and(
            eq(schema.agentSessions.paneId, k.paneId),
            or(
              eq(schema.agentSessions.machineId, k.machineId),
              eq(schema.agentSessions.machineId, ""),
            ),
          )
        : eq(schema.agentSessions.paneId, k.paneId),
    );
    conds.push(or(...byPane)!);
  }
  const rows = await db
    .select({
      s: schema.agentSessions,
      issueName: schema.issues.name,
      sequenceId: schema.issues.sequenceId,
      priority: schema.issues.priority,
      identifier: schema.projects.identifier,
      slug: schema.workspaces.slug,
      stateId: schema.states.id,
      stateKey: schema.states.key,
      stateName: schema.states.name,
      stateGroup: schema.states.groupName,
    })
    .from(schema.agentSessions)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.agentSessions.issueId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.agentSessions.workspaceId))
    .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(and(...conds))
    .orderBy(desc(schema.agentSessions.updatedAt))
    .limit(Math.min(opts.limit ?? 200, 500));

  return rows.map((r) => {
    const s = r.s;
    return {
      id: s.id,
      paneId: clientPaneId(s.machineId, s.paneId),
      machineId: s.machineId || null,
      localPaneId: s.paneId,
      sessionId: s.sessionId,
      agent: s.agent,
      state: s.state as SessionState,
      stateAt: s.stateAt,
      source: s.source as LinkSource,
      linkedAt: s.createdAt,
      updatedAt: s.updatedAt,
      endedAt: s.endedAt,
      cwd: s.cwd,
      title: s.title,
      suggestedStateId: s.suggestedStateId,
      issue: {
        id: s.issueId,
        key: `${r.identifier}-${r.sequenceId}`,
        name: r.issueName,
        projectId: s.projectId,
        workspaceSlug: r.slug,
        stateId: r.stateId,
        stateKey: r.stateKey,
        stateName: r.stateName,
        stateGroup: r.stateGroup,
        priority: r.priority,
        url: `${APP_URL}/${r.slug}/projects/${s.projectId}/issues/${r.sequenceId}`,
      },
    };
  });
}

// ── Authz + issue resolution ──────────────────────────────────────────────

export async function requireMemberOf(db: DbClient, slug: string, userId: string) {
  const ws = await workspaceRepo.findBySlug(db, slug);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  if (ws.ownerId !== userId && !(await memberRepo.isWorkspaceMember(db, ws.id, userId))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }
  return ws;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^([A-Za-z0-9_]+)-(\d+)$/;

/** An issue of the workspace by uuid, `KEY-12`, or sequence number plus project_id. */
export async function resolveIssueRef(
  db: DbClient,
  workspaceId: string,
  ref: string,
  projectId?: string,
) {
  const base = and(eq(schema.issues.workspaceId, workspaceId), isNull(schema.issues.deletedAt));
  if (UUID.test(ref)) {
    const [row] = await db
      .select()
      .from(schema.issues)
      .where(and(base, eq(schema.issues.id, ref)))
      .limit(1);
    if (row) return row;
  }
  const key = KEY.exec(ref);
  if (key) {
    const [row] = await db
      .select({ issue: schema.issues })
      .from(schema.issues)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
      .where(
        and(
          base,
          sql`lower(${schema.projects.identifier}) = ${key[1]!.toLowerCase()}`,
          eq(schema.issues.sequenceId, Number(key[2])),
          isNull(schema.projects.deletedAt),
        ),
      )
      .limit(1);
    if (row) return row.issue;
  }
  if (projectId && /^\d+$/.test(ref)) {
    const [row] = await db
      .select()
      .from(schema.issues)
      .where(
        and(
          base,
          eq(schema.issues.projectId, projectId),
          eq(schema.issues.sequenceId, Number(ref)),
        ),
      )
      .limit(1);
    if (row) return row;
  }
  throw new HTTPException(404, { message: "Issue not found" });
}

export const linkSchema = z.object({
  pane_id: z.string().min(1).max(160),
  machine_id: z.string().max(64).optional(),
  workspace: z.string().min(1),
  issue_id: z.string().min(1),
  project_id: z.string().optional(),
  session_id: z.string().max(128).optional(),
  agent: z.string().max(64).optional(),
  cwd: z.string().max(1024).optional(),
  title: z.string().max(200).optional(),
  source: z.enum(LINK_SOURCES).optional(),
});

/** Validate and apply an explicit link request from a signed-in user (REST / MCP / hook). */
export async function linkForUser(
  db: DbClient,
  userId: string,
  body: z.infer<typeof linkSchema>,
  defaultSource: LinkSource = "manual",
  ownsMachine?: (machineId: string) => Promise<boolean>,
): Promise<AgentSessionWire> {
  const ws = await requireMemberOf(db, body.workspace, userId);
  const issue = await resolveIssueRef(db, ws.id, body.issue_id, body.project_id);
  const key = paneKey(body.pane_id, body.machine_id);
  if (key.machineId && ownsMachine && !(await ownsMachine(key.machineId))) {
    throw new HTTPException(403, { message: "not one of your machines" });
  }
  // Re-pointing a pane already linked into another workspace needs membership there too.
  const existing = await findRow(db, key.machineId, key.paneId);
  if (existing && existing.workspaceId !== ws.id) {
    const visible = await workspaceRepo.listIdsByUser(db, userId);
    if (!visible.includes(existing.workspaceId)) {
      throw new HTTPException(403, { message: "pane is linked in a workspace you cannot access" });
    }
  }
  const row = await linkPane(db, {
    ...key,
    workspaceId: ws.id,
    projectId: issue.projectId,
    issueId: issue.id,
    sessionId: body.session_id,
    agent: body.agent,
    cwd: body.cwd,
    title: body.title,
    source: body.source ?? defaultSource,
    state: (body.source ?? defaultSource) === "manual" ? "unknown" : "working",
    linkedById: userId,
  });
  const [wire] = await list(db, { workspaceIds: [row.workspaceId], panes: [body.pane_id] });
  if (!wire) throw new HTTPException(500, { message: "link not readable" });
  return wire;
}

/** Record a bridge agent event (wire shape) on the pane's linked session; never throws. */
export async function recordSessionEvent(
  db: DbClient,
  machineId: string,
  event: AgentEvent,
): Promise<void> {
  try {
    await recordEvent(db, {
      status: event.status,
      paneId: event.pane_id,
      machineId,
      agent: event.agent,
      cwd: event.cwd,
      title: event.title,
      detail: event.detail,
      sessionId: event.session_id,
    });
  } catch (err) {
    console.error(`agent session event failed (${machineId || "legacy"} ${event.pane_id}):`, err);
  }
}
