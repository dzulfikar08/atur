import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import { paginationParams, paginatedResponse } from '../lib/pagination'
import * as workspaceService from '../services/workspaces'

export const workspaceRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const { offset, limit } = paginationParams(c)
    const { rows, total } = await workspaceService.list(db, user.sub, offset, limit)
    return c.json(paginatedResponse(rows, total, offset, limit))
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const body = workspaceService.createWorkspaceSchema.parse(await c.req.json())
    const workspace = await workspaceService.create(db, user.sub, body)
    return c.json(workspace, 201)
  })
  .get('/:slug', async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const workspace = await workspaceService.getBySlug(db, slug)
    return c.json(workspace)
  })
  .patch('/:slug', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const body = workspaceService.updateWorkspaceSchema.parse(await c.req.json())
    const workspace = await workspaceService.update(db, slug, body)
    return c.json(workspace)
  })
  .delete('/:slug', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    await workspaceService.remove(db, slug)
    return c.body(null, 204)
  })
