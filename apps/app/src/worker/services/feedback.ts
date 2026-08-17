import { z } from "zod";
import { v4 as uuid } from "uuid";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, inArray } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as feedbackRepo from "../repositories/feedback";
import * as labelsRepo from "../repositories/labels";
import { getNextSequence } from "../repositories/issues";

// Fixed id of the seeded feedback-bot user (see migration). All public comments
// are authored by it since issue_comments.actor_id is NOT NULL FK -> users.
export const FEEDBACK_BOT_USER_ID = "feedbac0-0000-0000-0000-000000000000";

// Salt mixed into voter hashes. Changing it invalidates existing dedup (voters
// could vote again) but leaks nothing; rotate if needed. Kept in-code to avoid a
// wrangler secret binding for the MVP.
const VOTER_SALT = "atur-feedback-v1-7f3c9a1e5b2d4e8a";

// ── Schemas ──

export const createItemSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(4000).optional(),
  email: z.string().email().max(255).optional(),
  name: z.string().max(120).optional(),
  source: z.enum(["portal", "widget"]).optional().default("portal"),
});

export const voteSchema = z.object({
  email: z.string().email().max(255).optional(),
});

export const commentSchema = z.object({
  body: z.string().min(1).max(4000),
  email: z.string().email().max(255).optional(),
  name: z.string().max(120).optional(),
});

export const upsertBoardSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  allow_submit: z.boolean().optional(),
  allow_voting: z.boolean().optional(),
  require_email: z.boolean().optional(),
  allow_comments: z.boolean().optional(),
  default_state_id: z.string().uuid().nullable().optional(),
  submit_label_id: z.string().uuid().nullable().optional(),
  brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).optional(),
});

// ── Helpers ──

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Public input is plain text. Store an escaped HTML copy for the team's internal
// issue view, and the plain text for the public portal (rendered as React text,
// so no XSS surface / no dangerouslySetInnerHTML anywhere).
function toHtml(paragraph: string): string {
  return `<p>${escapeHtml(paragraph)}</p>`;
}

export async function voterHashFor(
  email: string | undefined,
  ip: string,
  ua: string,
): Promise<string> {
  const base = email ? `email:${email.trim().toLowerCase()}` : `anon:${ip}|${ua}`;
  const data = new TextEncoder().encode(base + ":" + VOTER_SALT);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PublicBoardConfig = {
  title: string;
  description: string | null;
  allow_submit: boolean;
  allow_voting: boolean;
  require_email: boolean;
  allow_comments: boolean;
  brand_color: string;
};

export type FeedbackItem = {
  id: string;
  sequence_id: number;
  name: string;
  description: string | null;
  state: { id: string; name: string; color: string | null; group: string | null } | null;
  votes: number;
  voted: boolean;
  comment_count: number;
  author_name: string | null;
  created_at: string | null;
};

async function resolveBoard(db: DbClient, token: string) {
  const board = await feedbackRepo.findBoardByToken(db, token);
  if (!board) throw new HTTPException(404, { message: "Feedback board not found" });
  return board;
}

type IssueRow = {
  id: string;
  sequenceId: number;
  name: string;
  descriptionStripped: string | null;
  stateId: string | null;
  createdAt: string | null;
};

async function enrichItems(
  db: DbClient,
  rows: IssueRow[],
  voterHash: string,
): Promise<FeedbackItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const stateIds = [...new Set(rows.map((r) => r.stateId).filter(Boolean) as string[])];

  const [voteMap, votedSet, commentMap, stateRows, metas] = await Promise.all([
    feedbackRepo.voteCountsForIssues(db, ids),
    feedbackRepo.votedIssueIds(db, ids, voterHash),
    feedbackRepo.countExternalCommentsForIssues(db, ids),
    stateIds.length
      ? db
          .select({
            id: schema.states.id,
            name: schema.states.name,
            color: schema.states.color,
            group: schema.states.groupName,
          })
          .from(schema.states)
          .where(and(isNull(schema.states.deletedAt), inArray(schema.states.id, stateIds)))
      : Promise.resolve([]),
    db.select().from(schema.feedbackMeta).where(inArray(schema.feedbackMeta.issueId, ids)),
  ]);
  const stateMap = new Map(stateRows.map((s) => [s.id, s]));
  const metaMap = new Map(metas.map((m) => [m.issueId, m]));

  return rows.map((r) => ({
    id: r.id,
    sequence_id: r.sequenceId,
    name: r.name,
    description: r.descriptionStripped,
    state: r.stateId ? (stateMap.get(r.stateId) ?? null) : null,
    votes: voteMap.get(r.id) ?? 0,
    voted: votedSet.has(r.id),
    comment_count: commentMap.get(r.id) ?? 0,
    author_name: metaMap.get(r.id)?.authorName ?? null,
    created_at: r.createdAt,
  }));
}

