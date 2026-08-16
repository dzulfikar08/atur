import { Hono, type Context } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import { paginationParams, paginatedResponse } from '../lib/pagination'
import * as commentsService from '../services/comments'
import * as issuesRepo from '../repositories/issues'
import { HTTPException } from 'hono/http-exception'

async function resolveIssueId(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB)
  const projectId = c.req.param('projectId')!
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param('issueId')!)
  if (!issue) throw new HTTPException(404, { message: 'Issue not found' })
  return issue.id
}

export const commentRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', async (c) => {
    const db = getDb(c.env.DB)
    const issueId = await resolveIssueId(c)
    const { offset, limit } = paginationParams(c)
    const comments = await commentsService.list(db, issueId, offset, limit)
    return c.json(paginatedResponse(comments, comments.length, offset, limit))
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const issueId = await resolveIssueId(c)
    const body = commentsService.createCommentSchema.parse(await c.req.json())
    const comment = await commentsService.create(db, user.sub, issueId, body)
    return c.json(comment, 201)
  })
  .patch('/:commentId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const commentId = c.req.param('commentId')!
    const body = commentsService.updateCommentSchema.parse(await c.req.json())
    const comment = await commentsService.update(db, user.sub, commentId, body)
    return c.json(comment)
  })
  .delete('/:commentId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const commentId = c.req.param('commentId')!
    await commentsService.remove(db, user.sub, commentId)
    return c.json({ success: true })
  })
