import { Hono } from 'hono'
import type { Env } from '../../lib/env'
import { getDb } from '../../db/index'
import { authMiddleware } from '../../middleware/auth'
import { paginationParams, paginatedResponse, nowISO } from '../../lib/pagination'
import { v4 as uuid } from 'uuid'
import { HTTPException } from 'hono/http-exception'
import { eq, and, desc, isNull, like, or } from 'drizzle-orm'
import * as schema from '../../db/schema'

interface JsonRpcRequest {
  jsonrpc: string
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: string
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

function ok(id: number | string | null, data: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
  }
}

function err(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

const TOOLS = [
  { name: 'list_workspaces', description: 'List all workspaces', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List projects in a workspace', inputSchema: { type: 'object', properties: { workspace: { type: 'string', description: 'Workspace slug' } }, required: ['workspace'] } },
  { name: 'get_project', description: 'Get a project by ID', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'create_project', description: 'Create a project', inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, name: { type: 'string' }, identifier: { type: 'string' }, description: { type: 'string' } }, required: ['workspace', 'name', 'identifier'] } },
  { name: 'list_issues', description: 'List issues in a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, state: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } }, required: ['project_id', 'workspace'] } },
  { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' }, description_html: { type: 'string' }, priority: { type: 'string' }, state_id: { type: 'string' }, label_ids: { type: 'array', items: { type: 'string' } }, assignee_ids: { type: 'array', items: { type: 'string' } } }, required: ['project_id', 'workspace', 'name'] } },
  { name: 'update_issue', description: 'Update an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' }, state_id: { type: 'string' }, priority: { type: 'string' }, name: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id'] } },
  { name: 'get_issue', description: 'Get an issue by ID', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' }, sequence_id: { type: 'integer' } }, required: ['project_id', 'workspace'] } },
  { name: 'search_issues', description: 'Search issues across workspace', inputSchema: { type: 'object', properties: { query: { type: 'string' }, workspace: { type: 'string' }, limit: { type: 'integer' } }, required: ['query', 'workspace'] } },
  { name: 'delete_issue', description: 'Delete an issue (soft)', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id'] } },
  { name: 'add_comment', description: 'Add a comment to an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' }, comment_html: { type: 'string' }, access: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id', 'comment_html'] } },
  { name: 'list_comments', description: 'List comments on an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id'] } },
  { name: 'list_states', description: 'List states for a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'list_labels', description: 'List labels for a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'list_members', description: 'List members of a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'list_workspace_members', description: 'List members of a workspace', inputSchema: { type: 'object', properties: { workspace: { type: 'string' } }, required: ['workspace'] } },
  { name: 'set_assignee', description: 'Assign a user to an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' }, assignee_id: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id', 'assignee_id'] } },
  { name: 'list_sprints', description: 'List sprints/cycles for a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'create_sprint', description: 'Create a sprint/cycle', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, description: { type: 'string' } }, required: ['project_id', 'workspace', 'name'] } },
  { name: 'get_sprint', description: 'Get a sprint by ID', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, sprint_id: { type: 'string' } }, required: ['project_id', 'workspace', 'sprint_id'] } },
  { name: 'update_sprint', description: 'Update a sprint', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, sprint_id: { type: 'string' }, name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['project_id', 'workspace', 'sprint_id'] } },
  { name: 'add_issue_to_sprint', description: 'Add an issue to a sprint', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, sprint_id: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'sprint_id', 'issue_id'] } },
  { name: 'remove_issue_from_sprint', description: 'Remove an issue from a sprint', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, sprint_id: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'sprint_id', 'issue_id'] } },
  { name: 'get_sprint_progress', description: 'Get sprint progress', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, sprint_id: { type: 'string' } }, required: ['project_id', 'workspace', 'sprint_id'] } },
  { name: 'list_modules', description: 'List modules for a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'get_module', description: 'Get a module by ID', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, module_id: { type: 'string' } }, required: ['project_id', 'workspace', 'module_id'] } },
  { name: 'add_issue_to_module', description: 'Add an issue to a module', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, module_id: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'module_id', 'issue_id'] } },
  { name: 'remove_issue_from_module', description: 'Remove an issue from a module', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, module_id: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'module_id', 'issue_id'] } },
  { name: 'list_pages', description: 'List pages in a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'get_page', description: 'Get a page by ID', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, page_id: { type: 'string' } }, required: ['project_id', 'workspace', 'page_id'] } },
  { name: 'create_page', description: 'Create a page', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' }, description_html: { type: 'string' }, access: { type: 'integer' } }, required: ['project_id', 'workspace', 'name'] } },
  { name: 'update_page', description: 'Update a page', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, page_id: { type: 'string' }, name: { type: 'string' }, description_html: { type: 'string' } }, required: ['project_id', 'workspace', 'page_id'] } },
  { name: 'upload_image', description: 'Upload an image asset', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' } }, required: ['project_id', 'workspace'] } },
  { name: 'add_issue_relation', description: 'Add a relation between issues', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' }, related_issue_id: { type: 'string' }, relation_type: { type: 'string', enum: ['blocks', 'blocked_by', 'relates_to', 'duplicates'] } }, required: ['project_id', 'workspace', 'issue_id', 'related_issue_id', 'relation_type'] } },
  { name: 'list_issue_relations', description: 'List relations for an issue', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, issue_id: { type: 'string' } }, required: ['project_id', 'workspace', 'issue_id'] } },
  { name: 'remove_issue_relation', description: 'Remove a relation', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, workspace: { type: 'string' }, relation_id: { type: 'string' } }, required: ['project_id', 'workspace', 'relation_id'] } },
]

