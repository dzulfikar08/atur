import { eq, and, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { states } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

// Frontend expects the state group under `group` (not `group_name`), so alias it.
const stateCols = {
  id: states.id,
  name: states.name,
  description: states.description,
  color: states.color,
  slug: states.slug,
  sequence: states.sequence,
  group: states.groupName,
  isDefault: states.isDefault,
  isTriage: states.isTriage,
  projectId: states.projectId,
  workspaceId: states.workspaceId,
  createdAt: states.createdAt,
  updatedAt: states.updatedAt,
}

export async function listByProject(db: DbClient, projectId: string) {
  return db.select(stateCols).from(states)
    .where(and(eq(states.projectId, projectId), isNull(states.deletedAt)))
}

export async function findById(db: DbClient, id: string) {
  const [state] = await db.select(stateCols).from(states).where(and(eq(states.id, id), isNull(states.deletedAt))).limit(1)
  return state
}

export async function create(
  db: DbClient,
  data: { name: string; color: string; groupName: string; projectId: string; workspaceId: string; description?: string; slug?: string }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(states).values({
    id,
    name: data.name,
    color: data.color,
    groupName: data.groupName,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    description: data.description || null,
    slug: data.slug || null,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function update(db: DbClient, id: string, data: Record<string, unknown>) {
  await db.update(states).set({ ...data, updatedAt: nowISO() }).where(eq(states.id, id))
  return findById(db, id)
}

export async function remove(db: DbClient, id: string) {
  await db.update(states).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(eq(states.id, id))
}
