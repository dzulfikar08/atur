import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { paginationParams } from '../lib/pagination'
import * as workspaceRepo from '../repositories/workspaces'
import * as portalService from '../services/portal'
import { portalAuthMiddleware, setPortalCookie, clearPortalCookie } from '../middleware/portalAuth'

export const portalRoutes = new Hono<{ Bindings: Env }>({ strict: false })

// Resolve the workspace from the URL slug. Throws 404 if unknown.
async function resolveWorkspace(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB)
  const slug = c.req.param('slug')!
  const workspace = await workspaceRepo.findBySlug(db, slug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  return workspace
}

// ── Auth (public) ──

portalRoutes.post('/:slug/auth/request-otp', async (c) => {
  const db = getDb(c.env.DB)
  const kv = c.env.RATE_LIMIT
  if (!kv) throw new HTTPException(500, { message: 'KV namespace not configured' })
  const workspace = await resolveWorkspace(c)
  const body = portalService.requestOtpSchema.parse(await c.req.json())
  const result = await portalService.requestOtp(db, kv, c.env, workspace.id, body)
  return c.json(result)
})

portalRoutes.post('/:slug/auth/verify-otp', async (c) => {
  const db = getDb(c.env.DB)
  const kv = c.env.RATE_LIMIT
  if (!kv) throw new HTTPException(500, { message: 'KV namespace not configured' })
  const workspace = await resolveWorkspace(c)
  const body = portalService.verifyOtpSchema.parse(await c.req.json())
  const { customer, token } = await portalService.verifyOtp(db, kv, workspace.id, body)
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Email not associated with this workspace' })
  }
  setPortalCookie(c, token)
  return c.json({ customer })
})

portalRoutes.post('/:slug/auth/sign-out', portalAuthMiddleware, async (c) => {
  const db = getDb(c.env.DB)
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  await portalService.clearSession(db, customer.id)
  clearPortalCookie(c)
  return c.json({ ok: true })
})

portalRoutes.get('/:slug/auth/me', portalAuthMiddleware, async (c) => {
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  return c.json({ customer })
})

// ── Tickets (portal-authenticated, workspace-scoped) ──

portalRoutes.get('/:slug/tickets', portalAuthMiddleware, async (c) => {
  const db = getDb(c.env.DB)
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  const { offset, limit } = paginationParams(c)
  const result = await portalService.listTickets(db, customer, { offset, limit })
  return c.json(result)
})

portalRoutes.post('/:slug/tickets', portalAuthMiddleware, async (c) => {
  const db = getDb(c.env.DB)
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  const body = portalService.createTicketSchema.parse(await c.req.json())
  const issue = await portalService.createTicket(db, customer, body)
  return c.json(issue, 201)
})

portalRoutes.get('/:slug/tickets/:seqId', portalAuthMiddleware, async (c) => {
  const db = getDb(c.env.DB)
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  const seqId = Number(c.req.param('seqId')!)
  const result = await portalService.getTicket(db, customer, seqId)
  return c.json(result)
})

portalRoutes.post('/:slug/tickets/:seqId/comments', portalAuthMiddleware, async (c) => {
  const db = getDb(c.env.DB)
  const workspace = await resolveWorkspace(c)
  const customer = c.get('customer')
  if (customer.workspaceId !== workspace.id) {
    throw new HTTPException(403, { message: 'Wrong workspace' })
  }
  const seqId = Number(c.req.param('seqId')!)
  const body = portalService.addCommentSchema.parse(await c.req.json())
  const comment = await portalService.addTicketComment(db, customer, seqId, body)
  return c.json(comment, 201)
})
