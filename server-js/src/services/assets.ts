import { z } from 'zod'
import type { DbClient } from '../db/index'
import type { Env } from '../lib/env'
import * as assetsRepo from '../repositories/assets'
import { HTTPException } from 'hono/http-exception'

export const uploadSchema = z.object({
  entityId: z.string().uuid().optional(),
  entityType: z.string().optional(),
})

export async function upload(
  db: DbClient,
  env: Env,
  createdById: string,
  file: File,
  entityId?: string,
  entityType?: string
) {
  const key = `${createdById}/${crypto.randomUUID()}`
  const buffer = await file.arrayBuffer()
  const contentType = file.type || 'application/octet-stream'

  await env.R2.put(key, buffer, {
    httpMetadata: { contentType },
  })

  const asset = await assetsRepo.createAsset(db, {
    asset: key,
    size: file.size,
    contentType,
    createdById,
    entityId,
    entityType,
  })

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
  }
}

export async function getAsset(db: DbClient, env: Env, id: string) {
  const asset = await assetsRepo.findById(db, id)
  if (!asset) {
    throw new HTTPException(404, { message: 'Asset not found' })
  }

  if (!asset.asset) {
    throw new HTTPException(404, { message: 'File not found in storage' })
  }

  const object = await env.R2.get(asset.asset)
  if (!object) {
    throw new HTTPException(404, { message: 'File not found in storage' })
  }

  return {
    body: object.body,
    contentType: asset.contentType ?? 'application/octet-stream',
    size: object.size,
  }
}
