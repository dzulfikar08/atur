import { z } from "zod";
import { v4 as uuid } from "uuid";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as feedbackRepo from "../repositories/feedback";
import * as labelsRepo from "../repositories/labels";
import * as customersRepo from "../repositories/customers";
import * as activitiesRepo from "../repositories/activities";
import * as crmActivitiesService from "./crm_activities";
import * as attachmentsService from "./feedback_attachments";
import {
  contextSchema,
  sanitizeContext,
  renderContextHtml,
  escapeHtml,
  type FeedbackContext,
} from "../lib/feedbackContext";
import { verifyIdentitySignature, newIdentifySecret, newIngestKey } from "../lib/identify";

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
  kind: z.enum(["idea", "bug", "question"]).optional().default("idea"),
  source: z.enum(["portal", "widget", "native", "api"]).optional().default("portal"),
  context: contextSchema.optional(),
  attachment_ids: z.array(z.string().uuid()).max(5).optional(),
  external_user: z
    .object({
      id: z.string().min(1).max(255),
      // Host-app supplied: a malformed address must not reject the whole report.
      email: z.string().max(255).optional(),
      name: z.string().max(120).optional(),
      signature: z.string().max(128).optional(),
    })
    .optional(),
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

// Public input is plain text. Store an escaped HTML copy for the team's internal
// issue view, and the plain text for the public portal (rendered as React text,
// so no XSS surface / no dangerouslySetInnerHTML anywhere).
function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
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
  position: string;
  workspace_slug: string | null;
  workspace_name: string | null;
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

