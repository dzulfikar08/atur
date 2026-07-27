// Sub-resources under /api/workspaces/:slug/projects/:projectId/issues/:issueId
// The :issueId param may be a sequence id (e.g. "1") or a UUID — resolve to the
// issue row, then key all sub-resource queries on its UUID.
// Backed by real tables: attachments, sub-issues (issues.parentId), relations,
// modules (module_issues), activities (issue_activities).
// Stubbed (no table in schema): custom-values.
import { Hono, type Context } from 'hono'
import { and, eq, isNull, desc } from 'drizzle-orm'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'
import * as schema from '../db/schema'
import * as issuesRepo from '../repositories/issues'
import * as timeEntriesService from '../services/timeEntries'

type C = Context<{ Bindings: Env }>

async function resolveIssue(c: C) {
  const db = getDb(c.env.DB)
  const projectId = c.req.param('projectId')!
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  return { db, issue }
}

export const issueExtrasRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  // ---- Attachments ----
  .get('/attachments', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const rows = await db.select().from(schema.issueAttachments)
      .where(and(eq(schema.issueAttachments.issueId, issue.id), isNull(schema.issueAttachments.deletedAt)))
      .orderBy(desc(schema.issueAttachments.createdAt))
    return c.json({ results: rows.map((r) => ({ id: r.id, issue_id: r.issueId, asset: r.asset, attributes: r.attributes ? JSON.parse(r.attributes) : null, created_at: r.createdAt })) })
  })
  .post('/attachments', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const body = (await c.req.json().catch(() => ({}))) as { asset?: string | null; attributes?: unknown }
    const id = uuid()
    const now = nowISO()
    await db.insert(schema.issueAttachments).values({ id, issueId: issue.id, asset: body.asset ?? null, attributes: body.attributes !== undefined ? JSON.stringify(body.attributes) : null, createdAt: now, updatedAt: now })
    return c.json({ id, issue_id: issue.id, asset: body.asset ?? null, attributes: body.attributes ?? null, created_at: now }, 201)
  })
  .delete('/attachments/:attachmentId', authMiddleware, async (c: C) => {
    // Scope to the path issue so a caller can't delete another issue's
    // attachment by guessing its id (IDOR).
    const { db, issue } = await resolveIssue(c)
    await db.update(schema.issueAttachments).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(and(eq(schema.issueAttachments.id, c.req.param('attachmentId')!), eq(schema.issueAttachments.issueId, issue.id)))
    return c.body(null, 204)
  })

  // ---- Sub-issues (children via issues.parent_id) ----
  .get('/sub-issues', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const rows = await db.select().from(schema.issues)
      .where(and(eq(schema.issues.parentId, issue.id), isNull(schema.issues.deletedAt)))
      .orderBy(desc(schema.issues.createdAt))
    return c.json({ results: rows })
  })
  .post('/sub-issues', authMiddleware, async (c: C) => {
    const { db, issue: parent } = await resolveIssue(c)
    const user = c.get('user')
    const body = (await c.req.json().catch(() => ({}))) as { name?: string }
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const [maxSeq] = await db.select({ seq: schema.issues.sequenceId }).from(schema.issues).where(eq(schema.issues.projectId, parent.projectId)).orderBy(desc(schema.issues.sequenceId)).limit(1)
    const id = uuid()
    const now = nowISO()
    await db.insert(schema.issues).values({ id, name: body.name, sequenceId: (maxSeq?.seq ?? 0) + 1, parentId: parent.id, projectId: parent.projectId, workspaceId: parent.workspaceId, createdById: user.sub, createdAt: now, updatedAt: now })
    return c.json((await db.select().from(schema.issues).where(eq(schema.issues.id, id)).limit(1))[0], 201)
  })

  // ---- Relations ----
  .get('/relations', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const rows = await db.select().from(schema.issueRelations)
      .where(and(eq(schema.issueRelations.issueId, issue.id), isNull(schema.issueRelations.deletedAt)))
      .orderBy(desc(schema.issueRelations.createdAt))
    return c.json({ results: rows })
  })
  .post('/relations', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const body = (await c.req.json().catch(() => ({}))) as { related_issue_id?: string; relation_type?: string }
    if (!body.related_issue_id || !body.relation_type) throw new HTTPException(400, { message: 'related_issue_id and relation_type are required' })
    const id = uuid()
    const now = nowISO()
    await db.insert(schema.issueRelations).values({ id, issueId: issue.id, relatedIssueId: body.related_issue_id, relationType: body.relation_type, createdAt: now, updatedAt: now })
    return c.json((await db.select().from(schema.issueRelations).where(eq(schema.issueRelations.id, id)).limit(1))[0], 201)
  })
  .delete('/relations/:relationId', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    await db.update(schema.issueRelations).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(and(eq(schema.issueRelations.id, c.req.param('relationId')!), eq(schema.issueRelations.issueId, issue.id)))
    return c.body(null, 204)
  })

  // ---- Modules (module_issues join) ----
  .get('/modules', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const rows = await db.select({ id: schema.modules.id, name: schema.modules.name, description: schema.modules.description, status: schema.modules.status, start_date: schema.modules.startDate, target_date: schema.modules.targetDate, project_id: schema.modules.projectId, workspace_id: schema.modules.workspaceId })
      .from(schema.moduleIssues)
      .innerJoin(schema.modules, eq(schema.moduleIssues.moduleId, schema.modules.id))
      .where(and(eq(schema.moduleIssues.issueId, issue.id), isNull(schema.moduleIssues.deletedAt)))
    return c.json({ results: rows })
  })
  .post('/modules', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const body = (await c.req.json().catch(() => ({}))) as { module_id?: string }
    if (!body.module_id) throw new HTTPException(400, { message: 'module_id is required' })
    const [existing] = await db.select().from(schema.moduleIssues).where(and(eq(schema.moduleIssues.moduleId, body.module_id), eq(schema.moduleIssues.issueId, issue.id))).limit(1)
    if (!existing) {
      const now = nowISO()
      await db.insert(schema.moduleIssues).values({ id: uuid(), moduleId: body.module_id, issueId: issue.id, createdAt: now, updatedAt: now })
    }
    return c.json({ ok: true })
  })
  .delete('/modules/:moduleId', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    await db.delete(schema.moduleIssues).where(and(eq(schema.moduleIssues.moduleId, c.req.param('moduleId')!), eq(schema.moduleIssues.issueId, issue.id)))
    return c.body(null, 204)
  })

  // ---- Activities ----
  .get('/activities', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const rows = await db.select().from(schema.issueActivities)
      .where(and(eq(schema.issueActivities.issueId, issue.id), isNull(schema.issueActivities.deletedAt)))
      .orderBy(desc(schema.issueActivities.createdAt))
    return c.json({ results: rows })
  })

  // ---- Custom values (no table — stub) ----
  .get('/custom-values', authMiddleware, (c: C) => c.json([]))
  .post('/custom-values', authMiddleware, (c: C) => c.json({ ok: true }))

  // ---- Time entries ----
  .get('/time-entries', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const result = await timeEntriesService.list(db, issue, c)
    return c.json(result)
  })
  .post('/time-entries', authMiddleware, async (c: C) => {
    const { db, issue } = await resolveIssue(c)
    const user = c.get('user')
    const body = timeEntriesService.createTimeEntrySchema.parse(await c.req.json().catch(() => ({})))
    const entry = await timeEntriesService.create(db, issue, user.sub, body)
    // snake_case payload matching the frontend TimeEntry type.
    return c.json({
      id: entry!.id,
      issue_id: entry!.issueId,
      user_id: entry!.userId,
      duration_seconds: entry!.durationSeconds,
      description: entry!.description,
      started_at: entry!.startedAt,
      ended_at: entry!.endedAt,
      created_at: entry!.createdAt,
    }, 201)
  })
  .delete('/time-entries/:entryId', authMiddleware, async (c: C) => {
    // Scope delete to the path issue so a caller can't delete another issue's
    // entry by guessing its id (IDOR).
    const { db, issue } = await resolveIssue(c)
    await timeEntriesService.remove(db, issue, c.req.param('entryId')!)
    return c.body(null, 204)
  })
