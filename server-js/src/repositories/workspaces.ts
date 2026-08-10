import { eq, and, isNull, or, inArray, sql } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findBySlug(db: DbClient, slug: string) {
  const [workspace] = await db.select().from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1)
  return workspace
}

export async function findById(db: DbClient, id: string) {
  const [workspace] = await db.select().from(schema.workspaces)
    .where(and(eq(schema.workspaces.id, id), isNull(schema.workspaces.deletedAt)))
    .limit(1)
  return workspace
}

export async function listByUser(db: DbClient, userId: string, offset: number, limit: number) {
  const memberIds = db.select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(and(
      eq(schema.workspaceMembers.memberId, userId),
      isNull(schema.workspaceMembers.deletedAt),
    ))

  const where = and(
    isNull(schema.workspaces.deletedAt),
    or(
      eq(schema.workspaces.ownerId, userId),
      inArray(schema.workspaces.id, memberIds),
    ),
  )

  const rows = await db.select().from(schema.workspaces)
    .where(where)
    .limit(limit).offset(offset)

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(schema.workspaces)
    .where(where)

  return { rows, total: count }
}


// All workspace IDs a user can see — owned or a member of. Used by the
// cross-workspace ("All Workspaces") /api/me/* endpoints to scope inArray() filters.
export async function listIdsByUser(db: DbClient, userId: string): Promise<string[]> {
  const memberIds = db.select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(and(
      eq(schema.workspaceMembers.memberId, userId),
      isNull(schema.workspaceMembers.deletedAt),
    ))
  const rows = await db.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(and(
      isNull(schema.workspaces.deletedAt),
      or(eq(schema.workspaces.ownerId, userId), inArray(schema.workspaces.id, memberIds)),
    ))
  return rows.map(r => r.id)
}
export async function create(db: DbClient, data: {
  name: string
  slug: string
  ownerId: string
  logo?: string | null
  organizationSize?: string | null
  timezone?: string | null
  backgroundColor?: string | null
}) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.workspaces).values({
    id,
    name: data.name,
    slug: data.slug,
    logo: data.logo ?? null,
    organizationSize: data.organizationSize ?? null,
    timezone: data.timezone ?? 'UTC',
    backgroundColor: data.backgroundColor ?? null,
    ownerId: data.ownerId,
    createdAt: now,
    updatedAt: now,
  })
  // Make the owner a member so /api/users/me lists this workspace.
  await db.insert(schema.workspaceMembers).values({
    id: uuid(),
    workspaceId: id,
    memberId: data.ownerId,
    role: 20,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function update(db: DbClient, id: string, data: Partial<typeof schema.workspaces.$inferInsert>) {
  await db.update(schema.workspaces)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.workspaces.id, id))
  return findById(db, id)
}

export async function softDelete(db: DbClient, id: string) {
  await db.update(schema.workspaces)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.workspaces.id, id))
}
