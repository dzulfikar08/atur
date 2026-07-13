import { Hono } from 'hono'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as assetsService from '../services/assets'
import { HTTPException } from 'hono/http-exception'

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
    const result = await assetsService.getAsset(db, c.env, id)
    c.header('Content-Type', result.contentType)
    c.header('Content-Length', result.size?.toString() || '0')
    return c.body(result.body as ReadableStream)
  })
