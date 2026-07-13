import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as customFieldsService from '../services/customFields'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'

async function resolveWorkspaceId(env: Env['DB'], slug: string): Promise<string> {
  const db = getDb(env)
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, slug)).limit(1)
  if (!ws) throw new HTTPException(404, { message: 'Workspace not found' })
  return ws.id
}

export const customFieldRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', async (c) => {
    const db = getDb(c.env.DB)
    const projectId = c.req.param('projectId')!
    const result = await customFieldsService.list(db, projectId)
    return c.json(result)
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const projectId = c.req.param('projectId')!
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug)
    const body = customFieldsService.createCustomFieldSchema.parse(await c.req.json())
    const result = await customFieldsService.create(db, projectId, workspaceId, body)
    return c.json(result, 201)
  })
  .patch('/:fieldId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const fieldId = c.req.param('fieldId')!
    const body = customFieldsService.updateCustomFieldSchema.parse(await c.req.json())
    const result = await customFieldsService.update(db, fieldId, body)
    return c.json(result)
  })
  .delete('/:fieldId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const fieldId = c.req.param('fieldId')!
    await customFieldsService.remove(db, fieldId)
    return c.body(null, 204)
  })
