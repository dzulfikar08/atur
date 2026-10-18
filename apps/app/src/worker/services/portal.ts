import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as issuesService from "./issues";
import * as issuesRepo from "../repositories/issues";
import * as commentsRepo from "../repositories/comments";
import * as customersRepo from "../repositories/customers";
import * as feedbackRepo from "../repositories/feedback";
import * as portalSettingsRepo from "../repositories/portalSettings";
import * as supportTicketsRepo from "../repositories/supportTickets";
import * as activitiesRepo from "../repositories/activities";
import * as crmActivitiesService from "./crm_activities";
import { generateToken } from "../lib/token";
import type { Env } from "../lib/env";
import {
  genOtp,
  hashOtp,
  sendOtpEmail,
  OTP_TTL_SECONDS,
  OTP_RATE_WINDOW_SECONDS,
  OTP_RATE_MAX,
} from "./email";
import type { CustomerRow } from "../repositories/customers";

export const requestOtpSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
});
export const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});
export const createTicketSchema = z.object({
  name: z.string().min(1).max(200),
  description_html: z.string().max(20000).optional(),
  priority: z.enum(["high", "medium", "low", "urgent", "none"]).optional().default("none"),
});
export const addCommentSchema = z.object({
  comment_html: z.string().min(1).max(20000),
});
export const updateTicketSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description_html: z.string().max(20000).optional(),
  priority: z.enum(["high", "medium", "low", "urgent", "none"]).optional(),
});

export interface PortalCustomer {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string | null;
}

export function toPortalCustomer(c: CustomerRow): PortalCustomer {
  // Portal customers always have a users row (ensure() creates it); leads
  // (user_id NULL) never carry a session_token so never reach here.
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    userId: c.userId!,
    email: c.email ?? "",
    displayName: c.name,
  };
}

function otpKey(workspaceId: string, email: string) {
  return `portal:otp:${workspaceId}:${email.toLowerCase()}`;
}
function rlKey(email: string) {
  return `portal:otp:rl:${email.toLowerCase()}`;
}

export async function requestOtp(
  db: DbClient,
  kv: KVNamespace,
  env: Env,
  workspaceId: string,
  data: z.infer<typeof requestOtpSchema>,
): Promise<{ ok: true; dev_code?: string }> {
  // Rate-limit by email across the whole portal (abuse / brute-force guard).
  const rk = rlKey(data.email);
  const raw = await kv.get(rk);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= OTP_RATE_MAX) {
    throw new HTTPException(429, { message: "Too many code requests. Try again later." });
  }
  await kv.put(rk, String(count + 1), { expirationTtl: OTP_RATE_WINDOW_SECONDS });

  const customer = await customersRepo.ensure(db, workspaceId, {
    email: data.email,
    name: data.name,
  });
  const code = genOtp();
  const codeHash = await hashOtp(code);

  await kv.put(
    otpKey(workspaceId, data.email),
    JSON.stringify({ codeHash, customerId: customer.id }),
    {
      expirationTtl: OTP_TTL_SECONDS,
    },
  );

  const result = await sendOtpEmail(env, data.email, code);
  return { ok: true, ...(result.devCode ? { dev_code: result.devCode } : {}) };
}

export async function verifyOtp(
  db: DbClient,
  kv: KVNamespace,
  workspaceId: string,
  data: z.infer<typeof verifyOtpSchema>,
): Promise<{ customer: PortalCustomer; token: string }> {
  const stored = await kv.get(otpKey(workspaceId, data.email));
  if (!stored) {
    throw new HTTPException(401, { message: "Code invalid or expired" });
  }
  const { codeHash, customerId } = JSON.parse(stored) as { codeHash: string; customerId: string };
  if ((await hashOtp(data.code)) !== codeHash) {
    throw new HTTPException(401, { message: "Code invalid or expired" });
  }
  await kv.delete(otpKey(workspaceId, data.email));

  const token = generateToken();
  await customersRepo.setSessionToken(db, customerId, token);
  const customer = await customersRepo.findBySessionToken(db, token);
  if (!customer) throw new HTTPException(500, { message: "Session could not be established" });
  return { customer: toPortalCustomer(customer), token };
}

export async function clearSession(db: DbClient, customerId: string) {
  await customersRepo.clearSessionToken(db, customerId);
}

export async function listTickets(
  db: DbClient,
  customer: PortalCustomer,
  opts: { offset: number; limit: number },
) {
  const { rows, total } = await supportTicketsRepo.listByCustomer(db, customer.id, opts);
  return { results: rows, total, offset: opts.offset, limit: opts.limit };
}