// ── Public API ──

export async function getBoard(db: DbClient, token: string, voterHash: string) {
  const board = await resolveBoard(db, token);
  const rows = await feedbackRepo.listFeedbackIssues(db, board.projectId);
  const items = await enrichItems(db, rows, voterHash);
  items.sort((a, b) => b.votes - a.votes || b.sequence_id - a.sequence_id);

  const boardConfig: PublicBoardConfig = {
    title: board.title,
    description: board.description,
    allow_submit: !!board.allowSubmit,
    allow_voting: !!board.allowVoting,
    require_email: !!board.requireEmail,
    allow_comments: !!board.allowComments,
    brand_color: board.brandColor,
  };
  return { board: boardConfig, items };
}

export async function getItem(db: DbClient, token: string, issueId: string, voterHash: string) {
  const board = await resolveBoard(db, token);
  const issue = await feedbackRepo.findFeedbackIssue(db, board.projectId, issueId);
  if (!issue) throw new HTTPException(404, { message: "Feedback item not found" });

  const [items, comments, meta] = await Promise.all([
    enrichItems(db, [issue], voterHash),
    feedbackRepo.listExternalComments(db, issue.id),
    feedbackRepo.getFeedbackMeta(db, issue.id),
  ]);
  return {
    ...items[0],
    author_email: meta?.authorEmail ?? null,
    comments,
  };
}

export async function createItem(
  db: DbClient,
  token: string,
  data: z.infer<typeof createItemSchema>,
) {
  const board = await resolveBoard(db, token);
  if (!board.allowSubmit) throw new HTTPException(403, { message: "Submissions are disabled" });
  if (board.requireEmail && !data.email) {
    throw new HTTPException(400, { message: "Email is required" });
  }

  const sequenceId = await getNextSequence(db, board.projectId);
  const id = uuid();
  await feedbackRepo.createFeedbackIssue(db, {
    id,
    name: data.title,
    sequenceId,
    projectId: board.projectId,
    workspaceId: board.workspaceId,
    descriptionHtml: data.description ? toHtml(data.description) : null,
    descriptionStripped: data.description ?? null,
    stateId: board.defaultStateId,
    submitLabelId: board.submitLabelId,
  });
  await feedbackRepo.insertFeedbackMeta(db, {
    issueId: id,
    authorEmail: data.email ?? null,
    authorName: data.name ?? null,
    source: data.source,
  });

  return { id, sequence_id: sequenceId };
}

// Toggle a vote for the given pre-computed voter hash. `email` is only used to
// enforce board.require_email; the hash itself is computed by the caller.
export async function voteWithHash(
  db: DbClient,
  token: string,
  issueId: string,
  voterHash: string,
  email?: string,
) {
  const board = await resolveBoard(db, token);
  if (!board.allowVoting) throw new HTTPException(403, { message: "Voting is disabled" });
  if (board.requireEmail && !email) {
    throw new HTTPException(400, { message: "Email is required to vote" });
  }
  const issue = await feedbackRepo.findFeedbackIssue(db, board.projectId, issueId);
  if (!issue) throw new HTTPException(404, { message: "Feedback item not found" });

  const already = await feedbackRepo.hasVoted(db, issue.id, voterHash);
  if (already) {
    await feedbackRepo.removeVote(db, issue.id, voterHash);
  } else {
    await feedbackRepo.addVote(db, issue.id, voterHash);
  }
  const count = await feedbackRepo.countVotes(db, issue.id);
  return { voted: !already, count };
}

export async function listComments(db: DbClient, token: string, issueId: string) {
  const board = await resolveBoard(db, token);
  if (!board.allowComments) throw new HTTPException(403, { message: "Comments are disabled" });
  const issue = await feedbackRepo.findFeedbackIssue(db, board.projectId, issueId);
  if (!issue) throw new HTTPException(404, { message: "Feedback item not found" });
  return feedbackRepo.listExternalComments(db, issue.id);
}

export async function addComment(
  db: DbClient,
  token: string,
  issueId: string,
  body: string,
  email?: string,
) {
  const board = await resolveBoard(db, token);
  if (!board.allowComments) throw new HTTPException(403, { message: "Comments are disabled" });
  if (board.requireEmail && !email) {
    throw new HTTPException(400, { message: "Email is required to comment" });
  }
  const issue = await feedbackRepo.findFeedbackIssue(db, board.projectId, issueId);
  if (!issue) throw new HTTPException(404, { message: "Feedback item not found" });
  const id = await feedbackRepo.addExternalComment(db, {
    issueId: issue.id,
    commentHtml: toHtml(body),
    commentStripped: body,
    actorId: FEEDBACK_BOT_USER_ID,
  });
  return { id };
}

