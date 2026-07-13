import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as membersService from '../services/members'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { z } from 'zod'

async function resolveWorkspaceId(env: Env['DB'], slug: string): Promise<string> {
  const db = getDb(env)
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, slug)).limit(1)
  if (!ws) throw new HTTPException(404, { message: 'Workspace not found' })
  return ws.id
}

const addMemberSchema = z.object({
  member_id: z.string().uuid(),
  role: z.number().int().optional(),
})

export const memberRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug)
    const result = await membersService.listWorkspaceMembers(db, workspaceId)
    return c.json(result)
  })
  .post('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const slug = c.req.param('slug')!
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug)
    const body = addMemberSchema.parse(await c.req.json())
    const result = await membersService.addWorkspaceMember(db, workspaceId, body.member_id, body.role)
    return c.json(result, 201)
  })
  .delete('/:memberId', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const memberId = c.req.param('memberId')!
    await membersService.removeWorkspaceMember(db, memberId)
    return c.body(null, 204)
  })