export async function createTicket(
  db: DbClient,
  customer: PortalCustomer,
  data: z.infer<typeof createTicketSchema>,
) {
  const settings = await portalSettingsRepo.get(db, customer.workspaceId);
  if (!settings?.isEnabled || !settings.supportProjectId) {
    throw new HTTPException(400, { message: "Support portal is not enabled for this workspace" });
  }

  const issue = await issuesService.create(
    db,
    settings.supportProjectId,
    {
      name: data.name,
      description_html: data.description_html,
      priority: data.priority,
    },
    customer.userId,
  );

  // Tag the issue as portal-sourced (informational; existing field).
  await db
    .update(schema.issues)
    .set({ externalSource: "portal" })
    .where(eq(schema.issues.id, issue.id));

  await supportTicketsRepo.create(db, {
    issueId: issue.id,
    customerId: customer.id,
    workspaceId: customer.workspaceId,
  });
  // Record the creation as the first entry in the ticket's activity trail.
  await activitiesRepo.create(db, {
    verb: "created",
    issueId: issue.id,
    actorId: customer.userId,
  });
  // CRM timeline: the ticket shows up on the contact's timeline too.
  await crmActivitiesService.recordActivity(db, customer.workspaceId, {
    customerId: customer.id,
    type: "NOTE",
    subject: "Support ticket created",
    body: issue.name,
    createdBy: customer.userId,
  });

  return issue;
}

// A customer's tickets can live in several projects (portal tickets in the
// support project, widget/native reports in each board's project). Callers pass
// the project; without one we fall back to the support project, then to any
// project the customer has a ticket with that sequence id in.
async function resolveOwnTicket(
  db: DbClient,
  customer: PortalCustomer,
  seqId: number,
  projectId?: string | null,
) {
  let scope = projectId ?? null;
  if (!scope) {
    const settings = await portalSettingsRepo.get(db, customer.workspaceId);
    scope = settings?.isEnabled ? settings.supportProjectId : null;
  }
  const ticket =
    (await supportTicketsRepo.getByIssueSeqForCustomer(db, scope, seqId, customer.id)) ??
    (scope && !projectId
      ? await supportTicketsRepo.getByIssueSeqForCustomer(db, null, seqId, customer.id)
      : null);
  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }
  return ticket;
}

export async function getTicket(
  db: DbClient,
  customer: PortalCustomer,
  seqId: number,
  projectId?: string | null,
) {
  const ticket = await resolveOwnTicket(db, customer, seqId, projectId);
  const issue = await issuesRepo.findById(db, ticket.issueId);
  // Workspace-scoped (DEV-21 parity with enrich paths): portal customers must
  // not see assignee rows linked from legacy cross-workspace data.
  const assignees = await issuesRepo.listAssignees(db, ticket.issueId, issue?.workspaceId);
  const comments = await listPublicComments(db, ticket.issueId);
  const activities = await activitiesRepo.listByIssue(db, ticket.issueId);
  return { ticket, issue, assignees, comments, activities };
}

export async function addTicketComment(
  db: DbClient,
  customer: PortalCustomer,
  seqId: number,
  data: z.infer<typeof addCommentSchema>,
  projectId?: string | null,
) {
  const ticket = await resolveOwnTicket(db, customer, seqId, projectId);
  return commentsRepo.create(db, {
    commentHtml: data.comment_html,
    access: "public",
    issueId: ticket.issueId,
    actorId: customer.userId,
  });
}
export async function updateTicket(
  db: DbClient,
  customer: PortalCustomer,
  seqId: number,
  data: z.infer<typeof updateTicketSchema>,
  projectId?: string | null,
) {
  const ticket = await resolveOwnTicket(db, customer, seqId, projectId);
  // Customers may refine their own request (title, body, priority). State
  // changes are a support-side action and surface only in the activity trail.
  // Routing through issuesService.update records the field-change activities.
  await issuesService.update(
    db,
    ticket.issueId,
    {
      name: data.name,
      description_html: data.description_html,
      priority: data.priority,
    },
    customer.userId,
  );
  return getTicket(db, customer, seqId, ticket.projectId);
}

// ── Unified portal (ideas + support + changelog) ──

interface PortalBoardSummary {
  token: string;
  title: string;
  description: string | null;
  brand_color: string;
  allow_submit: boolean;
  project_id: string;
}

async function workspaceBoards(db: DbClient, workspaceId: string): Promise<PortalBoardSummary[]> {
  const boards = await feedbackRepo.listBoardsByWorkspace(db, workspaceId);
  return boards.map((b) => ({
    token: b.publicToken,
    title: b.title,
    description: b.description,
    brand_color: b.brandColor,
    allow_submit: !!b.allowSubmit,
    project_id: b.projectId,
  }));
}

// Public landing data for /portal/:slug: the workspace's feedback boards (Ideas
// tab) and whether the Support tab can create tickets.
export async function getOverview(
  db: DbClient,
  workspace: { id: string; name: string; slug: string },
) {
  const [boards, settings] = await Promise.all([
    workspaceBoards(db, workspace.id),
    portalSettingsRepo.get(db, workspace.id),
  ]);
  return {
    workspace: { name: workspace.name, slug: workspace.slug },
    boards,
    support_enabled: !!settings?.isEnabled && !!settings.supportProjectId,
  };
}

