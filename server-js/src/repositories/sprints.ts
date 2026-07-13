import { eq, and, desc, isNull, count } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findById(db: DbClient, id: string) {
  const [sprint] = await db.select().from(schema.sprints).where(eq(schema.sprints.id, id)).limit(1)
  return sprint ?? null
}

export async function listByProject(db: DbClient, projectId: string, offset: number, limit: number) {
  const sprints = await db.select().from(schema.sprints)
    .where(and(eq(schema.sprints.projectId, projectId), isNull(schema.sprints.deletedAt)))
    .orderBy(desc(schema.sprints.createdAt))
    .offset(offset).limit(limit)
  const [{ total }] = await db.select({ total: count() }).from(schema.sprints)
    .where(and(eq(schema.sprints.projectId, projectId), isNull(schema.sprints.deletedAt)))
  return { sprints, total }
}

export async function create(
  db: DbClient,
  data: {
    name: string
    description?: string | null
    startDate: string
    endDate: string
    projectId: string
    workspaceId: string
    ownedById: string
  }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.sprints).values({
    id,
    name: data.name,
    description: data.description ?? null,
    startDate: data.startDate,
    endDate: data.endDate,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    ownedById: data.ownedById,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function update(
  db: DbClient,
  id: string,
  data: { name?: string; description?: string | null; startDate?: string; endDate?: string }
) {
  await db.update(schema.sprints)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.sprints.id, id))
  return findById(db, id)
}

export async function softDelete(db: DbClient, id: string) {
  const now = nowISO()
  await db.update(schema.sprints)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.sprints.id, id))
}

export async function addIssue(db: DbClient, sprintId: string, issueId: string) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.sprintIssues).values({ id, sprintId, issueId, createdAt: now, updatedAt: now })
}

export async function removeIssue(db: DbClient, sprintId: string, issueId: string) {
  await db.delete(schema.sprintIssues)
    .where(and(eq(schema.sprintIssues.sprintId, sprintId), eq(schema.sprintIssues.issueId, issueId)))
}

export async function listIssues(db: DbClient, sprintId: string, offset: number, limit: number) {
  const issues = await db.select().from(schema.sprintIssues)
    .where(eq(schema.sprintIssues.sprintId, sprintId))
    .offset(offset).limit(limit)
  const [{ total }] = await db.select({ total: count() }).from(schema.sprintIssues)
    .where(eq(schema.sprintIssues.sprintId, sprintId))
  return { issues, total }
}
