import { eq, and, desc, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface ActivityRow {
  id: string;
  workspaceId: string;
  customerId: string | null;
  dealId: string | null;
  type: string;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  createdBy: string | null;
  createdAt: string | null;
}

export const activitySelect = {
  id: schema.crmActivities.id,
  workspaceId: schema.crmActivities.workspaceId,
  customerId: schema.crmActivities.customerId,
  dealId: schema.crmActivities.dealId,
  type: schema.crmActivities.type,
  subject: schema.crmActivities.subject,
  body: schema.crmActivities.body,
  occurredAt: schema.crmActivities.occurredAt,
  createdBy: schema.crmActivities.createdBy,
  createdAt: schema.crmActivities.createdAt,
};

export async function createActivity(
  db: DbClient,
  data: {
    workspaceId: string;
    customerId?: string | null;
    dealId?: string | null;
    type: string;
    subject?: string | null;
    body?: string | null;
    occurredAt?: string;
    createdBy?: string | null;
  },
): Promise<ActivityRow> {
  const id = uuid();
  const occurredAt = data.occurredAt ?? nowISO();
  await db.insert(schema.crmActivities).values({
    id,
    workspaceId: data.workspaceId,
    customerId: data.customerId ?? null,
    dealId: data.dealId ?? null,
    type: data.type,
    subject: data.subject ?? null,
    body: data.body ?? null,
    occurredAt,
    createdBy: data.createdBy ?? null,
    createdAt: nowISO(),
  });
  const [row] = await db
    .select(activitySelect)
    .from(schema.crmActivities)
    .where(eq(schema.crmActivities.id, id))
    .limit(1);
  return row!;
}

export async function listByCustomer(
  db: DbClient,
  customerId: string,
  opts: { offset: number; limit: number },
): Promise<{ rows: ActivityRow[]; total: number }> {
  const conditions = [eq(schema.crmActivities.customerId, customerId)];
  const where = and(...conditions);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.crmActivities)
    .where(where);
  const rows = await db
    .select(activitySelect)
    .from(schema.crmActivities)
    .where(where)
    .orderBy(desc(schema.crmActivities.occurredAt))
    .offset(opts.offset)
    .limit(opts.limit);
  return { rows, total: countRow.total };
}

export async function listByDeal(
  db: DbClient,
  dealId: string,
  opts: { offset: number; limit: number },
): Promise<{ rows: ActivityRow[]; total: number }> {
  const conditions = [eq(schema.crmActivities.dealId, dealId)];
  const where = and(...conditions);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.crmActivities)
    .where(where);
  const rows = await db
    .select(activitySelect)
    .from(schema.crmActivities)
    .where(where)
    .orderBy(desc(schema.crmActivities.occurredAt))
    .offset(opts.offset)
    .limit(opts.limit);
  return { rows, total: countRow.total };
}

// Stamp the contact's lastActivityAt rollup (drives stale flags in lists).
export async function touchContact(db: DbClient, customerId: string): Promise<void> {
  await db
    .update(schema.customers)
    .set({ lastActivityAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.customers.id, customerId));
}
