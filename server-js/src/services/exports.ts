import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as exportsRepo from '../repositories/exports'

export const createExportSchema = z.object({
  service: z.string().min(1),
  project_id: z.string().uuid().optional(),
})

export async function create(db: DbClient, userId: string, workspaceId: string, data: z.infer<typeof createExportSchema>) {
  return exportsRepo.create(db, {
    service: data.service,
    projectId: data.project_id,
    workspaceId,
    createdById: userId,
  })
}

export async function list(db: DbClient, workspaceId: string) {
  return exportsRepo.listByWorkspace(db, workspaceId)
}