// ── Admin API ──

async function assertWorkspaceMember(db: DbClient, workspaceId: string, userId: string) {
  const [m] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!m) throw new HTTPException(403, { message: "Not a member of this workspace" });
}

async function resolveProject(db: DbClient, slug: string, projectId: string) {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
    .limit(1);
  if (!project || project.workspaceId !== workspace.id) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  return { workspace, project };
}

export async function getAdminConfig(
  db: DbClient,
  slug: string,
  projectId: string,
  userId: string,
) {
  const { workspace, project } = await resolveProject(db, slug, projectId);
  await assertWorkspaceMember(db, workspace.id, userId);
  const board = await feedbackRepo.findBoardByProject(db, project.id);
  return board ? toAdminBoard(board) : { enabled: false };
}

export async function upsertAdminConfig(
  db: DbClient,
  slug: string,
  projectId: string,
  userId: string,
  data: z.infer<typeof upsertBoardSchema>,
) {
  const { workspace, project } = await resolveProject(db, slug, projectId);
  await assertWorkspaceMember(db, workspace.id, userId);

  const existing = await feedbackRepo.findBoardByProject(db, project.id);

  if (!existing) {
    // First enable: mint a token, ensure a 'feedback' label, pick a default state.
    const label = await ensureFeedbackLabel(db, project.id, workspace.id);
    const defaultStateId =
      data.default_state_id ?? (await feedbackRepo.pickDefaultStateId(db, project.id));
    const title = data.title ?? `${project.name} Feedback`;
    const board = await feedbackRepo.createBoard(db, {
      id: uuid(),
      projectId: project.id,
      workspaceId: workspace.id,
      publicToken: newPublicToken(),
      title,
      description: data.description ?? null,
      allowSubmit: data.allow_submit === false ? 0 : 1,
      allowVoting: data.allow_voting === false ? 0 : 1,
      requireEmail: data.require_email ? 1 : 0,
      allowComments: data.allow_comments === false ? 0 : 1,
      defaultStateId,
      submitLabelId: data.submit_label_id ?? label.id,
      brandColor: data.brand_color ?? "#6366f1",
      position: data.position ?? "bottom-right",
    });
    return toAdminBoard(board!);
  }

  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.allow_submit !== undefined) update.allowSubmit = data.allow_submit ? 1 : 0;
  if (data.allow_voting !== undefined) update.allowVoting = data.allow_voting ? 1 : 0;
  if (data.require_email !== undefined) update.requireEmail = data.require_email ? 1 : 0;
  if (data.allow_comments !== undefined) update.allowComments = data.allow_comments ? 1 : 0;
  if (data.default_state_id !== undefined) update.defaultStateId = data.default_state_id;
  if (data.submit_label_id !== undefined) update.submitLabelId = data.submit_label_id;
  if (data.brand_color !== undefined) update.brandColor = data.brand_color;
  if (data.position !== undefined) update.position = data.position;

  const board = await feedbackRepo.updateBoard(db, existing.id, update);
  return toAdminBoard(board!);
}

export async function deleteAdminConfig(
  db: DbClient,
  slug: string,
  projectId: string,
  userId: string,
) {
  const { workspace, project } = await resolveProject(db, slug, projectId);
  await assertWorkspaceMember(db, workspace.id, userId);
  const existing = await feedbackRepo.findBoardByProject(db, project.id);
  if (existing) await feedbackRepo.deleteBoard(db, existing.id);
  return { ok: true };
}

// ── Admin helpers ──

async function ensureFeedbackLabel(db: DbClient, projectId: string, workspaceId: string) {
  const existing = await db
    .select()
    .from(schema.labels)
    .where(
      and(
        eq(schema.labels.name, "feedback"),
        eq(schema.labels.workspaceId, workspaceId),
        isNull(schema.labels.deletedAt),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  return labelsRepo.create(db, { name: "feedback", color: "#6366f1", workspaceId, projectId });
}

function newPublicToken(): string {
  return "pk_fb_" + crypto.randomUUID().replace(/-/g, "");
}

type BoardRow = NonNullable<Awaited<ReturnType<typeof feedbackRepo.findBoardByProject>>>;

function toAdminBoard(b: BoardRow) {
  return {
    enabled: true,
    id: b.id,
    public_token: b.publicToken,
    title: b.title,
    description: b.description,
    allow_submit: !!b.allowSubmit,
    allow_voting: !!b.allowVoting,
    require_email: !!b.requireEmail,
    allow_comments: !!b.allowComments,
    default_state_id: b.defaultStateId,
    submit_label_id: b.submitLabelId,
    brand_color: b.brandColor,
    position: b.position,
  };
}
