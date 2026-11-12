import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as feedbackRepo from "../repositories/feedback";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { hmacSha256Hex, identityMessage, safeEqual } from "../lib/identify";
import { contextSchema } from "../lib/feedbackContext";
import * as feedback from "./feedback";
import * as portal from "./portal";

// A host app's own "feedback" page (docs/feedback-portal.md, "Signed-in API"): the host's
// SERVER calls /api/feedback/<token>/me/* on behalf of a person it has signed in, proving
// who that is with a short-lived signature made with the board's identify secret:
//
//   X-Atur-User-Id, X-Atur-User-Email, X-Atur-User-Name (optional, URI-encoded),
//   X-Atur-Expires (unix seconds, at most ME_MAX_AGE_SEC ahead),
//   X-Atur-Signature = hex(HMAC-SHA256(secret, "me:" + id + ":" + lowercased email + ":" + expires))
//
// The "me:" prefix and the expiry keep a widget signature (id:email, no expiry) from opening
// this API, and a leaked header set from working for long. No portal session is created, so
// the person's own portal logins (one per customer) are left alone.

export const ME_MAX_AGE_SEC = 300;

export function meMessage(id: string, email: string, expires: number): string {
  return `me:${id}:${email.trim().toLowerCase()}:${expires}`;
}

export interface MeHeaders {
  id?: string;
  email?: string;
  name?: string;
  expires?: string;
  signature?: string;
}

export interface Me {
  /** The host app's user id (from X-Atur-User-Id). */
  id: string;
  board: NonNullable<Awaited<ReturnType<typeof feedbackRepo.findBoardByToken>>>;
  email: string;
  name: string | null;
  /** The portal customer behind the email (created on first use, like a verified widget report). */
  customer: portal.PortalCustomer | null;
  /** Voter hash of the verified email, so votes and "voted" match the portal's for the same email. */
  voterHash: string;
}

const emailSchema = z.string().email().max(255);

export async function resolveMe(
  db: DbClient,
  token: string,
  h: MeHeaders,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Me> {
  const board = await feedbackRepo.findBoardByToken(db, token);
  if (!board) throw new HTTPException(404, { message: "Feedback board not found" });
  if (!board.identifySecret) {
    throw new HTTPException(403, { message: "This board has no identify secret" });
  }
  const id = (h.id ?? "").trim();
  const email = (h.email ?? "").trim().toLowerCase();
  const expires = Number(h.expires);
  if (!id || id.length > 255 || !emailSchema.safeParse(email).success) {
    throw new HTTPException(401, { message: "Missing or invalid identity" });
  }
  if (!Number.isInteger(expires) || expires < nowSec || expires > nowSec + ME_MAX_AGE_SEC) {
    throw new HTTPException(401, { message: "Identity expired" });
  }
  const expected = await hmacSha256Hex(board.identifySecret, meMessage(id, email, expires));
  if (!safeEqual(expected, (h.signature ?? "").trim().toLowerCase())) {
    throw new HTTPException(401, { message: "Invalid identity signature" });
  }
  let name: string | null = null;
  if (h.name) {
    try {
      name = decodeURIComponent(h.name).slice(0, 120) || null;
    } catch {
      name = null;
    }
  }
  const row = await feedback.findOrCreateCustomer(db, board.workspaceId, email, name);
  // A CRM lead with this email has no users row; it can read but not reply until it has one.
  const customer = row.userId ? portal.toPortalCustomer(row) : null;
  const voterHash = await feedback.voterHashFor(email, "", "");
  return { id, board, email, name, customer, voterHash };
}

export const meCommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });

/** Plain text of a comment's HTML: paragraphs and line breaks kept, tags dropped, entities decoded. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The person's reports: support tickets (verified), ideas they posted, and reports typed in with their email but unverified. */
export async function reports(db: DbClient, me: Me) {
  if (!me.customer) return { tickets: [], ideas: [], unverified: [] };
  const mine = await portal.getMine(db, me.customer);
  return {
    tickets: mine.tickets.map((t) => ({
      sequence_id: t.sequenceId,
      project_id: t.projectId,
      name: t.name,
      state: t.stateName
        ? { name: t.stateName, color: t.stateColor ?? null, group: t.stateGroup ?? null }
        : null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      completed_at: t.completedAt,
    })),
    ideas: mine.ideas,
    unverified: mine.unverified,
  };
}

/** One ticket with its public thread. Staff appear by display name only, never by email. */
export async function ticket(db: DbClient, me: Me, seqId: number, projectId?: string | null) {
  if (!me.customer) throw new HTTPException(404, { message: "Ticket not found" });
  const t = await portal.getTicket(db, me.customer, seqId, projectId ?? me.board.projectId);
  const issue = t.issue;
  const state = issue?.stateId ? await stateOf(db, issue.stateId, me.board.workspaceId) : null;
  return {
    sequence_id: issue?.sequenceId ?? seqId,
    project_id: t.ticket.projectId,
    name: issue?.name ?? "",
    description: issue?.descriptionStripped ?? null,
    state,
    created_at: issue?.createdAt ?? null,
    completed_at: issue?.completedAt ?? null,
    comments: [...t.comments].reverse().map((c) => ({
      id: c.id,
      text: htmlToText(c.commentHtml),
      created_at: c.createdAt,
      from: c.actorId === me.customer!.userId ? ("you" as const) : ("team" as const),
      author_name: c.actorId === me.customer!.userId ? null : (c.actorName ?? null),
    })),
  };
}

async function stateOf(db: DbClient, stateId: string, workspaceId: string) {
  const [s] = await db
    .select({
      name: schema.states.name,
      color: schema.states.color,
      group: schema.states.groupName,
    })
    .from(schema.states)
    .where(
      and(
        eq(schema.states.id, stateId),
        eq(schema.states.workspaceId, workspaceId),
        isNull(schema.states.deletedAt),
      ),
    )
    .limit(1);
  return s ? { name: s.name, color: s.color ?? null, group: s.group ?? null } : null;
}

export async function replyToTicket(
  db: DbClient,
  me: Me,
  seqId: number,
  body: string,
  projectId?: string | null,
) {
  if (!me.customer) {
    throw new HTTPException(409, { message: "This email has no portal account to reply with" });
  }
  const comment = await portal.addTicketComment(
    db,
    me.customer,
    seqId,
    { comment_html: feedback.textToHtml(body) },
    projectId ?? me.board.projectId,
  );
  return { id: comment?.id ?? null };
}

/** A report or idea filed from the host app's own form, as the signed-in person (no widget). */
export const meItemSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(4000).optional(),
  kind: z.enum(["idea", "bug", "question"]),
  context: contextSchema.optional(),
  attachment_ids: z.array(z.string().uuid()).max(5).optional(),
});

/**
 * Files it exactly like a verified widget report (feedback.createItem with an external_user signed by the board's
 * identify secret, here on the server): a bug or question becomes this person's support ticket, an idea stays on the board.
 */
export async function submit(
  db: DbClient,
  token: string,
  me: Me,
  data: z.infer<typeof meItemSchema>,
  origin: string,
) {
  const signature = await hmacSha256Hex(me.board.identifySecret!, identityMessage(me.id, me.email));
  return feedback.createItem(
    db,
    token,
    {
      title: data.title,
      description: data.description?.trim() || undefined,
      kind: data.kind,
      source: "api",
      context: data.context,
      attachment_ids: data.attachment_ids,
      external_user: { id: me.id, email: me.email, name: me.name ?? undefined, signature },
    },
    origin,
  );
}
