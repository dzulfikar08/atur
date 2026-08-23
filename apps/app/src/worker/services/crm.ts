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
  getPurpose,
  isKnownPurpose,
  TEMPLATE_PURPOSES,
  TEMPLATE_VARIABLES,
  type PurchaseInfo,
  type TemplatePurpose,
  type RenderedEmail,
} from "./crm_email_templates";
import * as emailVariantsRepo from "../repositories/crm_email_variants";
import * as emailLogRepo from "../repositories/crm_email_log";
import * as activitiesService from "./crm_activities";
import * as activitiesRepo from "../repositories/crm_activities";
import * as factsRepo from "../repositories/contact_facts";
import * as companiesRepo from "../repositories/companies";

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
  company_id: z.string().uuid().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  seniority: z.string().max(60).nullable().optional(),
  function: z.string().max(120).nullable().optional(),
  linkedin_url: z.string().max(500).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
});

// ── Deal schemas (wire format is snake_case) ──
export const createDealSchema = z.object({
  name: z.string().min(1).max(200),
  customer_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
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
  company_id: z.string().uuid().nullable().optional(),
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
  const [deals, tickets, emails, company, activities, facts, suggestions] = await Promise.all([
    dealsRepo.listByCustomer(db, customerId),
    supportTicketsRepo.listByCustomer(db, customerId, { offset: 0, limit: 50 }),
    emailLogRepo.listByCustomer(db, customerId, 20),
    contact.companyId ? companiesRepo.getCompany(db, workspaceId, contact.companyId) : null,
    activitiesRepo.listByCustomer(db, workspaceId, customerId, { offset: 0, limit: 50 }),
    factsRepo.listFacts(db, workspaceId, { customerId, offset: 0, limit: 20 }),
    factsRepo.listFacts(db, workspaceId, { customerId, status: "PROPOSED", offset: 0, limit: 10 }),
  ]);
  return {
    contact,
    company,
    deals,
    tickets: tickets.rows,
    emails,
    activities: activities.rows,
    facts: facts.rows,
    suggestions: suggestions.rows,
  };
}

export async function updateContact(
  db: DbClient,
  workspaceId: string,
  customerId: string,
  data: z.infer<typeof updateContactSchema>,
) {
  // Wire keys are snake_case for the new fields (company_id etc.) — translate
  // to the repo's camelCase patch. Legacy camelCase keys pass through as-is.
  const contact = await customersRepo.updateContact(db, workspaceId, customerId, {
    name: data.name,
    company: data.company,
    companyId: data.company_id,
    title: data.title,
    seniority: data.seniority,
    function: data.function,
    linkedinUrl: data.linkedin_url,
    imageUrl: data.image_url,
    phone: data.phone,
    status: data.status,
    source: data.source,
    email: data.email,
  });
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

// Bind a deal's customer/company links to the deal's workspace (the same
// DEV-19 class as issue state/label ids): a foreign UUID that merely exists
// must not be attachable to a deal — the board joins customer/company names
// and get_contact rolls deals up, so a cross-workspace link leaks data.
async function assertDealLinksInWorkspace(
  db: DbClient,
  workspaceId: string,
  customerId?: string | null,
  companyId?: string | null,
) {
  if (customerId) {
    const contact = await customersRepo.getContact(db, workspaceId, customerId);
    if (!contact) throw new HTTPException(404, { message: "Customer not found" });
  }
  if (companyId) {
    const company = await companiesRepo.getCompany(db, workspaceId, companyId);
    if (!company) throw new HTTPException(404, { message: "Company not found" });
  }
}

export async function createDeal(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  data: z.infer<typeof createDealSchema>,
  createdById?: string | null,
) {
  // Bind customer/company to this workspace BEFORE the issue is minted, so a
  // foreign id fails fast instead of leaving an orphan issue + deal row.
  await assertDealLinksInWorkspace(db, workspaceId, data.customer_id, data.company_id);
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
    companyId: data.company_id,
    workspaceId,
    amountCents: data.amount_cents ?? 0,
    currency: data.currency ?? "USD",
    expectedCloseAt: data.expected_close_at,
  });

  // CRM timeline: the deal's creation shows up on the contact's timeline too.
  await activitiesService.recordActivity(db, workspaceId, {
    dealId: deal.id,
    customerId: data.customer_id,
    type: "NOTE",
    subject: "Deal created",
    body: data.name,
    createdBy: createdById,
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

  // Same binding on update: relinking a deal to a foreign customer/company
  // must 404, scoped to the deal's own workspace.
  await assertDealLinksInWorkspace(db, existing.workspaceId, data.customer_id, data.company_id);
  if (data.name) {
    await issuesService.update(db, issueId, { name: data.name });
  }
  return dealsRepo.update(db, issueId, {
    amountCents: data.amount_cents,
    currency: data.currency,
    expectedCloseAt: data.expected_close_at,
    customerId: data.customer_id,
    companyId: data.company_id,
  });
}

// Stage transition: delegates to the normal issue state update so all the
// existing issue-side validation / activity logging applies.
export async function moveDealStage(
  db: DbClient,
  projectId: string,
  issueId: string,
  stateId: string,
  actorId?: string | null,
) {
  const existing = await dealsRepo.getByIssue(db, issueId, projectId);
  if (!existing) throw new HTTPException(404, { message: "Deal not found" });
  const [state] = await db
    .select({ name: schema.states.name })
    .from(schema.states)
    .where(eq(schema.states.id, stateId))
    .limit(1);
  const updated = await issuesService.update(db, issueId, { state_id: stateId });
  // CRM timeline: STAGE_CHANGE on the deal (+ contact rollup when linked).
  await activitiesService.recordActivity(db, existing.workspaceId, {
    dealId: existing.id,
    customerId: existing.customerId,
    type: "STAGE_CHANGE",
    subject: state?.name ? `Stage changed to ${state.name}` : "Stage changed",
    createdBy: actorId,
  });
  return updated;
}

// Pipeline rollups for the board header + column totals. Currencies are never
// cross-summed: every bucket is a per-currency list. "won_this_month" buckets
// terminal completed deals whose underlying issue was updated this UTC month
// (updated_at proxies the won date — see aggregateTerminalSince caveat).
function startOfMonthISO(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function pipelineStats(db: DbClient, projectId: string) {
  const [byStageRaw, wonThisMonth, lost] = await Promise.all([
    dealsRepo.aggregateByStageCurrency(db, projectId),
    dealsRepo.aggregateTerminalSince(db, projectId, "completed", startOfMonthISO()),
    dealsRepo.aggregateTerminalSince(db, projectId, "cancelled", ""),
  ]);

  const byStage = byStageRaw.map((r) => ({
    state_id: r.stateId,
    currency: r.currency,
    total_cents: r.totalCents,
    count: r.count,
  }));

  // Open = anything not in a terminal group (null group counts as open).
  const openMap = new Map<string, { currency: string; total_cents: number; count: number }>();
  for (const r of byStageRaw) {
    if (r.stateGroup === "completed" || r.stateGroup === "cancelled") continue;
    const cur = openMap.get(r.currency) ?? { currency: r.currency, total_cents: 0, count: 0 };
    cur.total_cents += r.totalCents;
    cur.count += r.count;
    openMap.set(r.currency, cur);
  }

  // Route wraps this in { results: … }.
  return {
    by_stage: byStage,
    totals: {
      open: [...openMap.values()],
      won_this_month: wonThisMonth.map((r) => ({
        currency: r.currency,
        total_cents: r.totalCents,
        count: r.count,
      })),
      lost: lost.map((r) => ({
        currency: r.currency,
        total_cents: r.totalCents,
        count: r.count,
      })),
    },
  };
}

// ── Customer email ──────────────────────────────────────────────────────────

export const sendEmailSchema = z.object({
  purpose: z.string().refine(isKnownPurpose, "Unknown email purpose"),
  variant_id: z.string().uuid().optional(),
});

// Variant create/update. Subjects become RFC822 headers — a newline would
// allow header injection (buildRawEmail also strips CR/LF in defense).
export const saveVariantSchema = z.object({
  purpose: z.string().refine(isKnownPurpose, "Unknown email purpose"),
  name: z.string().min(1).max(80),
  subject: z
    .string()
    .min(1)
    .max(300)
    .refine((s) => !/[\r\n]/.test(s), "Subject must not contain line breaks"),
  body: z.string().min(1).max(10000),
  is_html: z.boolean().optional(),
});

export const updateVariantSchema = saveVariantSchema.omit({ purpose: true }).partial();

// Runtime guard for route params / request bodies typed as TemplatePurpose —
// a blind cast would persist arbitrary purpose strings.
export function parsePurposeName(name: string): TemplatePurpose {
  if (isKnownPurpose(name)) return name;
  throw new HTTPException(404, { message: `Unknown email purpose: ${name}` });
}

// Workspace-level email footer ({{footer}} placeholder value). Stored on
// workspaces.email_footer; empty string clears it back to the default.
export const saveFooterSchema = z.object({
  footer: z.string().max(500),
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
    .filter((o): o is PolarOrder => o !== null && (o.status === "paid" || o.status === undefined))
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

// Resolve which template source to send: the requested variant (validated
// against workspace + purpose), else the purpose's default-flagged variant,
// else the curated code default. Unknown purposes throw 404. Returns the
// resolved variant row too (null = curated default) so the send log can
// record exactly what went out.
export async function resolveTemplateSource(
  db: DbClient,
  workspaceId: string,
  purpose: TemplatePurpose,
  variantId?: string,
): Promise<{
  source: { subject: string; body: string; isHtml: boolean };
  variant: emailVariantsRepo.EmailVariantRow | null;
}> {
  const def = getPurpose(purpose);
  if (!def) throw new HTTPException(404, { message: `Unknown email purpose: ${purpose}` });

  const variant = await emailVariantsRepo.resolveVariant(db, workspaceId, purpose, variantId);
  if (variant) {
    return {
      source: { subject: variant.subject, body: variant.body, isHtml: variant.isHtml === 1 },
      variant,
    };
  }
  return { source: { ...def.default, isHtml: false }, variant: null };
}

// Workspace fields the email renderer needs. Any workspace row satisfies this.
export interface EmailWorkspace {
  id: string;
  name: string;
  emailFooter: string | null;
}

// Shared lookup + render: validates the contact belongs to the workspace,
// resolves the variant (or curated default), enriches with the most-recent
// paid order (when the purpose requires it), and fills {{placeholders}} with
// customer + purchase data. Returns the rendered email plus purchase info and
// which variant resolved (null = curated default) for the frontend preview.
export async function renderTemplateEmail(
  db: DbClient,
  ws: EmailWorkspace,
  contactId: string,
  purpose: TemplatePurpose,
  variantId?: string,
): Promise<{
  subject: string;
  text: string;
  html: string;
  to: string | null;
  purchase: PurchaseInfo | null;
  variant_id: string | null;
  variant_name: string | null;
}> {
  const contact = await customersRepo.getContact(db, ws.id, contactId);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  if (!contact.email) {
    throw new HTTPException(400, { message: "Contact has no email address" });
  }

  const ctx = { name: contact.name, email: contact.email, company: contact.company };
  let purchase: PurchaseInfo | null = null;
  const def = getPurpose(purpose);
  if (def?.requiresPurchase) {
    purchase = await getContactPurchaseInfo(db, contact.id);
  }

  const { source, variant } = await resolveTemplateSource(db, ws.id, purpose, variantId);
  const footer = ws.emailFooter ?? `Regards,\n${ws.name} team`;
  const rendered: RenderedEmail = renderFromTemplateSource(source, ctx, purchase, footer);
  return {
    ...rendered,
    to: contact.email,
    purchase,
    variant_id: variant?.id ?? null,
    variant_name: variant?.name ?? null,
  };
}

// Minimum time between templated emails to the same contact (repeat-click
// / fat-finger protection; not an anti-spam system).
export const CUSTOMER_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

// Render + send a CRM customer email for a purpose (variant optional — falls
// back to the purpose's default variant or the curated default). Returns the
// rendered subject + whether the email was actually sent (false when the
// binding is absent in local dev). Sends to the same contact are rate-limited
// to one per cooldown window; every attempt is recorded in crm_email_log.
export async function sendTemplateEmail(
  db: DbClient,
  env: Env,
  ws: EmailWorkspace,
  contactId: string,
  body: z.infer<typeof sendEmailSchema>,
  actorId?: string | null,
): Promise<{ subject: string; sent: boolean; to: string | null }> {
  const contact = await customersRepo.getContact(db, ws.id, contactId);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  if (contact.lastEmailAt) {
    const elapsed = Date.now() - Date.parse(contact.lastEmailAt);
    if (Number.isFinite(elapsed) && elapsed < CUSTOMER_EMAIL_COOLDOWN_MS) {
      const minutes = Math.ceil((CUSTOMER_EMAIL_COOLDOWN_MS - elapsed) / 60_000);
      throw new HTTPException(429, {
        message: `An email was already sent to this contact recently — try again in ~${minutes} min`,
      });
    }
  }

  const rendered = await renderTemplateEmail(db, ws, contactId, body.purpose, body.variant_id);
  const result = await sendCustomerEmail(env, rendered.to!, {
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });

  await emailLogRepo.logSend(db, {
    workspaceId: ws.id,
    customerId: contactId,
    purpose: body.purpose,
    variantId: rendered.variant_id,
    variantName: rendered.variant_name,
    subject: rendered.subject,
    sent: result.sent,
  });
  if (result.sent) {
    await customersRepo.markEmailSent(db, contactId);
  }
  // CRM timeline: an EMAIL activity for the contact.
  await activitiesService.recordActivity(db, ws.id, {
    customerId: contactId,
    type: "EMAIL",
    subject: rendered.subject,
    body: body.purpose,
    createdBy: actorId,
  });

  return { subject: rendered.subject, sent: result.sent, to: rendered.to };
}

// ── Variant management (per-purpose template CRUD) ───────────────────────────

function variantWire(r: emailVariantsRepo.EmailVariantRow) {
  return {
    id: r.id,
    purpose: r.purpose,
    name: r.name,
    subject: r.subject,
    body: r.body,
    is_html: r.isHtml,
    is_default: r.isDefault,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

// Purpose registry (curated defaults + metadata) + this workspace's variants.
export async function listEmailTemplates(db: DbClient, workspaceId: string) {
  const variants = await emailVariantsRepo.listVariants(db, workspaceId);
  return {
    purposes: TEMPLATE_PURPOSES.map((p) => ({
      name: p.name,
      label: p.label,
      description: p.description,
      requires_purchase: p.requiresPurchase,
      default: p.default,
    })),
    variants: variants.map(variantWire),
  };
}

export async function createEmailVariant(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof saveVariantSchema>,
): Promise<ReturnType<typeof variantWire>> {
  try {
    const row = await emailVariantsRepo.createVariant(db, workspaceId, {
      purpose: data.purpose,
      name: data.name,
      subject: data.subject,
      body: data.body,
      isHtml: data.is_html,
    });
    return variantWire(row);
  } catch (err) {
    // UNIQUE(workspace_id, purpose, name) violation → friendly 409.
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, {
        message: `A variant named "${data.name}" already exists for this purpose`,
      });
    }
    throw err;
  }
}

export async function updateEmailVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
  data: z.infer<typeof updateVariantSchema>,
): Promise<void> {
  const existing = await emailVariantsRepo.getVariant(db, workspaceId, variantId);
  if (!existing) throw new HTTPException(404, { message: "Variant not found" });
  try {
    await emailVariantsRepo.updateVariant(db, workspaceId, variantId, {
      name: data.name,
      subject: data.subject,
      body: data.body,
      isHtml: data.is_html,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, {
        message: `A variant named "${data.name}" already exists for this purpose`,
      });
    }
    throw err;
  }
}

export async function deleteEmailVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
): Promise<void> {
  const existing = await emailVariantsRepo.getVariant(db, workspaceId, variantId);
  if (!existing) throw new HTTPException(404, { message: "Variant not found" });
  await emailVariantsRepo.deleteVariant(db, workspaceId, variantId);
}

export async function setDefaultEmailVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
): Promise<void> {
  const existing = await emailVariantsRepo.getVariant(db, workspaceId, variantId);
  if (!existing) throw new HTTPException(404, { message: "Variant not found" });
  await emailVariantsRepo.setDefaultVariant(db, workspaceId, variantId);
}

// Re-export template variables for the frontend editor UI.
export { TEMPLATE_VARIABLES };
