import { eq, and, desc, isNull, count, sql, gte, lte } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findById(db: DbClient, id: string) {
  const [entry] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id)).limit(1)
  return entry ?? null
}

export async function listByIssue(db: DbClient, issueId: string, offset: number, limit: number) {
  const entries = await db.select().from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.issueId, issueId), isNull(schema.timeEntries.deletedAt)))
    .orderBy(desc(schema.timeEntries.startedAt), desc(schema.timeEntries.createdAt))
    .offset(offset).limit(limit)
  const [{ total }] = await db.select({ total: count() }).from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.issueId, issueId), isNull(schema.timeEntries.deletedAt)))
  return { entries, total }
}

export async function create(
  db: DbClient,
  data: {
    issueId: string
    workspaceId: string
    userId: string
    durationSeconds: number
    description?: string | null
    startedAt: string
    endedAt?: string | null
  }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(schema.timeEntries).values({
    id,
    issueId: data.issueId,
    workspaceId: data.workspaceId,
    userId: data.userId,
    durationSeconds: data.durationSeconds,
    description: data.description ?? null,
    startedAt: data.startedAt,
    endedAt: data.endedAt ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function softDelete(db: DbClient, id: string) {
  const now = nowISO()
  await db.update(schema.timeEntries)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.timeEntries.id, id))
}

// Sum of duration_seconds for an issue (non-deleted). 0 when none.
export async function totalForIssue(db: DbClient, issueId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.timeEntries.durationSeconds}), 0)` })
    .from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.issueId, issueId), isNull(schema.timeEntries.deletedAt)))
  return Number(row?.total ?? 0)
}

// Scoped soft-delete: only when the entry belongs to the given issue. Prevents
// cross-issue deletion by guessing entry ids (IDOR).
export async function softDeleteForIssue(db: DbClient, id: string, issueId: string) {
  const now = nowISO()
  await db.update(schema.timeEntries)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(schema.timeEntries.id, id), eq(schema.timeEntries.issueId, issueId)))
}
// Aggregate time entries for the workspace timesheet view. Groups by user + issue
// (joined for issue name/sequence/project and user display). Date range and
// user/project filters are optional. Ordered by total duration desc.
export async function aggregateForWorkspace(
  db: DbClient,
  opts: { workspaceId: string; from?: string; to?: string; userId?: string; projectId?: string }
) {
  const conditions = [
    eq(schema.timeEntries.workspaceId, opts.workspaceId),
    isNull(schema.timeEntries.deletedAt),
  ]
  if (opts.from) conditions.push(gte(schema.timeEntries.startedAt, opts.from))
  if (opts.to) conditions.push(lte(schema.timeEntries.startedAt, opts.to))
  if (opts.userId) conditions.push(eq(schema.timeEntries.userId, opts.userId))
  if (opts.projectId) conditions.push(eq(schema.issues.projectId, opts.projectId))

  const rows = await db.select({
    user_id: schema.timeEntries.userId,
    issue_id: schema.timeEntries.issueId,
    issue_name: schema.issues.name,
    sequence_id: schema.issues.sequenceId,
    project_id: schema.issues.projectId,
    user_name: schema.users.displayName,
    user_email: schema.users.email,
    total_seconds: sql<number>`COALESCE(SUM(${schema.timeEntries.durationSeconds}), 0)`,
    entry_count: sql<number>`COUNT(*)`,
  }).from(schema.timeEntries)
    .innerJoin(schema.issues, eq(schema.timeEntries.issueId, schema.issues.id))
    .innerJoin(schema.users, eq(schema.timeEntries.userId, schema.users.id))
    .where(and(...conditions))
    .groupBy(
      schema.timeEntries.userId,
      schema.timeEntries.issueId,
      schema.issues.name,
      schema.issues.sequenceId,
      schema.issues.projectId,
      schema.users.displayName,
      schema.users.email,
    )
    .orderBy(desc(sql<number>`SUM(${schema.timeEntries.durationSeconds})`))
  return rows.map((r) => ({
    ...r,
    total_seconds: Number(r.total_seconds),
    entry_count: Number(r.entry_count),
  }))
}
