import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import { eq } from "drizzle-orm";

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db.select().from(schema.webhooks).where(eq(schema.webhooks.workspaceId, workspaceId));
}

export async function findById(db: DbClient, id: string) {
  const [webhook] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, id))
    .limit(1);
  return webhook;
}

export async function create(
  db: DbClient,
  data: {
    url: string;
    secret?: string;
    events?: string;
    workspaceId: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.webhooks).values({
    id,
    url: data.url,
    secret: data.secret,
    events: data.events,
    workspaceId: data.workspaceId,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function update(
  db: DbClient,
  id: string,
  data: Partial<typeof schema.webhooks.$inferInsert>,
) {
  await db
    .update(schema.webhooks)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.webhooks.id, id));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string) {
  await db
    .update(schema.webhooks)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.webhooks.id, id));
}
