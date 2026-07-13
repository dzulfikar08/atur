import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import { paginationParams, paginatedResponse } from '../lib/pagination'
import * as notificationService from '../services/notifications'

export const notificationRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get('/', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const { offset, limit } = paginationParams(c)
    const { data, total } = await notificationService.list(db, user.sub, offset, limit)
    return c.json(paginatedResponse(data, total, offset, limit))
  })
  .get('/unread-count', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const count = await notificationService.unreadCount(db, user.sub)
    return c.json({ count })
  })
  .patch('/:id', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const id = c.req.param('id')!
    const body = (await c.req.json().catch(() => ({}))) as { read?: boolean; archived?: boolean }
    await notificationService.update(db, id, user.sub, body)
    return c.json({ ok: true })
  })
  .post('/mark-all-read', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    await notificationService.markAllRead(db, user.sub)
    return c.json({ ok: true })
  })
