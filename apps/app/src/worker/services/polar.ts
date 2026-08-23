import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as polarRepo from "../repositories/polar";
import * as customersRepo from "../repositories/customers";
import * as dealsRepo from "../repositories/deals";
import * as crmService from "./crm";
import * as issuesService from "./issues";
import * as activitiesService from "./crm_activities";
import {
  polarListAll,
  type PolarCustomer,
  type PolarEvent,
  type PolarOrder,
  type PolarSubscription,
} from "../lib/polar";
import { nowISO } from "../lib/pagination";

// ── Polar → CRM sync engine ──────────────────────────────────────────────────
// Polar customer  → customers row (contact, deduped on workspace+email).
// Polar subscription/order → deals row + backing issue in the workspace's
// pipeline project. Idempotent: polar_links dedupes on (type, polar_id).

export interface SyncCounts {
  customers: number;
  subscriptions: number;
  orders: number;
  // True when any resource hit SYNC_MAX — the tail was not fetched.
  truncated: boolean;
}

// Per-resource cap for a single "Sync now" run. Every D1 query is a
// subrequest (limit 1000/req) and each entity costs ~5 — this keeps the worst
// case inside the budget. Webhooks keep things fresh after the initial pull.
const SYNC_MAX = 500;

function polarAmountCents(amount: number | null): number {
  // Polar amounts are already integer cents.
  return amount ?? 0;
}

function currencyOf(code: string | null | undefined): string {
  const c = code ?? "";
  return c.toUpperCase() || "USD";
}

// Resolve (or create) the Atur contact for a Polar customer. Backfills name
// when the contact already exists. Returns the customers row.
async function ensureContact(
  db: DbClient,
  workspaceId: string,
  customer: PolarCustomer,
): Promise<NonNullable<Awaited<ReturnType<typeof customersRepo.findByWorkspaceEmail>>>> {
  const email = customer.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Polar customer has no email");
  }
  const existing = await customersRepo.findByWorkspaceEmail(db, workspaceId, email);
  if (existing) {
    await customersRepo.updateContact(db, workspaceId, existing.id, {
      name: existing.name ? undefined : (customer.name ?? null),
      source: existing.source ? undefined : "polar",
    });
    if (customer.id && existing.polarCustomerId !== customer.id) {
      await polarRepo.setCustomerPolarId(db, existing.id, customer.id);
    }
    return existing;
  }
  // createLead upserts on (workspace, email) — idempotent.
  const created = await customersRepo.createLead(db, workspaceId, {
    email,
    name: customer.name ?? null,
    source: "polar",
  });
  await polarRepo.setCustomerPolarId(db, created.id, customer.id);
  return created;
}

// Find the state for a given workflow group in the pipeline project. Used to
// map Polar subscription status → deal stage.
async function findStateByGroup(
  db: DbClient,
  projectId: string,
  group: string,
): Promise<string | null> {
  const [state] = await db
    .select({ id: schema.states.id })
    .from(schema.states)
    .where(
      and(
        eq(schema.states.projectId, projectId),
        eq(schema.states.groupName, group),
        isNull(schema.states.deletedAt),
      ),
    )
    // Deterministic pick among same-group states (e.g. Qualified vs Proposal
    // for "started" in sales-seeded pipelines): lowest sequence wins.
    .orderBy(schema.states.sequence)
    .limit(1);
  return state?.id ?? null;
}

// Pick the default pipeline project when the workspace hasn't configured one:
// a project whose name suggests a CRM pipeline, else the most recently created.
async function pickPipelineProject(db: DbClient, workspaceId: string): Promise<string | null> {
  const projects = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      createdAt: schema.projects.createdAt,
      isPipeline: schema.projects.isPipeline,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.workspaceId, workspaceId), isNull(schema.projects.deletedAt)));
  if (projects.length === 0) return null;
  const flagged = projects.find((p) => p.isPipeline === 1);
  if (flagged) return flagged.id;
  const hinted = projects.find((p) => /crm|deal|pipeline|sales/i.test(p.name ?? ""));
  if (hinted) return hinted.id;
  return (
    projects.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]?.id ?? null
  );
}

