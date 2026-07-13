import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { HTTPException } from 'hono/http-exception'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import * as issuesRepo from '../repositories/issues'
import { paginatedResponse } from '../lib/pagination'

export const createIssueSchema = z.object({
  name: z.string().min(1),
  description_html: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'urgent', 'none']).optional().default('none'),
  state_id: z.string().uuid().optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
})

export const updateIssueSchema = z.object({
  name: z.string().min(1).optional(),
  description_html: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low', 'urgent', 'none']).optional(),
  state_id: z.string().uuid().optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
})

export async function create(
  db: DbClient,
  projectId: string,
  data: z.infer<typeof createIssueSchema>,
  createdById?: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)),
  })
  if (!project) throw new HTTPException(404, { message: 'Project not found' })

  const sequenceId = await issuesRepo.getNextSequence(db, projectId)

  const issue = await issuesRepo.create(db, {
    id: uuid(),
    name: data.name,
    sequenceId,
    projectId,
    workspaceId: project.workspaceId,
    priority: data.priority,
    descriptionHtml: data.description_html,
    stateId: data.state_id,
    createdById,
  })

  if (data.label_ids && data.label_ids.length > 0) {
    for (const labelId of data.label_ids) {
      await issuesRepo.addLabel(db, issue.id, labelId)
    }
  }

  if (data.assignee_ids && data.assignee_ids.length > 0) {
    for (const assigneeId of data.assignee_ids) {
      await issuesRepo.addAssignee(db, issue.id, assigneeId)
    }
  }

  return enrichIssue(db, issue)
}

export async function getById(db: DbClient, issueId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  return enrichIssue(db, issue)
}

export async function list(
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
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)),
  })
  if (!project) throw new HTTPException(404, { message: 'Project not found' })

  const { data, total } = await issuesRepo.listByProject(db, projectId, opts)

  const enriched = await enrichIssues(db, data)

  return paginatedResponse(enriched, total, opts.offset, opts.limit)
}

export async function update(
  db: DbClient,
  issueId: string,
  data: z.infer<typeof updateIssueSchema>
) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.description_html !== undefined) updateData.descriptionHtml = data.description_html
  if (data.priority !== undefined) updateData.priority = data.priority
  if (data.state_id !== undefined) updateData.stateId = data.state_id

  const updated = await issuesRepo.update(db, issueId, updateData)

  if (data.label_ids !== undefined) {
    const currentLabels = await issuesRepo.listLabels(db, issueId)
    const currentLabelIds = currentLabels.map(l => l.id)
    for (const labelId of currentLabelIds) {
      await issuesRepo.removeLabel(db, issueId, labelId)
    }
    for (const labelId of data.label_ids) {
      await issuesRepo.addLabel(db, issueId, labelId)
    }
  }

  if (data.assignee_ids !== undefined) {
    const currentAssignees = await issuesRepo.listAssignees(db, issueId)
    const currentAssigneeIds = currentAssignees.map(a => a.id)
    for (const assigneeId of currentAssigneeIds) {
      await issuesRepo.removeAssignee(db, issueId, assigneeId)
    }
    for (const assigneeId of data.assignee_ids) {
      await issuesRepo.addAssignee(db, issueId, assigneeId)
    }
  }

  return enrichIssue(db, updated!)
}

export async function remove(db: DbClient, issueId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  await issuesRepo.remove(db, issueId)
}

export async function addLabel(db: DbClient, issueId: string, labelId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  await issuesRepo.addLabel(db, issueId, labelId)
}

export async function removeLabel(db: DbClient, issueId: string, labelId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  await issuesRepo.removeLabel(db, issueId, labelId)
}

export async function addAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  await issuesRepo.addAssignee(db, issueId, assigneeId)
}

export async function removeAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  await issuesRepo.removeAssignee(db, issueId, assigneeId)
}

export async function setAssignees(db: DbClient, issueId: string, assigneeIds: string[]) {
  const issue = await issuesRepo.findById(db, issueId)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })

  const currentAssignees = await issuesRepo.listAssignees(db, issueId)
  const currentAssigneeIds = currentAssignees.map(a => a.id)

  for (const assigneeId of currentAssigneeIds) {
    await issuesRepo.removeAssignee(db, issueId, assigneeId)
  }
  for (const assigneeId of assigneeIds) {
    await issuesRepo.addAssignee(db, issueId, assigneeId)
  }
}

async function enrichIssue(db: DbClient, issue: NonNullable<Awaited<ReturnType<typeof issuesRepo.findById>>>) {
  const labels = issue ? await issuesRepo.listLabels(db, issue.id) : []
  const assignees = issue ? await issuesRepo.listAssignees(db, issue.id) : []

  let state = null
  if (issue?.stateId) {
    const [s] = await db.select({
      id: schema.states.id,
      name: schema.states.name,
      color: schema.states.color,
      group: schema.states.groupName,
    }).from(schema.states).where(eq(schema.states.id, issue.stateId)).limit(1)
    state = s ?? null
  }

  return {
    ...issue,
    labels,
    assignees,
    state,
  }
}

async function enrichIssues(
  db: DbClient,
  issueList: NonNullable<Awaited<ReturnType<typeof issuesRepo.findById>>>[]
) {
  if (issueList.length === 0) return []

  const issueIds = issueList.map(i => i.id)
  const stateIds = [...new Set(issueList.map(i => i.stateId).filter(Boolean) as string[])]

  const stateRows = stateIds.length > 0
    ? await db.select({
      id: schema.states.id,
      name: schema.states.name,
      color: schema.states.color,
      group: schema.states.groupName,
    }).from(schema.states).where(inArray(schema.states.id, stateIds))
    : []
  const stateMap = new Map(stateRows.map(s => [s.id, s]))

  const assigneeRows = await db.select({
    issueId: schema.issueAssignees.issueId,
    id: schema.users.id,
    email: schema.users.email,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatar: schema.users.avatar,
  })
    .from(schema.issueAssignees)
    .innerJoin(schema.users, eq(schema.issueAssignees.assigneeId, schema.users.id))
    .where(and(inArray(schema.issueAssignees.issueId, issueIds), isNull(schema.issueAssignees.deletedAt)))

  const assigneeMap = new Map<string, typeof assigneeRows>()
  for (const row of assigneeRows) {
    if (!assigneeMap.has(row.issueId)) assigneeMap.set(row.issueId, [])
    assigneeMap.get(row.issueId)!.push(row)
  }

  const labelRows = await db.select({
    issueId: schema.issueLabels.issueId,
    id: schema.labels.id,
    name: schema.labels.name,
    color: schema.labels.color,
  })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.issueLabels.labelId, schema.labels.id))
    .where(and(inArray(schema.issueLabels.issueId, issueIds), isNull(schema.issueLabels.deletedAt)))

  const labelMap = new Map<string, typeof labelRows>()
  for (const row of labelRows) {
    if (!labelMap.has(row.issueId)) labelMap.set(row.issueId, [])
    labelMap.get(row.issueId)!.push(row)
  }

  return issueList.map(issue => {
    const assignees = assigneeMap.get(issue.id)?.map(a => ({
      id: a.id,
      email: a.email,
      username: a.username,
      displayName: a.displayName,
      avatar: a.avatar,
    })) ?? []
    const labels = labelMap.get(issue.id)?.map(l => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })) ?? []
    const state = issue.stateId ? (stateMap.get(issue.stateId) ?? null) : null
    return { ...issue, labels, assignees, state }
  })
}
