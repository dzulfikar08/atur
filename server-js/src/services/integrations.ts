import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as integrationsRepo from '../repositories/integrations'
import { HTTPException } from 'hono/http-exception'

export const createIntegrationSchema = z.object({
  service: z.string().min(1),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
})

export async function create(db: DbClient, userId: string, workspaceId: string, data: z.infer<typeof createIntegrationSchema>) {
  return integrationsRepo.create(db, {
    service: data.service,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId,
    workspaceId,
  })
}

export async function getById(db: DbClient, id: string) {
  const integration = await integrationsRepo.findById(db, id)
  if (!integration) throw new HTTPException(404, { message: 'Integration not found' })
  return integration
}

export async function list(db: DbClient, workspaceId: string) {
  return integrationsRepo.listByWorkspace(db, workspaceId)
}

export async function remove(db: DbClient, id: string) {
  const integration = await integrationsRepo.findById(db, id)
  if (!integration) throw new HTTPException(404, { message: 'Integration not found' })
  await integrationsRepo.remove(db, id)
}
