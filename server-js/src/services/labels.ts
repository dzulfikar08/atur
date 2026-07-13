import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as labelsRepo from '../repositories/labels'
import { HTTPException } from 'hono/http-exception'

export const createLabelSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  description: z.string().optional(),
  parent_id: z.string().optional(),
})

export async function create(
  db: DbClient,
  workspaceId: string,
  projectId: string | undefined,
  data: z.infer<typeof createLabelSchema>
) {
  return labelsRepo.create(db, {
    name: data.name,
    color: data.color,
    workspaceId,
    projectId,
    parentId: data.parent_id,
    description: data.description,
  })
}

export async function getById(db: DbClient, id: string) {
  const label = await labelsRepo.findById(db, id)
  if (!label) throw new HTTPException(404, { message: 'Label not found' })
  return label
}

export async function list(db: DbClient, projectId: string, workspaceId: string) {
  return { results: await labelsRepo.listByProject(db, projectId, workspaceId) }
}

export const updateLabelSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  description: z.string().optional(),
  parent_id: z.string().nullable().optional(),
}).partial().refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function update(db: DbClient, id: string, data: z.infer<typeof updateLabelSchema>) {
  const existing = await labelsRepo.findById(db, id)
  if (!existing) throw new HTTPException(404, { message: 'Label not found' })
  const updateData: Record<string, unknown> = { ...data }
  if (data.parent_id !== undefined) {
    updateData.parentId = data.parent_id
    delete updateData.parent_id
  }
  return labelsRepo.update(db, id, updateData)
}

export async function remove(db: DbClient, id: string) {
  const existing = await labelsRepo.findById(db, id)
  if (!existing) throw new HTTPException(404, { message: 'Label not found' })
  await labelsRepo.remove(db, id)
}
