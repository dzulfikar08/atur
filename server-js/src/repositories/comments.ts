import { eq, and, isNull, desc } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { issueComments } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function listByIssue(db: DbClient, issueId: string, offset: number, limit: number) {
  const rows = await db
    .select()
    .from(issueComments)
    .where(and(eq(issueComments.issueId, issueId), isNull(issueComments.deletedAt)))
    .orderBy(desc(issueComments.createdAt))
    .limit(limit)
    .offset(offset)
  return rows
}

export async function findById(db: DbClient, id: string) {
  const [comment] = await db
    .select()
    .from(issueComments)
    .where(and(eq(issueComments.id, id), isNull(issueComments.deletedAt)))
    .limit(1)
  return comment
}

export async function create(
  db: DbClient,
  data: { commentHtml: string; access?: string; issueId: string; actorId: string }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(issueComments).values({
    id,
    commentHtml: data.commentHtml,
    access: data.access ?? 'internal',
    issueId: data.issueId,
    actorId: data.actorId,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function update(db: DbClient, id: string, data: { commentHtml?: string; access?: string }) {
  await db
    .update(issueComments)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(issueComments.id, id), isNull(issueComments.deletedAt)))
  return findById(db, id)
}

export async function remove(db: DbClient, id: string) {
  await db
    .update(issueComments)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(issueComments.id, id), isNull(issueComments.deletedAt)))
}