async function getWorkspaceId(db: ReturnType<typeof getDb>, slug: string) {
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt))).limit(1)
  if (!ws) throw new HTTPException(404, { message: `Workspace "${slug}" not found` })
  return ws.id
}

async function handleTool(db: ReturnType<typeof getDb>, env: Env, toolName: string, params: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'list_workspaces': {
      const rows = await db.select().from(schema.workspaces).where(isNull(schema.workspaces.deletedAt))
      return rows
    }
    case 'list_projects': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const rows = await db.select().from(schema.projects).where(and(eq(schema.projects.workspaceId, workspaceId), isNull(schema.projects.deletedAt)))
      return rows
    }
    case 'get_project': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, params.project_id as string), eq(schema.projects.workspaceId, workspaceId), isNull(schema.projects.deletedAt))).limit(1)
      if (!project) throw new HTTPException(404, { message: 'Project not found' })
      return project
    }
    case 'create_project': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.projects).values({
        id,
        name: params.name as string,
        identifier: params.identifier as string,
        description: (params.description as string) ?? null,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1)
    }
    case 'list_issues': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const conditions = [eq(schema.issues.projectId, params.project_id as string), eq(schema.issues.workspaceId, workspaceId), isNull(schema.issues.deletedAt)]
      if (params.state) conditions.push(eq(schema.issues.stateId, params.state as string))
      const limit = Math.min(Number(params.limit) || 50, 100)
      const offset = Number(params.offset) || 0
      const rows = await db.select().from(schema.issues).where(and(...conditions)).orderBy(desc(schema.issues.createdAt)).limit(limit).offset(offset)
      return rows
    }
    case 'create_issue': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const projectId = params.project_id as string
      const [maxSeq] = await db.select({ seq: schema.issues.sequenceId }).from(schema.issues).where(eq(schema.issues.projectId, projectId)).orderBy(desc(schema.issues.sequenceId)).limit(1)
      const seq = (maxSeq?.seq ?? 0) + 1
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.issues).values({
        id,
        name: params.name as string,
        descriptionHtml: (params.description_html as string) ?? null,
        priority: (params.priority as string) ?? 'none',
        stateId: (params.state_id as string) ?? null,
        sequenceId: seq,
        projectId,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      if (params.label_ids && Array.isArray(params.label_ids)) {
        for (const labelId of params.label_ids as string[]) {
          await db.insert(schema.issueLabels).values({ id: uuid(), issueId: id, labelId, createdAt: now, updatedAt: now })
        }
      }
      if (params.assignee_ids && Array.isArray(params.assignee_ids)) {
        for (const assigneeId of params.assignee_ids as string[]) {
          await db.insert(schema.issueAssignees).values({ id: uuid(), issueId: id, assigneeId, createdAt: now, updatedAt: now })
        }
      }
      return db.select().from(schema.issues).where(eq(schema.issues.id, id)).limit(1)
    }
    case 'update_issue': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const updates: Record<string, unknown> = { updatedAt: nowISO() }
      if (params.state_id !== undefined) updates.stateId = params.state_id
      if (params.priority !== undefined) updates.priority = params.priority
      if (params.name !== undefined) updates.name = params.name
      await db.update(schema.issues).set(updates).where(and(eq(schema.issues.id, params.issue_id as string), eq(schema.issues.projectId, params.project_id as string), eq(schema.issues.workspaceId, workspaceId)))
      return db.select().from(schema.issues).where(eq(schema.issues.id, params.issue_id as string)).limit(1)
    }
    case 'get_issue': {
      const [issue] = await db.select().from(schema.issues).where(and(isNull(schema.issues.deletedAt), eq(schema.issues.id, params.issue_id as string))).limit(1)
      if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
      return issue
    }
    case 'search_issues': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const q = `%${params.query as string}%`
      const rows = await db.select().from(schema.issues).where(and(eq(schema.issues.workspaceId, workspaceId), isNull(schema.issues.deletedAt), or(like(schema.issues.name, q), like(schema.issues.descriptionStripped, q)))).limit(Math.min(Number(params.limit) || 50, 100))
      return rows
    }
    case 'delete_issue': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const now = nowISO()
      await db.update(schema.issues).set({ deletedAt: now, updatedAt: now }).where(and(eq(schema.issues.id, params.issue_id as string), eq(schema.issues.projectId, params.project_id as string), eq(schema.issues.workspaceId, workspaceId)))
      return { success: true }
    }
    case 'add_comment': {
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.issueComments).values({
        id,
        commentHtml: params.comment_html as string,
        access: (params.access as string) ?? 'internal',
        issueId: params.issue_id as string,
        actorId: params.actor_id as string,
        createdAt: now,
        updatedAt: now,
      })
      return db.select().from(schema.issueComments).where(eq(schema.issueComments.id, id)).limit(1)
    }
    case 'list_comments': {
      const rows = await db.select().from(schema.issueComments).where(and(eq(schema.issueComments.issueId, params.issue_id as string), isNull(schema.issueComments.deletedAt))).orderBy(desc(schema.issueComments.createdAt))
      return rows
    }
    case 'list_states': {
      const rows = await db.select().from(schema.states).where(and(eq(schema.states.projectId, params.project_id as string), isNull(schema.states.deletedAt))).orderBy(schema.states.sequence)
      return rows
    }
    case 'list_labels': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const rows = await db.select().from(schema.labels).where(and(eq(schema.labels.workspaceId, workspaceId), isNull(schema.labels.deletedAt))).orderBy(schema.labels.sortOrder)
      return rows
    }
    case 'list_members': {
      const rows = await db.select().from(schema.projectMembers).where(and(eq(schema.projectMembers.projectId, params.project_id as string), isNull(schema.projectMembers.deletedAt)))
      return rows
    }
    case 'list_workspace_members': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const rows = await db.select().from(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), isNull(schema.workspaceMembers.deletedAt)))
      return rows
    }
    case 'set_assignee': {
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.issueAssignees).values({ id, issueId: params.issue_id as string, assigneeId: params.assignee_id as string, createdAt: now, updatedAt: now })
      return { success: true }
    }
    case 'list_sprints': {
      const rows = await db.select().from(schema.cycles).where(and(eq(schema.cycles.projectId, params.project_id as string), isNull(schema.cycles.deletedAt))).orderBy(desc(schema.cycles.startDate))
      return rows
    }
    case 'create_sprint': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.cycles).values({
        id,
        name: params.name as string,
        description: (params.description as string) ?? null,
        startDate: (params.start_date as string) ?? null,
        endDate: (params.end_date as string) ?? null,
        projectId: params.project_id as string,
        workspaceId,
        ownedById: params.owned_by_id as string,
        createdAt: now,
        updatedAt: now,
      })
      return db.select().from(schema.cycles).where(eq(schema.cycles.id, id)).limit(1)
    }
    case 'get_sprint': {
      const [sprint] = await db.select().from(schema.cycles).where(and(eq(schema.cycles.id, params.sprint_id as string), isNull(schema.cycles.deletedAt))).limit(1)
      if (!sprint) throw new HTTPException(404, { message: 'Sprint not found' })
      return sprint
    }
    case 'update_sprint': {
      const updates: Record<string, unknown> = { updatedAt: nowISO() }
      if (params.name !== undefined) updates.name = params.name
      if (params.start_date !== undefined) updates.startDate = params.start_date
      if (params.end_date !== undefined) updates.endDate = params.end_date
      await db.update(schema.cycles).set(updates).where(eq(schema.cycles.id, params.sprint_id as string))
      return db.select().from(schema.cycles).where(eq(schema.cycles.id, params.sprint_id as string)).limit(1)
    }
    case 'add_issue_to_sprint': {
      const [existing] = await db.select().from(schema.cycleIssues).where(and(eq(schema.cycleIssues.cycleId, params.sprint_id as string), eq(schema.cycleIssues.issueId, params.issue_id as string))).limit(1)
      if (!existing) {
        const id = uuid()
        const now = nowISO()
        await db.insert(schema.cycleIssues).values({ id, cycleId: params.sprint_id as string, issueId: params.issue_id as string, createdAt: now, updatedAt: now })
      }
      return { success: true }
    }
    case 'remove_issue_from_sprint': {
      await db.delete(schema.cycleIssues).where(and(eq(schema.cycleIssues.cycleId, params.sprint_id as string), eq(schema.cycleIssues.issueId, params.issue_id as string)))
      return { success: true }
    }
    case 'get_sprint_progress': {
      const sprintId = params.sprint_id as string
      const total = await db.select().from(schema.cycleIssues).where(eq(schema.cycleIssues.cycleId, sprintId))
      const totalCount = total.length
      if (totalCount === 0) return { total: 0, completed: 0, percentage: 0 }
      const issueIds = total.map((ci) => ci.issueId)
      const completedStates = await db.select().from(schema.states).where(and(eq(schema.states.groupName, 'completed'), eq(schema.states.projectId, params.project_id as string)))
      const completedStateIds = completedStates.map((s) => s.id)
      let completedCount = 0
      for (const issueId of issueIds) {
        const [issue] = await db.select({ stateId: schema.issues.stateId }).from(schema.issues).where(eq(schema.issues.id, issueId)).limit(1)
        if (issue && completedStateIds.includes(issue.stateId ?? '')) completedCount++
      }
      return { total: totalCount, completed: completedCount, percentage: Math.round((completedCount / totalCount) * 100) }
    }
    case 'list_modules': {
      const rows = await db.select().from(schema.modules).where(and(eq(schema.modules.projectId, params.project_id as string), isNull(schema.modules.deletedAt))).orderBy(desc(schema.modules.createdAt))
      return rows
    }
    case 'get_module': {
      const [mod] = await db.select().from(schema.modules).where(and(eq(schema.modules.id, params.module_id as string), isNull(schema.modules.deletedAt))).limit(1)
      if (!mod) throw new HTTPException(404, { message: 'Module not found' })
      return mod
    }
    case 'add_issue_to_module': {
      const [existing] = await db.select().from(schema.moduleIssues).where(and(eq(schema.moduleIssues.moduleId, params.module_id as string), eq(schema.moduleIssues.issueId, params.issue_id as string))).limit(1)
      if (!existing) {
        const id = uuid()
        const now = nowISO()
        await db.insert(schema.moduleIssues).values({ id, moduleId: params.module_id as string, issueId: params.issue_id as string, createdAt: now, updatedAt: now })
      }
      return { success: true }
    }
    case 'remove_issue_from_module': {
      await db.delete(schema.moduleIssues).where(and(eq(schema.moduleIssues.moduleId, params.module_id as string), eq(schema.moduleIssues.issueId, params.issue_id as string)))
      return { success: true }
    }
    case 'list_pages': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const rows = await db.select().from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt))).orderBy(desc(schema.pages.createdAt))
      return rows
    }
    case 'get_page': {
      const [page] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, params.page_id as string), isNull(schema.pages.deletedAt))).limit(1)
      if (!page) throw new HTTPException(404, { message: 'Page not found' })
      return page
    }
    case 'create_page': {
      const workspaceId = await getWorkspaceId(db, params.workspace as string)
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.pages).values({
        id,
        name: params.name as string,
        descriptionHtml: (params.description_html as string) ?? null,
        access: (params.access as number) ?? 0,
        workspaceId,
        ownedById: params.owned_by_id as string,
        createdAt: now,
        updatedAt: now,
      })
      return db.select().from(schema.pages).where(eq(schema.pages.id, id)).limit(1)
    }
    case 'update_page': {
      const updates: Record<string, unknown> = { updatedAt: nowISO() }
      if (params.name !== undefined) updates.name = params.name
      if (params.description_html !== undefined) updates.descriptionHtml = params.description_html
      await db.update(schema.pages).set(updates).where(eq(schema.pages.id, params.page_id as string))
      return db.select().from(schema.pages).where(eq(schema.pages.id, params.page_id as string)).limit(1)
    }
    case 'upload_image': {
      return { message: 'Use POST /api/assets/upload endpoint. This is a placeholder.' }
    }
    case 'add_issue_relation': {
      const id = uuid()
      const now = nowISO()
      await db.insert(schema.issueRelations).values({
        id,
        issueId: params.issue_id as string,
        relatedIssueId: params.related_issue_id as string,
        relationType: params.relation_type as string,
        createdAt: now,
        updatedAt: now,
      })
      return db.select().from(schema.issueRelations).where(eq(schema.issueRelations.id, id)).limit(1)
    }
    case 'list_issue_relations': {
      const rows = await db.select().from(schema.issueRelations).where(and(eq(schema.issueRelations.issueId, params.issue_id as string), isNull(schema.issueRelations.deletedAt)))
      return rows
    }
    case 'remove_issue_relation': {
      await db.update(schema.issueRelations).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(eq(schema.issueRelations.id, params.relation_id as string))
      return { success: true }
    }
    default:
      throw new HTTPException(400, { message: `Unknown tool: ${toolName}` })
  }
}

export const mcpRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', (c) => {
    return c.json({
      name: 'atur-mcp',
      version: '1.0.0',
      description: 'Atur MCP Server - Project Management',
      protocolVersion: '2024-11-05',
    })
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const body = await c.req.json<JsonRpcRequest>()

    if (!body || body.jsonrpc !== '2.0') {
      return c.json(err(null, -32600, 'Invalid Request'), 400)
    }

    try {
      switch (body.method) {
        case 'tools/list': {
          return c.json(ok(body.id, { tools: TOOLS }))
        }
        case 'tools/call': {
          const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined
          if (!params?.name) {
            return c.json(err(body.id, -32602, 'Missing tool name'), 400)
          }
          const result = await handleTool(db, c.env, params.name, params.arguments || {})
          return c.json(ok(body.id, result))
        }
        default:
          return c.json(err(body.id, -32601, `Method not found: ${body.method}`), 404)
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.json(err(body.id, -32000, error.message), error.status)
      }
      const message = error instanceof Error ? error.message : 'Internal error'
      return c.json(err(body.id, -32603, message), 500)
    }
  })
