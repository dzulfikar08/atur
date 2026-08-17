import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import { paginationParams } from '../lib/pagination'
import * as issuesService from '../services/issues'
import * as issuesRepo from '../repositories/issues'

export const issueRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  .get('/', async (c) => {
    const db = getDb(c.env.DB)
    const { offset, limit } = paginationParams(c)
    const projectId = c.req.param('projectId')!
    const state = c.req.query('state')
    const priority = c.req.query('priority')
    const search = c.req.query('search')
    const labelsQuery = c.req.query('labels')
    const assignee = c.req.query('assignee')

    const labels = labelsQuery ? labelsQuery.split(',').map(l => l.trim()).filter(Boolean) : undefined

    const result = await issuesService.list(db, projectId, {
      offset, limit,
      state: state ?? undefined,
      priority: priority ?? undefined,
      search: search ?? undefined,
      labels,
      assignee: assignee ?? undefined,
    })
    return c.json(result)
  })

  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const body = issuesService.createIssueSchema.parse(await c.req.json())
    const user = c.get('user')
    const result = await issuesService.create(db, projectId, body, user.sub)
    return c.json(result, 201)
  })

  .get('/:issueId', async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
    if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
    const result = await issuesService.getById(db, issue.id)
    return c.json(result)
  })

  .get('/:issueId/sub-issues', async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
    if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
    const result = await issuesService.listSubIssues(db, issue.id)
    return c.json(result)
  })

  .patch('/:issueId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
    if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
    const body = issuesService.updateIssueSchema.parse(await c.req.json())
    const user = c.get('user')
    const result = await issuesService.update(db, issue.id, body, user.sub, c.env, user.displayName)
    return c.json(result)
  })

  .delete('/:issueId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
    if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
    await issuesService.remove(db, issue.id)
    return c.json({ ok: true })
  })

  .post('/:issueId/labels', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const issueId = c.req.param('issueId')!
    const { label_id } = await c.req.json() as { label_id: string }
    await issuesService.addLabel(db, issueId, label_id)
    return c.json({ ok: true })
  })

  .delete('/:issueId/labels/:labelId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const issueId = c.req.param('issueId')!
    const labelId = c.req.param('labelId')!
    await issuesService.removeLabel(db, issueId, labelId)
    return c.json({ ok: true })
  })

  .post('/:issueId/assignees', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const issueId = c.req.param('issueId')!
    const { assignee_id } = await c.req.json() as { assignee_id: string }
    await issuesService.addAssignee(db, issueId, assignee_id)
    return c.json({ ok: true })
  })

  .delete('/:issueId/assignees/:assigneeId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const issueId = c.req.param('issueId')!
    const assigneeId = c.req.param('assigneeId')!
    await issuesService.removeAssignee(db, issueId, assigneeId)
    return c.json({ ok: true })
  })
