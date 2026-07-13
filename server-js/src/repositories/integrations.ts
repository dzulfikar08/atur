import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'
import { eq } from 'drizzle-orm'

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db.select().from(schema.integrationTokens).where(eq(schema.integrationTokens.workspaceId, workspaceId))
}

export async function findById(db: DbClient, id: string) {
  const [token] = await db.select().from(schema.integrationTokens).where(eq(schema.integrationTokens.id, id)).limit(1)
  return token
}

export async function create(db: DbClient, data: {
  service: string
  accessToken?: string
  refreshToken?: string
  userId: string
  workspaceId: string
}) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.integrationTokens).values({
    id,
    service: data.service,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    userId: data.userId,
    workspaceId: data.workspaceId,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function update(db: DbClient, id: string, data: Partial<typeof schema.integrationTokens.$inferInsert>) {
  await db.update(schema.integrationTokens)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.integrationTokens.id, id))
  return findById(db, id)
}

export async function remove(db: DbClient, id: string) {
  await db.update(schema.integrationTokens)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.integrationTokens.id, id))
}
