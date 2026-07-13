import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as importsRepo from '../repositories/imports'

export const createImportSchema = z.object({
  service: z.string().min(1),
  data: z.string().optional(),
})

export async function create(db: DbClient, userId: string, workspaceId: string, data: z.infer<typeof createImportSchema>) {
  return importsRepo.create(db, {
    service: data.service,
    data: data.data,
    workspaceId,
    createdById: userId,
  })
}

export async function list(db: DbClient, workspaceId: string) {
  return importsRepo.listByWorkspace(db, workspaceId)
}
