import { z } from "zod";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as customersRepo from "../repositories/customers";
import * as dealsRepo from "../repositories/deals";
import * as supportTicketsRepo from "../repositories/supportTickets";
import * as polarRepo from "../repositories/polar";
import type { PolarOrder } from "../lib/polar";
import * as issuesService from "./issues";
import { paginatedResponse } from "../lib/pagination";
import { sendCustomerEmail } from "./email";
import {
  renderFromTemplateSource,
  getDefaultTemplate,
  TEMPLATES_REQUIRING_PURCHASE,
  TEMPLATE_NAMES,
  TEMPLATE_VARIABLES,
  type PurchaseInfo,
  type TemplateName,
  type RenderedEmail,
} from "./crm_email_templates";
import * as emailTemplatesRepo from "../repositories/crm_email_templates";

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
  createdById?: string | null,
) {
  const issue = await issuesService.create(
    db,
    projectId,
    {
      name: data.name,
      priority: "none",
      state_id: data.state_id,
    },
    createdById ?? undefined,
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

// ── Customer email ──────────────────────────────────────────────────────────

export const sendEmailSchema = z.object({
  template: z.enum(["feedback_request"]),
});

export const saveTemplateSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
  is_html: z.boolean().optional(),
});

// Find the customer's most recent paid Polar order by parsing the raw
// payloads stored in polar_links. Returns null when there is no paid order.
export async function getContactPurchaseInfo(
  db: DbClient,
  customerId: string,
): Promise<PurchaseInfo | null> {
  const links = await polarRepo.listLinksByCustomer(db, customerId);
  const orders = links
    .filter((l) => l.polarType === "order" && l.raw)
    .map((l) => {
      if (!l.raw) return null;
      try {
        return JSON.parse(l.raw) as PolarOrder;
      } catch {
        return null;
      }
    })
    .filter(
      (o): o is PolarOrder =>
        o !== null && (o.status === "paid" || o.status === undefined),
    )
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  if (orders.length === 0) return null;
  const order = orders[0];
  return {
    date: order.created_at ?? "",
    amountCents: order.net_amount ?? 0,
    currency: order.currency ?? "USD",
    productName: order.product?.name ?? "your purchase",
  };
}

// Resolve which template source to use: a custom one from the DB, or the
// code-defined default. Throws 404 for unknown template names.
export async function resolveTemplateSource(
  db: DbClient,
  workspaceId: string,
  template: TemplateName,
): Promise<{ subject: string; body: string }> {
  const row = await emailTemplatesRepo.getTemplate(db, workspaceId, template);
  if (row) {
    return { subject: row.subject, body: row.body };
  }
  const def = getDefaultTemplate(template);
  if (!def) throw new HTTPException(404, { message: `Unknown template: ${template}` });
  return def;
}

// Shared lookup + render: validates the contact belongs to the workspace,
// loads the template (DB override or code default), enriches with the
// most-recent paid order (when the template requires it), and fills
// {{placeholders}} with customer + purchase data. Returns the rendered email
// plus the purchase info for the frontend preview.
export async function renderTemplateEmail(
  db: DbClient,
  workspaceId: string,
  contactId: string,
  template: TemplateName,
): Promise<{ subject: string; text: string; html: string; to: string | null; purchase: PurchaseInfo | null }> {
  const contact = await customersRepo.getContact(db, workspaceId, contactId);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  if (!contact.email) {
    throw new HTTPException(400, { message: "Contact has no email address" });
  }

  const ctx = { name: contact.name, email: contact.email, company: contact.company };
  let purchase: PurchaseInfo | null = null;
  if (TEMPLATES_REQUIRING_PURCHASE.has(template)) {
    purchase = await getContactPurchaseInfo(db, contact.id);
  }

  const source = await resolveTemplateSource(db, workspaceId, template);
  const rendered: RenderedEmail = renderFromTemplateSource(source, ctx, purchase);
  return { ...rendered, to: contact.email, purchase };
}

// Render + send a CRM customer email template. Uses the saved DB template (or
// code default) with customer + purchase data filled in. Returns the rendered
// subject + whether the email was actually sent (false when the binding is
// absent in local dev).
export async function sendTemplateEmail(
  db: DbClient,
  env: Env,
  workspaceId: string,
  contactId: string,
  body: z.infer<typeof sendEmailSchema>,
): Promise<{ subject: string; sent: boolean; to: string | null }> {
  const rendered = await renderTemplateEmail(db, workspaceId, contactId, body.template);
  const result = await sendCustomerEmail(env, rendered.to!, {
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });

  return { subject: rendered.subject, sent: result.sent, to: rendered.to };
}

// ── Template management (CRUD) ────────────────────────────────────────────────

export async function listEmailTemplates(
  db: DbClient,
  workspaceId: string,
): Promise<
  { id: string; template_name: string; subject: string; body: string; is_html: number; created_at: string | null; updated_at: string | null }[]
> {
  const rows = await emailTemplatesRepo.listTemplates(db, workspaceId);
  // Always include default templates so the UI can show "not customized" state.
  const defaults = TEMPLATE_NAMES.map((name) => {
    const def = getDefaultTemplate(name)!;
    return {
      id: `default:${name}`,
      template_name: name,
      subject: def.subject,
      body: def.body,
      is_html: 0,
      created_at: null,
      updated_at: null,
    };
  });
  const customized = rows.map((r) => ({
    id: r.id,
    template_name: r.templateName,
    subject: r.subject,
    body: r.body,
    is_html: r.isHtml,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return [...customized, ...defaults];
}

export async function getEmailTemplate(
  db: DbClient,
  workspaceId: string,
  template: TemplateName,
): Promise<{
  id: string;
  template_name: string;
  subject: string;
  body: string;
  is_html: number;
  created_at: string | null;
  updated_at: string | null;
} | null> {
  const row = await emailTemplatesRepo.getTemplate(db, workspaceId, template);
  if (!row) {
    const def = getDefaultTemplate(template);
    if (!def) return null;
    return {
      id: `default:${template}`,
      template_name: template,
      subject: def.subject,
      body: def.body,
      is_html: 0,
      created_at: null,
      updated_at: null,
    };
  }
  return {
    id: row.id,
    template_name: row.templateName,
    subject: row.subject,
    body: row.body,
    is_html: row.isHtml,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function saveEmailTemplate(
  db: DbClient,
  workspaceId: string,
  template: TemplateName,
  data: z.infer<typeof saveTemplateSchema>,
): Promise<{
  id: string;
  template_name: string;
  subject: string;
  body: string;
  is_html: number;
  created_at: string | null;
  updated_at: string | null;
}> {
  const row = await emailTemplatesRepo.upsertTemplate(db, workspaceId, template, {
    subject: data.subject,
    body: data.body,
    isHtml: data.is_html,
  });
  return {
    id: row.id,
    template_name: row.templateName,
    subject: row.subject,
    body: row.body,
    is_html: row.isHtml,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function deleteEmailTemplate(
  db: DbClient,
  workspaceId: string,
  template: TemplateName,
): Promise<void> {
  await emailTemplatesRepo.deleteTemplate(db, workspaceId, template);
}

// Re-export template variables for the frontend editor UI.
export { TEMPLATE_VARIABLES };
