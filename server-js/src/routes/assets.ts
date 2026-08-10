import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as assetsService from '../services/assets'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { extractToken } from '../middleware/auth'
import { PORTAL_COOKIE } from '../middleware/portalAuth'
import * as usersRepo from '../repositories/users'
import * as customersRepo from '../repositories/customers'
import * as membersRepo from '../repositories/members'

export const assetRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .post('/upload', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')

    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      throw new HTTPException(400, { message: 'File is required' })
    }

    const entityId = formData.get('entityId') as string | null
    const entityType = formData.get('entityType') as string | null

    const result = await assetsService.upload(
      db,
      c.env,
      user.sub,
      file,
      entityId ?? undefined,
      entityType ?? undefined
    )
    return c.json(result, 201)
  })
  .get('/:id', async (c) => {
    const db = getDb(c.env.DB)
    const id = c.req.param('id')!

    // Resolve the requester: a main-app user (any token) or, failing that, a
    // portal customer (portal-session cookie). Asset IDs are NOT public —
    // anonymous requests are rejected.
    const token = extractToken(c)
    let userId: string | null = null
    if (token) {
      const u = await usersRepo.findByToken(db, token)
      if (u) userId = u.id
    }
    let customer: customersRepo.CustomerRow | null = null
    if (!userId) {
      const portalToken = getCookie(c, PORTAL_COOKIE)
      if (portalToken) customer = await customersRepo.findBySessionToken(db, portalToken)
    }
    if (!userId && !customer) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const result = await assetsService.getAsset(db, c.env, id)
    const ownerId = result.asset.createdById

    // Authorize. Assets are either portal-uploaded (owner is a customer) or
    // internal (owner is a workspace user).
    const ownerCustomer = await customersRepo.findById(db, ownerId)
    if (customer) {
      if (ownerCustomer) {
        // Another customer's upload: only the owner may view it.
        if (ownerCustomer.id !== customer.id) {
          throw new HTTPException(403, { message: 'Forbidden' })
        }
      } else {
        // Internal asset: allow only if its owner is a member of this
        // customer's workspace (support staff sharing in their ticket).
        const ok = await membersRepo.isWorkspaceMember(db, customer.workspaceId, ownerId)
        if (!ok) throw new HTTPException(403, { message: 'Forbidden' })
      }
    } else if (ownerCustomer) {
      // Portal asset requested by a main-app user: allow only for members of
      // the owning customer's workspace.
      const ok = await membersRepo.isWorkspaceMember(db, ownerCustomer.workspaceId, userId!)
      if (!ok) throw new HTTPException(403, { message: 'Forbidden' })
    }
    // Internal asset requested by a main-app user: allowed.

    c.header('Content-Type', result.contentType)
    c.header('Content-Length', result.size?.toString() || '0')
    return c.body(result.body as ReadableStream)
  })