// Changelog = feedback items completed on this workspace's boards, newest first.
export async function getChangelog(db: DbClient, workspaceId: string) {
  const boards = await workspaceBoards(db, workspaceId);
  if (boards.length === 0) return { results: [] };
  const byProject = new Map(boards.map((b) => [b.project_id, b]));
  const rows = await db
    .select({
      id: schema.issues.id,
      sequenceId: schema.issues.sequenceId,
      projectId: schema.issues.projectId,
      name: schema.issues.name,
      description: schema.issues.descriptionStripped,
      completedAt: schema.issues.completedAt,
    })
    .from(schema.issues)
    .innerJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(
      and(
        inArray(schema.issues.projectId, [...byProject.keys()]),
        eq(schema.issues.externalSource, "feedback"),
        eq(schema.states.groupName, "completed"),
        isNull(schema.issues.deletedAt),
        isNotNull(schema.issues.completedAt),
      ),
    )
    .orderBy(desc(schema.issues.completedAt))
    .limit(50);
  const votes = await feedbackRepo.voteCountsForIssues(
    db,
    rows.map((r) => r.id),
  );
  return {
    results: rows.map((r) => ({
      id: r.id,
      sequence_id: r.sequenceId,
      name: r.name,
      description: r.description,
      completed_at: r.completedAt,
      votes: votes.get(r.id) ?? 0,
      board_title: byProject.get(r.projectId)?.title ?? null,
      board_token: byProject.get(r.projectId)?.token ?? null,
    })),
  };
}

// Everything the signed-in person filed. The OTP login proves ownership of
// `customer.email`, so reports submitted WITHOUT identity verification (typed
// email, no/bad signature) that name this address surface here — in a separate
// `unverified` list, because the person never vouched for them and they must
// not be mistaken for their own requests.
//  - tickets: support tickets tied to their customer record (verified only)
//  - ideas: board ideas whose email was proven by a valid identify signature
//  - unverified: any idea/bug/question typed in with their email, unproven
export async function getMine(db: DbClient, customer: PortalCustomer) {
  const [tickets, boards] = await Promise.all([
    supportTicketsRepo.listByCustomer(db, customer.id, { offset: 0, limit: 100 }),
    workspaceBoards(db, customer.workspaceId),
  ]);
  const byProject = new Map(boards.map((b) => [b.project_id, b]));
  const email = customer.email.trim().toLowerCase();
  const rows = email
    ? await db
        .select({
          id: schema.issues.id,
          sequenceId: schema.issues.sequenceId,
          projectId: schema.issues.projectId,
          name: schema.issues.name,
          createdAt: schema.issues.createdAt,
          stateName: schema.states.name,
          stateColor: schema.states.color,
          kind: schema.feedbackMeta.kind,
          verified: schema.feedbackMeta.identityVerified,
        })
        .from(schema.feedbackMeta)
        .innerJoin(schema.issues, eq(schema.issues.id, schema.feedbackMeta.issueId))
        .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
        .where(
          and(
            eq(schema.issues.workspaceId, customer.workspaceId),
            isNull(schema.issues.deletedAt),
            sql`lower(${schema.feedbackMeta.authorEmail}) = ${email}`,
          ),
        )
        .orderBy(desc(schema.issues.createdAt))
        .limit(200)
    : [];
  const toItem = (r: (typeof rows)[number]) => ({
    id: r.id,
    sequence_id: r.sequenceId,
    name: r.name,
    kind: r.kind,
    created_at: r.createdAt,
    state_name: r.stateName,
    state_color: r.stateColor,
    board_token: byProject.get(r.projectId)?.token ?? null,
    board_title: byProject.get(r.projectId)?.title ?? null,
  });
  return {
    ideas: rows.filter((r) => r.verified === 1 && r.kind === "idea").map(toItem),
    unverified: rows.filter((r) => r.verified !== 1).map(toItem),
    tickets: tickets.rows,
  };
}

// Portal-visible thread: only comments explicitly marked public.
export async function listPublicComments(db: DbClient, issueId: string) {
  return db
    .select({
      id: schema.issueComments.id,
      commentHtml: schema.issueComments.commentHtml,
      createdAt: schema.issueComments.createdAt,
      actorId: schema.issueComments.actorId,
      actorName: schema.users.displayName,
      actorEmail: schema.users.email,
      isCustomer: schema.users.isCustomer,
    })
    .from(schema.issueComments)
    .innerJoin(schema.users, eq(schema.users.id, schema.issueComments.actorId))
    .where(
      and(
        eq(schema.issueComments.issueId, issueId),
        eq(schema.issueComments.access, "public"),
        isNull(schema.issueComments.deletedAt),
      ),
    )
    .orderBy(desc(schema.issueComments.createdAt));
}
