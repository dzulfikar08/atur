import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as statesRepo from '../repositories/states'
import { HTTPException } from 'hono/http-exception'

export const createStateSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  group: z.string().min(1),
  description: z.string().optional(),
  slug: z.string().optional(),
})

export async function create(
  db: DbClient,
  projectId: string,
  workspaceId: string,
  data: z.infer<typeof createStateSchema>
) {
  return statesRepo.create(db, {
    name: data.name,
    color: data.color || '#808080',
    groupName: data.group,
    description: data.description,
    slug: data.slug,
    projectId,
    workspaceId,
  })
}

export async function getById(db: DbClient, id: string) {
  const state = await statesRepo.findById(db, id)
  if (!state) throw new HTTPException(404, { message: 'State not found' })
  return state
}

export async function list(db: DbClient, projectId: string) {
  return { results: await statesRepo.listByProject(db, projectId) }
}

export const updateStateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  group_name: z.string().min(1).optional(),
  description: z.string().optional(),
  slug: z.string().optional(),
}).partial().refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function update(db: DbClient, id: string, data: z.infer<typeof updateStateSchema>) {
  const existing = await statesRepo.findById(db, id)
  if (!existing) throw new HTTPException(404, { message: 'State not found' })
  const updateData: Record<string, unknown> = { ...data }
  if (data.group_name !== undefined) updateData.groupName = data.group_name
  delete updateData.group_name
  return statesRepo.update(db, id, updateData)
}

export async function remove(db: DbClient, id: string) {
  const existing = await statesRepo.findById(db, id)
  if (!existing) throw new HTTPException(404, { message: 'State not found' })
  await statesRepo.remove(db, id)
}