// Attachment uploads are part of submitting, so they follow allow_submit.
export async function findBoardForUpload(db: DbClient, token: string) {
  const board = await resolveBoard(db, token);
  if (!board.allowSubmit) throw new HTTPException(403, { message: "Submissions are disabled" });
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
  workspaceId: string,
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
          // Workspace-scoped: issues created under a poisoned board config
          // must render stateless, not leak a foreign state's name/color —
          // this endpoint is public (token-only).
          .where(
            and(
              isNull(schema.states.deletedAt),
              inArray(schema.states.id, stateIds),
              eq(schema.states.workspaceId, workspaceId),
            ),
          )
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

async function toPublicConfig(
  db: DbClient,
  board: typeof schema.feedbackBoards.$inferSelect,
): Promise<PublicBoardConfig> {
  const [workspace] = await db
    .select({ slug: schema.workspaces.slug, name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.id, board.workspaceId), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  return {
    title: board.title,
    description: board.description,
    allow_submit: !!board.allowSubmit,
    allow_voting: !!board.allowVoting,
    require_email: !!board.requireEmail,
    allow_comments: !!board.allowComments,
    brand_color: board.brandColor,
    position: board.position,
    workspace_slug: workspace?.slug ?? null,
    workspace_name: workspace?.name ?? null,
  };
}

export async function getBoardConfig(db: DbClient, token: string) {
  return toPublicConfig(db, await resolveBoard(db, token));
}

export async function getBoard(db: DbClient, token: string, voterHash: string) {
  const board = await resolveBoard(db, token);
  const rows = await feedbackRepo.listFeedbackIssues(db, board.projectId);
  const items = await enrichItems(db, rows, voterHash, board.workspaceId);
  items.sort((a, b) => b.votes - a.votes || b.sequence_id - a.sequence_id);
  return { board: await toPublicConfig(db, board), items };
}

export async function getItem(db: DbClient, token: string, issueId: string, voterHash: string) {
  const board = await resolveBoard(db, token);
  const issue = await feedbackRepo.findFeedbackIssue(db, board.projectId, issueId);
  if (!issue) throw new HTTPException(404, { message: "Feedback item not found" });

  const [items, comments] = await Promise.all([
    enrichItems(db, [issue], voterHash, board.workspaceId),
    feedbackRepo.listExternalComments(db, issue.id),
  ]);
  return { ...items[0], comments };
}

// Resolve who the reporter is. The email is trusted ("verified") ONLY when the
// board has an identify secret and external_user.signature is the HMAC of
// `${id}:${email.toLowerCase()}` for that exact email. Anything else — no secret,
// no/bad signature, a typed email — is kept as unverified text on the report:
// it never creates or links a customer, ticket or CRM record.
async function resolveReporter(
  board: { identifySecret: string | null },
  data: z.infer<typeof createItemSchema>,
) {
  const isEmail = (v: string | undefined) =>
    v ? z.string().email().safeParse(v.trim()).success : false;
  const ext = data.external_user;
  const extEmail = isEmail(ext?.email) ? ext!.email!.trim().toLowerCase() : undefined;
  const email = extEmail ?? (data.email ? data.email.trim().toLowerCase() : undefined);
  const name = ext?.name ?? data.name;

  const verified =
    !!ext && !!extEmail && !!board.identifySecret
      ? await verifyIdentitySignature(board.identifySecret, ext.id, extEmail, ext.signature)
      : false;
  return { email, name, verified, externalUserId: ext?.id ?? null };
}

function reportHtml(p: {
  description?: string;
  kind: string;
  source: string;
  email?: string;
  name?: string;
  verified: boolean;
  attachments: attachmentsService.ClaimedAttachment[];
  context?: FeedbackContext;
}): string {
  const parts: string[] = [];
  if (p.email || p.name) {
    const label = [
      p.name ? escapeHtml(p.name) : "",
      p.email ? `&lt;${escapeHtml(p.email)}&gt;` : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(
      `<p><strong>Reporter:</strong> ${label} <em>(${p.verified ? "verified identity" : "submitted without verification"})</em></p>`,
    );
  }
  if (p.kind !== "idea" || p.source !== "portal") {
    parts.push(
      `<p><strong>Type:</strong> ${escapeHtml(p.kind)} · <strong>Source:</strong> ${escapeHtml(p.source)}</p>`,
    );
  }
  if (p.attachments.length) {
    const items = p.attachments.map((a) => {
      const href = `/api/assets/${a.id}`;
      return a.mime.startsWith("image/")
        ? `<p><img src="${href}" alt="${escapeHtml(a.filename)}"></p>`
        : `<p><a href="${href}">${escapeHtml(a.filename)}</a></p>`;
    });
    parts.push(`<h4>Attachments</h4>${items.join("")}`);
  }
  if (p.context) parts.push(renderContextHtml(p.context));
  return (p.description ? toHtml(p.description) : "") + parts.join("");
}

export type CreatedItem = { id: string; sequence_id: number; url: string };

export async function createItem(
  db: DbClient,
  token: string,
  data: z.infer<typeof createItemSchema>,
  origin: string,
): Promise<CreatedItem> {
  const board = await resolveBoard(db, token);
  if (!board.allowSubmit) throw new HTTPException(403, { message: "Submissions are disabled" });
  const reporter = await resolveReporter(board, data);
  if (board.requireEmail && !reporter.email) {
    throw new HTTPException(400, { message: "Email is required" });
  }
  const { stateId: boardStateId, labelId: boardLabelId } = await sanitizeBoardConfig(db, board);
  const attachments = await attachmentsService.resolveUnclaimed(
    db,
    board.id,
    data.attachment_ids ?? [],
  );
  const context = data.context ? sanitizeContext(data.context) : undefined;
  const isTicket = data.kind !== "idea";

  // Only a verified email owns a customer record + ticket link. An unverified
  // report still reaches staff as an issue (email kept in feedback_meta only);
  // the real owner can see it, marked unverified, after signing in by OTP.
  const customer =
    isTicket && reporter.email && reporter.verified
      ? await findOrCreateCustomer(db, board.workspaceId, reporter.email, reporter.name)
      : null;

  const html = reportHtml({
    description: data.description,
    kind: data.kind,
    source: data.source,
    email: reporter.email,
    name: reporter.name,
    verified: reporter.verified,
    attachments,
    context,
  });

  const id = uuid();
  // sequenceId allocated atomically inside createFeedbackIssue (per-project
  // counter) — public portal bursts get distinct ids, no collision 500s.
  const sequenceId = await feedbackRepo.createFeedbackIssue(db, {
    id,
    name: data.title,
    projectId: board.projectId,
    workspaceId: board.workspaceId,
    descriptionHtml: html || null,
    descriptionStripped: data.description ?? null,
    stateId: boardStateId,
    submitLabelId: boardLabelId,
    externalSource: isTicket ? "portal" : "feedback",
    createdById: customer?.userId ?? null,
  });
  await feedbackRepo.insertFeedbackMeta(db, {
    issueId: id,
    authorEmail: reporter.email ?? null,
    authorName: reporter.name ?? null,
    source: data.source,
    kind: data.kind,
    contextJson: context ? JSON.stringify(context) : null,
    externalUserId: reporter.externalUserId,
    identityVerified: reporter.verified,
  });
  await attachmentsService.claimAttachments(
    db,
    id,
    attachments.map((a) => a.id),
  );

  if (customer) {
    await db.insert(schema.supportTickets).values({
      id: uuid(),
      issueId: id,
      customerId: customer.id,
      workspaceId: board.workspaceId,
      createdAt: new Date().toISOString(),
    });
    if (customer.userId) {
      await activitiesRepo.create(db, { verb: "created", issueId: id, actorId: customer.userId });
    }
    await crmActivitiesService.recordActivity(db, board.workspaceId, {
      customerId: customer.id,
      type: "NOTE",
      subject: `${data.kind === "bug" ? "Bug report" : "Question"} via ${data.source}`,
      body: data.title,
      createdBy: customer.userId,
    });
  }

  const [workspace] = await db
    .select({ slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, board.workspaceId))
    .limit(1);
  const portal = `${origin}/portal/${workspace?.slug ?? ""}`;
  const url = customer
    ? `${portal}/tickets/${sequenceId}?project=${board.projectId}`
    : isTicket
      ? `${portal}/tickets`
      : `${portal}/ideas?board=${encodeURIComponent(board.publicToken)}&item=${id}`;
  return { id, sequence_id: sequenceId, url };
}

// Case-insensitive customer lookup so a widget email matches the row the portal
// OTP flow created for the same person, whatever casing either side used.
export async function findOrCreateCustomer(
  db: DbClient,
  workspaceId: string,
  email: string,
  name?: string | null,
) {
  const [existing] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.workspaceId, workspaceId),
        sql`lower(${schema.customers.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (existing) {
    const row = await customersRepo.getContact(db, workspaceId, existing.id);
    if (row) return row;
  }
  return customersRepo.ensure(db, workspaceId, { email: email.toLowerCase(), name });
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

// Config-poisoning guard (store side): caller-supplied entity ids on the
// admin board config must resolve in the board's workspace (and be alive)
// before they're persisted — 404 otherwise.
async function assertBoardIdsInWorkspace(
  db: DbClient,
  workspaceId: string,
  ids: { stateId?: string; labelId?: string },
) {
  if (ids.stateId) {
    const [st] = await db
      .select({ id: schema.states.id })
      .from(schema.states)
      .where(
        and(
          eq(schema.states.id, ids.stateId),
          eq(schema.states.workspaceId, workspaceId),
          isNull(schema.states.deletedAt),
        ),
      )
      .limit(1);
    if (!st) throw new HTTPException(404, { message: "State not found" });
  }
  if (ids.labelId) {
    const [lb] = await db
      .select({ id: schema.labels.id })
      .from(schema.labels)
      .where(
        and(
          eq(schema.labels.id, ids.labelId),
          eq(schema.labels.workspaceId, workspaceId),
          isNull(schema.labels.deletedAt),
        ),
      )
      .limit(1);
    if (!lb) throw new HTTPException(404, { message: "Label not found" });
  }
}

// Belt-and-braces (consume side) for pre-existing poisoned config rows: ids
// on the board that don't resolve in the board's workspace are DROPPED — the
// item is created stateless/unlabeled. The public path must neither 5xx nor
// link foreign entities.
// Exported for tests (DEV-20 config-poisoning coverage).
export async function sanitizeBoardConfig(
  db: DbClient,
  board: { workspaceId: string; defaultStateId: string | null; submitLabelId: string | null },
): Promise<{ stateId: string | null; labelId: string | null }> {
  let stateId = board.defaultStateId ?? null;
  if (stateId) {
    const [st] = await db
      .select({ id: schema.states.id })
      .from(schema.states)
      .where(
        and(
          eq(schema.states.id, stateId),
          eq(schema.states.workspaceId, board.workspaceId),
          isNull(schema.states.deletedAt),
        ),
      )
      .limit(1);
    if (!st) stateId = null;
  }
  let labelId = board.submitLabelId ?? null;
  if (labelId) {
    const [lb] = await db
      .select({ id: schema.labels.id })
      .from(schema.labels)
      .where(
        and(
          eq(schema.labels.id, labelId),
          eq(schema.labels.workspaceId, board.workspaceId),
          isNull(schema.labels.deletedAt),
        ),
      )
      .limit(1);
    if (!lb) labelId = null;
  }
  return { stateId, labelId };
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

  // Config poisoning: caller-supplied entity ids must belong to this
  // workspace before they're stored — the public board consumes them raw.
  await assertBoardIdsInWorkspace(db, workspace.id, {
    stateId: data.default_state_id ?? undefined,
    labelId: data.submit_label_id ?? undefined,
  });

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

// Create/rotate (action "rotate") or revoke (action "revoke") a board secret.
// Rotating the identify secret invalidates signatures minted with the old one;
// revoking it turns identify enforcement off (typed emails count as unverified
// again). Revoking the ingest key makes POST /api/ingest/:key 404.
export async function setBoardSecret(
  db: DbClient,
  slug: string,
  projectId: string,
  userId: string,
  which: "identify_secret" | "ingest_key",
  action: "rotate" | "revoke",
) {
  const { workspace, project } = await resolveProject(db, slug, projectId);
  await assertWorkspaceMember(db, workspace.id, userId);
  const existing = await feedbackRepo.findBoardByProject(db, project.id);
  if (!existing) throw new HTTPException(404, { message: "Feedback board not enabled" });
  const value =
    action === "revoke" ? null : which === "identify_secret" ? newIdentifySecret() : newIngestKey();
  const board = await feedbackRepo.updateBoard(
    db,
    existing.id,
    which === "identify_secret" ? { identifySecret: value } : { ingestKey: value },
  );
  return toAdminBoard(board!);
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
    // Admin-only (this payload is gated by workspace membership): the HMAC key
    // for Atur.identify() and the bearer key for POST /api/ingest/:key.
    identify_secret: b.identifySecret,
    ingest_key: b.ingestKey,
  };
}
