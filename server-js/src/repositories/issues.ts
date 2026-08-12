import { eq, and, like, desc, sql, inArray, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { issues, issueAssignees, issueLabels, labels, users, issueSequences } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findById(db: DbClient, id: string) {
  const [issue] = await db.select().from(issues).where(
    and(eq(issues.id, id), isNull(issues.deletedAt))
  ).limit(1)
  return issue
}

// Frontend addresses issues by sequence id in URLs (e.g. /issues/1) but also by
// UUID elsewhere. Resolve either form to the issue row within a project.
export async function resolveIssue(db: DbClient, projectId: string, identifier: string) {
  if (/^\d+$/.test(identifier)) {
    const [row] = await db.select().from(issues).where(
      and(eq(issues.projectId, projectId), eq(issues.sequenceId, Number(identifier)), isNull(issues.deletedAt))
    ).limit(1)
    return row ?? null
  }
  return findById(db, identifier)
}

export async function listByProject(
  db: DbClient,
  projectId: string,
  opts: {
    offset: number
    limit: number
    state?: string
    priority?: string
    search?: string
    labels?: string[]
    assignee?: string
  }
) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(issues.projectId, projectId),
    isNull(issues.deletedAt),
  ]
  if (opts.state) conditions.push(eq(issues.stateId, opts.state))
  if (opts.priority) conditions.push(eq(issues.priority, opts.priority))
  if (opts.search) conditions.push(like(issues.name, `%${opts.search}%`))

  if (opts.assignee) {
    const assigneeIssueIds = db
      .select({ issueId: issueAssignees.issueId })
      .from(issueAssignees)
      .where(and(eq(issueAssignees.assigneeId, opts.assignee), isNull(issueAssignees.deletedAt)))
    conditions.push(inArray(issues.id, assigneeIssueIds))
  }

  if (opts.labels && opts.labels.length > 0) {
    const labelIssueIds = db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(and(inArray(issueLabels.labelId, opts.labels), isNull(issueLabels.deletedAt)))
    conditions.push(inArray(issues.id, labelIssueIds))
  }

  const where = and(...conditions)

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(issues)
    .where(where)

  const rows = await db
    .select()
    .from(issues)
    .where(where)
    .orderBy(desc(issues.sequenceId))
    .offset(opts.offset)
    .limit(opts.limit)

  return { data: rows, total: countRow.total }
}

export async function create(
  db: DbClient,
  data: {
    id: string
    name: string
    sequenceId: number
    projectId: string
    workspaceId: string
    priority?: string
    descriptionHtml?: string
    stateId?: string
    createdById?: string
    sortOrder?: number
    startDate?: string
    targetDate?: string
    estimatePoints?: number | null
  }
) {
  const now = nowISO()
  await db.insert(issues).values({
    id: data.id,
    name: data.name,
    sequenceId: data.sequenceId,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    priority: data.priority ?? 'none',
    descriptionHtml: data.descriptionHtml ?? null,
    stateId: data.stateId ?? null,
    createdById: data.createdById ?? null,
    sortOrder: data.sortOrder ?? 65535.0,
    startDate: data.startDate ?? null,
    targetDate: data.targetDate ?? null,
    estimatePoints: data.estimatePoints ?? null,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(issueSequences).values({
    id: uuid(),
    sequence: data.sequenceId,
    issueId: data.id,
    projectId: data.projectId,
    isDeleted: 0,
    createdAt: now,
    updatedAt: now,
  })

  return findById(db, data.id)
}

export async function update(
  db: DbClient,
  id: string,
  data: {
    name?: string
    descriptionHtml?: string
    priority?: string
    stateId?: string
    sortOrder?: number
    startDate?: string
    targetDate?: string
    estimatePoints?: number | null
    archivedAt?: string
    isDraft?: number
    descriptionJson?: string
    descriptionStripped?: string
  }
) {
  await db.update(issues).set({ ...data, updatedAt: nowISO() }).where(
    and(eq(issues.id, id), isNull(issues.deletedAt))
  )
  return findById(db, id)
}

export async function remove(db: DbClient, id: string) {
  const now = nowISO()
  await db.update(issues).set({ deletedAt: now, updatedAt: now }).where(eq(issues.id, id))
}

export async function addLabel(db: DbClient, issueId: string, labelId: string) {
  const now = nowISO()
  await db.insert(issueLabels).values({
    id: uuid(),
    issueId,
    labelId,
    createdAt: now,
    updatedAt: now,
  })
}

export async function removeLabel(db: DbClient, issueId: string, labelId: string) {
  const now = nowISO()
  await db.update(issueLabels)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(issueLabels.issueId, issueId), eq(issueLabels.labelId, labelId), isNull(issueLabels.deletedAt)))
}

export async function addAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const now = nowISO()
  await db.insert(issueAssignees).values({
    id: uuid(),
    issueId,
    assigneeId,
    createdAt: now,
    updatedAt: now,
  })
}

export async function removeAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const now = nowISO()
  await db.update(issueAssignees)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(issueAssignees.issueId, issueId), eq(issueAssignees.assigneeId, assigneeId), isNull(issueAssignees.deletedAt)))
}

export async function listLabels(db: DbClient, issueId: string) {
  return db.select({
    id: labels.id,
    name: labels.name,
    color: labels.color,
  })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(and(eq(issueLabels.issueId, issueId), isNull(issueLabels.deletedAt)))
}

export async function listAssignees(db: DbClient, issueId: string) {
  return db.select({
    id: users.id,
    email: users.email,
    username: users.username,
    displayName: users.displayName,
    avatar: users.avatar,
  })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.assigneeId, users.id))
    .where(and(eq(issueAssignees.issueId, issueId), isNull(issueAssignees.deletedAt)))
}

export async function getNextSequence(db: DbClient, projectId: string): Promise<number> {
  // Derive from the issues table itself (MAX sequence_id) so it stays correct
  // for rows seeded/imported without an issue_sequences entry.
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${issues.sequenceId}), 0)` })
    .from(issues)
    .where(eq(issues.projectId, projectId))
  return (row?.maxSeq ?? 0) + 1
}
