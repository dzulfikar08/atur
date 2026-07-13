import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'
import { eq, desc, isNull, and, count } from 'drizzle-orm'

export async function listByUser(db: DbClient, userId: string, offset: number, limit: number) {
  const data = await db.select()
    .from(schema.notifications)
    .where(eq(schema.notifications.receiverId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .offset(offset)
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .where(eq(schema.notifications.receiverId, userId))
  return { data, total: row.total }
}

export async function findById(db: DbClient, id: string) {
  const [notif] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).limit(1)
  return notif
}

export async function markRead(db: DbClient, id: string) {
  await db.update(schema.notifications)
    .set({ readAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.notifications.id, id))
}

export async function markAllRead(db: DbClient, userId: string) {
  await db.update(schema.notifications)
    .set({ readAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(schema.notifications.receiverId, userId), isNull(schema.notifications.readAt)))
}

export async function unreadCount(db: DbClient, userId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.receiverId, userId), isNull(schema.notifications.readAt)))
  return row.count
}

export async function update(
  db: DbClient,
  id: string,
  data: { read?: boolean; archived?: boolean }
) {
  const set: Record<string, unknown> = { updatedAt: nowISO() }
  if (data.read === true) set.readAt = nowISO()
  if (data.read === false) set.readAt = null
  if (data.archived === true) set.deletedAt = nowISO()
  await db.update(schema.notifications).set(set).where(eq(schema.notifications.id, id))
}

export async function create(db: DbClient, data: {
  title: string
  message: string
  workspaceId: string
  projectId?: string
  triggeredById?: string
  receiverId: string
  data?: string
  entityIdentifier?: string
  entityName?: string
}) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.notifications).values({ id, ...data, createdAt: now, updatedAt: now })
  return findById(db, id)
}
