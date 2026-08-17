import { z } from "zod";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as customersRepo from "../repositories/customers";
import * as dealsRepo from "../repositories/deals";
import * as supportTicketsRepo from "../repositories/supportTickets";
import * as issuesService from "./issues";
import { paginatedResponse } from "../lib/pagination";

// ── Contact (lead / customer) schemas ──
export const createContactSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  source: z.string().max(120).optional(),
});
export const updateContactSchema = createContactSchema.partial().extend({
  status: z.enum(["lead", "active", "churned"]).optional(),
});

// ── Deal schemas (wire format is snake_case) ──
export const createDealSchema = z.object({
  name: z.string().min(1).max(200),
  customer_id: z.string().uuid().optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  currency: z.string().max(8).optional(),
  expected_close_at: z.string().optional(),
  state_id: z.string().uuid().optional(),
});
export const updateDealSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  currency: z.string().max(8).optional(),
  expected_close_at: z.string().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
});
export const moveDealSchema = z.object({
  state_id: z.string().uuid(),
});

// ── Contacts ──

export async function createContact(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof createContactSchema>,
) {
  return customersRepo.createLead(db, workspaceId, data);
}

export async function listContacts(
  db: DbClient,
  workspaceId: string,
  opts: { status?: string; search?: string; offset: number; limit: number },
) {
  const { rows, total } = await customersRepo.listContacts(db, workspaceId, opts);
  return paginatedResponse(rows, total, opts.offset, opts.limit);
}

export async function getContact(db: DbClient, workspaceId: string, customerId: string) {
  const contact = await customersRepo.getContact(db, workspaceId, customerId);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  const [deals, tickets] = await Promise.all([
    dealsRepo.listByCustomer(db, customerId),
    supportTicketsRepo.listByCustomer(db, customerId, { offset: 0, limit: 50 }),
  ]);
  return { contact, deals, tickets: tickets.rows };
}

export async function updateContact(
  db: DbClient,
  workspaceId: string,
  customerId: string,
  data: z.infer<typeof updateContactSchema>,
) {
  const contact = await customersRepo.updateContact(db, workspaceId, customerId, data);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  return contact;
}

export async function deleteContact(db: DbClient, workspaceId: string, customerId: string) {
  const contact = await customersRepo.getContact(db, workspaceId, customerId);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  // Guard: support_tickets.customer_id is ON DELETE CASCADE — deleting the
  // contact would destroy ticket history. Refuse until tickets are removed.
  // deals.customer_id is ON DELETE SET NULL, so deals survive — allowed.
  const { total } = await supportTicketsRepo.listByCustomer(db, customerId, {
    offset: 0,
    limit: 1,
  });
  if (total > 0) {
    throw new HTTPException(409, { message: "Contact has support tickets; remove them first" });
  }
  await customersRepo.deleteContact(db, workspaceId, customerId);
}

// ── Deals ──

// A deal is an issue (external_source='crm') plus a deals side row. The
// pipeline is the issue's project; the stage is the issue's state.
export async function createDeal(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  data: z.infer<typeof createDealSchema>,
  createdById: string,
) {
  const issue = await issuesService.create(
    db,
    projectId,
    {
      name: data.name,
      priority: "none",
      state_id: data.state_id,
    },
    createdById,
  );

  await db
    .update(schema.issues)
    .set({ externalSource: "crm" })
    .where(eq(schema.issues.id, issue.id));

  const deal = await dealsRepo.create(db, {
    issueId: issue.id,
    customerId: data.customer_id,
    workspaceId,
    amountCents: data.amount_cents ?? 0,
    currency: data.currency ?? "USD",
    expectedCloseAt: data.expected_close_at,
  });

  return { ...deal, issue };
}

export async function listDeals(
  db: DbClient,
  projectId: string,
  opts: { stateId?: string; offset: number; limit: number },
) {
  const { rows, total } = await dealsRepo.listByProject(db, projectId, opts);
  return paginatedResponse(rows, total, opts.offset, opts.limit);
}

export async function getDeal(db: DbClient, projectId: string, issueId: string) {
  const deal = await dealsRepo.getByIssue(db, issueId, projectId);
  if (!deal) throw new HTTPException(404, { message: "Deal not found" });
  return deal;
}

export async function updateDeal(
  db: DbClient,
  projectId: string,
  issueId: string,
  data: z.infer<typeof updateDealSchema>,
) {
  // Scope by project to close IDOR before mutating.
  const existing = await dealsRepo.getByIssue(db, issueId, projectId);
  if (!existing) throw new HTTPException(404, { message: "Deal not found" });

  if (data.name) {
    await issuesService.update(db, issueId, { name: data.name });
  }
  return dealsRepo.update(db, issueId, {
    amountCents: data.amount_cents,
    currency: data.currency,
    expectedCloseAt: data.expected_close_at,
    customerId: data.customer_id,
  });
}

// Stage transition: delegates to the normal issue state update so all the
// existing issue-side validation / activity logging applies.
export async function moveDealStage(
  db: DbClient,
  projectId: string,
  issueId: string,
  stateId: string,
) {
  const existing = await dealsRepo.getByIssue(db, issueId, projectId);
  if (!existing) throw new HTTPException(404, { message: "Deal not found" });
  return issuesService.update(db, issueId, { state_id: stateId });
}

export async function pipelineStats(db: DbClient, projectId: string) {
  return dealsRepo.aggregateByState(db, projectId);
}
