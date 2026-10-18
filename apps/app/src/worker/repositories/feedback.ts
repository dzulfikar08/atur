import { eq, and, isNull, desc, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { allocateNextSequence, completedAtForState } from "./issues";
import {
  feedbackBoards,
  feedbackVotes,
  feedbackMeta,
  issues,
  issueComments,
  states,
  issueSequences,
  issueLabels,
} from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// ── Boards ──

export async function findBoardByToken(db: DbClient, token: string) {
  const [board] = await db
    .select()
    .from(feedbackBoards)
    .where(eq(feedbackBoards.publicToken, token))
    .limit(1);
  return board ?? null;
}

export async function findBoardByProject(db: DbClient, projectId: string) {
  const [board] = await db
    .select()
    .from(feedbackBoards)
    .where(eq(feedbackBoards.projectId, projectId))
    .limit(1);
  return board ?? null;
}

export async function createBoard(
  db: DbClient,
  data: Partial<typeof feedbackBoards.$inferInsert> & {
    id: string;
    projectId: string;
    workspaceId: string;
    publicToken: string;
    title: string;
  },
) {
  const now = nowISO();
  await db.insert(feedbackBoards).values({
    id: data.id,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    publicToken: data.publicToken,
    slug: data.slug ?? null,
    title: data.title,
    description: data.description ?? null,
    allowSubmit: data.allowSubmit ?? 1,
    allowVoting: data.allowVoting ?? 1,
    requireEmail: data.requireEmail ?? 0,
    allowComments: data.allowComments ?? 1,
    defaultStateId: data.defaultStateId ?? null,
    submitLabelId: data.submitLabelId ?? null,
    brandColor: data.brandColor ?? "#6366f1",
    position: data.position ?? "bottom-right",
    createdAt: now,
    updatedAt: now,
  });
  return findBoardByProject(db, data.projectId);
}

export async function updateBoard(db: DbClient, boardId: string, data: Record<string, unknown>) {
  await db
    .update(feedbackBoards)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(feedbackBoards.id, boardId));
  const [board] = await db
    .select()
    .from(feedbackBoards)
    .where(eq(feedbackBoards.id, boardId))
    .limit(1);
  return board ?? null;
}

export async function deleteBoard(db: DbClient, boardId: string) {
  await db.delete(feedbackBoards).where(eq(feedbackBoards.id, boardId));
}

// ── Items (feedback-tagged issues) ──

export async function listFeedbackIssues(db: DbClient, projectId: string) {
  return db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.projectId, projectId),
        eq(issues.externalSource, "feedback"),
        isNull(issues.deletedAt),
      ),
    )
    .orderBy(desc(issues.sequenceId));
}