async function ensureSettings(
  db: DbClient,
  workspaceId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof polarRepo.getSettings>>>> {
  let settings = await polarRepo.getSettings(db, workspaceId);
  if (!settings) {
    await polarRepo.upsertSettings(db, workspaceId, {});
    settings = await polarRepo.getSettings(db, workspaceId);
  }
  return settings!;
}

async function resolvePipeline(
  db: DbClient,
  settings: NonNullable<Awaited<ReturnType<typeof polarRepo.getSettings>>>,
): Promise<{ projectId: string; defaultStateId: string | null }> {
  let projectId = settings.pipelineProjectId;
  if (!projectId) projectId = await pickPipelineProject(db, settings.workspaceId);
  if (!projectId) {
    throw new Error("No pipeline project configured for Polar sync");
  }
  let defaultStateId = settings.defaultStateId ?? null;
  if (!defaultStateId) {
    defaultStateId = await findStateByGroup(db, projectId, "started");
  }
  return { projectId, defaultStateId };
}

// Create the deal (issue + deals row) if it doesn't already exist for this
// Polar entity, and return its ids. Idempotent via polar_links. Note the two
// ids differ: `dealId` is the deals row PK (polar_links.deal_id,
// setDealPolarId), `issueId` keys dealsRepo.update and stage moves.
async function ensureDeal(
  db: DbClient,
  workspaceId: string,
  settings: NonNullable<Awaited<ReturnType<typeof polarRepo.getSettings>>>,
  customerRow: { id: string },
  polarType: "subscription" | "order",
  polarId: string,
  name: string,
  amountCents: number,
  currency: string,
): Promise<{ dealId: string; issueId: string }> {
  const existing = await polarRepo.findLinkByPolarId(db, workspaceId, polarType, polarId);
  if (existing?.dealId) {
    const issueId = await polarRepo.dealIssueId(db, existing.dealId);
    if (issueId) return { dealId: existing.dealId, issueId };
    // Deal row gone (deleted) — fall through and recreate.
  }

  const { projectId, defaultStateId } = await resolvePipeline(db, settings);
  const deal = await crmService.createDeal(
    db,
    workspaceId,
    projectId,
    {
      name,
      customer_id: customerRow.id,
      amount_cents: amountCents,
      currency,
      state_id: defaultStateId ?? undefined,
    },
    null,
  );

  await polarRepo.upsertLink(db, {
    workspaceId,
    polarType,
    polarId,
    customerId: customerRow.id,
    dealId: deal.id,
    lastEvent: `${polarType}.created`,
  });
  return { dealId: deal.id, issueId: deal.issueId };
}

// Move a deal's issue to the state matching a Polar subscription status.
async function setDealStageForStatus(
  db: DbClient,
  settings: NonNullable<Awaited<ReturnType<typeof polarRepo.getSettings>>>,
  issueId: string,
  status: string,
) {
  let group: string | null = null;
  if (status === "active" || status === "trialing" || status === "past_due") {
    group = "started";
  } else if (status === "canceled" || status === "revoked" || status === "paused") {
    group = "cancelled";
  }
  if (!group) return;
  await moveDealToGroup(db, settings, issueId, group);
}

// Resolve the pipeline project (configured or auto-picked) and move the deal's
// issue to the first state in `group`. Silently no-ops when there is nothing
// to move to — sync must not fail over stage mapping.
async function moveDealToGroup(
  db: DbClient,
  settings: NonNullable<Awaited<ReturnType<typeof polarRepo.getSettings>>>,
  issueId: string,
  group: string,
) {
  const projectId =
    settings.pipelineProjectId ?? (await pickPipelineProject(db, settings.workspaceId));
  if (!projectId) return;
  const stateId = await findStateByGroup(db, projectId, group);
  if (!stateId) return;
  await issuesService.update(db, issueId, { state_id: stateId });
}

// ── Webhook handlers ──

export async function upsertCustomer(
  db: DbClient,
  workspaceId: string,
  customer: PolarCustomer,
  eventType = "customer.updated",
) {
  const row = await ensureContact(db, workspaceId, customer);
  await polarRepo.upsertLink(db, {
    workspaceId,
    polarType: "customer",
    polarId: customer.id,
    customerId: row.id,
    lastEvent: eventType,
    raw: JSON.stringify(customer),
  });
  // CRM timeline: a Polar import event on the contact.
  await activitiesService.recordActivity(db, workspaceId, {
    customerId: row.id,
    type: "NOTE",
    subject: "Polar import",
    body: eventType,
  });
  return row;
}

export async function upsertSubscription(
  db: DbClient,
  workspaceId: string,
  subscription: PolarSubscription,
  eventType = "subscription.updated",
) {
  const customer = subscription.customer;
  if (!customer?.email) return null;
  const settings = await ensureSettings(db, workspaceId);
  const customerRow = await ensureContact(db, workspaceId, customer);
  const amount = polarAmountCents(subscription.price_amount);
  const currency = currencyOf(subscription.price_currency);
  const name = `Subscription — ${subscription.product?.name ?? "Polar"}`;

  const { dealId, issueId } = await ensureDeal(
    db,
    workspaceId,
    settings,
    customerRow,
    "subscription",
    subscription.id,
    name,
    amount,
    currency,
  );

  // Update amount/currency (subscriptions can change price on renewal).
  await dealsRepo.update(db, issueId, {
    amountCents: amount,
    currency,
  });
  // Set Polar provenance on the deal row.
  await polarRepo.setDealPolarId(db, dealId, subscription.id, "subscription");
  await setDealStageForStatus(db, settings, issueId, subscription.status);

  await polarRepo.upsertLink(db, {
    workspaceId,
    polarType: "subscription",
    polarId: subscription.id,
    customerId: customerRow.id,
    dealId,
    lastEvent: eventType,
    raw: JSON.stringify(subscription),
  });
  return dealId;
}

export async function upsertOrder(
  db: DbClient,
  workspaceId: string,
  order: PolarOrder,
  eventType = "order.updated",
) {
  const customer = order.customer;
  if (!customer?.email) return null;
  const settings = await ensureSettings(db, workspaceId);
  const customerRow = await ensureContact(db, workspaceId, customer);
  const amount = polarAmountCents(order.net_amount);
  const currency = currencyOf(order.currency);
  const name = `Order — ${order.product?.name ?? "Polar"}`;

  const { dealId, issueId } = await ensureDeal(
    db,
    workspaceId,
    settings,
    customerRow,
    "order",
    order.id,
    name,
    amount,
    currency,
  );

  await dealsRepo.update(db, issueId, {
    amountCents: amount,
    currency,
  });
  await polarRepo.setDealPolarId(db, dealId, order.id, "order");
  // Refunds close the deal: move it to the cancelled group.
  if (order.status === "refunded") {
    await moveDealToGroup(db, settings, issueId, "cancelled");
  }

  await polarRepo.upsertLink(db, {
    workspaceId,
    polarType: "order",
    polarId: order.id,
    customerId: customerRow.id,
    dealId,
    lastEvent: eventType,
    raw: JSON.stringify(order),
  });
  return dealId;
}

export async function handleEvent(
  db: DbClient,
  workspaceId: string,
  event: PolarEvent,
): Promise<void> {
  const { type, data } = event;
  if (
    type === "customer.created" ||
    type === "customer.updated" ||
    type === "customer.state_changed"
  ) {
    await upsertCustomer(db, workspaceId, data as unknown as PolarCustomer, type);
  } else if (type === "customer.deleted") {
    // Contact stays for history; just drop the link + polar id mapping.
    const customer = data as unknown as PolarCustomer;
    if (!customer?.id) return; // malformed payload — nothing to unlink
    await polarRepo.removeLinkByPolarId(db, workspaceId, "customer", customer.id);
  } else if (
    type.startsWith("subscription.") &&
    (type === "subscription.created" ||
      type === "subscription.active" ||
      type === "subscription.updated" ||
      type === "subscription.cycled" ||
      type === "subscription.canceled" ||
      type === "subscription.uncanceled" ||
      type === "subscription.revoked" ||
      type === "subscription.paused" ||
      type === "subscription.resumed" ||
      type === "subscription.past_due")
  ) {
    await upsertSubscription(db, workspaceId, data as unknown as PolarSubscription, type);
  } else if (
    type === "order.created" ||
    type === "order.paid" ||
    type === "order.updated" ||
    type === "order.refunded"
  ) {
    await upsertOrder(db, workspaceId, data as unknown as PolarOrder, type);
  }
  // Other events (benefit.*, product.*, discount.*, …) are not CRM-relevant.
}

// ── "Sync now" backfill via the Polar REST API ──

export async function syncAll(
  db: DbClient,
  workspaceId: string,
  accessToken: string,
  apiUrl?: string,
): Promise<SyncCounts> {
  const settings = await ensureSettings(db, workspaceId);
  await resolvePipeline(db, settings);

  const [customers, subscriptions, orders] = await Promise.all([
    polarListAll<PolarCustomer>(accessToken, apiUrl, "/v1/customers", 100, SYNC_MAX),
    polarListAll<PolarSubscription>(accessToken, apiUrl, "/v1/subscriptions", 100, SYNC_MAX),
    polarListAll<PolarOrder>(accessToken, apiUrl, "/v1/orders", 100, SYNC_MAX),
  ]);
  // polarListAll stops at SYNC_MAX per resource — flag it so the UI can say
  // the sync was partial rather than silently dropping the tail.
  const truncated =
    customers.length >= SYNC_MAX || subscriptions.length >= SYNC_MAX || orders.length >= SYNC_MAX;

  let customerCount = 0;
  let subscriptionCount = 0;
  let orderCount = 0;
  for (const c of customers) {
    await upsertCustomer(db, workspaceId, c, "customer.updated");
    customerCount++;
  }
  for (const s of subscriptions) {
    const dealt = await upsertSubscription(db, workspaceId, s, "subscription.updated");
    if (dealt) subscriptionCount++;
  }
  for (const o of orders) {
    const dealt = await upsertOrder(db, workspaceId, o, "order.updated");
    if (dealt) orderCount++;
  }

  await polarRepo.upsertSettings(db, workspaceId, { lastSyncedAt: nowISO() });
  return {
    customers: customerCount,
    subscriptions: subscriptionCount,
    orders: orderCount,
    truncated,
  };
}
