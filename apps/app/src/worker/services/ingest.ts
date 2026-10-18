import { z } from "zod";
import { v4 as uuid } from "uuid";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as feedbackRepo from "../repositories/feedback";
import { sha256Hex } from "../lib/identify";
import { nowISO } from "../lib/pagination";
import { escapeHtml } from "../lib/feedbackContext";
import { sanitizeBoardConfig } from "./feedback";

export const ingestSchema = z.object({
  message: z.string().min(1).max(2000),
  level: z.enum(["error", "warning", "info"]).optional().default("error"),
  fingerprint: z.string().min(1).max(200).optional(),
  stack: z.string().max(20000).optional(),
  service: z.string().max(100).optional(),
  environment: z.string().max(50).optional(),
  context: z.record(z.string().max(100), z.unknown()).optional(),
  logs: z.array(z.string().max(2000)).max(50).optional(),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

const PRIORITY: Record<IngestPayload["level"], string> = {
  error: "high",
  warning: "medium",
  info: "low",
};

// Volatile tokens (ids, counters, hex blobs) are masked so "user 42 not found"
// and "user 97 not found" group together.
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/0x[0-9a-f]+/g, "<hex>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

// First frame of a stack trace with line/column numbers and cache-busting
// query strings stripped, so a redeploy that shifts lines keeps the same group.
export function topStackFrame(stack: string | undefined): string {
  if (!stack) return "";
  const frame = stack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^at\s/.test(l) || /@.+:\d+/.test(l) || /\.\w+:\d+/.test(l));
  return (frame ?? "").replace(/[?#][^\s)]*/g, "").replace(/:\d+(?::\d+)?/g, "");
}

export async function fingerprintFor(p: {
  service?: string;
  message: string;
  stack?: string;
}): Promise<string> {
  return sha256Hex(`${p.service ?? ""}|${normalizeMessage(p.message)}|${topStackFrame(p.stack)}`);
}

const SUMMARY_RE = /<div data-atur-ingest="summary">[\s\S]*?<\/div>/;
const LATEST_RE = /<div data-atur-ingest="latest">[\s\S]*?<\/div>\s*$/;

function summaryBlock(g: {
  occurrences: number;
  level: string;
  firstSeenAt: string;
  lastSeenAt: string;
  service?: string | null;
  environment?: string | null;
}): string {
  const bits = [
    `<strong>Occurrences:</strong> ${g.occurrences}`,
    `<strong>First seen:</strong> ${escapeHtml(g.firstSeenAt)}`,
    `<strong>Last seen:</strong> ${escapeHtml(g.lastSeenAt)}`,
    `<strong>Level:</strong> ${escapeHtml(g.level)}`,
  ];
  if (g.service) bits.push(`<strong>Service:</strong> ${escapeHtml(g.service)}`);
  if (g.environment) bits.push(`<strong>Environment:</strong> ${escapeHtml(g.environment)}`);
  return `<div data-atur-ingest="summary"><p>${bits.join(" · ")}</p></div>`;
}

function latestBlock(p: IngestPayload, at: string): string {
  const parts: string[] = [];
  if (p.context && Object.keys(p.context).length) {
    parts.push(
      `<details><summary>Context of latest occurrence (${escapeHtml(at)})</summary><pre><code>${escapeHtml(
        JSON.stringify(p.context, null, 2).slice(0, 8000),
      )}</code></pre></details>`,
    );
  }
  if (p.logs?.length) {
    parts.push(
      `<details><summary>Recent logs (${p.logs.length})</summary><pre><code>${escapeHtml(
        p.logs.join("\n"),
      )}</code></pre></details>`,
    );
  }
  return `<div data-atur-ingest="latest">${parts.join("")}</div>`;
}

function firstOccurrenceHtml(p: IngestPayload): string {
  const stack = p.stack ? `<h4>Stack</h4><pre><code>${escapeHtml(p.stack)}</code></pre>` : "";
  return `<pre><code>${escapeHtml(p.message)}</code></pre>${stack}`;
}

// Replace the machine-managed blocks of an existing description; if a human edit
// stripped the markers, re-add them rather than losing the counters.
export function refreshDescription(html: string | null, summary: string, latest: string): string {
  let out = html ?? "";
  out = SUMMARY_RE.test(out) ? out.replace(SUMMARY_RE, () => summary) : summary + out;
  out = LATEST_RE.test(out) ? out.replace(LATEST_RE, () => latest) : out + latest;
  return out;
}

export type IngestResult = {
  issue_id: string;
  sequence_id: number;
  occurrences: number;
  created: boolean;
};

async function createGroupIssue(
  db: DbClient,
  board: typeof schema.feedbackBoards.$inferSelect,
  p: IngestPayload,
  fingerprint: string,
  now: string,
) {
  const { stateId, labelId } = await sanitizeBoardConfig(db, board);
  const issueId = uuid();
  const firstLine = p.message.split("\n")[0].trim();
  const title = `${p.service ? `[${p.service}] ` : ""}${firstLine}`.slice(0, 200);
  const html =
    summaryBlock({
      occurrences: 1,
      level: p.level,
      firstSeenAt: now,
      lastSeenAt: now,
      service: p.service,
      environment: p.environment,
    }) +
    firstOccurrenceHtml(p) +
    latestBlock(p, now);
  const sequenceId = await feedbackRepo.createFeedbackIssue(db, {
    id: issueId,
    name: title,
    projectId: board.projectId,
    workspaceId: board.workspaceId,
    descriptionHtml: html,
    descriptionStripped: p.message.slice(0, 500),
    stateId,
    submitLabelId: labelId,
    externalSource: "ingest",
    priority: PRIORITY[p.level],
  });
  const inserted = await db
    .insert(schema.ingestGroups)
    .values({
      id: uuid(),
      projectId: board.projectId,
      issueId,
      fingerprint,
      occurrences: 1,
      level: p.level,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.ingestGroups.id });
  return { issueId, sequenceId, won: inserted.length > 0 };
}

export async function ingest(
  db: DbClient,
  ingestKey: string,
  payload: IngestPayload,
): Promise<IngestResult> {
  const board = await feedbackRepo.findBoardByIngestKey(db, ingestKey);
  if (!board) throw new HTTPException(404, { message: "Unknown ingest key" });

  const fingerprint = payload.fingerprint ?? (await fingerprintFor(payload));
  const now = nowISO();

  type GroupRow = {
    id: string;
    issueId: string;
    issueDeleted: string | null;
    sequenceId: number;
    descriptionHtml: string | null;
    firstSeenAt: string;
  };
  const findGroup = async (): Promise<GroupRow | undefined> => {
    const [row] = await db
      .select({
        id: schema.ingestGroups.id,
        issueId: schema.ingestGroups.issueId,
        issueDeleted: schema.issues.deletedAt,
        sequenceId: schema.issues.sequenceId,
        descriptionHtml: schema.issues.descriptionHtml,
        firstSeenAt: schema.ingestGroups.firstSeenAt,
      })
      .from(schema.ingestGroups)
      .innerJoin(schema.issues, eq(schema.issues.id, schema.ingestGroups.issueId))
      .where(
        and(
          eq(schema.ingestGroups.projectId, board.projectId),
          eq(schema.ingestGroups.fingerprint, fingerprint),
        ),
      )
      .limit(1);
    return row;
  };

  let group: GroupRow | undefined = await findGroup();

  // The grouped issue was deleted by the team: start a fresh issue for this
  // fingerprint instead of resurrecting (or silently dropping) the error.
  if (group?.issueDeleted) {
    await db.delete(schema.ingestGroups).where(eq(schema.ingestGroups.id, group.id));
    group = undefined;
  }

  if (!group) {
    const created = await createGroupIssue(db, board, payload, fingerprint, now);
    if (created.won) {
      return {
        issue_id: created.issueId,
        sequence_id: created.sequenceId,
        occurrences: 1,
        created: true,
      };
    }
    // Lost a creation race on the (project, fingerprint) unique index: discard
    // our duplicate issue and count this hit on the winner.
    await db
      .update(schema.issues)
      .set({ deletedAt: now })
      .where(eq(schema.issues.id, created.issueId));
    group = await findGroup();
    if (!group) throw new HTTPException(500, { message: "Could not record occurrence" });
  }

  const [updated] = await db
    .update(schema.ingestGroups)
    .set({
      occurrences: sql`${schema.ingestGroups.occurrences} + 1`,
      lastSeenAt: now,
      level: payload.level,
    })
    .where(eq(schema.ingestGroups.id, group.id))
    .returning({
      occurrences: schema.ingestGroups.occurrences,
      firstSeenAt: schema.ingestGroups.firstSeenAt,
    });

  const html = refreshDescription(
    group.descriptionHtml,
    summaryBlock({
      occurrences: updated.occurrences,
      level: payload.level,
      firstSeenAt: updated.firstSeenAt,
      lastSeenAt: now,
      service: payload.service,
      environment: payload.environment,
    }),
    latestBlock(payload, now),
  );
  await db
    .update(schema.issues)
    .set({ descriptionHtml: html, updatedAt: now })
    .where(and(eq(schema.issues.id, group.issueId), isNull(schema.issues.deletedAt)));

  return {
    issue_id: group.issueId,
    sequence_id: group.sequenceId,
    occurrences: updated.occurrences,
    created: false,
  };
}