export async function findFeedbackIssue(db: DbClient, projectId: string, issueId: string) {
  const [row] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.projectId, projectId),
        eq(issues.externalSource, "feedback"),
        isNull(issues.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Create a feedback issue directly (repositories/issues.ts create doesn't expose
// externalSource), then write its sequence + label. Stores BOTH description_html
// (escaped, for the team's internal view) and description_stripped (plain text
// the public portal renders safely as React text).
export async function createFeedbackIssue(
  db: DbClient,
  data: {
    id: string;
    name: string;
    sequenceId?: number;
    projectId: string;
    workspaceId: string;
    descriptionHtml: string | null;
    descriptionStripped: string | null;
    stateId: string | null;
    submitLabelId: string | null;
  },
) {
  const now = nowISO();
  // Atomic allocation via the per-project counter — the public feedback
  // portal is a concurrent-writer path (form spam, bursts) and must not
  // 500 on sequence collisions.
  const sequenceId = data.sequenceId ?? (await allocateNextSequence(db, data.projectId));
  await db.insert(issues).values({
    id: data.id,
    name: data.name,
    sequenceId,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    priority: "none",
    descriptionHtml: data.descriptionHtml,
    descriptionStripped: data.descriptionStripped,
    stateId: data.stateId,
    completedAt: await completedAtForState(db, data.stateId, now),
    externalSource: "feedback",
    sortOrder: 65535.0,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(issueSequences).values({
    id: uuid(),
    sequence: sequenceId,
    issueId: data.id,
    projectId: data.projectId,
    isDeleted: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (data.submitLabelId) {
    await db.insert(issueLabels).values({
      id: uuid(),
      issueId: data.id,
      labelId: data.submitLabelId,
      createdAt: now,
      updatedAt: now,
    });
  }

  return sequenceId;
}

// ── Votes ──

export async function hasVoted(db: DbClient, issueId: string, voterHash: string) {
  const [row] = await db
    .select({ id: feedbackVotes.id })
    .from(feedbackVotes)
    .where(and(eq(feedbackVotes.issueId, issueId), eq(feedbackVotes.voterHash, voterHash)))
    .limit(1);
  return !!row;
}

export async function addVote(db: DbClient, issueId: string, voterHash: string) {
  await db.insert(feedbackVotes).values({
    id: uuid(),
    issueId,
    voterHash,
    createdAt: nowISO(),
  });
}

export async function removeVote(db: DbClient, issueId: string, voterHash: string) {
  await db
    .delete(feedbackVotes)
    .where(and(eq(feedbackVotes.issueId, issueId), eq(feedbackVotes.voterHash, voterHash)));
}

export async function countVotes(db: DbClient, issueId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedbackVotes)
    .where(eq(feedbackVotes.issueId, issueId));
  return row?.count ?? 0;
}

// Map<issueId, voteCount> for a batch.
export async function voteCountsForIssues(db: DbClient, issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ issueId: feedbackVotes.issueId, count: sql<number>`count(*)` })
    .from(feedbackVotes)
    .where(inArray(feedbackVotes.issueId, issueIds))
    .groupBy(feedbackVotes.issueId);
  return new Map(rows.map((r) => [r.issueId, r.count]));
}

// issueIds the given voter has already voted on.
export async function votedIssueIds(db: DbClient, issueIds: string[], voterHash: string) {
  if (issueIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ issueId: feedbackVotes.issueId })
    .from(feedbackVotes)
    .where(and(inArray(feedbackVotes.issueId, issueIds), eq(feedbackVotes.voterHash, voterHash)));
  return new Set(rows.map((r) => r.issueId));
}

// ── Meta ──

export async function insertFeedbackMeta(
  db: DbClient,
  data: { issueId: string; authorEmail: string | null; authorName: string | null; source: string },
) {
  await db.insert(feedbackMeta).values({
    issueId: data.issueId,
    authorEmail: data.authorEmail,
    authorName: data.authorName,
    source: data.source,
    createdAt: nowISO(),
  });
}

export async function getFeedbackMeta(db: DbClient, issueId: string) {
  const [row] = await db
    .select()
    .from(feedbackMeta)
    .where(eq(feedbackMeta.issueId, issueId))
    .limit(1);
  return row ?? null;
}

// ── Comments (public = access='external') ──

// Return plain text (comment_stripped), not HTML — the portal renders it as
// React text so there is no XSS surface. commentHtml stays escaped for the
// team's internal issue view.
export async function listExternalComments(db: DbClient, issueId: string) {
  return db
    .select({
      id: issueComments.id,
      body: issueComments.commentStripped,
      created_at: issueComments.createdAt,
    })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.issueId, issueId),
        eq(issueComments.access, "external"),
        isNull(issueComments.deletedAt),
      ),
    )
    .orderBy(issueComments.createdAt);
}

export async function countExternalCommentsForIssues(db: DbClient, issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ issueId: issueComments.issueId, count: sql<number>`count(*)` })
    .from(issueComments)
    .where(
      and(
        inArray(issueComments.issueId, issueIds),
        eq(issueComments.access, "external"),
        isNull(issueComments.deletedAt),
      ),
    )
    .groupBy(issueComments.issueId);
  return new Map(rows.map((r) => [r.issueId, r.count]));
}

export async function addExternalComment(
  db: DbClient,
  data: { issueId: string; commentHtml: string; commentStripped: string; actorId: string },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(issueComments).values({
    id,
    commentHtml: data.commentHtml,
    commentStripped: data.commentStripped,
    access: "external",
    issueId: data.issueId,
    actorId: data.actorId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ── States ──

// Pick a sensible landing state for new feedback: prefer the project's triage
// state, then default, then the first state.
export async function pickDefaultStateId(db: DbClient, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ id: states.id, isTriage: states.isTriage, isDefault: states.isDefault })
    .from(states)
    .where(and(eq(states.projectId, projectId), isNull(states.deletedAt)));
  const triage = rows.find((r) => r.isTriage === 1);
  if (triage) return triage.id;
  const def = rows.find((r) => r.isDefault === 1);
  if (def) return def.id;
  return rows[0]?.id ?? null;
}
