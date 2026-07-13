import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as pagesService from '../services/pages'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'

async function resolveWorkspaceId(env: Env['DB'], slug: string): Promise<string> {
  const db = getDb(env)
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, slug)).limit(1)
  if (!ws) throw new HTTPException(404, { message: 'Workspace not found' })
  return ws.id
}

export const pageRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug)
    const result = await pagesService.list(db, workspaceId)
    return c.json(result)
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug)
    const user = c.get('user')
    const body = pagesService.createPageSchema.parse(await c.req.json())
    const result = await pagesService.create(db, workspaceId, user.sub, body)
    return c.json(result, 201)
  })
  .get('/:pageId', async (c) => {
    const db = getDb(c.env.DB)
    const pageId = c.req.param('pageId')!
    const result = await pagesService.getById(db, pageId)
    return c.json(result)
  })
  .patch('/:pageId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const pageId = c.req.param('pageId')!
    const body = pagesService.updatePageSchema.parse(await c.req.json())
    const result = await pagesService.update(db, pageId, body)
    return c.json(result)
  })
  .delete('/:pageId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const pageId = c.req.param('pageId')!
    await pagesService.remove(db, pageId)
    return c.body(null, 204)
  })
  .get('/:pageId/backlinks', authMiddleware, (c) => c.json([]))
