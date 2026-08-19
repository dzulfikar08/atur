import { and, eq } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// ── polar_links ──

export async function findLinkByPolarId(
  db: DbClient,
  workspaceId: string,
  polarType: string,
  polarId: string,
) {
  const [row] = await db
    .select()
    .from(schema.polarLinks)
    .where(
      and(
        eq(schema.polarLinks.workspaceId, workspaceId),
        eq(schema.polarLinks.polarType, polarType),
        eq(schema.polarLinks.polarId, polarId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertLink(
  db: DbClient,
  data: {
    workspaceId: string;
    polarType: string;
    polarId: string;
    customerId?: string | null;
    dealId?: string | null;
    raw?: string | null;
    lastEvent?: string | null;
  },
) {
  const now = nowISO();
  // Single-statement upsert. A concurrent webhook (Polar retry racing the
  // original) with a SELECT-then-INSERT pattern here would crash on the
  // unique index; ON CONFLICT resolves to whichever write lands last.
  // Omitted fields deliberately reset to null — every caller of a given
  // polarType always passes the same field set.
  await db
    .insert(schema.polarLinks)
    .values({
      id: uuid(),
      workspaceId: data.workspaceId,
      service: "polar",
      polarType: data.polarType,
      polarId: data.polarId,
      customerId: data.customerId ?? null,
      dealId: data.dealId ?? null,
      raw: data.raw ?? null,
      lastEvent: data.lastEvent ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.polarLinks.workspaceId,
        schema.polarLinks.service,
        schema.polarLinks.polarType,
        schema.polarLinks.polarId,
      ],
      set: {
        customerId: data.customerId ?? null,
        dealId: data.dealId ?? null,
        raw: data.raw ?? null,
        lastEvent: data.lastEvent ?? null,
        updatedAt: now,
      },
    });
  return findLinkByPolarId(db, data.workspaceId, data.polarType, data.polarId);
}

export async function listLinksByCustomer(db: DbClient, customerId: string) {
  return db
    .select()
    .from(schema.polarLinks)
    .where(eq(schema.polarLinks.customerId, customerId))
    .orderBy(schema.polarLinks.updatedAt);
}

export async function listLinksByWorkspace(db: DbClient, workspaceId: string) {
  return db
    .select()
    .from(schema.polarLinks)
    .where(eq(schema.polarLinks.workspaceId, workspaceId))
    .orderBy(schema.polarLinks.updatedAt);
}

export async function removeLinkByPolarId(
  db: DbClient,
  workspaceId: string,
  polarType: string,
  polarId: string,
) {
  const link = await findLinkByPolarId(db, workspaceId, polarType, polarId);
  if (!link) return;
  await db.delete(schema.polarLinks).where(eq(schema.polarLinks.id, link.id));
}

// ── polar_settings ──

export async function getSettings(db: DbClient, workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.polarSettings)
    .where(eq(schema.polarSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

// ── Provenance columns on CRM rows ──

export async function setCustomerPolarId(
  db: DbClient,
  customerId: string,
  polarCustomerId: string,
) {
  await db
    .update(schema.customers)
    .set({ polarCustomerId, updatedAt: nowISO() })
    .where(eq(schema.customers.id, customerId));
}

export async function setDealPolarId(
  db: DbClient,
  dealId: string,
  polarId: string,
  kind: "subscription" | "order",
) {
  const set: Record<string, unknown> = { updatedAt: nowISO() };
  if (kind === "subscription") set.polarSubscriptionId = polarId;
  else set.polarOrderId = polarId;
  await db.update(schema.deals).set(set).where(eq(schema.deals.id, dealId));
}

// deals.id (PK, what polar_links stores) → the backing issue id. Null when the
// deal row no longer exists.
export async function dealIssueId(db: DbClient, dealId: string): Promise<string | null> {
  const [row] = await db
    .select({ issueId: schema.deals.issueId })
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId))
    .limit(1);
  return row?.issueId ?? null;
}

export async function upsertSettings(
  db: DbClient,
  workspaceId: string,
  data: {
    accessToken?: string | null;
    webhookSecret?: string | null;
    pipelineProjectId?: string | null;
    defaultStateId?: string | null;
    webhookEnabled?: number | null;
    lastSyncedAt?: string | null;
  },
) {
  const now = nowISO();
  const existing = await getSettings(db, workspaceId);
  if (existing) {
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.accessToken !== undefined) set.accessToken = data.accessToken;
    if (data.webhookSecret !== undefined) set.webhookSecret = data.webhookSecret;
    if (data.pipelineProjectId !== undefined) set.pipelineProjectId = data.pipelineProjectId;
    if (data.defaultStateId !== undefined) set.defaultStateId = data.defaultStateId;
    if (data.webhookEnabled !== undefined) set.webhookEnabled = data.webhookEnabled;
    if (data.lastSyncedAt !== undefined) set.lastSyncedAt = data.lastSyncedAt;
    await db
      .update(schema.polarSettings)
      .set(set)
      .where(eq(schema.polarSettings.workspaceId, workspaceId));
    return getSettings(db, workspaceId);
  }
  // onConflictDoNothing: a concurrent first-save (e.g. webhook arriving while
  // the settings form saves) hits the workspace PK — let the winner's row
  // stand and re-read below.
  await db
    .insert(schema.polarSettings)
    .values({
      workspaceId,
      accessToken: data.accessToken ?? null,
      webhookSecret: data.webhookSecret ?? null,
      pipelineProjectId: data.pipelineProjectId ?? null,
      defaultStateId: data.defaultStateId ?? null,
      webhookEnabled: data.webhookEnabled ?? 0,
      lastSyncedAt: data.lastSyncedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return getSettings(db, workspaceId);
}
