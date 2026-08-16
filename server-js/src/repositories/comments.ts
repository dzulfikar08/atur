import { eq, and, isNull, desc } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { issueComments, users } from '../db/schema'
import * as activitiesRepo from './activities'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

// Shape used by the API: comment row + nested actor (user) info so the UI can
// render "display_name" instead of falling back to a generic label.
function mapComment(c: any, u: any) {
  return {
    ...c,
    actor_detail: u
      ? {
          id: u.id,
          display_name: u.display_name || u.username || null,
          email: u.email || null,
          avatar: u.avatar || null,
        }
      : null,
  }
}

export async function listByIssue(db: DbClient, issueId: string, offset: number, limit: number) {
  const rows = await db
    .select({
      id: issueComments.id,
      commentStripped: issueComments.commentStripped,
      commentJson: issueComments.commentJson,
      commentHtml: issueComments.commentHtml,
      access: issueComments.access,
      parentId: issueComments.parentId,
      issueId: issueComments.issueId,
      actorId: issueComments.actorId,
      createdAt: issueComments.createdAt,
      updatedAt: issueComments.updatedAt,
      deletedAt: issueComments.deletedAt,
      actor: {
        id: users.id,
        display_name: users.displayName,
        username: users.username,
        email: users.email,
        avatar: users.avatar,
      },
    })
    .from(issueComments)
    .leftJoin(users, eq(users.id, issueComments.actorId))
    .where(and(eq(issueComments.issueId, issueId), isNull(issueComments.deletedAt)))
    .orderBy(desc(issueComments.createdAt))
    .limit(limit)
    .offset(offset)
  return rows.map((r) => mapComment(r, r.actor))
}

export async function findById(db: DbClient, id: string) {
  const [row] = await db
    .select({
      id: issueComments.id,
      commentStripped: issueComments.commentStripped,
      commentJson: issueComments.commentJson,
      commentHtml: issueComments.commentHtml,
      access: issueComments.access,
      parentId: issueComments.parentId,
      issueId: issueComments.issueId,
      actorId: issueComments.actorId,
      createdAt: issueComments.createdAt,
      updatedAt: issueComments.updatedAt,
      deletedAt: issueComments.deletedAt,
      actor: {
        id: users.id,
        display_name: users.displayName,
        username: users.username,
        email: users.email,
        avatar: users.avatar,
      },
    })
    .from(issueComments)
    .leftJoin(users, eq(users.id, issueComments.actorId))
    .where(and(eq(issueComments.id, id), isNull(issueComments.deletedAt)))
    .limit(1)
  if (!row) return null
  return mapComment(row, row.actor)
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
  const comment = await findById(db, id)
  // Surface a trail event only for customer-visible (public) comments; internal
  // staff notes stay out of the activity log.
  if (comment && (data.access ?? 'internal') === 'public') {
    await activitiesRepo.create(db, {
      verb: 'commented',
      issueId: data.issueId,
      issueCommentId: comment.id,
      actorId: data.actorId,
    })
  }
  return comment
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
